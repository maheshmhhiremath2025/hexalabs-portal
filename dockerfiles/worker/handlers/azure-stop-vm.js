// handlers/azure-stop-vm.js
const { logger } = require('./../plugins/logger');
const VM = require('./../models/vm');
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

    if (!vmDoc.isRunning) {
      return logger.error(`${vmName} is already stopped – skipping`);
    }

    const currentTime = new Date();

    // Find the open log entry (stop === null)
    const logIndex = vmDoc.logs.findIndex(log => !log.stop);
    if (logIndex === -1) {
      return logger.error(`No open log entry for ${vmName}`);
    }

    const startTime = vmDoc.logs[logIndex].start;
    const durationMins = Math.ceil((currentTime - new Date(startTime)) / 60000);
    const totalDuration = vmDoc.duration + durationMins;
    const consumedQuota = vmDoc.quota.consumed + durationMins;

    // ---------------------------------------------------------------
    // 2. Deallocate VM for consistent snapshot
    // ---------------------------------------------------------------
    await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);
    logger.info(`${vmName} deallocated for consistent snapshot`);

    // ---------------------------------------------------------------
    // 3. Get VM and create OS snapshot (mandatory)
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
    // 4. Delete VM
    // ---------------------------------------------------------------
    await computeClient.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);
    logger.info(`VM deleted: ${vmName}`);

    // ---------------------------------------------------------------
    // 5. Delete OS disk
    // ---------------------------------------------------------------
    await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
    logger.info(`OS disk deleted: ${osDiskName}`);

    // ---------------------------------------------------------------
    // 6. Rotate old snapshots (keep latest N)
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
    // 7. Persist DB changes - Save vmSize in separate field
    // ---------------------------------------------------------------
    const actualVmSize = vm.hardwareProfile.vmSize;
    const actualLocation = vm.location;

    const updatePayload = {
      isRunning: false,
      [`logs.${logIndex}.stop`]: currentTime,
      [`logs.${logIndex}.duration`]: durationMins,
      duration: totalDuration,
      'quota.consumed': consumedQuota,
      vmSize: actualVmSize, // Save VM size in separate field
      location: actualLocation, // Save location in separate field
    };

    if (consumedQuota >= vmDoc.quota.total) {
      updatePayload.isAlive = false;
      updatePayload.remarks = 'Quota Exceeded';
    }

    await VM.updateOne({ name: vmName }, { $set: updatePayload });

    logger.info(`${vmName} stopped & snapshotted (duration: ${durationMins} min, total: ${totalDuration} min). Saved vmSize: ${actualVmSize}`);
  } catch (error) {
    logger.error('Error in azure-stop-vm handler:', error);
    throw error; // let queue retry/fail
  }
};

module.exports = handler;
