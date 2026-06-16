/**
 * AWS DCV public-IP refresher.
 *
 * Why: AWS Spot persistent instances get a NEW public IP every time they're
 * restarted (no EIP attached). After Spot eviction + auto-restart, Mongo
 * still has the old IP — the user hits getlabs.cloud:<dcvPort>/ and gets
 * a 504 from nginx because nginx proxies to the dead old IP.
 *
 * The Azure-side spotEvictionHandler handles this for Azure VMs, but is
 * Azure SDK only (beginStartAndWait, networkProfile, etc.). This file is
 * the AWS counterpart — scan AWS DCV VMs, detect IP drift, update Mongo.
 * The existing awsDcvNginx.rebuildFromDb cron (runs every 30s) then picks
 * up the new IP and refreshes nginx within ~30s.
 *
 * Added 2026-06-16 alongside the winnoxtrn-1 504 incident.
 * Pattern per memory feedback_no_regression_rule: new file, additive,
 * env kill switch, hooked into existing 5-min tick (no new cron).
 */
const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const REGION = process.env.AWS_REGION || 'ap-south-1';
let _ec2;
function getEc2() {
  if (!_ec2) {
    _ec2 = new EC2Client({
      region: REGION,
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
    });
  }
  return _ec2;
}

async function awsIpRefresher() {
  if (process.env.AWS_IP_REFRESHER_ENABLED === 'false') return;   // opt-out kill switch

  // Find AWS DCV VMs that are running and have a cloudInstanceId.
  const vms = await VM.find({
    cloud: 'aws',
    isRunning: true,
    cloudInstanceId: { $exists: true, $regex: /^i-/ },
  }).select('name cloudInstanceId publicIp dcvPort').lean();

  if (!vms.length) return;

  const ec2 = getEc2();
  const idsToCheck = vms.map(v => v.cloudInstanceId);

  // EC2 DescribeInstances accepts up to 1000 IDs in one shot, fine for any cohort size.
  let resp;
  try {
    resp = await ec2.send(new DescribeInstancesCommand({ InstanceIds: idsToCheck }));
  } catch (e) {
    logger.warn(`[aws-ip-refresh] DescribeInstances err: ${e.message}`);
    return;
  }

  const live = new Map();
  for (const r of resp.Reservations || []) {
    for (const i of r.Instances || []) {
      live.set(i.InstanceId, { state: i.State?.Name, publicIp: i.PublicIpAddress || null });
    }
  }

  let updated = 0, missing = 0;
  for (const vm of vms) {
    const aws = live.get(vm.cloudInstanceId);
    if (!aws) { missing++; continue; }   // instance gone — likely terminated; other automations handle
    if (aws.state !== 'running') continue;
    if (!aws.publicIp) continue;
    if (aws.publicIp === vm.publicIp) continue;   // no drift

    await VM.updateOne(
      { _id: vm._id },
      { $set: { publicIp: aws.publicIp, lastActivityAt: new Date() } }
    );
    logger.warn(`[aws-ip-refresh] ${vm.name} IP drift: ${vm.publicIp} → ${aws.publicIp} (Spot restart)`);
    updated++;
  }

  if (updated > 0) {
    logger.warn(`[aws-ip-refresh] healed ${updated}/${vms.length} VMs — nginx will rebuild within 30s`);
  } else if (missing > 0) {
    logger.info(`[aws-ip-refresh] OK — scanned ${vms.length}, ${missing} instance(s) gone in AWS`);
  }
}

module.exports = { awsIpRefresher };
