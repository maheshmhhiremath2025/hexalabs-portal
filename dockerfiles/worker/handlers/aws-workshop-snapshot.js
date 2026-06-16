/**
 * Workshop · Cleanup + Snapshot + Register as Template.
 * Payload: { vmName, templateName, description, visibility, email }
 *
 * Steps:
 *   1. SSM cleanup script (bash history, machine-id, ssh host keys, package cache, cloud-init clean)
 *   2. StopInstances → wait stopped
 *   3. CreateImage (NoReboot — already stopped)
 *   4. Wait AMI available
 *   5. Register Templates doc (isTrainerBuilt:true, visibility, createdBy)
 *   6. TerminateInstances (build VM is done)
 *   7. Delete VM doc from Mongo
 */
const {
  EC2Client, CreateImageCommand, DescribeImagesCommand,
  StopInstancesCommand, TerminateInstancesCommand, DescribeInstancesCommand,
} = require("@aws-sdk/client-ec2");
const { SSMClient, SendCommandCommand, GetCommandInvocationCommand } = require("@aws-sdk/client-ssm");
const VM = require("./../models/vm");
const Templates = require("./../models/templates");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });
const ssm = new SSMClient({ region: REGION, credentials });

const CLEANUP_SCRIPT = `
set -e
echo "=== Workshop snapshot cleanup ==="
# History
rm -f /root/.bash_history /home/*/.bash_history 2>/dev/null || true
history -c 2>/dev/null || true
# SSH host keys (regenerated on first boot of derived VM)
rm -f /etc/ssh/ssh_host_* 2>/dev/null || true
# Machine ID (regenerated)
truncate -s 0 /etc/machine-id 2>/dev/null || true
rm -f /var/lib/dbus/machine-id 2>/dev/null || true
# Package caches
(apt-get clean 2>/dev/null && rm -rf /var/lib/apt/lists/*) || (dnf clean all 2>/dev/null) || true
# Cloud-init
cloud-init clean --logs --machine-id 2>/dev/null || cloud-init clean --logs 2>/dev/null || true
# Logs
truncate -s 0 /var/log/wtmp /var/log/btmp 2>/dev/null || true
journalctl --rotate 2>/dev/null && journalctl --vacuum-time=1s 2>/dev/null || true
echo "=== Cleanup done ==="
`;

async function waitForState(instanceId, target, timeoutSec = 360) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const st = r.Reservations[0]?.Instances[0]?.State?.Name;
    if (st === target) return true;
    await new Promise(r => setTimeout(r, 5000));
  }
  return false;
}

const handler = async (job) => {
  const { vmName, templateName, description, visibility, email } = job.data;
  logger.info(`[aws-workshop-snapshot] ${vmName} → template ${templateName}`);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) throw new Error(`VM ${vmName} not found`);
    const instanceId = vmDoc.cloudInstanceId;
    if (!instanceId?.startsWith("i-")) throw new Error(`No EC2 instance id on ${vmName}`);

    // 1) cleanup via SSM
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Cleaning up…" } });
    const cmd = await ssm.send(new SendCommandCommand({
      InstanceIds: [instanceId], DocumentName: "AWS-RunShellScript",
      Parameters: { commands: [CLEANUP_SCRIPT] }, TimeoutSeconds: 300,
    }));
    const cmdId = cmd.Command.CommandId;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: cmdId, InstanceId: instanceId }));
      if (inv.Status === "Success") break;
      if (inv.Status === "Failed") throw new Error(`Cleanup script: ${inv.StandardErrorContent}`);
    }

    // 2) Clean shutdown
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Shutting down…" } });
    await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
    await waitForState(instanceId, "stopped");

    // 3) Snapshot
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Snapshotting…" } });
    const amiName = `${templateName.replace(/[^a-zA-Z0-9_-]/g, "-")}-v1.0-${Date.now()}`;
    const img = await ec2.send(new CreateImageCommand({
      InstanceId: instanceId, Name: amiName,
      Description: description || `Workshop template — ${templateName} built by ${email}`,
      NoReboot: true,
    }));
    const amiId = img.ImageId;
    logger.info(`[aws-workshop-snapshot] ${vmName} AMI ${amiId} pending`);

    // 4) Wait available
    const dl = Date.now() + 30 * 60 * 1000;
    while (Date.now() < dl) {
      await new Promise(r => setTimeout(r, 20000));
      const d = await ec2.send(new DescribeImagesCommand({ ImageIds: [amiId] }));
      const st = d.Images?.[0]?.State;
      if (st === "available") { logger.info(`[aws-workshop-snapshot] ${vmName} AMI available`); break; }
      if (st === "failed") throw new Error(`AMI ${amiId} bake failed`);
    }

    // 5) Register Templates doc — under workshop-built fields
    await Templates.create({
      name: templateName,
      rate: 0,  // trainer-built templates default to platform rate inheritance
      cloud: "aws", dcv: true,
      createdBy: email, isTrainerBuilt: true,
      visibility: visibility || "private",
      sourceBuildVm: vmName,
      requiredBackend: "aws", accessProtocol: "dcv", nestedVirt: false,
      creation: {
        vmSize: vmDoc.vmSize || "m5.large",
        imageId: amiId,
        location: REGION,
        os: "Linux",
        diskSizeGB: 100,
        licence: "none",
        securityGroupId: process.env.AWS_DCV_DEFAULT_SG || "sg-004577c1281b27db6",
        iamProfile: process.env.AWS_DCV_DEFAULT_IAM || "SynergificDCVRole",
      },
      display: { cpu: "2", memory: "8 GB", os: "Linux", storage: "100 GB", disk: "100" },
    });
    logger.info(`[aws-workshop-snapshot] ${vmName} template doc registered as ${templateName}`);

    // 6) Terminate build VM
    await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    logger.info(`[aws-workshop-snapshot] ${vmName} build VM terminated`);

    // 7) Delete VM doc
    await VM.deleteOne({ name: vmName });
    logger.info(`[aws-workshop-snapshot] ${vmName} complete — Mongo cleaned`);
  } catch (err) {
    logger.error(`[aws-workshop-snapshot] ${vmName} FAILED: ${err.message}`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: `Snapshot failed: ${err.message}` } }).catch(()=>{});
    throw err;
  }
};

module.exports = handler;
