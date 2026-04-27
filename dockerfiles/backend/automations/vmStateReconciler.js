/**
 * VM State Reconciler
 *
 * Periodically checks Azure for the actual power state of all VMs
 * that the database thinks are running. If a VM was stopped or
 * deallocated externally (Azure Portal, Spot eviction, etc.),
 * this triggers the proper stop flow:
 *   1. Close the open log entry with correct duration
 *   2. Update quota consumed
 *   3. Queue proper stop (snapshot + delete) via the existing worker
 *   4. Mark isRunning = false in DB
 *
 * Runs every 5 minutes alongside the idle shutdown checker.
 */
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');
const { cascadeRdsSessions } = require('../services/rdsCascade');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const computeClient = new ComputeManagementClient(credential, subscriptionId);

// Bull queue for proper stop (snapshot + cleanup)
let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('azure-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 }
  });
} catch {
  // Queue not available — will handle inline
}

/**
 * Get the power state of an Azure VM.
 * Returns: 'running', 'deallocated', 'stopped', 'deleted', or 'unknown'
 */
async function getVmPowerState(resourceGroup, vmName) {
  try {
    const vm = await computeClient.virtualMachines.get(resourceGroup, vmName, {
      expand: 'instanceView',
    });
    const statuses = vm.instanceView?.statuses || [];
    for (const status of statuses) {
      if (status.code?.startsWith('PowerState/')) {
        const state = status.code.replace('PowerState/', '');
        // Azure returns: running, deallocated, stopped, deallocating, starting
        return state;
      }
    }
    return 'unknown';
  } catch (err) {
    if (err.statusCode === 404 || err.code === 'ResourceNotFound') {
      return 'deleted';
    }
    throw err;
  }
}

/**
 * Handle a VM that was stopped externally — close the log, update quota,
 * and queue proper cleanup (snapshot + delete) if the VM still exists.
 */
async function reconcileStoppedVm(vmDoc, powerState) {
  const currentTime = new Date();

  // 1. Close the open log entry
  const logIndex = vmDoc.logs.findIndex(log => !log.stop);
  let durationMins = 0;

  if (logIndex !== -1) {
    const startTime = new Date(vmDoc.logs[logIndex].start);
    durationMins = Math.ceil((currentTime - startTime) / 60000);
  }

  const totalDuration = (vmDoc.duration || 0) + durationMins;
  const consumedQuota = (vmDoc.quota?.consumed || 0) + durationMins;

  const updatePayload = {
    isRunning: false,
    duration: totalDuration,
    'quota.consumed': consumedQuota,
    remarks: `Reconciled — VM was ${powerState} externally`,
    stopAttempts: 0,   // VM is genuinely stopped now — clear the stuck-stop alert arming
  };

  if (logIndex !== -1) {
    updatePayload[`logs.${logIndex}.stop`] = currentTime;
    updatePayload[`logs.${logIndex}.duration`] = durationMins;
  }

  if (consumedQuota >= (vmDoc.quota?.total || Infinity)) {
    updatePayload.isAlive = false;
    updatePayload.remarks = 'Quota Exceeded (reconciled)';
  }

  await VM.updateOne({ _id: vmDoc._id }, { $set: updatePayload });

  logger.info(`[reconciler] ${vmDoc.name}: DB updated (was ${powerState} externally, duration: ${durationMins} min, total: ${totalDuration} min)`);

  // 2. If VM still exists (deallocated/stopped but not deleted), queue the proper
  //    stop flow so it snapshots the disk and cleans up resources.
  if (powerState === 'deallocated' || powerState === 'stopped') {
    if (stopQueue) {
      try {
        await stopQueue.add({
          name: vmDoc.name,
          resourceGroup: vmDoc.resourceGroup,
          reconciled: true,
        });
        logger.info(`[reconciler] ${vmDoc.name}: queued proper stop (snapshot + cleanup)`);
      } catch (qErr) {
        logger.error(`[reconciler] ${vmDoc.name}: failed to queue stop — ${qErr.message}`);
      }
    } else {
      logger.warn(`[reconciler] ${vmDoc.name}: stop queue unavailable — VM left deallocated (disk still charged). Manual cleanup needed.`);
    }
  } else if (powerState === 'deleted') {
    // VM is gone in Azure. This is the EXPECTED state right after the worker's
    // stop sequence finishes (deallocate -> snapshot -> delete VM -> delete disk).
    // Don't mark isAlive=false — that would hide the VM from the lab console and
    // remove the Start button, blocking snapshot-based recovery. Instead leave
    // the VM recoverable; the existing Start handler will detect the missing VM
    // and recreate it from its latest snapshot.
    logger.warn(`[reconciler] ${vmDoc.name}: missing in Azure — leaving recoverable (Start triggers snapshot recovery).`);
    // If this was an RDS host, the per-user session rows it spawned are
    // now orphaned (same publicIp, but the VM is gone). Cascade so they
    // stop showing as Running and Guacamole stops trying to RDP into a
    // dead IP.
    await cascadeRdsSessions(vmDoc.name, 'delete').catch(e =>
      logger.error(`[reconciler] ${vmDoc.name}: rds cascade failed — ${e.message}`)
    );
  }
}

/**
 * Main reconciler — runs every 5 minutes.
 * Finds VMs the DB thinks are running and checks their actual Azure state.
 */
async function vmStateReconciler() {
  try {
    // Skip RDS session "VMs" — they're logical user accounts on the RDS
    // host, not real Azure VMs. Their os string ends with "(RDS Session)".
    // Looking them up in Azure always 404s and the reconciler would
    // wrongly mark them "Deleted externally — no snapshot".
    const runningVms = await VM.find({
      isRunning: true,
      isAlive: true,
      os: { $not: /RDS Session/ },
    });

    if (!runningVms.length) return;

    let reconciled = 0;

    for (const vm of runningVms) {
      try {
        const powerState = await getVmPowerState(vm.resourceGroup, vm.name);

        if (powerState === 'running' || powerState === 'starting') {
          continue; // All good — DB matches Azure
        }

        // VM is not running in Azure but DB says it is — reconcile
        logger.warn(`[reconciler] ${vm.name}: DB says running but Azure says "${powerState}" — reconciling`);
        await reconcileStoppedVm(vm, powerState);
        reconciled++;
      } catch (err) {
        logger.error(`[reconciler] Failed to check ${vm.name}: ${err.message}`);
      }
    }

    if (reconciled > 0) {
      logger.info(`[reconciler] Reconciled ${reconciled} VMs that were stopped externally`);
    }
  } catch (err) {
    logger.error(`[reconciler] VM state reconciler error: ${err.message}`);
  }
}

module.exports = { vmStateReconciler };
