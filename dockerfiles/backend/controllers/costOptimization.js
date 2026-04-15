const { scanOrphans, deleteOrphan } = require('../services/orphanCleanup');
const { analyzeRightSizing } = require('../services/rightSizing');
const { logger } = require('../plugins/logger');

/**
 * GET /admin/optimize/orphans
 * Scan Azure for orphaned resources.
 */
async function handleScanOrphans(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
    logger.info(`Orphan scan triggered by ${req.user.email}`);
    const orphans = await scanOrphans();
    res.json(orphans);
  } catch (err) {
    logger.error(`Orphan scan error: ${err.message}`);
    res.status(500).json({ message: 'Scan failed' });
  }
}

/**
 * DELETE /admin/optimize/orphan
 * Delete a specific orphan resource.
 */
async function handleDeleteOrphan(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
    const { type, resourceGroup, name } = req.body;
    if (!type || !resourceGroup || !name) return res.status(400).json({ message: 'type, resourceGroup, name required' });

    logger.info(`Deleting orphan ${type}: ${name} in ${resourceGroup} by ${req.user.email}`);
    await deleteOrphan(type, resourceGroup, name);
    res.json({ message: `Deleted ${type}: ${name}` });
  } catch (err) {
    res.status(500).json({ message: `Failed to delete: ${err.message}` });
  }
}

/**
 * GET /admin/optimize/rightsizing
 * Get right-sizing recommendations for running VMs.
 */
async function handleRightSizing(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
    logger.info(`Right-sizing analysis triggered by ${req.user.email}`);
    const result = await analyzeRightSizing();
    res.json(result);
  } catch (err) {
    logger.error(`Right-sizing error: ${err.message}`);
    res.status(500).json({ message: 'Analysis failed' });
  }
}

module.exports = { handleScanOrphans, handleDeleteOrphan, handleRightSizing };
