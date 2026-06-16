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

  // PATCH 2026-05-25 v2: Skip if ANY recency signal suggests this doc was just
  // touched (recovery, bulk-restore, recent log activity). Reconciler runs every
  // 5 min; deferring one cycle is safe. EY cohort lost 37 VMs to this race during
  // the 2026-05-23 outage; v1 patch only checked createdAt/log.start which both
  // miss the "bulk-restored VM" case where Mongo doc is old but Azure VM is new.
  const SAFE_WINDOW_MS = 30 * 60 * 1000;  // patched 2026-06-07: 10->30 min, covers bulk-stop wait when worker fleet is saturated
  const lastLog = vmDoc.logs?.[vmDoc.logs.length - 1];
  const sigs = [vmDoc.updatedAt, vmDoc.lastActivityAt, lastLog?.start, lastLog?.stop]
    .filter(Boolean)
    .map(t => new Date(t).getTime());
  const newestSignal = sigs.length ? Math.max.apply(null, sigs) : 0;
  if (newestSignal > 0 && (Date.now() - newestSignal) < SAFE_WINDOW_MS) {
    logger.info(`[reconciler] ${vmDoc.name}: skipping — touched ${Math.round((Date.now() - newestSignal) / 60000)}m ago (safety window)`);
    return;
  }

  // 1. Close the open log entry
  const logIndex = vmDoc.logs.findIndex(log => !log.stop);
  let durationMins = 0;

  if (logIndex !== -1) {
    const startTime = new Date(vmDoc.logs[logIndex].start);
    const rawDuration = Math.ceil((currentTime - startTime) / 60000);
    // PATCH 2026-05-25 v2: HARD CAP on stale open log entries. If a log entry
    // has been open > 24h, something went wrong (idleShutdown auto-stops at
    // 30 min); the previous destruction never closed the log, so charging
    // "real elapsed time" inflates quota by hundreds of hours. Cap at
    // idleThreshold instead. Legitimate sessions <24h still charge correctly.
    const STALE_LOG_THRESHOLD_MIN = 24 * 60;
    const idleThreshold = vmDoc.idleMinutes || 30;
    if (rawDuration > STALE_LOG_THRESHOLD_MIN) {
      durationMins = idleThreshold;
      logger.warn(`[reconciler] ${vmDoc.name}: stale open log (${Math.round(rawDuration/60)}h old) — clamping duration to ${idleThreshold}m to prevent quota inflation`);
    } else {
      durationMins = rawDuration;
    }
  }

  const totalDuration = (vmDoc.duration || 0) + durationMins;
  const consumedQuota = Math.round(((vmDoc.quota?.consumed || 0) + durationMins / 60) * 100) / 100;  // patched 2026-06-07: consumed stored as HOURS, was adding minutes (unit mismatch)

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

  if (consumedQuota * 60 >= (vmDoc.quota?.total || Infinity)) {  // patched 2026-06-07: HOURS->MINUTES normalize
    updatePayload.isAlive = false;
    updatePayload.remarks = 'Quota Exceeded (reconciled)';
  }

  await VM.updateOne({ _id: vmDoc._id }, { $set: updatePayload });

  logger.info(`[reconciler] ${vmDoc.name}: DB updated (was ${powerState} externally, duration: ${durationMins} min, total: ${totalDuration} min)`);

  // 2. If VM still exists (deallocated/stopped but not deleted), do NOT queue
  //    destructive stop (snapshot+delete). The vmAutoRestart automation will
  //    restart the VM on its next 3-minute cycle. Previously this queued
  //    snapshot+delete which permanently destroyed spot-evicted VMs before
  //    the eviction handler could restart them.
  if (powerState === 'deallocated' || powerState === 'stopped') {
    logger.info(`[reconciler] ${vmDoc.name}: deallocated — skipping destructive stop queue, vmAutoRestart will handle recovery`);
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
      cloud: { $ne: "aws" },
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

        if (powerState === 'unknown') {
          // Transient API state (mid-deallocation, eventual consistency, etc.).
          // Don't reconcile — that would mark isRunning=false WITHOUT queuing
          // the snapshot+delete cleanup, leaving the OS disk attached and billing
          // forever. Skip; the next 5-min cycle will catch it once Azure settles.
          logger.info(`[reconciler] ${vm.name}: Azure returned 'unknown' — likely transient, skipping this cycle`);
          continue;
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

    // REVERSE-SYNC for always-on cohorts (admintrack): when Azure has the VM
    // running but DB says isRunning=false (e.g. external recovery via az vm start
    // after a Spot eviction), flip mongo back to isRunning=true so the portal
    // UI matches reality. Scoped to trainingName='admintrack' only — other VMs
    // may be intentionally stopped by their learner and shouldn't be flipped.
    const alwaysOnDown = await VM.find({
      isRunning: false,
      isAlive: true,
      trainingName: 'admintrack',
      os: { $not: /RDS Session/ },
    });

    let reverseSynced = 0;
    for (const vm of alwaysOnDown) {
      try {
        const powerState = await getVmPowerState(vm.resourceGroup, vm.name);
        if (powerState === 'running') {
          await VM.updateOne(
            { _id: vm._id },
            { $set: { isRunning: true, remarks: 'Running (auto-resynced)' } }
          );
          logger.info(`[reconciler] ${vm.name}: Azure=running, DB was isRunning=false — flipped DB to true`);
          reverseSynced++;
        }
      } catch (err) {
        logger.error(`[reconciler] reverse-sync failed for ${vm.name}: ${err.message}`);
      }
    }
    if (reverseSynced > 0) {
      logger.info(`[reconciler] Reverse-synced ${reverseSynced} admintrack VMs (DB was stale-down, Azure was running)`);
    }
  } catch (err) {
    logger.error(`[reconciler] VM state reconciler error: ${err.message}`);
  }
}

module.exports = { vmStateReconciler };
