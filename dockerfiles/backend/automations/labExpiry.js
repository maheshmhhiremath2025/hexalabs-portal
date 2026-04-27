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

    // Expired: delete from Azure + DB
    if (expiresAt <= now) {
      logger.info(`VM ${vm.name} expired — auto-deleting from Azure`);

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

    // Expired: delete Docker container
    if (expiresAt <= now) {
      if (dockerCleanup) { try { await dockerCleanup(c.containerId); } catch {} }
      else { c.isAlive = false; c.isRunning = false; c.remarks = 'Auto-deleted (expired)'; await c.save(); }
      logger.info(`Container ${c.name} expired and cleaned up`);
    }
  }

  // ===== Training-level expiry (purge entire batch) =====
  const expiringTrainings = await Training.find({
    status: 'active',
    expiresAt: { $exists: true, $ne: null, $lte: now },
  });

  for (const training of expiringTrainings) {
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
