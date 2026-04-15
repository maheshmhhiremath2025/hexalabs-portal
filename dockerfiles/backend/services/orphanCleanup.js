const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const computeClient = new ComputeManagementClient(credential, subscriptionId);
const networkClient = new NetworkManagementClient(credential, subscriptionId);

/**
 * Scan Azure for orphaned resources not linked to any active VM in DB.
 * Returns list of orphans grouped by type with estimated monthly cost.
 */
async function scanOrphans() {
  // Get all active VM names from DB
  const activeVms = await VM.find({ isAlive: true }).select('name resourceGroup').lean();
  const activeNames = new Set(activeVms.map(v => v.name.toLowerCase()));
  const activeRGs = [...new Set(activeVms.map(v => v.resourceGroup))];

  const orphans = { nics: [], publicIps: [], nsgs: [], disks: [], snapshots: [], totalMonthlyCost: 0 };

  for (const rg of activeRGs) {
    try {
      // 1. Orphan NICs — not attached to any VM
      for await (const nic of networkClient.networkInterfaces.list(rg)) {
        if (!nic.virtualMachine) {
          // Check if name matches any active VM pattern
          const vmName = nic.name.replace('-nic', '').toLowerCase();
          if (!activeNames.has(vmName)) {
            orphans.nics.push({
              name: nic.name, resourceGroup: rg, id: nic.id,
              monthlyCost: 0, // NICs are free but clutter
            });
          }
        }
      }

      // 2. Orphan Public IPs — not associated with any NIC
      for await (const ip of networkClient.publicIPAddresses.list(rg)) {
        if (!ip.ipConfiguration) {
          const vmName = ip.name.replace('-public-IP', '').toLowerCase();
          if (!activeNames.has(vmName)) {
            const isStatic = ip.publicIPAllocationMethod === 'Static';
            const cost = isStatic ? 260 : 0; // ~₹260/month for unused static IP
            orphans.publicIps.push({
              name: ip.name, resourceGroup: rg, id: ip.id, ipAddress: ip.ipAddress,
              allocationMethod: ip.publicIPAllocationMethod, monthlyCost: cost,
            });
            orphans.totalMonthlyCost += cost;
          }
        }
      }

      // 3. Orphan NSGs — not associated with any NIC or subnet
      for await (const nsg of networkClient.networkSecurityGroups.list(rg)) {
        if ((!nsg.networkInterfaces || nsg.networkInterfaces.length === 0) &&
            (!nsg.subnets || nsg.subnets.length === 0)) {
          const vmName = nsg.name.replace('-nsg', '').toLowerCase();
          if (!activeNames.has(vmName)) {
            orphans.nsgs.push({
              name: nsg.name, resourceGroup: rg, id: nsg.id, monthlyCost: 0,
            });
          }
        }
      }

      // 4. Orphan Disks — unattached managed disks
      for await (const disk of computeClient.disks.listByResourceGroup(rg)) {
        if (disk.diskState === 'Unattached') {
          const sizeGB = disk.diskSizeGB || 0;
          // Estimate cost: Premium SSD ~₹8/GB/month, Standard ~₹3/GB/month
          const isPremium = (disk.sku?.name || '').includes('Premium');
          const costPerGB = isPremium ? 8 : 3;
          const cost = sizeGB * costPerGB;
          orphans.disks.push({
            name: disk.name, resourceGroup: rg, id: disk.id,
            sizeGB, sku: disk.sku?.name, monthlyCost: cost,
          });
          orphans.totalMonthlyCost += cost;
        }
      }

      // 5. Old Snapshots — older than 30 days and not linked to active VMs
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for await (const snap of computeClient.snapshots.listByResourceGroup(rg)) {
        const snapDate = snap.timeCreated ? new Date(snap.timeCreated) : new Date();
        if (snapDate < thirtyDaysAgo) {
          // Check if snapshot name relates to any active VM
          const relatedToActive = [...activeNames].some(n => snap.name.toLowerCase().includes(n));
          if (!relatedToActive) {
            const sizeGB = snap.diskSizeGB || 0;
            const cost = Math.round(sizeGB * 1.5); // ~₹1.5/GB/month for snapshots
            orphans.snapshots.push({
              name: snap.name, resourceGroup: rg, id: snap.id,
              sizeGB, age: Math.floor((Date.now() - snapDate) / (24 * 60 * 60 * 1000)),
              monthlyCost: cost,
            });
            orphans.totalMonthlyCost += cost;
          }
        }
      }
    } catch (err) {
      logger.error(`Orphan scan error in ${rg}: ${err.message}`);
    }
  }

  orphans.totalMonthlyCost = Math.round(orphans.totalMonthlyCost);
  orphans.totalCount = orphans.nics.length + orphans.publicIps.length + orphans.nsgs.length + orphans.disks.length + orphans.snapshots.length;

  return orphans;
}

/**
 * Delete a specific orphan resource by type and ID.
 */
async function deleteOrphan(type, resourceGroup, name) {
  try {
    switch (type) {
      case 'nic':
        await networkClient.networkInterfaces.beginDeleteAndWait(resourceGroup, name);
        break;
      case 'publicIp':
        await networkClient.publicIPAddresses.beginDeleteAndWait(resourceGroup, name);
        break;
      case 'nsg':
        await networkClient.networkSecurityGroups.beginDeleteAndWait(resourceGroup, name);
        break;
      case 'disk':
        await computeClient.disks.beginDeleteAndWait(resourceGroup, name);
        break;
      case 'snapshot':
        await computeClient.snapshots.beginDeleteAndWait(resourceGroup, name);
        break;
      default:
        throw new Error(`Unknown resource type: ${type}`);
    }
    logger.info(`Deleted orphan ${type}: ${name} in ${resourceGroup}`);
    return true;
  } catch (err) {
    logger.error(`Failed to delete orphan ${type} ${name}: ${err.message}`);
    throw err;
  }
}

module.exports = { scanOrphans, deleteOrphan };
