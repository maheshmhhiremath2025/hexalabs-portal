const express = require('express');
const {handleGetTrainingName, handleGetTemplates, handleGetMachines, handleVMRestart} = require('../controllers/users/azure')
const {handleGetTrainingPorts, handleOpenTrainingPorts, handleCloseTrainingPorts} = require('./../controllers/users/port')
const {handleGetExistingSchedule, handleDeleteSchedule, handleCreateSchedule, handleGetSchedulesByVm, handleBulkDeleteSchedules, handleBulkUpdateSchedules} = require("./../controllers/users/schedule")
const {handleGetBillingStats, handleGetLogs, handleGetVMnames, handleGetCohortLogs} = require('./../controllers/users/billingStats')
const {handleCreateMachines, handleCreateFreshVMs, handleGetMarketplaceImages} = require ('./../controllers/users/azureVmCreate')
const {handleVMOperations} = require('./../controllers/users/vm')
const {handleKillTraining, handlePreviewKill} = require("./../controllers/killTraining")
const { getVmAccessUrl } = require('../services/guacamoleService');
const { requireWorker, isWorkerAlive } = require('../services/queueHealth');
const { cascadeRdsSessions } = require('../services/rdsCascade');
const { logger } = require('../plugins/logger');
const queues = require('./../controllers/newQueues');
const router = express.Router();

router.get('/trainingName', handleGetTrainingName);
router.get('/ports', handleGetTrainingPorts);
// Mutations that enqueue Bull jobs are gated by requireWorker — if no
// worker is heart-beating on Redis, we return 503 with a clear message
// instead of silently dropping the job into the void.
router.post('/ports', requireWorker, handleOpenTrainingPorts);
router.delete('/ports', requireWorker, handleCloseTrainingPorts);
router.get('/schedules', handleGetExistingSchedule);
router.delete('/schedules', handleDeleteSchedule);
router.post('/schedules', handleCreateSchedule);
// === Additive bulk-management endpoints (2026-05-28) ===
router.get('/schedules/by-vm', handleGetSchedulesByVm);
router.post('/schedules/bulk-delete', handleBulkDeleteSchedules);
router.post('/schedules/bulk-update', handleBulkUpdateSchedules);
router.get('/templates', handleGetTemplates);
router.get('/billing', handleGetBillingStats);
router.get('/logs', handleGetLogs);
router.get('/vmnames', handleGetVMnames);
router.get('/logs/cohort', handleGetCohortLogs);
router.get('/machines', handleGetMachines)
router.post('/machines', requireWorker, handleCreateMachines)
router.get('/marketplace-images', handleGetMarketplaceImages);
router.post('/marketplace-vm', requireWorker, handleCreateFreshVMs);
router.patch('/machines', requireWorker, handleVMOperations);
router.patch('/machinesRestart', requireWorker, handleVMRestart);
router.get('/killTraining/preview', handlePreviewKill);
router.delete('/killTraining', handleKillTraining);

// Light-weight queue-health probe for the frontend. Lets the UI gray out
// Start/Stop buttons proactively instead of discovering the outage at
// click-time. Cached for 5s inside queueHealth so polling is cheap.
router.get('/queue-health', async (req, res) => {
  const alive = await isWorkerAlive();
  res.json({ alive });
});

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

    // Cascade to per-user RDS session rows (helper matches by name prefix
    // + os tag — the previous `rdsServer` query never matched anything
    // because that field is never persisted).
    await cascadeRdsSessions(vmName, 'delete').catch(e =>
      logger.error(`[delete-vm] ${vmName}: rds cascade failed — ${e.message}`)
    );

    // Hand cleanup off to the worker via Bull. The previous implementation ran
    // an unawaited (async () => { ... })() in the request process, which is
    // killed on every backend restart — leaving partial cleanups (e.g. NIC
    // deleted but Public IP / NSG / snapshot still around) that brick future
    // snapshot-recovery starts on the same vmName. The worker handler at
    // worker/handlers/azure-delete-vm.js calls DeleteVMandResources() which is
    // already idempotent (skips 404s gracefully), so Bull retries on failure
    // converge cleanly. Ref: dockerguidedlab-1 incident 2026-05-05.
    await queues['azure-delete-vm'].add({
      name: vmName,
      resourceGroup,
      guacamole: !!vm.guacamole,
    });
    res.json({ message: `${vmName} deletion queued — Azure resources will be cleaned up by the worker` });
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
    // Tenant scoping: org-admin can only modify expiry for own org's resources.
    const scopeOrg = req.user.userType === 'superadmin' ? null : (req.user.organization || null);

    if (trainingName && !vmName) {
      // Set expiry for entire training + all its VMs/containers
      const Training = require('../models/training');
      const VM = require('../models/vm');
      const Container = require('../models/container');

      // Verify training belongs to caller's org
      if (scopeOrg) {
        const t = await Training.findOne({ name: trainingName }, 'organization').lean();
        if (!t || t.organization !== scopeOrg) {
          return res.status(403).json({ message: 'Cannot modify expiry for a training outside your organization' });
        }
      }

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
      const Training = require('../models/training');

      // Verify VM/container belongs to caller's org (VM has no org field — resolve via trainingName)
      if (scopeOrg) {
        const vmDoc = await VM.findOne({ name: vmName }, 'trainingName').lean();
        const cDoc  = vmDoc ? null : await Container.findOne({ name: vmName }, 'organization trainingName').lean();
        if (vmDoc) {
          const t = await Training.findOne({ name: vmDoc.trainingName }, 'organization').lean();
          if (!t || t.organization !== scopeOrg) {
            return res.status(403).json({ message: 'Cannot modify expiry for a VM outside your organization' });
          }
        } else if (cDoc) {
          if (cDoc.organization !== scopeOrg) {
            return res.status(403).json({ message: 'Cannot modify expiry for a container outside your organization' });
          }
        } else {
          return res.status(404).json({ message: 'Instance not found' });
        }
      }

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
    // Patched 2026-05-21: ignore client-supplied creds. Pull adminUsername/adminPassword/publicIp from Mongo to prevent stale frontend caches reverting Guac connection params.
    const { vmName, useVnc, vncPort } = req.body;
    if (!vmName) return res.status(400).json({ message: 'vmName required' });
    const VMM = require('../models/vm');
    const vmServerDoc = await VMM.findOne({ name: vmName }, 'adminUsername adminPass publicIp os hasXrdp').lean();
    if (!vmServerDoc) return res.status(404).json({ message: 'VM not found' });
    const adminUsername = vmServerDoc.adminUsername;
    const adminPassword = vmServerDoc.adminPass;
    const publicIp = vmServerDoc.publicIp;
    const os = vmServerDoc.os;

    // Only route to the Kasm proxy when the caller explicitly asked
    // (useVnc=true, set by vmDetails.jsx when the VM's kasmVnc flag is
    // true). Otherwise fall through to Guacamole — Windows always does,
    // and Linux VMs without KasmVNC installed need Guacamole too.
    if (useVnc) {
      const apiBase = process.env.KASM_PROXY_BASE || 'https://api.hexalabs.online';
      const pw = encodeURIComponent(adminPassword || 'Welcome1234!');
      return res.json({
        accessUrl: `${apiBase}/kasm/${vmName}/?password=${pw}&autoconnect=1`,
        mode: 'kasmvnc-proxy',
      });
    }

    // For Linux VMs with xrdp installed, pass the xrdp flag so the
    // Guacamole service picks RDP (security='rdp', port 3389) and opens
    // the XFCE desktop instead of a bare SSH terminal.
    const result = await getVmAccessUrl({
      vmName, publicIp, adminUsername, adminPassword, os,
      useVnc: useVnc || false,
      vncPort: vncPort || 6901,
      xrdp: !!vmServerDoc.hasXrdp,
    });
    res.json(result);
  } catch (err) {
    logger.error(`Browser access error: ${err.message}`);
    res.status(500).json({ message: 'Failed to create browser access' });
  }
});

module.exports = router