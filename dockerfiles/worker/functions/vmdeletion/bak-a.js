// functions/vmdeletion/azure.js
require('dotenv').config();
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// Delete VM + OS disk; snapshot persistent data disk; KEEP NIC + IP + NSG
async function DeleteVMandResources(vmName, resourceGroup) {
  try {
    let vm;
    try {
      vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
    } catch (e) {
      if (e.statusCode === 404) {
        console.log(`VM ${vmName} not found. Nothing to delete.`);
        return true;
      }
      throw e;
    }

    const osDiskName = vm.storageProfile?.osDisk?.name;
    const dataDisk = (vm.storageProfile?.dataDisks || [])[0];

    // snapshot persistent data disk
    if (dataDisk?.managedDisk?.id) {
      try {
        const dataDiskObj = await computeClient.disks.get(resourceGroup, dataDisk.name);
        const snapName = `${vmName}-data-snap-${Date.now()}`;
        await computeClient.snapshots.beginCreateOrUpdateAndWait(resourceGroup, snapName, {
          location: dataDiskObj.location,
          creationData: { createOption: 'Copy', sourceResourceId: dataDiskObj.id },
          sku: { name: 'Standard_LRS' },
          tags: vm.tags || {}
        });
        console.log(`Snapshot created: ${snapName}`);
      } catch (snapErr) {
        console.error(`Snapshot failed for ${vmName}:`, snapErr.message || snapErr);
      }
    }

    // delete VM
    await computeClient.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);
    console.log(`VM deleted: ${vmName}`);

    // delete OS disk; KEEP data disk, NIC, Public IP, NSG
    if (osDiskName) {
      try {
        await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
        console.log(`OS Disk deleted: ${osDiskName}`);
      } catch (e) {
        if (e.statusCode === 404) console.log(`OS disk ${osDiskName} not found; skip`);
        else throw e;
      }
    }
    console.log(`Kept NIC, NSG, Public IP, and Data Disk for seat reservation.`);
    return true;
  } catch (err) {
    console.error('DeleteVMandResources error:', err.message || err);
    throw err;
  }
}

module.exports = { DeleteVMandResources };
