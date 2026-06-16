/**
 * Workshop · Grow root EBS volume + extend partition inside OS.
 * Payload: { vmName, newSizeGB }
 *
 * Online operation — no VM stop. Volume grows, then SSM runs growpart + filesystem
 * resize. Works for ext4 (Ubuntu) and xfs (Rocky) without distinguishing — fallback
 * tries both filesystem grow commands.
 */
const {
  EC2Client, DescribeInstancesCommand, ModifyVolumeCommand,
  DescribeVolumesModificationsCommand,
} = require("@aws-sdk/client-ec2");
const { SSMClient, SendCommandCommand, GetCommandInvocationCommand } = require("@aws-sdk/client-ssm");
const VM = require("./../models/vm");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });
const ssm = new SSMClient({ region: REGION, credentials });

const GROW_SCRIPT = `
set -e
ROOT_DEV=$(findmnt -n -o SOURCE /)
ROOT_DISK=$(lsblk -no PKNAME "$ROOT_DEV" | head -n1)
PART_NUM=$(echo "$ROOT_DEV" | grep -oE '[0-9]+$' | tail -1)
echo "root device: $ROOT_DEV, disk: /dev/$ROOT_DISK, partition: $PART_NUM"
growpart "/dev/$ROOT_DISK" "$PART_NUM" || echo "growpart already-grown or NOCHANGE — proceeding"
FSTYPE=$(findmnt -n -o FSTYPE /)
echo "fs: $FSTYPE"
case "$FSTYPE" in
  xfs)   xfs_growfs / ;;
  ext4|ext3|ext2) resize2fs "$ROOT_DEV" ;;
  *)     echo "Unknown fs $FSTYPE"; exit 1 ;;
esac
df -h /
`;

async function waitForVolumeModification(volId, timeoutSec = 600) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await ec2.send(new DescribeVolumesModificationsCommand({ VolumeIds: [volId] }));
    const m = r.VolumesModifications?.[0];
    if (m?.ModificationState === "completed" || m?.ModificationState === "optimizing") return true;
    if (m?.ModificationState === "failed") throw new Error(`Volume modification failed for ${volId}`);
    await new Promise(r => setTimeout(r, 8000));
  }
  return false;
}

const handler = async (job) => {
  const { vmName, newSizeGB } = job.data;
  logger.info(`[aws-workshop-grow-disk] ${vmName} → ${newSizeGB} GB`);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) throw new Error(`VM ${vmName} not found`);
    const instanceId = vmDoc.cloudInstanceId;
    if (!instanceId?.startsWith("i-")) throw new Error(`No EC2 instance id on ${vmName}`);

    await VM.updateOne({ name: vmName }, { $set: { remarks: "Growing disk…" } });

    const r = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const rootDev = r.Reservations[0]?.Instances[0]?.RootDeviceName;
    const rootVolId = r.Reservations[0]?.Instances[0]?.BlockDeviceMappings
      ?.find(b => b.DeviceName === rootDev)?.Ebs?.VolumeId;
    if (!rootVolId) throw new Error(`Could not find root volume for ${instanceId}`);

    logger.info(`[aws-workshop-grow-disk] ${vmName} root volume ${rootVolId} → ${newSizeGB} GB`);
    await ec2.send(new ModifyVolumeCommand({ VolumeId: rootVolId, Size: Number(newSizeGB) }));
    await waitForVolumeModification(rootVolId);
    logger.info(`[aws-workshop-grow-disk] ${vmName} volume modification optimizing`);

    const cmd = await ssm.send(new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: { commands: [GROW_SCRIPT] },
      TimeoutSeconds: 300,
    }));
    const cmdId = cmd.Command.CommandId;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 6000));
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: cmdId, InstanceId: instanceId }));
      if (inv.Status === "Success") { logger.info(`[aws-workshop-grow-disk] ${vmName} OS grow ok\n${inv.StandardOutputContent}`); break; }
      if (inv.Status === "Failed" || inv.Status === "Cancelled") throw new Error(`Grow script: ${inv.StandardErrorContent}`);
    }

    await VM.updateOne({ name: vmName }, {
      $set: { remarks: "Ready (disk grown)", lastActivityAt: new Date() },
    });
    logger.info(`[aws-workshop-grow-disk] ${vmName} complete`);
  } catch (err) {
    logger.error(`[aws-workshop-grow-disk] ${vmName} FAILED: ${err.message}`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: `Disk grow failed: ${err.message}` } }).catch(()=>{});
    throw err;
  }
};

module.exports = handler;
