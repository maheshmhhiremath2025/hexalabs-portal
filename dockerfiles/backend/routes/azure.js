const express = require('express');
const {handleGetTrainingName, handleGetTemplates, handleGetMachines, handleVMRestart} = require('../controllers/users/azure')
const {handleGetTrainingPorts, handleOpenTrainingPorts, handleCloseTrainingPorts} = require('./../controllers/users/port')
const {handleGetExistingSchedule, handleDeleteSchedule, handleCreateSchedule} = require("./../controllers/users/schedule")
const {handleGetBillingStats, handleGetLogs, handleGetVMnames} = require('./../controllers/users/billingStats')
const {handleCreateMachines} = require ('./../controllers/users/azureVmCreate')
const {handleVMOperations} = require('./../controllers/users/vm')
const {handleKillTraining, handlePreviewKill} = require("./../controllers/killTraining")
const { getVmAccessUrl } = require('../services/guacamoleService');
const { logger } = require('../plugins/logger');
const router = express.Router();

router.get('/trainingName', handleGetTrainingName);
router.get('/ports', handleGetTrainingPorts);
router.post('/ports', handleOpenTrainingPorts);
router.delete('/ports', handleCloseTrainingPorts);
router.get('/schedules', handleGetExistingSchedule);
router.delete('/schedules', handleDeleteSchedule);
router.post('/schedules', handleCreateSchedule);
router.get('/templates', handleGetTemplates);
router.get('/billing', handleGetBillingStats);
router.get('/logs', handleGetLogs);
router.get('/vmnames', handleGetVMnames);
router.get('/machines', handleGetMachines)
router.post('/machines', handleCreateMachines)
router.patch('/machines', handleVMOperations);
router.patch('/machinesRestart', handleVMRestart);
router.get('/killTraining/preview', handlePreviewKill);
router.delete('/killTraining', handleKillTraining);

// Delete single VM (superadmin only) — synchronous, deletes from Azure directly
router.delete('/vm', async (req, res) => {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
    const { vmName, resourceGroup } = req.body;
    if (!vmName || !resourceGroup) return res.status(400).json({ message: 'vmName and resourceGroup required' });

    const VM = require('../models/vm');
    const vm = await VM.findOne({ name: vmName });
    if (!vm) return res.status(404).json({ message: 'VM not found' });

    // Mark as deleted in DB immediately
    vm.isAlive = false;
    vm.isRunning = false;
    vm.remarks = 'Deleted by superadmin';
    await vm.save();

    // Remove from training mapping
    const Training = require('../models/training');
    await Training.updateOne({ name: vm.trainingName }, { $pull: { vmUserMapping: { vmName: vmName } } });

    // Also delete all RDS session entries linked to this server
    if (vm.remarks?.includes('RDS Server')) {
      await VM.updateMany({ rdsServer: vmName }, { isAlive: false, isRunning: false, remarks: 'RDS server deleted' });
    }

    // Return immediately, do Azure cleanup in background
    res.json({ message: `${vmName} deletion started — Azure resources being cleaned up` });

    // Background: Delete from Azure directly (no worker needed)
    (async () => {
      try {
        const { ClientSecretCredential } = require('@azure/identity');
        const { ComputeManagementClient } = require('@azure/arm-compute');
        const { NetworkManagementClient } = require('@azure/arm-network');
        const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
        const compute = new ComputeManagementClient(cred, process.env.SUBSCRIPTION_ID);
        const network = new NetworkManagementClient(cred, process.env.SUBSCRIPTION_ID);

        // 1. Get VM details before deleting (need OS disk name)
        let osDiskName;
        try {
          const azVm = await compute.virtualMachines.get(resourceGroup, vmName);
          osDiskName = azVm.storageProfile?.osDisk?.name;
        } catch {}

        // 2. Delete VM
        try { await compute.virtualMachines.beginDeleteAndWait(resourceGroup, vmName); logger.info(`Azure VM deleted: ${vmName}`); } catch (e) { logger.error(`VM delete: ${e.message}`); }

        // 3. Delete OS disk
        if (osDiskName) { try { await compute.disks.beginDeleteAndWait(resourceGroup, osDiskName); logger.info(`Disk deleted: ${osDiskName}`); } catch {} }

        // 4. Delete NIC
        try { await network.networkInterfaces.beginDeleteAndWait(resourceGroup, `${vmName}-nic`); logger.info(`NIC deleted: ${vmName}-nic`); } catch {}

        // 5. Delete Public IP
        for (const ipName of [`${vmName}-public-IP`, `${vmName}-pip`]) {
          try { await network.publicIPAddresses.beginDeleteAndWait(resourceGroup, ipName); logger.info(`IP deleted: ${ipName}`); } catch {}
        }

        // 6. Delete NSG
        try { await network.networkSecurityGroups.beginDeleteAndWait(resourceGroup, `${vmName}-nsg`); logger.info(`NSG deleted: ${vmName}-nsg`); } catch {}

        // 7. Delete snapshots
        try {
          for await (const snap of compute.snapshots.listByResourceGroup(resourceGroup)) {
            if (snap.name.includes(vmName)) { await compute.snapshots.beginDeleteAndWait(resourceGroup, snap.name); logger.info(`Snapshot deleted: ${snap.name}`); }
          }
        } catch {}

        logger.info(`Full Azure cleanup complete for ${vmName}`);
      } catch (e) {
        logger.error(`Azure cleanup failed for ${vmName}: ${e.message}`);
      }
    })();
  } catch (err) {
    logger.error(`VM delete error: ${err.message}`);
    res.status(500).json({ message: 'Delete failed' });
  }
});

// Set/extend expiry for a training or individual VM
router.patch('/expiry', async (req, res) => {
  try {
    if (!['superadmin', 'admin'].includes(req.user.userType)) return res.status(403).json({ message: 'Forbidden' });

    const { trainingName, vmName, expiresAt, extendHours } = req.body;

    if (trainingName && !vmName) {
      // Set expiry for entire training + all its VMs/containers
      const Training = require('../models/training');
      const VM = require('../models/vm');
      const Container = require('../models/container');

      const newExpiry = extendHours
        ? new Date(Date.now() + extendHours * 60 * 60 * 1000)
        : new Date(expiresAt);

      await Training.findOneAndUpdate({ name: trainingName }, {
        expiresAt: newExpiry,
        expiryWarningEmailSent: false,
      });

      // Set same expiry on all VMs and containers in this training
      const vmUpdate = await VM.updateMany(
        { trainingName, isAlive: true },
        { expiresAt: newExpiry, expiryWarningEmailSent: false, $inc: { extendedCount: extendHours ? 1 : 0 } }
      );

      const containerUpdate = await Container.updateMany(
        { trainingName, isAlive: true },
        { expiresAt: newExpiry, expiryWarningEmailSent: false, $inc: { extendedCount: extendHours ? 1 : 0 } }
      );

      logger.info(`Expiry set for training ${trainingName}: ${newExpiry.toISOString()} (${vmUpdate.modifiedCount} VMs, ${containerUpdate.modifiedCount} containers)`);
      res.json({
        message: `Expiry ${extendHours ? 'extended' : 'set'} for training ${trainingName}`,
        expiresAt: newExpiry,
        vmsUpdated: vmUpdate.modifiedCount,
        containersUpdated: containerUpdate.modifiedCount,
      });
    } else if (vmName) {
      // Set/extend expiry for single VM
      const VM = require('../models/vm');
      const Container = require('../models/container');

      const newExpiry = extendHours
        ? new Date(Date.now() + extendHours * 60 * 60 * 1000)
        : new Date(expiresAt);

      // Try VM first, then container
      let updated = await VM.findOneAndUpdate(
        { name: vmName, isAlive: true },
        { expiresAt: newExpiry, expiryWarningEmailSent: false, $inc: { extendedCount: extendHours ? 1 : 0 } },
        { new: true }
      );

      if (!updated) {
        updated = await Container.findOneAndUpdate(
          { name: vmName, isAlive: true },
          { expiresAt: newExpiry, expiryWarningEmailSent: false, $inc: { extendedCount: extendHours ? 1 : 0 } },
          { new: true }
        );
      }

      if (!updated) return res.status(404).json({ message: 'Instance not found' });

      logger.info(`Expiry ${extendHours ? 'extended' : 'set'} for ${vmName}: ${newExpiry.toISOString()}`);
      res.json({ message: `Expiry ${extendHours ? 'extended' : 'set'} for ${vmName}`, expiresAt: newExpiry });
    } else {
      return res.status(400).json({ message: 'trainingName or vmName required' });
    }
  } catch (err) {
    logger.error(`Expiry update error: ${err.message}`);
    res.status(500).json({ message: 'Failed to update expiry' });
  }
});

// Update auto-shutdown settings for VMs (superadmin only)
router.patch('/vm-settings', async (req, res) => {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });

    const { vmName, trainingName, autoShutdown, idleMinutes, expiresAt } = req.body;
    const VM = require('../models/vm');

    const update = {};
    if (autoShutdown !== undefined) update.autoShutdown = autoShutdown;
    if (idleMinutes !== undefined) update.idleMinutes = idleMinutes;
    if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;

    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'Nothing to update' });

    let modified = 0;
    if (vmName) {
      const result = await VM.updateOne({ name: vmName }, { $set: update });
      modified = result.modifiedCount;
    } else if (trainingName) {
      const result = await VM.updateMany({ trainingName }, { $set: update });
      modified = result.modifiedCount;
    } else {
      return res.status(400).json({ message: 'vmName or trainingName required' });
    }

    const { logger } = require('../plugins/logger');
    logger.info(`VM settings updated: ${vmName || trainingName} → ${JSON.stringify(update)} (${modified} modified)`);
    res.json({ message: `Updated ${modified} VM(s)`, update });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update VM settings' });
  }
});

// Browser access for VMs.
//
// Policy: all Linux VMs go DIRECTLY to KasmVNC on port 6901 — no
// Guacamole hop. KasmVNC's own web UI handles clipboard sync, file
// drag/drop, multi-viewer and avoids extra server load. Windows VMs
// still route through Guacamole for RDP.
router.post('/browser-access', async (req, res) => {
  try {
    const { vmName, publicIp, adminUsername, adminPassword, os, useVnc, vncPort } = req.body;
    if (!vmName || !publicIp) return res.status(400).json({ message: 'vmName and publicIp required' });

    // Only route to the Kasm proxy when the caller explicitly asked
    // (useVnc=true, set by vmDetails.jsx when the VM's kasmVnc flag is
    // true). Otherwise fall through to Guacamole — Windows always does,
    // and Linux VMs without KasmVNC installed need Guacamole too.
    if (useVnc) {
      const apiBase = process.env.KASM_PROXY_BASE || 'https://api.getlabs.cloud';
      const pw = encodeURIComponent(adminPassword || 'Welcome1234!');
      return res.json({
        accessUrl: `${apiBase}/kasm/${vmName}/?password=${pw}&autoconnect=1`,
        mode: 'kasmvnc-proxy',
      });
    }

    // For Linux VMs with xrdp installed, pass the xrdp flag so the
    // Guacamole service picks RDP (security='rdp', port 3389) and opens
    // the XFCE desktop instead of a bare SSH terminal.
    const VM = require('../models/vm');
    const vmDoc = await VM.findOne({ name: vmName }, 'hasXrdp').lean();

    const result = await getVmAccessUrl({
      vmName, publicIp, adminUsername, adminPassword, os,
      useVnc: useVnc || false,
      vncPort: vncPort || 6901,
      xrdp: !!vmDoc?.hasXrdp,
    });
    res.json(result);
  } catch (err) {
    logger.error(`Browser access error: ${err.message}`);
    res.status(500).json({ message: 'Failed to create browser access' });
  }
});

module.exports = router;
