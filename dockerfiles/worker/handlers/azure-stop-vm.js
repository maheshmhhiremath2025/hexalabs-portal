// handlers/azure-stop-vm.js
const { logger } = require('./../plugins/logger');
const VM = require('./../models/vm');
const { cascadeRdsSessions } = require('./../functions/rdsCascade');
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
require('dotenv').config();

const subscriptionId = process.env.SUBSCRIPTION_ID;
const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const KEEP_LAST_SNAPSHOTS = parseInt(process.env.KEEP_LAST_SNAPSHOTS || '1', 10);
const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
const computeClient = new ComputeManagementClient(credentials, subscriptionId);

/**
 * STOP handler – executed when user clicks "Stop".
 * 1. Deallocate VM for consistent snapshot
 * 2. Snapshot OS disk (mandatory - throw if fails)
 * 3. Delete VM + OS disk
 * 4. Rotate old snapshots
 * 5. Update DB: stop time, duration, quota, isRunning=false
 */
const handler = async (job) => {
  try {
    const vmName = job.data.name;
    const resourceGroup = job.data.resourceGroup;

    // ---------------------------------------------------------------
    // 1. Load VM document + validate state
    // ---------------------------------------------------------------
    const vmDoc = await VM.findOne(
      { name: vmName },
      'isRunning isAlive logs duration quota vmTemplate -_id'
    );

    if (!vmDoc) {
      return logger.error(`${vmName} not found in DB`);
    }

    // When queued by the reconciler, DB is already updated (isRunning=false, log closed).
    // We still need to do the Azure operations (snapshot + delete).
    const reconciledMode = job.data.reconciled === true;

    if (!vmDoc.isRunning && !reconciledMode) {
      return logger.error(`${vmName} is already stopped – skipping`);
    }

    const currentTime = new Date();

    // Find the open log entry (stop === null)
    let logIndex = vmDoc.logs.findIndex(log => !log.stop);
    if (logIndex === -1 && !reconciledMode) {
      // No open log — proceed with stop anyway (duration = 0 for this session)
      logger.warn(`No open log entry for ${vmName} — proceeding with stop (duration=0)`);
    }

    const startTime = logIndex !== -1 ? vmDoc.logs[logIndex].start : null;
    const durationMins = startTime ? Math.ceil((currentTime - new Date(startTime)) / 60000) : 0;
    const totalDuration = (vmDoc.duration || 0) + durationMins;
    const consumedQuota = (vmDoc.quota?.consumed || 0) + durationMins;

    // ---------------------------------------------------------------
    // 2. UPDATE DB FIRST — mark as stopped BEFORE touching Azure
    //    This ensures portal never shows "Running" for a deleted VM.
    // ---------------------------------------------------------------
    const dbUpdatePayload = {
      isRunning: false,
      stopAttempts: 0,   // success — clear the idleShutdown stuck-stop counter
    };

    if (!reconciledMode && logIndex !== -1) {
      dbUpdatePayload[`logs.${logIndex}.stop`] = currentTime;
      dbUpdatePayload[`logs.${logIndex}.duration`] = durationMins;
      dbUpdatePayload.duration = totalDuration;
      dbUpdatePayload['quota.consumed'] = consumedQuota;
    }

    if (consumedQuota >= (vmDoc.quota?.total || Infinity)) {
      dbUpdatePayload.isAlive = false;
      dbUpdatePayload.remarks = 'Quota Exceeded';
    }

    await VM.updateOne({ name: vmName }, { $set: dbUpdatePayload });
    logger.info(`${vmName} marked as stopped in DB (duration: ${durationMins} min)`);

    // If this VM is an RDS host, pause its session rows too — otherwise the
    // Lab Console keeps showing them as Running, pointing at an IP that no
    // longer accepts RDP, which is what triggers Guacamole's "network
    // unstable" error. We use 'stop' (not 'delete') because the host can
    // come back from snapshot via the start handler.
    cascadeRdsSessions(vmName, 'stop').catch(e =>
      logger.error(`[stop-vm] ${vmName}: rds cascade failed — ${e.message}`)
    );

    // ---------------------------------------------------------------
    // 3. Deallocate VM for consistent snapshot
    // ---------------------------------------------------------------
    await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);
    logger.info(`${vmName} deallocated for consistent snapshot`);

    // ---------------------------------------------------------------
    // 4. Get VM and create OS snapshot (mandatory)
    // ---------------------------------------------------------------
    const vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
    const osDiskName = vm.storageProfile?.osDisk?.name;
    if (!osDiskName) {
      throw new Error(`No OS disk found on VM ${vmName}; cannot snapshot.`);
    }
    const osDisk = await computeClient.disks.get(resourceGroup, osDiskName);
    const snapName = `${vmName}-os-snap-${Date.now()}`;
    await computeClient.snapshots.beginCreateOrUpdateAndWait(resourceGroup, snapName, {
      location: osDisk.location,
      sku: { name: 'Standard_LRS' },
      creationData: { createOption: 'Copy', sourceResourceId: osDisk.id },
      tags: Object.assign({}, vm.tags || {}, { seatId: vmName })
    });
    logger.info(`OS snapshot created: ${snapName}`);

    // ---------------------------------------------------------------
    // 5. Delete VM
    // ---------------------------------------------------------------
    await computeClient.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);
    logger.info(`VM deleted: ${vmName}`);

    // ---------------------------------------------------------------
    // 6. Delete OS disk
    // ---------------------------------------------------------------
    await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
    logger.info(`OS disk deleted: ${osDiskName}`);

    // ---------------------------------------------------------------
    // 7. Rotate old snapshots (keep latest N)
    // ---------------------------------------------------------------
    const prefix = `${vmName}-os-snap-`;
    const snaps = [];
    for await (const s of computeClient.snapshots.listByResourceGroup(resourceGroup)) {
      if (s.name?.startsWith(prefix)) snaps.push(s);
    }
    snaps.sort((a, b) => new Date(b.timeCreated) - new Date(a.timeCreated));
    const toDelete = snaps.slice(KEEP_LAST_SNAPSHOTS);
    for (const s of toDelete) {
      await computeClient.snapshots.beginDeleteAndWait(resourceGroup, s.name);
      logger.info(`Old snapshot deleted: ${s.name}`);
    }

    logger.info(`Seat preserved: NIC + Public IP + NSG intact for ${vmName}.`);

    // ---------------------------------------------------------------
    // 8. Save VM size + location for future restarts
    // ---------------------------------------------------------------
    const actualVmSize = vm.hardwareProfile?.vmSize;
    const actualLocation = vm.location;

    await VM.updateOne({ name: vmName }, { $set: {
      vmSize: actualVmSize,
      location: actualLocation,
      remarks: reconciledMode ? 'Stopped & snapshotted (reconciled)' : 'Stopped',
    }});

    logger.info(`${vmName} stopped & snapshotted${reconciledMode ? ' (reconciled)' : ''} (duration: ${durationMins} min, total: ${totalDuration} min). Saved vmSize: ${actualVmSize}`);
  } catch (error) {
    logger.error('Error in azure-stop-vm handler:', error);
    // Throw a plain Error to avoid circular JSON serialization issues with Azure SDK errors
    throw new Error(error.message || String(error));
  }
};

module.exports = handler;
