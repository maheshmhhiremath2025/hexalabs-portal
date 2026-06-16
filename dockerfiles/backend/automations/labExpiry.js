const VM = require('../models/vm');
const Container = require('../models/container');
const Training = require('../models/training');
const { logger } = require('../plugins/logger');
const { cascadeRdsSessions } = require('../services/rdsCascade');

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

// Direct Azure cleanup (same as DELETE /azure/vm route)
let azureCleanup;
try {
  const { ClientSecretCredential } = require('@azure/identity');
  const { ComputeManagementClient } = require('@azure/arm-compute');
  const { NetworkManagementClient } = require('@azure/arm-network');
  const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const compute = new ComputeManagementClient(cred, process.env.SUBSCRIPTION_ID);
  const network = new NetworkManagementClient(cred, process.env.SUBSCRIPTION_ID);

  azureCleanup = async (vmName, resourceGroup) => {
    try {
      let osDiskName;
      try { const azVm = await compute.virtualMachines.get(resourceGroup, vmName); osDiskName = azVm.storageProfile?.osDisk?.name; } catch {}
      try { await compute.virtualMachines.beginDeleteAndWait(resourceGroup, vmName); } catch {}
      if (osDiskName) { try { await compute.disks.beginDeleteAndWait(resourceGroup, osDiskName); } catch {} }
      try { await network.networkInterfaces.beginDeleteAndWait(resourceGroup, `${vmName}-nic`); } catch {}
      for (const ipName of [`${vmName}-public-IP`, `${vmName}-pip`]) { try { await network.publicIPAddresses.beginDeleteAndWait(resourceGroup, ipName); } catch {} }
      try { await network.networkSecurityGroups.beginDeleteAndWait(resourceGroup, `${vmName}-nsg`); } catch {}
      logger.info(`Expiry cleanup: ${vmName} deleted from Azure`);
    } catch (e) { logger.error(`Expiry cleanup failed for ${vmName}: ${e.message}`); }
  };
} catch {}

// Docker cleanup
let dockerCleanup;
try {
  const { deleteContainer } = require('../services/containerService');
  dockerCleanup = deleteContainer;
} catch {}

/**
 * Lab Expiry Checker — runs every minute.
 * 1. Sends warning email 1 hour before expiry
 * 2. Auto-deletes VMs/containers when expired
 * 3. Auto-purges entire training if training expiresAt is set
 */
async function labExpiryChecker() {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  // ===== Individual VM expiry =====
  const expiringVms = await VM.find({
    isAlive: true,
    expiresAt: { $exists: true, $ne: null },
  });

  for (const vm of expiringVms) {
    const expiresAt = new Date(vm.expiresAt);

    // Warning: 1 hour before expiry
    if (expiresAt <= oneHourFromNow && expiresAt > now && !vm.expiryWarningEmailSent && sendEmail) {
      const minsLeft = Math.round((expiresAt - now) / 60000);
      await sendEmail(vm.email,
        `Lab Expiry Warning: ${vm.name} expires in ${minsLeft} minutes`,
        `<div style="font-family:-apple-system,sans-serif;max-width:500px;">
          <div style="background:#f59e0b;padding:16px 20px;border-radius:8px 8px 0 0;"><h2 style="color:white;margin:0;font-size:16px;">Lab Expiring Soon</h2></div>
          <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p>Your lab instance <strong>${vm.name}</strong> (${vm.trainingName}) will be <strong>automatically deleted</strong> in <strong>${minsLeft} minutes</strong>.</p>
            <p>All resources including VMs, disks, and networking will be permanently removed.</p>
            <p style="color:#6b7280;font-size:13px;">To extend the lab, contact your administrator or use the "Extend" option in the portal before expiry.</p>
          </div>
        </div>`
      ).catch(() => {});
      vm.expiryWarningEmailSent = true;
      await vm.save();
      logger.info(`Expiry warning sent for VM ${vm.name} (${minsLeft}m left)`);
    }

    // Expired: delete from Azure + DB.
    // 24h grace before destructive cleanup — protects against admin-extends-expiry
    // race where labExpiry fires right as old expiresAt crosses, before Mongo update lands.
    // Pattern mirrors the young-VM guard in vmStateReconciler (post-25-May EY cohort fix).
    const twentyFourHoursAgoVm = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (expiresAt > twentyFourHoursAgoVm && expiresAt <= now) {
      // Just expired (<24h) — soft-mark only, keep Azure resources alive so an extend can recover.
      if (vm.isAlive) {
        vm.isAlive = false; vm.isRunning = false; vm.remarks = 'Expired — awaiting 24h grace';
        await vm.save();
        logger.info(`VM ${vm.name} soft-expired, deferring Azure delete until 24h past expiry`);
      }
      continue;
    }
    if (expiresAt <= twentyFourHoursAgoVm) {
      logger.info(`VM ${vm.name} expired >24h — auto-deleting from Azure`);

      // Delete from Azure
      if (azureCleanup && vm.resourceGroup !== 'docker') {
        await azureCleanup(vm.name, vm.resourceGroup);
      }

      // Mark as dead in DB
      vm.isAlive = false;
      vm.isRunning = false;
      vm.remarks = 'Auto-deleted (lab expired)';
      await vm.save();

      // Cascade to per-user RDS session rows (if any). The previous query
      // matched on `rdsServer` which was never written, so it silently
      // no-op'd; the helper matches by name prefix + os tag instead.
      await cascadeRdsSessions(vm.name, 'delete').catch(e =>
        logger.error(`[expiry] ${vm.name}: rds cascade failed — ${e.message}`)
      );

      logger.info(`VM ${vm.name} expired and cleaned up`);
    }
  }

  // ===== Individual Container expiry =====
  const expiringContainers = await Container.find({
    isAlive: true,
    expiresAt: { $exists: true, $ne: null },
  });

  for (const c of expiringContainers) {
    const expiresAt = new Date(c.expiresAt);

    // Warning
    if (expiresAt <= oneHourFromNow && expiresAt > now && !c.expiryWarningEmailSent && sendEmail) {
      const minsLeft = Math.round((expiresAt - now) / 60000);
      await sendEmail(c.email,
        `Container Expiry: ${c.name} expires in ${minsLeft} minutes`,
        `<p>Your container <strong>${c.name}</strong> will be deleted in ${minsLeft} minutes.</p>`
      ).catch(() => {});
      c.expiryWarningEmailSent = true;
      await c.save();
    }

    // Expired: delete Docker container — 24h grace before destructive docker rm.
    // Mirrors VM guard above. Protects against the labExpiry vs admin-extend race that
    // wiped 11 linuxvibe containers on 2026-05-26 (data unrecoverable, no snapshot).
    const twentyFourHoursAgoC = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (expiresAt > twentyFourHoursAgoC && expiresAt <= now) {
      if (c.isAlive) {
        c.isAlive = false; c.isRunning = false; c.remarks = 'Expired — awaiting 24h grace';
        await c.save();
        logger.info(`Container ${c.name} soft-expired, deferring docker rm until 24h past expiry`);
      }
      continue;
    }
    if (expiresAt <= twentyFourHoursAgoC) {
      if (dockerCleanup) { try { await dockerCleanup(c.containerId); } catch {} }
      else { c.isAlive = false; c.isRunning = false; c.remarks = 'Auto-deleted (expired >24h)'; await c.save(); }
      logger.info(`Container ${c.name} expired >24h — cleaned up`);
    }
  }

  // ===== Training-level expiry (purge entire batch) =====
  const expiringTrainings = await Training.find({
    status: 'active',
    expiresAt: { $exists: true, $ne: null, $lte: now },
  });

  for (const training of expiringTrainings) {
    // Guard 1: refuse to purge if ANY child VM or container has its own expiresAt extended
    // beyond the training-level expiry. Admins extend container.expiresAt via portal UI but
    // training.expiresAt is often missed — without this guard, training-level purge wipes
    // containers that were explicitly extended (data loss incident on 2026-05-27).
    // Guard 2: 24h grace before destructive purge even if everything is aligned — safety net
    // against admin-extend race where the new expiresAt lands milliseconds after this cron tick.
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (new Date(training.expiresAt) > twentyFourHoursAgo) {
      logger.info(`Training ${training.name} expired but within 24h grace — deferring purge`);
      continue;
    }

    const liveChildVm = await VM.findOne({
      trainingName: training.name,
      isAlive: true,
      expiresAt: { $gt: now },
    });
    const liveChildContainer = await Container.findOne({
      trainingName: training.name,
      isAlive: true,
      expiresAt: { $gt: now },
    });
    if (liveChildVm || liveChildContainer) {
      logger.warn(`Training ${training.name} marked expired but ${liveChildVm ? 'VM ' + liveChildVm.name : ''}${liveChildVm && liveChildContainer ? ' + ' : ''}${liveChildContainer ? 'container ' + liveChildContainer.name : ''} has extended expiresAt > now — auto-aligning training.expiresAt and skipping purge`);
      // Auto-align: extend training.expiresAt to match the latest child expiry so subsequent
      // ticks don't keep re-flagging this training as expired.
      const maxVm = await VM.find({ trainingName: training.name, isAlive: true }).sort({ expiresAt: -1 }).limit(1).toArray ? null : await VM.findOne({ trainingName: training.name, isAlive: true }).sort({ expiresAt: -1 });
      const maxContainer = await Container.findOne({ trainingName: training.name, isAlive: true }).sort({ expiresAt: -1 });
      const candidates = [maxVm && maxVm.expiresAt, maxContainer && maxContainer.expiresAt].filter(Boolean).map(d => new Date(d).getTime());
      if (candidates.length) {
        training.expiresAt = new Date(Math.max(...candidates));
        await training.save();
      }
      continue;
    }

    logger.info(`Training ${training.name} expired — auto-purging all resources`);

    // Delete all VMs in this training
    const vms = await VM.find({ trainingName: training.name, isAlive: true });
    for (const vm of vms) {
      if (azureCleanup && vm.resourceGroup !== 'docker') {
        await azureCleanup(vm.name, vm.resourceGroup);
      }
      vm.isAlive = false; vm.isRunning = false; vm.remarks = 'Training expired'; await vm.save();
    }

    // Delete all containers in this training
    const containers = await Container.find({ trainingName: training.name, isAlive: true });
    for (const c of containers) {
      if (dockerCleanup) { try { await dockerCleanup(c.containerId); } catch {} }
      c.isAlive = false; c.isRunning = false; c.remarks = 'Training expired'; await c.save();
    }

    training.status = 'expired';
    await training.save();

    logger.info(`Training ${training.name} fully purged (${vms.length} VMs, ${containers.length} containers)`);
  }
}

module.exports = { labExpiryChecker };
