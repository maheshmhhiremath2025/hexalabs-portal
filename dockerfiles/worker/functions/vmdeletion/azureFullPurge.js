// functions/vmdeletion/azureFullPurge.js
require('dotenv').config();
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const cred = new ClientSecretCredential(tenantId, clientId, clientSecret);
const compute = new ComputeManagementClient(cred, subscriptionId);
const network = new NetworkManagementClient(cred, subscriptionId);

/**
 * Fully release all seat resources: VM (if any), OS disk, data disk, snapshots, NIC, Public IP, NSG.
 * Call this when the whole batch ends and you want to clean everything (plus delete Guac record + logs).
 */
async function FullPurgeSeat(resourceGroup, vmName) {
  const nicName      = `${vmName}-nic`;
  const publicIpName = `${vmName}-public-IP`;
  const nsgName      = `${vmName}-nsg`;
  const dataDiskName = `${vmName}-data`;
  const osDiskName   = `${vmName}-os`; // only exists if snapshot-based boot path used

  // VM
  try { await compute.virtualMachines.beginDeleteAndWait(resourceGroup, vmName); } catch {}

  // Disks
  try { await compute.disks.beginDeleteAndWait(resourceGroup, osDiskName); } catch {}
  try { await compute.disks.beginDeleteAndWait(resourceGroup, dataDiskName); } catch {}

  // NIC + Public IP + NSG
  try { await network.networkInterfaces.beginDeleteAndWait(resourceGroup, nicName); } catch {}
  try { await network.publicIPAddresses.beginDeleteAndWait(resourceGroup, publicIpName); } catch {}
  try { await network.networkSecurityGroups.beginDeleteAndWait(resourceGroup, nsgName); } catch {}

  // Snapshots with prefix
  try {
    const snaps = compute.snapshots.list();
    for await (const s of snaps) {
      if (s.name.startsWith(`${vmName}-data-snap-`) && s.id.includes(`/resourceGroups/${resourceGroup}/`)) {
        await compute.snapshots.beginDeleteAndWait(resourceGroup, s.name);
      }
    }
  } catch {}

  return true;
}

module.exports = { FullPurgeSeat };
