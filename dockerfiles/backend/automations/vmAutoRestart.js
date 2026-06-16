/**
 * VM Auto-Restart
 *
 * Runs every 3 minutes. Keeps VMs from specific "always-on" trainings
 * running by detecting any that are deallocated/stopped on Azure and
 * restarting them automatically.
 *
 * SCOPED: Only applies to trainings listed in ALWAYS_ON_TRAININGS.
 * Other VMs are untouched — users can stop/start them freely from the
 * portal without this automation interfering.
 *
 * Add a trainingName to ALWAYS_ON_TRAININGS to opt a batch in.
 *
 * This catches:
 *   - Spot evictions (Azure reclaims capacity)
 *   - External stops (someone stopped VM in Azure Portal)
 *   - VMs the reconciler already flipped to isRunning=false
 *   - Failed restart attempts from the spot eviction handler
 */
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const computeClient = new ComputeManagementClient(credential, subscriptionId);
const networkClient = new NetworkManagementClient(credential, subscriptionId);

// ── Only these trainings get auto-restarted ─────────────────────────
// Add training names here to keep their VMs always running.
// VMs from any other training are ignored by this automation.
const ALWAYS_ON_TRAININGS = [
  'shael',
];

/**
 * Get the public IP of a running VM.
 */
async function getVmPublicIp(resourceGroup, vmName, fallbackIp) {
  try {
    const azVm = await computeClient.virtualMachines.get(resourceGroup, vmName, { expand: 'instanceView' });
    const nicId = azVm.networkProfile?.networkInterfaces?.[0]?.id;
    if (!nicId) return fallbackIp;

    const nicName = nicId.split('/').pop();
    const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
    const pipId = nic.ipConfigurations?.[0]?.publicIPAddress?.id;
    if (!pipId) return fallbackIp;

    const pipName = pipId.split('/').pop();
    const pip = await networkClient.publicIPAddresses.get(resourceGroup, pipName);
    return pip.ipAddress || fallbackIp;
  } catch {
    return fallbackIp;
  }
}

/**
 * Main auto-restart handler.
 */
async function vmAutoRestart() {
  try {
    // Only target alive Azure VMs from always-on trainings
    const aliveVms = await VM.find({
      isAlive: true,
      cloud: { $ne: 'aws' },
      os: { $not: /RDS Session/ },
      trainingName: { $in: ALWAYS_ON_TRAININGS },
    });

    if (!aliveVms.length) return;

    let restarted = 0;
    let dbFixed = 0;

    for (const vm of aliveVms) {
      try {
        // Skip VMs in the middle of a platform stop sequence
        if (vm.stoppingUntil && new Date(vm.stoppingUntil) > new Date()) continue;

        // Skip build VMs
        if (vm.isBuildVM) continue;

        // Skip VMs that exceeded quota
        const consumedHours = vm.quota?.consumed || 0;
        const totalHours = vm.quota?.total || Infinity;
        if (consumedHours >= totalHours) continue;

        // Check Azure power state
        let powerState;
        try {
          const azVm = await computeClient.virtualMachines.get(vm.resourceGroup, vm.name, { expand: 'instanceView' });
          const statuses = azVm.instanceView?.statuses || [];
          const ps = statuses.find(s => s.code?.startsWith('PowerState/'));
          powerState = ps?.code?.replace('PowerState/', '') || 'unknown';
        } catch (err) {
          if (err.statusCode === 404 || err.code === 'ResourceNotFound') {
            powerState = 'deleted';
          } else {
            continue; // Skip on transient API errors
          }
        }

        // VM is running — make sure DB reflects that
        if (powerState === 'running' || powerState === 'starting') {
          if (!vm.isRunning) {
            await VM.updateOne({ _id: vm._id }, {
              $set: { isRunning: true, lastActivityAt: new Date(), remarks: 'Running (auto-resynced)' },
            });
            logger.info(`[auto-restart] ${vm.name}: Azure=running but DB=stopped — fixed DB`);
            dbFixed++;
          }
          continue;
        }

        // VM is deallocated or stopped — restart it
        if (powerState === 'deallocated' || powerState === 'stopped') {
          logger.warn(`[auto-restart] ${vm.name} is ${powerState} — starting VM...`);

          try {
            await computeClient.virtualMachines.beginStartAndWait(vm.resourceGroup, vm.name);

            // Get new public IP (Spot restart may assign a new one)
            const newIp = await getVmPublicIp(vm.resourceGroup, vm.name, vm.publicIp);

            // Update DB — mark running, open new log entry if needed
            const update = {
              $set: {
                isRunning: true,
                publicIp: newIp,
                lastActivityAt: new Date(),
                remarks: 'Running (auto-restarted)',
                stopAttempts: 0,
              },
            };

            // If there's no open log entry, push a new one
            const hasOpenLog = vm.logs?.some(l => !l.stop);
            if (!hasOpenLog) {
              update.$push = { logs: { start: new Date() } };
            }

            await VM.updateOne({ _id: vm._id }, update);

            logger.info(`[auto-restart] ${vm.name} restarted successfully. IP: ${newIp}`);
            restarted++;
          } catch (startErr) {
            logger.error(`[auto-restart] ${vm.name} restart failed: ${startErr.message}`);
            // Don't give up — next cycle will retry
          }
          continue;
        }

        // VM is deleted in Azure — can't restart, leave for snapshot recovery
        if (powerState === 'deleted') {
          if (vm.isRunning) {
            await VM.updateOne({ _id: vm._id }, {
              $set: {
                isRunning: false,
                remarks: 'VM deleted on Azure — click Start to recover from snapshot',
              },
            });
            logger.warn(`[auto-restart] ${vm.name} deleted on Azure — marked stopped, needs snapshot recovery`);
          }
          continue;
        }

        // Unknown/transitional state — skip, let next cycle catch it
      } catch (err) {
        logger.error(`[auto-restart] Error processing ${vm.name}: ${err.message}`);
      }
    }

    if (restarted > 0 || dbFixed > 0) {
      logger.info(`[auto-restart] Cycle complete: ${restarted} VMs restarted, ${dbFixed} DB states fixed`);
    }
  } catch (err) {
    logger.error(`[auto-restart] Handler error: ${err.message}`);
  }
}

module.exports = { vmAutoRestart };
