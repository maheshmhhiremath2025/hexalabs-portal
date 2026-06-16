/**
 * Workshop · Resize CPU/RAM on a build VM.
 * Payload: { vmName, newInstanceType }
 *
 * Flow: stop → ModifyInstanceAttribute → start. New IP, same disk, same NIC.
 */
const {
  EC2Client, StopInstancesCommand, StartInstancesCommand,
  ModifyInstanceAttributeCommand, DescribeInstancesCommand,
} = require("@aws-sdk/client-ec2");
const VM = require("./../models/vm");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

async function waitForState(instanceId, target, timeoutSec = 360) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const st = r.Reservations[0]?.Instances[0]?.State?.Name;
    if (st === target) return r.Reservations[0].Instances[0];
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timeout waiting for ${instanceId} → ${target}`);
}

const handler = async (job) => {
  const { vmName, newInstanceType } = job.data;
  logger.info(`[aws-workshop-resize] ${vmName} → ${newInstanceType}`);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) throw new Error(`VM ${vmName} not found`);
    const instanceId = vmDoc.cloudInstanceId;
    if (!instanceId?.startsWith("i-")) throw new Error(`No EC2 instance id on ${vmName}`);

    await VM.updateOne({ name: vmName }, { $set: { remarks: "Stopping for resize…", isRunning: false } });
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
    await waitForState(instanceId, "stopped");

    await VM.updateOne({ name: vmName }, { $set: { remarks: "Resizing…" } });
    await ec2.send(new ModifyInstanceAttributeCommand({
      InstanceId: instanceId,
      InstanceType: { Value: newInstanceType },
    }));
    logger.info(`[aws-workshop-resize] ${vmName} type → ${newInstanceType}`);

    await VM.updateOne({ name: vmName }, { $set: { remarks: "Starting…" } });
    await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
    const inst = await waitForState(instanceId, "running");

    const publicIp = inst.PublicIpAddress || vmDoc.publicIp;
    await VM.updateOne({ name: vmName }, {
      $set: {
        isRunning: true, publicIp, vmSize: newInstanceType,
        remarks: "Ready (resized)", lastActivityAt: new Date(),
      },
    });
    logger.info(`[aws-workshop-resize] ${vmName} complete — new IP ${publicIp}, type ${newInstanceType}`);
  } catch (err) {
    logger.error(`[aws-workshop-resize] ${vmName} FAILED: ${err.message}`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: `Resize failed: ${err.message}` } }).catch(()=>{});
    throw err;
  }
};

module.exports = handler;
