const { syncAllTrainingCosts, getOrganizationCostSummary, getLabCostDetail, fetchCostsForTraining } = require('../services/azureCostService');
const LabCost = require('../models/azureCost');
const Training = require('../models/training');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

/**
 * GET /admin/costs/summary
 * Returns per-organization cost summary with profit margins.
 * Superadmin only.
 */
async function handleGetCostSummary(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const summary = await getOrganizationCostSummary();
    res.json(summary);
  } catch (err) {
    logger.error(`Error fetching cost summary: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch cost summary' });
  }
}

/**
 * GET /admin/costs/lab?trainingName=xxx&organization=yyy
 * Returns detailed per-VM cost breakdown for a specific lab.
 * Superadmin only.
 */
async function handleGetLabCosts(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { trainingName, organization } = req.query;
    if (!trainingName || !organization) {
      return res.status(400).json({ message: 'trainingName and organization are required' });
    }

    const costs = await getLabCostDetail(trainingName, organization);

    // Also get current VM states for context
    const vms = await VM.find({ trainingName }).select('name isRunning isAlive duration rate quota');

    res.json({ costs, vms });
  } catch (err) {
    logger.error(`Error fetching lab costs: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch lab costs' });
  }
}

/**
 * GET /admin/costs/labs?organization=xxx
 * Returns all labs and their costs for an organization.
 * Superadmin only.
 */
async function handleGetOrgLabs(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { organization } = req.query;
    if (!organization) {
      return res.status(400).json({ message: 'organization is required' });
    }

    const labs = await LabCost.find({ organization })
      .sort({ lastSyncedAt: -1 });

    res.json(labs);
  } catch (err) {
    logger.error(`Error fetching org labs: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch organization labs' });
  }
}

/**
 * POST /admin/costs/sync
 * Triggers a manual cost sync from Azure.
 * Superadmin only.
 */
async function handleSyncCosts(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    logger.info(`Manual cost sync triggered by ${req.user.email}`);
    const results = await syncAllTrainingCosts();

    res.json({
      message: `Synced costs for ${results.length} trainings`,
      results,
    });
  } catch (err) {
    logger.error(`Error syncing costs: ${err.message}`);
    res.status(500).json({ message: 'Failed to sync costs from Azure' });
  }
}

/**
 * POST /admin/costs/sync-lab
 * Sync cost for a specific lab. Supports custom date range.
 * Superadmin only.
 */
async function handleSyncLabCost(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { trainingName, organization, startDate, endDate } = req.body;
    if (!trainingName || !organization) {
      return res.status(400).json({ message: 'trainingName and organization are required' });
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;

    const costData = await fetchCostsForTraining(trainingName, organization, start, end);

    if (!costData) {
      return res.status(404).json({ message: 'No VMs found for this training' });
    }

    // Upsert
    await LabCost.findOneAndUpdate(
      { trainingName, organization, periodStart: start },
      costData,
      { upsert: true, new: true }
    );

    res.json(costData);
  } catch (err) {
    logger.error(`Error syncing lab cost: ${err.message}`);
    res.status(500).json({ message: 'Failed to sync lab cost' });
  }
}

/**
 * GET /admin/costs/overview
 * High-level stats: total azure spend, total billed, total profit, margins.
 * Superadmin only.
 */
async function handleGetCostOverview(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const [overview] = await LabCost.aggregate([
      {
        $group: {
          _id: null,
          totalAzureCost: { $sum: '$totalAzureCost' },
          totalBilled: { $sum: '$totalBilledAmount' },
          totalProfit: { $sum: '$profit' },
          totalLabs: { $sum: 1 },
          totalVMs: { $sum: '$vmCount' },
          lastSynced: { $max: '$lastSyncedAt' },
        },
      },
    ]);

    if (!overview) {
      return res.json({
        totalAzureCost: 0,
        totalBilled: 0,
        totalProfit: 0,
        margin: 0,
        totalLabs: 0,
        totalVMs: 0,
        lastSynced: null,
      });
    }

    res.json({
      totalAzureCost: Math.round(overview.totalAzureCost * 100) / 100,
      totalBilled: Math.round(overview.totalBilled * 100) / 100,
      totalProfit: Math.round(overview.totalProfit * 100) / 100,
      margin: overview.totalBilled > 0
        ? Math.round((overview.totalProfit / overview.totalBilled) * 10000) / 100
        : 0,
      totalLabs: overview.totalLabs,
      totalVMs: overview.totalVMs,
      lastSynced: overview.lastSynced,
    });
  } catch (err) {
    logger.error(`Error fetching cost overview: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch cost overview' });
  }
}

module.exports = {
  handleGetCostSummary,
  handleGetLabCosts,
  handleGetOrgLabs,
  handleSyncCosts,
  handleSyncLabCost,
  handleGetCostOverview,
};
