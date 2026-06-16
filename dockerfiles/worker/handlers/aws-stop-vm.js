const { EC2Client, CreateImageCommand, TerminateInstancesCommand, DescribeImagesCommand, StopInstancesCommand, DescribeInstancesCommand, CancelSpotInstanceRequestsCommand, DeregisterImageCommand, DeleteSnapshotCommand } = require("@aws-sdk/client-ec2");
const VM = require("./../models/vm");
const { logger } = require("./../plugins/logger");

const REGION = process.env.AWS_REGION || "ap-south-1";
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

const handler = async (job) => {
  const vmName = job.data.vmName || job.data.name;
  logger.info(`[aws-stop-vm] ${vmName}`);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) throw new Error(`VM ${vmName} not found`);
    const instanceId = vmDoc.cloudInstanceId || vmDoc.resourceGroup;
    if (!instanceId || !instanceId.startsWith("i-")) throw new Error(`No EC2 instance id on ${vmName}`);

    // 1a. Clean shutdown FIRST so the EBS snapshot is filesystem-consistent.
    //     Snapshotting a RUNNING Windows instance with NoReboot=true left DCV
    //     in a corrupt restore state (2026-06-09 regression). The Azure-parity
    //     pattern is: deallocate → snapshot → delete.
    logger.info(`[aws-stop-vm] ${vmName} stopping instance ${instanceId} for clean snapshot`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Shutting down…" } });
    try { await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] })); }
    catch (e) { logger.warn(`[aws-stop-vm] ${vmName} StopInstances soft-fail: ${e.message}`); }
    {
      const stopDeadline = Date.now() + 6 * 60 * 1000;
      while (Date.now() < stopDeadline) {
        await new Promise(r => setTimeout(r, 8000));
        const di = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
        const st = di.Reservations[0]?.Instances[0]?.State?.Name;
        if (st === "stopped") { logger.info(`[aws-stop-vm] ${vmName} stopped — safe to snapshot`); break; }
        if (st === "terminated") throw new Error(`Instance ${instanceId} already terminated`);
      }
    }

    // 1b. CreateImage from the STOPPED EC2. NoReboot:true is now safe — the OS
    //     isn't running, so the EBS volume is already in a consistent state.
    const amiName = `${vmName}-snap-${Date.now()}`;
    logger.info(`[aws-stop-vm] ${vmName} CreateImage ${amiName}`);
    const img = await ec2.send(new CreateImageCommand({
      InstanceId: instanceId, Name: amiName,
      Description: `Auto-snapshot of ${vmName} on stop ${new Date().toISOString()}`,
      NoReboot: true,
    }));
    const stoppedAmiId = img.ImageId;
    logger.info(`[aws-stop-vm] ${vmName} AMI ${stoppedAmiId} pending`);
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Snapshotting…" } });

    // 2. Wait until AMI moves past "pending" (typically 3-8 min). Bull job timeout
    //    is generous; the worker can sit here.
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15000));
      const r = await ec2.send(new DescribeImagesCommand({ ImageIds: [stoppedAmiId] }));
      const state = r.Images?.[0]?.State;
      if (state === "available") { logger.info(`[aws-stop-vm] ${vmName} AMI available`); break; }
      if (state === "failed") throw new Error(`AMI ${stoppedAmiId} failed`);
    }
    await VM.updateOne({ name: vmName }, { $set: { remarks: "Terminating…" } });

    // 3a. Cancel the persistent Spot Instance Request BEFORE terminate.
    //     Added 2026-06-15 — the aman-m365-jun2026 zombie incident.
    //     Without this, AWS auto-launches replacement instances within ~60s of
    //     terminate to maintain the persistent Spot request's desired capacity.
    //     Those replacements aren't linked to Mongo (cloudInstanceId stays null),
    //     so portal can't see them and they bill silently for days. Snapshot+
    //     terminate is meaningless on AWS Spot unless the request is also cancelled.
    //     Cancelling the request does NOT terminate the instance, so order is safe.
    try {
      const di = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      const sirId = di.Reservations?.[0]?.Instances?.[0]?.SpotInstanceRequestId;
      if (sirId) {
        await ec2.send(new CancelSpotInstanceRequestsCommand({ SpotInstanceRequestIds: [sirId] }));
        logger.info(`[aws-stop-vm] ${vmName} Spot request ${sirId} cancelled (prevents auto-replacement)`);
      } else {
        logger.info(`[aws-stop-vm] ${vmName} no SpotInstanceRequestId on instance — on-demand or already detached, skipping cancel`);
      }
    } catch (sirErr) {
      // Don't block terminate — log and continue. Worst case: replacement gets launched,
      // and a follow-up sweep can catch it.
      logger.warn(`[aws-stop-vm] ${vmName} Spot request cancel soft-fail: ${sirErr.message}`);
    }

    // 3b. Terminate the EC2. The boot EBS is DeleteOnTermination:true so it goes
    //     with the instance — disk cost goes to zero while stopped, only the AMI
    //     snapshot remains (~$0.05/GB-month).
    await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    logger.info(`[aws-stop-vm] ${vmName} EC2 terminated`);

    // 3c. Snapshot rotation — mirror Azure's "keep latest 1" pattern.
    //     Added 2026-06-16. Previously every stop left an AMI + EBS snapshot
    //     behind forever — each start handler only deregistered the AMI it
    //     was launching from, never older ones. For Trainify/M365 cohorts
    //     stopping daily over 2 months, that's 60 AMIs + 60 incremental
    //     snapshots per VM. Azure handler already rotates in azure-stop-vm.js:175.
    //     Same idea here: list all AMIs matching this VM's naming pattern,
    //     filter out the one we just created, deregister + delete the rest's
    //     EBS snapshots. Soft-fail — log + continue so the stop completes.
    try {
      const desc = await ec2.send(new DescribeImagesCommand({
        Owners: ['self'],
        Filters: [{ Name: 'name', Values: [`${vmName}-snap-*`] }],
      }));
      const oldAmis = (desc.Images || []).filter(im => im.ImageId !== stoppedAmiId);
      let amiDel = 0, snapDel = 0;
      for (const im of oldAmis) {
        // Capture snapshot ids BEFORE deregister (after deregister, BDM is gone).
        const snapIds = (im.BlockDeviceMappings || [])
          .map(b => b.Ebs?.SnapshotId)
          .filter(Boolean);
        try {
          await ec2.send(new DeregisterImageCommand({ ImageId: im.ImageId }));
          amiDel++;
        } catch (e) { logger.warn(`[aws-stop-vm] ${vmName} old AMI ${im.ImageId} deregister err: ${e.message}`); }
        for (const sid of snapIds) {
          try {
            await ec2.send(new DeleteSnapshotCommand({ SnapshotId: sid }));
            snapDel++;
          } catch (e) { logger.warn(`[aws-stop-vm] ${vmName} old snap ${sid} delete err: ${e.message}`); }
        }
      }
      if (amiDel || snapDel) {
        logger.info(`[aws-stop-vm] ${vmName} rotation: -${amiDel} old AMI(s), -${snapDel} old snapshot(s)`);
      }
    } catch (rotErr) {
      logger.warn(`[aws-stop-vm] ${vmName} rotation soft-fail (proceeding): ${rotErr.message}`);
    }

    // 4. Close the log + update quota in the same hours convention as Azure stop.
    const currentTime = new Date();
    const logIndex = (vmDoc.logs || []).findIndex(l => !l.stop);
    const update = {
      isRunning: false,
      cloudInstanceId: null,
      publicIp: null,
      // dcvPort preserved across stop/start — getlabs.cloud:<port> URL is stable forever.
      // nginx auto-rebuild skips entries with null publicIp, so the proxy entry vanishes
      // while stopped and reappears with the new IP on start.
      stoppedAmiId,
      remarks: "Stopped & snapshotted",
    };
    if (logIndex !== -1) {
      const startTime = new Date(vmDoc.logs[logIndex].start);
      const durationMins = Math.ceil((currentTime - startTime) / 60000);
      const totalDuration = (vmDoc.duration || 0) + durationMins;
      const consumedQuota = Math.round(((vmDoc.quota?.consumed || 0) + durationMins / 60) * 100) / 100;
      update[`logs.${logIndex}.stop`] = currentTime;
      update[`logs.${logIndex}.duration`] = durationMins;
      update.duration = totalDuration;
      update["quota.consumed"] = consumedQuota;
      const totalMinutes = vmDoc.quota?.total || Infinity;
      if (consumedQuota * 60 >= totalMinutes) {
        update.isAlive = false;
        update.remarks = "Quota Exceeded";
      }
    }
    await VM.updateOne({ name: vmName }, { $set: update });
    logger.info(`[aws-stop-vm] ${vmName} snapshot+terminate complete`);
  } catch (err) {
    logger.error(`[aws-stop-vm] ${vmName}: ${err.message}`);
    // Last-resort safety: try a regular stop so the customer at least isn\'t paying
    // compute, even if the snapshot path failed.
    try {
      const vmDoc = await VM.findOne({ name: vmName }).lean();
      const instanceId = vmDoc?.cloudInstanceId || vmDoc?.resourceGroup;
      if (instanceId?.startsWith("i-")) {
        await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
        await VM.updateOne({ name: vmName }, { $set: { isRunning: false, remarks: "Stopped (fallback)" } });
      }
    } catch {}
    throw err;
  }
};

module.exports = handler;
