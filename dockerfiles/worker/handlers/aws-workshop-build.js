/**
 * Workshop · Build a new trainer VM from a base Linux+DCV AMI.
 * Payload: { vmName, email, organization, baseAmi, instanceType, diskSizeGB,
 *           targetTemplateName, dcvPort }
 *
 * Phase 3 skeleton — focuses on safe instance launch + Mongo state.
 * Reuses sg/iam env-fallback pattern from aws-start-vm.
 */
const {
  EC2Client, RunInstancesCommand, DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
} = require("@aws-sdk/client-ec2");
const VM = require("./../models/vm");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

async function waitForRunning(instanceId, timeoutSec = 600) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const inst = r.Reservations[0]?.Instances[0];
    if (inst?.State?.Name === "running" && inst?.PublicIpAddress) return inst;
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(`Timeout waiting for ${instanceId}`);
}

async function waitForSystemOk(instanceId, timeoutSec = 600) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const r = await ec2.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId], IncludeAllInstances: true }));
      const st = r.InstanceStatuses?.[0];
      if (st?.SystemStatus?.Status === "ok" && st?.InstanceStatus?.Status === "ok") return true;
    } catch {}
    await new Promise(r => setTimeout(r, 10000));
  }
  return false;
}

const handler = async (job) => {
  const data = job.data;
  const vmName = data.vmName;
  logger.info(`[aws-workshop-build] ${vmName} start`);
  try {
    const sg = process.env.AWS_DCV_DEFAULT_SG || "sg-004577c1281b27db6";
    const iam = process.env.AWS_DCV_DEFAULT_IAM || "SynergificDCVRole";

    const tags = [
      { Key: "Name", Value: vmName },
      { Key: "Email", Value: data.email || "" },
      { Key: "Org", Value: data.organization || "" },
      { Key: "Workshop", Value: "true" },
      { Key: "TargetTemplate", Value: data.targetTemplateName || "" },
      { Key: "ManagedBy", Value: "synergific-workshop" },
    ];

    const runRes = await ec2.send(new RunInstancesCommand({
      ImageId: data.baseAmi,
      InstanceType: data.instanceType || "m5.large",
      MinCount: 1, MaxCount: 1,
      SecurityGroupIds: [sg],
      IamInstanceProfile: { Name: iam },
      InstanceMarketOptions: { MarketType: "spot", SpotOptions: { SpotInstanceType: "persistent", InstanceInterruptionBehavior: "stop" } },
      BlockDeviceMappings: [{ DeviceName: "/dev/sda1", Ebs: { VolumeSize: data.diskSizeGB || 100, VolumeType: "gp3", DeleteOnTermination: true } }],
      TagSpecifications: [{ ResourceType: "instance", Tags: tags }],
    }));
    const instanceId = runRes.Instances[0].InstanceId;
    logger.info(`[aws-workshop-build] ${vmName} launched ${instanceId}`);
    await VM.updateOne({ name: vmName }, {
      $set: { cloudInstanceId: instanceId, remarks: "Initializing…", isBuildVM: true,
              templateBuildOf: data.email, targetTemplateName: data.targetTemplateName },
    });

    const inst = await waitForRunning(instanceId);
    const publicIp = inst.PublicIpAddress;
    logger.info(`[aws-workshop-build] ${vmName} running @ ${publicIp}`);

    await VM.updateOne({ name: vmName }, { $set: { publicIp, remarks: "Booting…" } });
    await waitForSystemOk(instanceId);
    logger.info(`[aws-workshop-build] ${vmName} system-ok`);

    await VM.updateOne({ name: vmName }, {
      $set: {
        isRunning: true, isAlive: true, publicIp, cloudInstanceId: instanceId,
        resourceGroup: instanceId, dcvPort: data.dcvPort, remarks: "Ready",
        lastActivityAt: new Date(),
      },
      $push: { logs: { start: new Date() } },
    });
    logger.info(`[aws-workshop-build] ${vmName} complete`);
  } catch (err) {
    logger.error(`[aws-workshop-build] ${vmName} FAILED: ${err.message}`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: `Build failed: ${err.message}` } }).catch(()=>{});
    throw err;
  }
};

module.exports = handler;
