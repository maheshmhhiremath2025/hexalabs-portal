/**
 * AWS counterpart to automations/quotaEnforcer.js.
 *
 * For every AWS VM where vm.quota.consumed >= vm.quota.total (hours), enqueue
 * aws-stop-vm Bull job and set isAlive=false so subsequent starts are denied.
 *
 * Per memory project_vm_quota_unit_mismatch_fix.md: quota.consumed is HOURS,
 * quota.total is MINUTES — same unit mismatch as Azure; compare consumed*60 vs total.
 *
 * Added 2026-06-16. Env kill switch AWS_QUOTA_ENFORCER_ENABLED (default false).
 */
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('aws-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 },
  });
} catch {}

async function awsQuotaEnforcer() {
  if (process.env.AWS_QUOTA_ENFORCER_ENABLED !== 'true') return;

  const vms = await VM.find({
    cloud: 'aws',
    isRunning: true,
    isAlive: true,
    'quota.total': { $gt: 0 },
  }).select('name cloudInstanceId quota duration trainingName email').lean();
  if (!vms.length) return;

  let stoppedCount = 0;
  for (const vm of vms) {
    const totalMinutes = Number(vm.quota?.total) || 0;
    const consumedHours = Number(vm.quota?.consumed) || 0;
    if (totalMinutes <= 0) continue;
    // consumed=HOURS, total=MINUTES (see memory project_vm_quota_unit_mismatch_fix.md).
    if (consumedHours * 60 < totalMinutes) continue;

    logger.warn(`[aws-quota] ${vm.name} quota exceeded: consumed=${consumedHours.toFixed(2)}h × 60 = ${(consumedHours*60).toFixed(0)}min >= total=${totalMinutes}min`);

    await VM.updateOne({ _id: vm._id }, {
      $set: { isAlive: false, remarks: 'Quota Exceeded' },
    });
    if (stopQueue) {
      await stopQueue.add({ vmName: vm.name }, { attempts: 1 });
      stoppedCount++;
    }
  }

  if (stoppedCount > 0) logger.info(`[aws-quota] tick: enforced=${stoppedCount}/${vms.length}`);
}

module.exports = { awsQuotaEnforcer };
