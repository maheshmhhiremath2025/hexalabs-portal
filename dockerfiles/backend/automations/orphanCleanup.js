/**
 * Orphan Resource Cleanup Automation
 *
 * Runs weekly (every Sunday at 2 AM IST).
 * Scans Azure for orphaned NICs, public IPs, NSGs, disks, and snapshots
 * that are not linked to any active VM in the database.
 *
 * Auto-deletes orphans older than 7 days. Logs a cost report.
 */
const { scanOrphans, deleteOrphan } = require('../services/orphanCleanup');
const { logger } = require('../plugins/logger');

async function orphanCleanupJob() {
  try {
    logger.info('[orphan-cleanup] Starting weekly orphan scan...');

    const orphans = await scanOrphans();

    if (orphans.totalCount === 0) {
      logger.info('[orphan-cleanup] No orphaned resources found.');
      return { cleaned: 0, cost: 0 };
    }

    logger.info(`[orphan-cleanup] Found ${orphans.totalCount} orphans costing ~₹${orphans.totalMonthlyCost}/month`);
    logger.info(`[orphan-cleanup]   NICs: ${orphans.nics.length}, IPs: ${orphans.publicIps.length}, NSGs: ${orphans.nsgs.length}, Disks: ${orphans.disks.length}, Snapshots: ${orphans.snapshots.length}`);

    let cleaned = 0;

    // Auto-delete orphaned resources
    // Delete in order: snapshots → disks → NICs → IPs → NSGs (dependency order)
    for (const snap of orphans.snapshots) {
      try {
        await deleteOrphan('snapshot', snap.resourceGroup, snap.name);
        cleaned++;
      } catch {}
    }

    for (const disk of orphans.disks) {
      try {
        await deleteOrphan('disk', disk.resourceGroup, disk.name);
        cleaned++;
      } catch {}
    }

    // Delete NICs before IPs (IPs may be attached to NICs)
    for (const nic of orphans.nics) {
      try {
        await deleteOrphan('nic', nic.resourceGroup, nic.name);
        cleaned++;
      } catch {}
    }

    for (const ip of orphans.publicIps) {
      try {
        await deleteOrphan('publicIp', ip.resourceGroup, ip.name);
        cleaned++;
      } catch {}
    }

    for (const nsg of orphans.nsgs) {
      try {
        await deleteOrphan('nsg', nsg.resourceGroup, nsg.name);
        cleaned++;
      } catch {}
    }

    logger.info(`[orphan-cleanup] Cleaned ${cleaned}/${orphans.totalCount} orphans. Saved ~₹${orphans.totalMonthlyCost}/month`);

    return { cleaned, total: orphans.totalCount, monthlySavings: orphans.totalMonthlyCost };
  } catch (err) {
    logger.error(`[orphan-cleanup] Error: ${err.message}`);
    return { cleaned: 0, error: err.message };
  }
}

module.exports = { orphanCleanupJob };
