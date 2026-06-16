const { EC2Client, StartInstancesCommand, DescribeInstancesCommand, RunInstancesCommand, DeregisterImageCommand, DescribeImagesCommand, DeleteSnapshotCommand } = require("@aws-sdk/client-ec2");
const VM = require("./../models/vm");
const Template = require("./../models/templates");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

async function allocateDcvPort(vmName) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const used = await VM.find({ dcvPort: { $exists: true, $ne: null } }, "dcvPort").lean();
    const usedSet = new Set(used.map(v => Number(v.dcvPort)).filter(Boolean));
    let candidate = null;
    for (let pp = 30001 + attempt; pp <= 39999; pp++) { if (!usedSet.has(pp)) { candidate = pp; break; } }
    if (!candidate) return null;
    try {
      await VM.updateOne({ name: vmName }, { $set: { dcvPort: candidate } });
      return candidate;
    } catch (e) { if (e.code !== 11000) throw e; }
  }
  return null;
}

const handler = async (job) => {
  const vmName = job.data.vmName || job.data.name;
  logger.info(`[aws-start-vm] ${vmName}`);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) throw new Error(`VM ${vmName} not found`);

    let instanceId = vmDoc.cloudInstanceId;
    let publicIp = vmDoc.publicIp;

    // Branch A: prior stop snapshot exists → launch a brand-new instance from it.
    if (vmDoc.stoppedAmiId) {
      logger.info(`[aws-start-vm] ${vmName} rehydrating from AMI ${vmDoc.stoppedAmiId}`);
      await VM.updateOne({ name: vmName }, { $set: { remarks: "Rehydrating…" } });

      // Pull template config for SG + instance profile + size
      const tpl = await Template.findOne({ name: vmDoc.templateName });
      const c = tpl?.creation || {};

      const tags = [
        { Key: "Name", Value: vmDoc.name },
        { Key: "Email", Value: vmDoc.email || "" },
        { Key: "Training", Value: vmDoc.trainingName || "" },
        { Key: "Org", Value: vmDoc.organization || "" },
        { Key: "ManagedBy", Value: "synergific" },
      ];

      // Hardened SG/IAM/subnet — env fallbacks guarantee the rehydrated
      // instance lands on the DCV network even when template metadata is
      // missing or the Template.findOne lookup races.
      const sg = c.securityGroupId || process.env.AWS_DCV_DEFAULT_SG || "sg-004577c1281b27db6";
      const iam = c.iamProfile || process.env.AWS_DCV_DEFAULT_IAM || "SynergificDCVRole";
      const subnet = c.subnetId || process.env.AWS_DCV_DEFAULT_SUBNET || undefined;
      logger.info(`[aws-start-vm] ${vmName} launching with sg=${sg} iam=${iam}${subnet ? ` subnet=${subnet}` : ""}`);

      const runRes = await ec2.send(new RunInstancesCommand({
        ImageId: vmDoc.stoppedAmiId,
        InstanceType: c.vmSize || vmDoc.vmSize || "m5.large",
        MinCount: 1, MaxCount: 1,
        SecurityGroupIds: [sg],
        IamInstanceProfile: { Name: iam },
        SubnetId: subnet,
        InstanceMarketOptions: { MarketType: "spot", SpotOptions: { SpotInstanceType: "persistent", InstanceInterruptionBehavior: "stop" } },
        BlockDeviceMappings: [{ DeviceName: "/dev/sda1", Ebs: { VolumeSize: c.diskSizeGB || 100, VolumeType: "gp3", DeleteOnTermination: true } }],
        TagSpecifications: [{ ResourceType: "instance", Tags: tags }],
      }));
      instanceId = runRes.Instances[0].InstanceId;
      logger.info(`[aws-start-vm] ${vmName} new instance ${instanceId} pending`);
      await VM.updateOne({ name: vmName }, { $set: { remarks: "Booting…" } });

      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
        const inst = r.Reservations[0]?.Instances[0];
        if (inst?.State?.Name === "running" && inst?.PublicIpAddress) { publicIp = inst.PublicIpAddress; break; }
      }

      // Deregister the consumed AMI + delete its EBS snapshots so storage doesn't pile up.
      // 2026-06-16: previously only deregistered the AMI (catalog only); the underlying
      // EBS snapshot stayed orphan, accumulating ~₹120-200/VM/month over a 2-month cohort.
      // Now capture snapshot IDs from BlockDeviceMappings BEFORE deregister (after deregister
      // they're inaccessible), then DeleteSnapshot each.
      try {
        const desc = await ec2.send(new DescribeImagesCommand({ ImageIds: [vmDoc.stoppedAmiId] }));
        const ami = desc.Images?.[0];
        const snapIds = (ami?.BlockDeviceMappings || [])
          .map(b => b.Ebs?.SnapshotId)
          .filter(Boolean);
        await ec2.send(new DeregisterImageCommand({ ImageId: vmDoc.stoppedAmiId }));
        logger.info(`[aws-start-vm] ${vmName} deregistered AMI ${vmDoc.stoppedAmiId}`);
        for (const sid of snapIds) {
          try {
            await ec2.send(new DeleteSnapshotCommand({ SnapshotId: sid }));
            logger.info(`[aws-start-vm] ${vmName} deleted snapshot ${sid}`);
          } catch (sErr) { logger.warn(`[aws-start-vm] ${vmName} snap ${sid} delete err: ${sErr.message}`); }
        }
      } catch (e) { logger.warn(`[aws-start-vm] AMI cleanup soft fail: ${e.message}`); }

      const dcvPort = vmDoc.dcvPort || await allocateDcvPort(vmName);

      await VM.updateOne({ name: vmName }, {
        $set: { isRunning: true, isAlive: true, publicIp, cloudInstanceId: instanceId, resourceGroup: instanceId, dcvPort, stoppedAmiId: null, remarks: "Alive", lastActivityAt: new Date() },
        $push: { logs: { start: new Date() } },
      });
      logger.info(`[aws-start-vm] ${vmName} rehydrate complete @ ${publicIp} port=${dcvPort}`);
      return;
    }

    // Branch B: legacy simple-Stop path (instance still exists in stopped state).
    if (!instanceId?.startsWith("i-")) throw new Error(`No instance id on ${vmName}`);
    await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
    const deadline = Date.now() + 480 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      const inst = r.Reservations[0]?.Instances[0];
      if (inst?.State?.Name === "running" && inst?.PublicIpAddress) { publicIp = inst.PublicIpAddress; break; }
    }
    await VM.updateOne({ name: vmName }, {
      $set: { isRunning: true, isAlive: true, publicIp, remarks: "Alive", lastActivityAt: new Date() },
      $push: { logs: { start: new Date() } },
    });
    logger.info(`[aws-start-vm] ${vmName} simple-start @ ${publicIp}`);
  } catch (err) {
    logger.error(`[aws-start-vm] ${vmName}: ${err.message}`);
    throw err;
  }
};

module.exports = handler;
