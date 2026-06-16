/**
 * Quota enforcer — proactively suspend running VMs once consumed >= total.
 *
 * Until 2026-05-22 the only quota gate was inside vmStateReconciler.js — it ran
 * ONLY when a VM was stopped externally. A running VM could blow past its cap
 * (e.g. EY: jude.akash hit 81.8h on a 50h cap because the cap was raised then
 * lowered after-the-fact). This enforcer closes that gap.
 *
 * Behaviour:
 *   - Find isAlive=true, isRunning=true, quota.total>0, consumed >= total.
 *   - Mark isAlive=false, remarks='Quota Exceeded — extend quota to restore'.
 *   - Queue azure-stop-vm (same path idleShutdown uses) → worker snapshots disk
 *     then deletes the VM resource. NIC + snapshot remain.
 *   - On quota extension via /quota POST the existing controller already flips
 *     isAlive back to true (see controllers/quota.js handleIncreaseQuota); the
 *     learner can then click Start to recreate from the preserved snapshot.
 */

const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('azure-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 }
  });
} catch (_) {
  // Worker queue unavailable — enforcer becomes a no-op except for DB marking.
}

async function quotaEnforcer() {
  const offenders = await VM.find({
    isAlive: true,
    isRunning: true,
    cloud: { $ne: "aws" },
    'quota.total': { $gt: 0 },
    $expr: { $gte: ['$quota.consumed', '$quota.total'] },
  }).select('name vmName resourceGroup email organization trainingName quota');

  if (offenders.length === 0) return;

  logger.warn(`[quotaEnforcer] ${offenders.length} VMs at/over quota — suspending`);

  for (const vm of offenders) {
    try {
      const c = vm.quota?.consumed || 0;
      const t = vm.quota?.total || 0;
      logger.warn(`[quotaEnforcer] ${vm.name} (${vm.email}) ${c}/${t} min — queueing stop+snapshot+delete`);

      vm.isAlive = false;
      vm.isRunning = false;
      vm.remarks = 'Quota Exceeded — extend quota to restore';
      vm.stoppingUntil = new Date(Date.now() + 90 * 1000);
      await vm.save();

      if (stopQueue) {
        await stopQueue.add({
          name: vm.name,
          resourceGroup: vm.resourceGroup,
          reason: 'quota_exceeded',
        });
      }
    } catch (err) {
      logger.error(`[quotaEnforcer] failed on ${vm.name}: ${err.message}`);
    }
  }
}

module.exports = { quotaEnforcer };
