const { EC2Client, TerminateInstancesCommand, DescribeInstancesCommand, CancelSpotInstanceRequestsCommand, DescribeImagesCommand, DeregisterImageCommand, DeleteSnapshotCommand } = require("@aws-sdk/client-ec2");
const VM = require("./../models/vm");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

const handler = async (job) => {
  const { vmName } = job.data;
  logger.info("[aws-delete-vm] " + vmName);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) {
      logger.warn("[aws-delete-vm] " + vmName + " not in Mongo — nothing to delete");
      return;
    }
    const instanceId = vmDoc.cloudInstanceId || vmDoc.resourceGroup;
    if (instanceId && instanceId.startsWith("i-")) {
      try {
        const di = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
        const sirId = di.Reservations?.[0]?.Instances?.[0]?.SpotInstanceRequestId;
        if (sirId) {
          await ec2.send(new CancelSpotInstanceRequestsCommand({ SpotInstanceRequestIds: [sirId] }));
          logger.info("[aws-delete-vm] " + vmName + " cancelled spot request " + sirId);
        } else {
          logger.info("[aws-delete-vm] " + vmName + " no SpotInstanceRequestId — on-demand or detached, skipping cancel");
        }
      } catch (e) {
        logger.warn("[aws-delete-vm] " + vmName + " spot-cancel error (ignoring): " + e.message);
      }
      try {
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
        logger.info("[aws-delete-vm] " + vmName + " EC2 " + instanceId + " terminate requested");
      } catch (e) {
        logger.warn("[aws-delete-vm] " + vmName + " terminate error (ignoring): " + e.message);
      }
    }
    // Full cleanup of this VM snapshot AMI(s) + backing EBS snapshots (no keep-last — this is a purge).
    // Runs unconditionally: a stopped/snapshotted VM has no live instance but DOES leave an AMI+snapshot.
    // Filter "<vm>-snap-*" is collision-safe (the -snap- delimiter prevents prefix overlap e.g. ubhive-1 vs ubhive-10).
    try {
      const imgs = await ec2.send(new DescribeImagesCommand({
        Owners: ["self"],
        Filters: [{ Name: "name", Values: [vmName + "-snap-*"] }],
      }));
      for (const im of (imgs.Images || [])) {
        const snapIds = (im.BlockDeviceMappings || []).map(b => b.Ebs && b.Ebs.SnapshotId).filter(Boolean);
        try {
          await ec2.send(new DeregisterImageCommand({ ImageId: im.ImageId }));
          logger.info("[aws-delete-vm] " + vmName + " deregistered AMI " + im.ImageId);
        } catch (e) {
          logger.warn("[aws-delete-vm] " + vmName + " deregister " + im.ImageId + " error (ignoring): " + e.message);
        }
        for (const sid of snapIds) {
          try {
            await ec2.send(new DeleteSnapshotCommand({ SnapshotId: sid }));
            logger.info("[aws-delete-vm] " + vmName + " deleted snapshot " + sid);
          } catch (e) {
            logger.warn("[aws-delete-vm] " + vmName + " delete snapshot " + sid + " error (ignoring): " + e.message);
          }
        }
      }
    } catch (e) {
      logger.warn("[aws-delete-vm] " + vmName + " AMI/snapshot cleanup error (ignoring): " + e.message);
    }
    await VM.updateOne({ name: vmName }, { $set: {
      isRunning: false, isAlive: false, dcvPort: null, remarks: "Terminated", stoppingUntil: null,
    }});
    logger.info("[aws-delete-vm] " + vmName + " marked terminated");
  } catch (err) {
    logger.error("[aws-delete-vm] " + vmName + ": " + err.message);
    throw err;
  }
};

module.exports = handler;
