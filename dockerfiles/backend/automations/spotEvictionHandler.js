/**
 * Spot Eviction Handler
 *
 * Runs every 5 minutes. Detects Azure Spot VMs that were evicted
 * (deallocated by Azure due to capacity) and auto-restarts them
 * from their latest snapshot.
 *
 * How it works:
 *   1. Find all VMs in DB where isRunning=true, isAlive=true
 *   2. Check Azure power state for each
 *   3. If VM is 'deallocated' and was NOT stopped by our system (no recent stop log),
 *      it was likely Spot-evicted
 *   4. Try to restart the VM (Azure may have capacity again)
 *   5. If restart fails (VM deleted), recreate from latest snapshot
 *   6. Update DB with new IP
 */
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');
const { cascadeRdsSessions } = require('../services/rdsCascade');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const computeClient = new ComputeManagementClient(credential, subscriptionId);
const networkClient = new NetworkManagementClient(credential, subscriptionId);

async function spotEvictionHandler() {
  try {
    // Skip RDS session entries — they're user accounts on the RDS host,
    // not separate Azure VMs. Azure lookup 404s and this would wrongly
    // flag them as spot-evicted.
    const runningVms = await VM.find({
      isRunning: true,
      isAlive: true,
      os: { $not: /RDS Session/ },
    });
    if (!runningVms.length) return;

    let recovered = 0;

    for (const vm of runningVms) {
      try {
        // Check Azure power state
        let powerState;
        try {
          const azVm = await computeClient.virtualMachines.get(vm.resourceGroup, vm.name, { expand: 'instanceView' });
          const statuses = azVm.instanceView?.statuses || [];
          const ps = statuses.find(s => s.code?.startsWith('PowerState/'));
          powerState = ps?.code?.replace('PowerState/', '') || 'unknown';
        } catch (err) {
          if (err.statusCode === 404) {
            powerState = 'deleted';
          } else {
            continue; // Skip on API errors
          }
        }

        // Skip if running — all good
        if (powerState === 'running' || powerState === 'starting') continue;

        // Skip if we recently stopped it (within last 10 min) — that's intentional
        const lastLog = vm.logs?.[vm.logs.length - 1];
        if (lastLog?.stop) {
          const stoppedRecently = (Date.now() - new Date(lastLog.stop).getTime()) < 10 * 60 * 1000;
          if (stoppedRecently) continue;
        }

        // VM is deallocated/stopped but DB says running — likely Spot eviction
        logger.warn(`[spot-eviction] ${vm.name} is ${powerState} but DB says running — likely Spot eviction. Attempting recovery...`);

        if (powerState === 'deallocated' || powerState === 'stopped') {
          // Try simple restart first
          try {
            await computeClient.virtualMachines.beginStartAndWait(vm.resourceGroup, vm.name);

            // Get new IP
            const updatedVm = await computeClient.virtualMachines.get(vm.resourceGroup, vm.name, { expand: 'instanceView' });
            const nicId = updatedVm.networkProfile?.networkInterfaces?.[0]?.id;
            let newIp = vm.publicIp;
            if (nicId) {
              const nicName = nicId.split('/').pop();
              try {
                const nic = await networkClient.networkInterfaces.get(vm.resourceGroup, nicName);
                const pipId = nic.ipConfigurations?.[0]?.publicIPAddress?.id;
                if (pipId) {
                  const pipName = pipId.split('/').pop();
                  const pip = await networkClient.publicIPAddresses.get(vm.resourceGroup, pipName);
                  newIp = pip.ipAddress || vm.publicIp;
                }
              } catch {}
            }

            await VM.updateOne({ _id: vm._id }, {
              $set: { publicIp: newIp, lastActivityAt: new Date(), remarks: 'Recovered from Spot eviction' },
            });

            logger.info(`[spot-eviction] ${vm.name} restarted successfully. IP: ${newIp}`);
            recovered++;
          } catch (startErr) {
            logger.error(`[spot-eviction] ${vm.name} restart failed: ${startErr.message}. Will try snapshot recovery on next cycle.`);
            // Mark as not running so the reconciler/start handler can pick it up
            await VM.updateOne({ _id: vm._id }, {
              $set: { isRunning: false, remarks: 'Spot evicted — restart failed, awaiting snapshot recovery' },
            });
            // Pause any RDS session rows tied to this host so the Lab
            // Console doesn't keep showing them as Running.
            await cascadeRdsSessions(vm.name, 'stop').catch(() => {});
          }
        } else if (powerState === 'deleted') {
          // VM was fully deleted — mark for snapshot recovery
          logger.warn(`[spot-eviction] ${vm.name} was deleted (Spot eviction or manual). Marking for recovery.`);
          await VM.updateOne({ _id: vm._id }, {
            $set: { isRunning: false, remarks: 'Spot evicted — VM deleted, click Start to recover from snapshot' },
          });
          await cascadeRdsSessions(vm.name, 'stop').catch(() => {});
        }
      } catch (err) {
        logger.error(`[spot-eviction] Error checking ${vm.name}: ${err.message}`);
      }
    }

    if (recovered > 0) {
      logger.info(`[spot-eviction] Recovered ${recovered} Spot-evicted VMs`);
    }
  } catch (err) {
    logger.error(`[spot-eviction] Handler error: ${err.message}`);
  }
}

module.exports = { spotEvictionHandler };
