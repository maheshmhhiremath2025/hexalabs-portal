/**
 * AWS counterpart to automations/labExpiry.js (which is Azure-only —
 * uses ComputeManagementClient + azureCleanup).
 *
 * For every AWS VM with expiresAt set:
 *   - 1 hour before expiry: send warning email (once)
 *   - At expiry: soft-mark isAlive=false, keep AWS instance running for 24h grace
 *   - 24h past expiry: enqueue aws-stop-vm (which does snapshot+cancel-Spot+terminate
 *     via the patched handler from project_aws_stop_spot_cancel_fix)
 *
 * Added 2026-06-16. Env kill switch AWS_LAB_EXPIRY_ENABLED (default false).
 */
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

let sendEmail;
try { ({ sendEmail } = require('../services/emailNotifications')); } catch {}

let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('aws-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 },
  });
} catch {}

async function awsLabExpiryChecker() {
  if (process.env.AWS_LAB_EXPIRY_ENABLED !== 'true') return;

  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const vms = await VM.find({
    cloud: 'aws',
    expiresAt: { $exists: true, $ne: null },
  }).select('name email trainingName organization expiresAt expiryWarningEmailSent isAlive isRunning cloudInstanceId').lean();

  if (!vms.length) return;

  let warned = 0, softExpired = 0, hardExpired = 0;

  for (const vm of vms) {
    const expiresAt = new Date(vm.expiresAt);

    // 1. Warning at T-1h (only for still-alive labs)
    if (vm.isAlive && expiresAt <= oneHourFromNow && expiresAt > now && !vm.expiryWarningEmailSent && sendEmail) {
      const minsLeft = Math.round((expiresAt - now) / 60000);
      try {
        await sendEmail(vm.email,
          `Lab Expiry Warning: ${vm.name} expires in ${minsLeft} minutes`,
          `<div style="font-family:Arial,sans-serif;max-width:520px">
            <div style="background:#f59e0b;padding:14px 18px;border-radius:8px 8px 0 0">
              <h2 style="color:white;margin:0;font-size:16px">Lab Expiring Soon</h2>
            </div>
            <div style="padding:18px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
              <p>Your lab <strong>${vm.name}</strong> (${vm.trainingName}) will be auto-stopped in <strong>${minsLeft} minutes</strong>.</p>
              <p>After expiry there's a 24-hour grace window before resources are permanently terminated.</p>
              <p style="color:#6b7280;font-size:13px">To extend, ask your trainer/admin.</p>
            </div>
          </div>`,
          `Lab Expiring Soon: ${vm.name} (${vm.trainingName}) auto-stops in ${minsLeft} minutes. 24-hour grace, then permanent termination.`
        );
        await VM.updateOne({ _id: vm._id }, { $set: { expiryWarningEmailSent: true } });
        warned++;
      } catch (e) { logger.warn(`[aws-expiry] warning email ${vm.name}: ${e.message}`); }
      continue;
    }

    // 2. Soft-expire: expired but within 24h grace
    if (vm.isAlive && expiresAt > twentyFourHoursAgo && expiresAt <= now) {
      await VM.updateOne({ _id: vm._id }, { $set: {
        isAlive: false, isRunning: false, remarks: 'Expired — awaiting 24h grace',
      }});
      logger.info(`[aws-expiry] ${vm.name} soft-expired (24h grace)`);
      softExpired++;
      continue;
    }

    // 3. Hard-expire: >24h past expiry — enqueue patched aws-stop-vm
    if (expiresAt <= twentyFourHoursAgo && vm.cloudInstanceId) {
      if (stopQueue) {
        await stopQueue.add({ vmName: vm.name }, { attempts: 1 });
      }
      await VM.updateOne({ _id: vm._id }, { $set: {
        isAlive: false, isRunning: false, remarks: 'Auto-deleted (lab expired)',
      }});
      logger.warn(`[aws-expiry] ${vm.name} expired >24h — aws-stop-vm enqueued (snapshot+terminate)`);
      hardExpired++;
    }
  }

  if (warned || softExpired || hardExpired) {
    logger.info(`[aws-expiry] tick: warned=${warned}, soft=${softExpired}, hard=${hardExpired}`);
  }
}

module.exports = { awsLabExpiryChecker };
