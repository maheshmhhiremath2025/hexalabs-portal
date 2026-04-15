/**
 * Unified Cost & Profit Dashboard
 *
 * Combines costs from ALL resource types into a single profit view:
 *   - Azure VMs (from azureCostService / LabCost model)
 *   - Containers (from containerCostService)
 *   - AWS sandboxes (from awsCostService / Cost Explorer)
 *   - GCP sandboxes (from gcpCostService / Billing API)
 *   - RDS (same as Azure VMs — they're Azure VMs)
 *   - Template-deployed sandboxes (from SandboxDeployment model)
 *
 * Revenue comes from:
 *   - Ledger transactions (organization billing model)
 *   - Subscription payments (Razorpay)
 *   - B2B quotes (from CourseAnalysis.cost)
 */

const LabCost = require('../models/azureCost');
const Container = require('../models/container');
const VM = require('../models/vm');
const SandboxDeployment = require('../models/sandboxDeployment');
const { logger } = require('../plugins/logger');

const { getContainerCostOverview, getContainerCostSummary } = require('./containerCostService');

/**
 * Get the complete platform P&L overview — all resource types combined.
 */
async function getUnifiedProfitOverview() {
  const [azureOverview, containerOverview, vmStats, sandboxStats] = await Promise.all([
    // Azure VM costs (from the existing LabCost model synced via Azure Cost Management API)
    LabCost.aggregate([
      {
        $group: {
          _id: null,
          totalAzureCost: { $sum: '$totalAzureCost' },
          totalBilledAmount: { $sum: '$totalBilledAmount' },
          totalProfit: { $sum: '$profit' },
          labCount: { $sum: 1 },
          totalVMs: { $sum: '$vmCount' },
        },
      },
    ]).then(r => r[0] || { totalAzureCost: 0, totalBilledAmount: 0, totalProfit: 0, labCount: 0, totalVMs: 0 }),

    // Container costs (computed from rate × duration)
    getContainerCostOverview(),

    // VM stats (running count, total)
    VM.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          alive: { $sum: { $cond: ['$isAlive', 1, 0] } },
          running: { $sum: { $cond: [{ $and: ['$isAlive', '$isRunning'] }, 1, 0] } },
          totalDurationHours: { $sum: { $divide: [{ $ifNull: ['$duration', 0] }, 3600] } },
          totalBilled: { $sum: { $multiply: ['$rate', { $divide: [{ $ifNull: ['$duration', 0] }, 3600] }] } },
        },
      },
    ]).then(r => r[0] || { total: 0, alive: 0, running: 0, totalDurationHours: 0, totalBilled: 0 }),

    // Sandbox deployments (template-deployed cloud accounts)
    SandboxDeployment.aggregate([
      {
        $group: {
          _id: '$cloud',
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$state', 'active'] }, 1, 0] } },
          totalBudget: { $sum: '$budgetInr' },
        },
      },
    ]),
  ]);

  // Parse sandbox stats by cloud
  const sandboxByCloud = {};
  for (const s of sandboxStats) {
    sandboxByCloud[s._id] = { total: s.total, active: s.active, totalBudget: s.totalBudget };
  }

  // Combine everything
  const totalInfraSpend = (azureOverview.totalAzureCost || 0) + (containerOverview.actualCostInr || 0);
  const totalRevenue = (azureOverview.totalBilledAmount || 0) + (vmStats.totalBilled || 0);
  const totalProfit = totalRevenue - totalInfraSpend;

  return {
    // Top-line numbers
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalInfraSpend: Math.round(totalInfraSpend * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      profitMargin: totalRevenue > 0 ? Math.round(totalProfit / totalRevenue * 10000) / 100 : 0,
      currency: 'INR',
    },

    // Per resource type
    azureVMs: {
      totalSpend: Math.round((azureOverview.totalAzureCost || 0) * 100) / 100,
      totalBilled: Math.round((azureOverview.totalBilledAmount || 0) * 100) / 100,
      profit: Math.round((azureOverview.totalProfit || 0) * 100) / 100,
      labCount: azureOverview.labCount || 0,
      vmCount: azureOverview.totalVMs || 0,
    },

    containers: {
      totalSpend: containerOverview.actualCostInr || 0,
      azureEquivalent: containerOverview.azureEquivalentInr || 0,
      savings: containerOverview.savingsInr || 0,
      savingsPercent: containerOverview.savingsPercent || 0,
      totalContainers: containerOverview.totalContainers || 0,
      activeContainers: containerOverview.activeContainers || 0,
      totalHours: containerOverview.totalHours || 0,
    },

    rds: {
      totalVMs: vmStats.total || 0,
      runningVMs: vmStats.running || 0,
      totalHours: Math.round((vmStats.totalDurationHours || 0) * 10) / 10,
      totalBilled: Math.round((vmStats.totalBilled || 0) * 100) / 100,
    },

    sandboxes: {
      aws: sandboxByCloud.aws || { total: 0, active: 0, totalBudget: 0 },
      azure: sandboxByCloud.azure || { total: 0, active: 0, totalBudget: 0 },
      gcp: sandboxByCloud.gcp || { total: 0, active: 0, totalBudget: 0 },
      totalDeployments: sandboxStats.reduce((s, x) => s + x.total, 0),
      activeDeployments: sandboxStats.reduce((s, x) => s + x.active, 0),
      totalBudgetAllocated: sandboxStats.reduce((s, x) => s + x.totalBudget, 0),
    },
  };
}

/**
 * Get per-training breakdown across ALL resource types for one organization.
 */
async function getTrainingCostBreakdown(organization) {
  const [azureCosts, containerCosts, vmCosts] = await Promise.all([
    LabCost.find(organization ? { organization } : {}).sort({ totalAzureCost: -1 }).limit(50).lean(),
    getContainerCostSummary(),
    VM.aggregate([
      ...(organization ? [{ $match: { organization } }] : []),
      {
        $group: {
          _id: '$trainingName',
          vmCount: { $sum: 1 },
          totalHours: { $sum: { $divide: [{ $ifNull: ['$duration', 0] }, 3600] } },
          totalBilled: { $sum: { $multiply: ['$rate', { $divide: [{ $ifNull: ['$duration', 0] }, 3600] }] } },
        },
      },
      { $sort: { totalBilled: -1 } },
    ]),
  ]);

  // Merge all into a unified training map
  const trainingMap = {};

  for (const ac of azureCosts) {
    const key = ac.trainingName;
    if (!trainingMap[key]) trainingMap[key] = { trainingName: key, organization: ac.organization, azureCost: 0, azureBilled: 0, containerCost: 0, containerSavings: 0, vmBilled: 0 };
    trainingMap[key].azureCost += ac.totalAzureCost;
    trainingMap[key].azureBilled += ac.totalBilledAmount;
  }

  for (const cc of containerCosts) {
    const key = cc.trainingName;
    if (!trainingMap[key]) trainingMap[key] = { trainingName: key, organization: cc.organization, azureCost: 0, azureBilled: 0, containerCost: 0, containerSavings: 0, vmBilled: 0 };
    trainingMap[key].containerCost += cc.actualCostInr;
    trainingMap[key].containerSavings += cc.savingsInr;
  }

  for (const vc of vmCosts) {
    const key = vc._id;
    if (!trainingMap[key]) trainingMap[key] = { trainingName: key, organization: organization || '', azureCost: 0, azureBilled: 0, containerCost: 0, containerSavings: 0, vmBilled: 0 };
    trainingMap[key].vmBilled += vc.totalBilled;
  }

  return Object.values(trainingMap)
    .map(t => ({
      ...t,
      totalSpend: Math.round((t.azureCost + t.containerCost) * 100) / 100,
      totalRevenue: Math.round((t.azureBilled + t.vmBilled) * 100) / 100,
      profit: Math.round((t.azureBilled + t.vmBilled - t.azureCost - t.containerCost) * 100) / 100,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

module.exports = { getUnifiedProfitOverview, getTrainingCostBreakdown };
