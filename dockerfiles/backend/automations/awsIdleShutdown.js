/**
 * AWS counterpart to automations/idleShutdown.js (which is Azure-only).
 *
 * For every running AWS VM with autoShutdown=true and idleMinutes set:
 *   - Query CloudWatch CPUUtilization over the last `idleMinutes` window
 *   - If average CPU < cpuThreshold (default 5%), enqueue aws-stop-vm Bull job
 *
 * CloudWatch publishes CPUUtilization every 5 min by default (basic monitoring).
 * Coverage rule: require at least `floor(idleMinutes/5 * 0.9)` data points,
 * capped at 12, before judging — protects against fresh VMs being killed
 * before CloudWatch has collected enough data.
 *
 * Added 2026-06-16 to close the AWS-side gap. Yesterday's attempt patched
 * the existing idleShutdown.js but crashed backend because the
 * @aws-sdk/client-cloudwatch package wasn't installed. This time:
 *   - SDK package installed first
 *   - NEW FILE — Azure idleShutdown.js untouched (per feedback_no_regression_rule)
 *   - Env kill switch AWS_IDLE_SHUTDOWN_ENABLED (default false — opt-in)
 *
 * Hooked into the existing 5-min cron block in index.js next to idleShutdownChecker.
 */
const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');
const { notifyAutoShutdown, sendEmail } = require('../services/emailNotifications');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const creds = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };

let _ec2, _cw;
function clients() {
  if (!_ec2) {
    _ec2 = new EC2Client({ region: REGION, credentials: creds });
    _cw  = new CloudWatchClient({ region: REGION, credentials: creds });
  }
  return { ec2: _ec2, cw: _cw };
}

let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('aws-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 },
  });
} catch {}

async function getAwsInstanceMeta(ec2, instanceId) {
  if (!instanceId || !instanceId.startsWith('i-')) return { state: 'unknown' };
  try {
    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const inst = r.Reservations?.[0]?.Instances?.[0];
    return {
      state: inst?.State?.Name || 'unknown',
      launchTime: inst?.LaunchTime ? new Date(inst.LaunchTime) : null,
    };
  } catch (e) {
    if ((e.name || e.Code) === 'InvalidInstanceID.NotFound') return { state: 'not-found' };
    return { state: 'unknown' };
  }
}

async function isAwsVmIdle(cw, instanceId, idleMinutes, cpuThreshold, launchTime) {
  const end = new Date();
  const start = new Date(end.getTime() - idleMinutes * 60 * 1000);
  try {
    const r = await cw.send(new GetMetricStatisticsCommand({
      Namespace: 'AWS/EC2',
      MetricName: 'CPUUtilization',
      Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
      StartTime: start, EndTime: end,
      Period: 300,                 // 5-min granularity (basic monitoring default)
      Statistics: ['Average'],
    }));
    // Filter to datapoints AFTER the instance's current LaunchTime.
    // 2026-06-16 fix: AWS persistent Spot stop-and-restart reuses the same
    // InstanceId; CloudWatch retains the pre-eviction data, so a freshly-
    // restarted VM would appear "idle for 30 min" based on the OLD session.
    // Without this filter, every Spot restart was triggering an immediate
    // auto-stop death loop (M365 cohort hit at 07:25 UTC).
    let pts = (r.Datapoints || []).filter(d => d.Average != null);
    if (launchTime) {
      pts = pts.filter(d => new Date(d.Timestamp) >= launchTime);
    }
    const values = pts.map(d => d.Average);
    // Coverage: idleMinutes/5 expected, allow 90%, capped at 12 (so even on
    // basic monitoring a 60-min idle window needs only 11 pts).
    const minPts = Math.min(Math.ceil(idleMinutes / 5 * 0.9), 12);
    if (values.length < minPts) {
      return { idle: false, reason: `only ${values.length}/${minPts} CPU pts since LaunchTime` };
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { idle: avg < cpuThreshold, avg, count: values.length };
  } catch (e) {
    return { idle: false, reason: `cw err: ${e.message}` };
  }
}

async function awsIdleShutdown() {
  if (process.env.AWS_IDLE_SHUTDOWN_ENABLED !== 'true') return;

  const vms = await VM.find({
    cloud: 'aws',
    isRunning: true,
    isAlive: true,
    autoShutdown: true,
    idleMinutes: { $gt: 0 },
    cloudInstanceId: { $exists: true, $regex: /^i-/ },
  }).select('name cloudInstanceId idleMinutes email organization trainingName stopAttempts').lean();
  if (!vms.length) return;

  const { ec2, cw } = clients();
  let stopped = 0;

  for (const vm of vms) {
    const idleMinutes = vm.idleMinutes;
    const cpuThreshold = Number(process.env.AWS_IDLE_CPU_THRESHOLD) || 5;

    const meta = await getAwsInstanceMeta(ec2, vm.cloudInstanceId);
    const power = meta.state;
    if (power === 'not-found') {
      // Instance gone from AWS but DB says running — sync up
      logger.info(`[aws-idle] ${vm.name} instance not-found — marking DB stopped`);
      await VM.updateOne({ _id: vm._id }, { $set: { isRunning: false, remarks: 'EC2 instance not found' } });
      continue;
    }
    if (power === 'stopped' || power === 'stopping') {
      // Sync DB if it's wrong
      await VM.updateOne({ _id: vm._id }, { $set: { isRunning: false, remarks: `Stopped (AWS: ${power})` } });
      continue;
    }
    if (power !== 'running') continue;

    const res = await isAwsVmIdle(cw, vm.cloudInstanceId, idleMinutes, cpuThreshold, meta.launchTime);
    if (!res.idle) continue;

    logger.warn(`[aws-idle] ${vm.name} idle ${idleMinutes}min avg=${res.avg.toFixed(1)}% < ${cpuThreshold}% — stopping`);
    if (stopQueue) {
      await stopQueue.add({ vmName: vm.name }, { attempts: 1 });
    } else {
      logger.warn(`[aws-idle] no stopQueue available — skipping (would have stopped)`);
      continue;
    }
    stopped++;

    notifyAutoShutdown({
      vmName: vm.name, organization: vm.organization, trainingName: vm.trainingName,
      idleMinutes, email: vm.email,
    }).catch(e => logger.error(`[aws-idle][notify] ${vm.name}: ${e.message}`));

    // Admin alert — one email per VM auto-stop event. Recipients come from
    // env AWS_IDLE_ADMIN_ALERT_EMAILS (comma-separated). The sendEmail helper
    // already CCs itops@ + vinay.chandra@ per memory feedback_email_cc_rule.
    // Added 2026-06-16.
    const adminEmails = (process.env.AWS_IDLE_ADMIN_ALERT_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (adminEmails.length && sendEmail) {
      const subject = `[Synergific] Idle auto-stop: ${vm.name} (${vm.trainingName})`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px">
        <div style="background:#0f766e;padding:14px 18px;border-radius:8px 8px 0 0">
          <h2 style="color:white;margin:0;font-size:16px">AWS VM auto-stopped (idle)</h2>
        </div>
        <div style="padding:18px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;font-size:14px">
          <table style="border-collapse:collapse;width:100%">
            <tr style="background:#f3f4f6"><td><strong>VM</strong></td><td>${vm.name}</td></tr>
            <tr><td><strong>Cohort</strong></td><td>${vm.trainingName || '?'}</td></tr>
            <tr style="background:#f3f4f6"><td><strong>Org</strong></td><td>${vm.organization || '?'}</td></tr>
            <tr><td><strong>Learner</strong></td><td>${vm.email || '?'}</td></tr>
            <tr style="background:#f3f4f6"><td><strong>Idle threshold</strong></td><td>${idleMinutes} min</td></tr>
            <tr><td><strong>Measured CPU avg</strong></td><td>${res.avg.toFixed(1)}% over ${res.count} datapoints</td></tr>
            <tr style="background:#f3f4f6"><td><strong>Instance</strong></td><td><code>${vm.cloudInstanceId}</code></td></tr>
          </table>
          <p style="color:#6b7280;font-size:12px;margin-top:14px">aws-stop-vm job has been enqueued. Snapshot will be taken, Spot request cancelled, instance terminated. Learner can restart any time via portal.</p>
        </div>
      </div>`;
      const text = `AWS VM auto-stopped (idle)\n\nVM:       ${vm.name}\nCohort:   ${vm.trainingName || '?'}\nOrg:      ${vm.organization || '?'}\nLearner:  ${vm.email || '?'}\nIdle:     ${idleMinutes} min @ ${res.avg.toFixed(1)}% CPU avg (${res.count} datapoints)\nInstance: ${vm.cloudInstanceId}\n\naws-stop-vm enqueued — snapshot + Spot cancel + terminate.`;
      for (const to of adminEmails) {
        sendEmail(to, subject, html, text).catch(e => logger.error(`[aws-idle][admin-alert] ${to}: ${e.message}`));
      }
    }
  }

  if (stopped > 0) logger.info(`[aws-idle] tick: stopped=${stopped}/${vms.length}`);
}

module.exports = { awsIdleShutdown };
