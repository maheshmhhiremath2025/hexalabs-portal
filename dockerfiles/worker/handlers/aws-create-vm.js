// AWS EC2 + NICE DCV provisioning handler
// DCV is free on EC2 (auto license via instance metadata). Spot persistent so VM
// auto-restarts after Spot interruption (Azure-parity behavior).
const { EC2Client, RunInstancesCommand, DescribeInstancesCommand, DescribeInstanceStatusCommand } = require("@aws-sdk/client-ec2");
const https = require("https");
const VM = require("./../models/vm");
const User = require("./../models/user");
const Training = require("./../models/training");
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

// Phase 2 readiness: AWS hypervisor health checks pass when Windows has booted
// far enough for EC2Launch v2 to finish its init pass (sets labuser password,
// starts DCV service). Usually 2-3 min after State.Name === 'running'.
async function waitForSystemOk(instanceId, timeoutSec = 600) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      const r = await ec2.send(new DescribeInstanceStatusCommand({ InstanceIds: [instanceId], IncludeAllInstances: true }));
      const st = r.InstanceStatuses?.[0];
      if (st?.SystemStatus?.Status === "ok" && st?.InstanceStatus?.Status === "ok") return true;
    } catch (e) { /* transient API hiccup — keep polling */ }
    await new Promise(r => setTimeout(r, 10000));
  }
  return false; // soft-fail; downstream probe will catch a real outage
}

// Phase 3 readiness: DCV HTTPS port is reachable end-to-end. Confirms DCV
// daemon is bound + handling SSL handshake + auth UI is up.
async function probeDcvUp(publicIp, timeoutSec = 240) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const req = https.request(
        { host: publicIp, port: 8443, path: "/", method: "GET", rejectUnauthorized: false, timeout: 5000 },
        res => { resolve(res.statusCode && res.statusCode < 500); res.resume(); }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 6000));
  }
  return false;
}

async function waitForWindowsReady(vmName, instanceId, publicIp, VM) {
  await VM.updateOne({ name: vmName }, { $set: { remarks: "Initializing Windows…" } });
  const sysOk = await waitForSystemOk(instanceId);
  if (sysOk) logger.info(`[aws-create-vm] ${vmName} SystemStatus ok`);
  await VM.updateOne({ name: vmName }, { $set: { remarks: "Starting DCV…" } });
  const dcvOk = await probeDcvUp(publicIp);
  if (dcvOk) logger.info(`[aws-create-vm] ${vmName} DCV reachable on :8443`);
  else logger.warn(`[aws-create-vm] ${vmName} DCV probe timed out — proceeding anyway`);
}

const handler = async (job) => {
  const data = job.data;
  logger.info(`[aws-create-vm] received: ${JSON.stringify({ vmName: data.vmName, email: data.email })}`);

  try {
    const tags = [
      { Key: "Name", Value: data.vmName },
      { Key: "Email", Value: data.email || "" },
      { Key: "Training", Value: data.trainingName || "" },
      { Key: "Org", Value: data.user?.organization || "" },
      { Key: "ManagedBy", Value: "synergific" },
    ];

    const runRes = await ec2.send(new RunInstancesCommand({
      ImageId: data.template.imageId,
      InstanceType: data.template.vmSize || "m5.large",
      MinCount: 1, MaxCount: 1,
      SecurityGroupIds: [data.template.securityGroupId],
      IamInstanceProfile: { Name: data.template.iamProfile || "SynergificDCVRole" },
      InstanceMarketOptions: {
        MarketType: "spot",
        SpotOptions: { SpotInstanceType: "persistent", InstanceInterruptionBehavior: "stop" }
      },
      BlockDeviceMappings: [{
        DeviceName: "/dev/sda1",
        Ebs: { VolumeSize: data.template.diskSizeGB || 100, VolumeType: "gp3", DeleteOnTermination: true }
      }],
      TagSpecifications: [{ ResourceType: "instance", Tags: tags }],
    }));
    const instanceId = runRes.Instances[0].InstanceId;
    logger.info(`[aws-create-vm] ${data.vmName} launched ${instanceId}`);

    const inst = await waitForRunning(instanceId);
    const publicIp = inst.PublicIpAddress;
    logger.info(`[aws-create-vm] ${data.vmName} running @ ${publicIp}`);

    // Wait for Windows-level readiness before the customer can hit Open-in-Browser.
    // Marked complete only when DCV is actually answering on 8443.
    // (Has to happen AFTER VM doc upsert so remarks updates have a target — see below.)

    const trainingName = (data.trainingName || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // Allocate a free DCV proxy port (30001-39999) with E11000 retry.
    // Mongo has a sparse unique index on dcvPort; the first writer wins, the
    // second gets a duplicate-key error and we try the next free port.
    let dcvPort = null;
    for (let attempt = 0; attempt < 20 && !dcvPort; attempt++) {
      try {
        const used = await VM.find({ dcvPort: { $exists: true, $ne: null } }, 'dcvPort').lean();
        const usedSet = new Set(used.map(v => Number(v.dcvPort)).filter(Boolean));
        let candidate = null;
        for (let pp = 30001 + attempt; pp <= 39999; pp++) { if (!usedSet.has(pp)) { candidate = pp; break; } }
        if (!candidate) break;
        // Attempt to claim the port atomically by writing a placeholder doc
        // upfront. Use updateOne with the unique index as the safety net.
        try {
          await VM.updateOne({ name: data.vmName }, { $set: { dcvPort: candidate } }, { upsert: true });
          dcvPort = candidate;
          logger.info(`[aws-create-vm] ${data.vmName} claimed dcvPort=${candidate} on attempt ${attempt+1}`);
        } catch (e2) {
          if (e2.code === 11000) {
            logger.info(`[aws-create-vm] ${data.vmName} port ${candidate} taken (race), retrying`);
            continue;
          }
          throw e2;
        }
      } catch (e) {
        logger.warn(`[aws-create-vm] dcvPort allocation attempt ${attempt+1} failed: ${e.message}`);
      }
    }
    if (!dcvPort) logger.error(`[aws-create-vm] ${data.vmName} FAILED to allocate dcvPort after 20 attempts`);

    await VM.updateOne({ name: data.vmName }, { $set: {
      name: data.vmName, templateName: data.templateName, logs: [{ start: new Date() }],
      rate: data.rate || 0, duration: 0, cloud: "aws", isRunning: true, isAlive: true,
      os: data.template.os || "Windows", resourceGroup: instanceId, publicIp,
      adminPass: "Welcome1234!", adminUsername: "labuser",
      kasmVnc: false, hasXrdp: false, guacamole: false, dcv: true,
      autoShutdown: data.autoShutdown || false, idleMinutes: data.idleMinutes || 0,
      hybridBenefit: false, expiresAt: data.expiresAt,
      organization: data.user?.organization || "", trainingName, email: data.email,
      vmSize: data.template.vmSize, location: REGION,
      quota: { total: data.allocatedHours || 2880, consumed: 0 },
      lastActivityAt: new Date(), remarks: "Alive", cloudInstanceId: instanceId,
      dcvPort,
    }}, { upsert: true });
    logger.info(`[aws-create-vm] VM doc upserted ${data.vmName}`);

    // Training doc upsert + vmUserMapping push.
    // 2026-06-16: previously this was a single $set upsert that NEVER populated
    // vmUserMapping. Result: Lab Console showed "No labs found" for every learner
    // on every AWS DCV cohort (winnox, M365, etc.) since at least 2026-06-09.
    // Mirror the working azure-create-vm pattern: findOne + check + push + save,
    // create with mapping if absent. Idempotent — if this handler retries, the
    // .some(...) check prevents duplicate mapping entries for the same VM.
    {
      const existingTraining = await Training.findOne({
        name: trainingName,
        organization: data.user?.organization || "",
      });
      if (existingTraining) {
        const alreadyMapped = (existingTraining.vmUserMapping || [])
          .some(m => m.vmName === data.vmName);
        if (!alreadyMapped && data.email) {
          existingTraining.vmUserMapping.push({
            vmName: data.vmName,
            userEmail: data.email,
          });
          await existingTraining.save();
          logger.info(`[aws-create-vm] Training ${trainingName} mapping +${data.email}`);
        }
      } else {
        await Training.create({
          name: trainingName,
          organization: data.user?.organization || "",
          vmUserMapping: data.email ? [{ vmName: data.vmName, userEmail: data.email }] : [],
          schedules: [],
          ports: data.template?.os === "Windows" ? [3389, 22] : [22],
        });
        logger.info(`[aws-create-vm] Training ${trainingName} created with mapping`);
      }
    }

    const existingUser = await User.findOne({ email: data.email });
    if (!existingUser && data.email) {
      const u = new User({
        email: data.email, password: "Welcome1234!",
        organization: data.user?.organization || "", userType: "user", trainingName,
      });
      await u.save();
      logger.info(`[aws-create-vm] user created ${data.email}`);
    }
    // Layered Windows-ready wait — happens BEFORE we mark complete so the
    // customer never sees a "Running" VM that DCV can't actually serve.
    await waitForWindowsReady(data.vmName, instanceId, publicIp, VM);
    await VM.updateOne({ name: data.vmName }, { $set: { remarks: "Alive" } });
    logger.info(`[aws-create-vm] ${data.vmName} complete`);
  } catch (err) {
    logger.error(`[aws-create-vm] FATAL ${data.vmName}: ${err.message}`);
    throw err;
  }
};

module.exports = handler;
