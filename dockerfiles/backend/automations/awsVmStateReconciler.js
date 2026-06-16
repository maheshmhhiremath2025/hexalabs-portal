/**
 * AWS state reconciler — catches Mongo↔AWS drift beyond what awsIpRefresher
 * already covers.
 *
 * Cases handled (idempotent):
 *   1. Mongo says isRunning=true, AWS says terminated → mark Mongo isRunning=false + isAlive=false
 *   2. Mongo says isRunning=true, AWS says stopped → mark Mongo isRunning=false
 *      (likely Spot eviction; if instance has persistent Spot request, AWS will
 *       auto-restart; if manual stop, learner will Start later)
 *   3. Mongo says isRunning=false, AWS says running → mark Mongo isRunning=true
 *      (caught the inverse drift we hit on M365 + winnoxtrn-1)
 *
 * Distinct from awsIpRefresher (which only updates IP for healthy runs).
 *
 * Added 2026-06-16. Env kill switch AWS_STATE_RECONCILER_ENABLED (default false).
 */
const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const creds = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
let _ec2;
function getEc2() {
  if (!_ec2) _ec2 = new EC2Client({ region: REGION, credentials: creds });
  return _ec2;
}

async function awsVmStateReconciler() {
  if (process.env.AWS_STATE_RECONCILER_ENABLED !== 'true') return;

  // Look at AWS VMs in either direction of drift candidates:
  //   isRunning=true with cloudInstanceId — check AWS says running too
  //   isRunning=false with cloudInstanceId — check AWS says NOT running too
  const vms = await VM.find({
    cloud: 'aws',
    cloudInstanceId: { $exists: true, $regex: /^i-/ },
    isAlive: true,
  }).select('name cloudInstanceId isRunning isAlive publicIp remarks').lean();
  if (!vms.length) return;

  const ec2 = getEc2();
  const ids = vms.map(v => v.cloudInstanceId);
  let resp;
  try { resp = await ec2.send(new DescribeInstancesCommand({ InstanceIds: ids })); }
  catch (e) {
    if (!String(e.message).includes('InvalidInstanceID.NotFound')) {
      logger.warn(`[aws-reconcile] DescribeInstances err: ${e.message}`);
      return;
    }
    // Some IDs gone; fall through to per-VM loop below
    resp = { Reservations: [] };
  }

  const live = new Map();
  for (const r of resp.Reservations || []) {
    for (const i of r.Instances || []) live.set(i.InstanceId, i.State?.Name);
  }

  let fixed = 0;
  for (const vm of vms) {
    const awsState = live.get(vm.cloudInstanceId);
    // Case 1: not in AWS at all → terminated/missing
    if (!awsState) {
      if (vm.isRunning || vm.isAlive) {
        await VM.updateOne({ _id: vm._id }, {
          $set: { isRunning: false, isAlive: false, remarks: 'EC2 instance not found (reconciled)' },
        });
        logger.warn(`[aws-reconcile] ${vm.name} EC2 gone — set isRunning/isAlive=false`);
        fixed++;
      }
      continue;
    }
    // Case 2: AWS says running but Mongo says stopped
    if (awsState === 'running' && !vm.isRunning) {
      await VM.updateOne({ _id: vm._id }, {
        $set: { isRunning: true, remarks: 'Recovered (reconciled — AWS was running)' },
      });
      logger.warn(`[aws-reconcile] ${vm.name} AWS running but Mongo says stopped — Mongo synced`);
      fixed++;
      continue;
    }
    // Case 3: AWS says NOT running but Mongo says running
    if ((awsState === 'stopped' || awsState === 'stopping' || awsState === 'terminated' || awsState === 'shutting-down') && vm.isRunning) {
      const update = { isRunning: false, remarks: `Stopped (reconciled — AWS: ${awsState})` };
      if (awsState === 'terminated' || awsState === 'shutting-down') update.isAlive = false;
      await VM.updateOne({ _id: vm._id }, { $set: update });
      logger.warn(`[aws-reconcile] ${vm.name} AWS ${awsState} but Mongo says running — Mongo synced`);
      fixed++;
    }
  }

  if (fixed > 0) logger.info(`[aws-reconcile] tick: fixed=${fixed}/${vms.length}`);
}

module.exports = { awsVmStateReconciler };
