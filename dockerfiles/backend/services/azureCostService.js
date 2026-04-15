const { ClientSecretCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const VM = require('../models/vm');
const Training = require('../models/training');
const LabCost = require('../models/azureCost');
const { logger } = require('../plugins/logger');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);

const subscriptionId = process.env.SUBSCRIPTION_ID;
const costClient = new CostManagementClient(credential);

/**
 * Fetches actual Azure costs for all VMs in a training, grouped by resource.
 * Uses Azure Cost Management Query API to get cost per resource.
 */
async function fetchCostsForTraining(trainingName, organization, startDate, endDate) {
  // Get all VMs for this training
  const vms = await VM.find({ trainingName, organization });
  if (!vms.length) return null;

  // Collect all resource group names (VMs in a training may span groups)
  const resourceGroups = [...new Set(vms.map(vm => vm.resourceGroup))];
  const vmNames = vms.map(vm => vm.name);

  // Build cost query scope - subscription level
  const scope = `subscriptions/${subscriptionId}`;

  // Query Azure Cost Management for costs grouped by ResourceId and MeterCategory
  const queryBody = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: {
      from: startDate,
      to: endDate,
    },
    dataset: {
      granularity: 'None',
      aggregation: {
        totalCost: { name: 'Cost', function: 'Sum' },
      },
      grouping: [
        { type: 'Dimension', name: 'ResourceId' },
        { type: 'Dimension', name: 'MeterCategory' },
      ],
      filter: {
        dimensions: {
          name: 'ResourceGroup',
          operator: 'In',
          values: resourceGroups,
        },
      },
    },
  };

  let rows;
  try {
    const result = await costClient.query.usage(scope, queryBody);
    rows = result.rows || [];
  } catch (err) {
    logger.error(`Azure Cost API error for training ${trainingName}: ${err.message}`);
    throw err;
  }

  // Parse results: each row = [cost, resourceId, meterCategory, currency]
  // Map costs to VM names
  const vmCostMap = {};
  vmNames.forEach(name => {
    vmCostMap[name] = {
      vmName: name,
      compute: 0,
      osDisk: 0,
      dataDisk: 0,
      networking: 0,
      snapshots: 0,
      other: 0,
      total: 0,
    };
  });

  for (const row of rows) {
    const cost = row[0] || 0;
    const resourceId = (row[1] || '').toLowerCase();
    const meterCategory = (row[2] || '').toLowerCase();

    // Match resource to a VM
    const matchedVm = vmNames.find(name => resourceId.includes(name.toLowerCase()));
    if (!matchedVm) continue;

    const entry = vmCostMap[matchedVm];

    // Categorize by meter category
    if (meterCategory.includes('virtual machines')) {
      entry.compute += cost;
    } else if (meterCategory.includes('storage') && resourceId.includes('snapshot')) {
      entry.snapshots += cost;
    } else if (meterCategory.includes('storage')) {
      // Distinguish OS disk vs data disk by resource name
      if (resourceId.includes('osdisk') || resourceId.includes('_osdisk')) {
        entry.osDisk += cost;
      } else {
        entry.dataDisk += cost;
      }
    } else if (
      meterCategory.includes('networking') ||
      meterCategory.includes('virtual network') ||
      meterCategory.includes('ip addresses') ||
      meterCategory.includes('load balancer')
    ) {
      entry.networking += cost;
    } else {
      entry.other += cost;
    }

    entry.total += cost;
  }

  // Calculate billed amount from internal rate tracking
  let totalAzureCost = 0;
  let totalBilledAmount = 0;

  const vmCosts = vmNames.map(name => {
    const entry = vmCostMap[name];
    totalAzureCost += entry.total;

    // Billed amount = (duration in hours) * rate
    const vm = vms.find(v => v.name === name);
    const hours = (vm.duration || 0) / 3600;
    const billed = hours * (vm.rate || 0);
    totalBilledAmount += billed;

    return entry;
  });

  // Round all costs
  totalAzureCost = Math.round(totalAzureCost * 100) / 100;
  totalBilledAmount = Math.round(totalBilledAmount * 100) / 100;

  return {
    trainingName,
    organization,
    periodStart: startDate,
    periodEnd: endDate,
    vmCosts,
    totalAzureCost,
    totalBilledAmount,
    profit: Math.round((totalBilledAmount - totalAzureCost) * 100) / 100,
    currency: 'INR',
    vmCount: vmNames.length,
    lastSyncedAt: new Date(),
  };
}

/**
 * Syncs costs for all active trainings.
 * Called by cron or manually by superadmin.
 */
async function syncAllTrainingCosts() {
  const now = new Date();
  // Default: current month
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = now;

  const trainings = await Training.find({ status: 'active' });
  logger.info(`Syncing Azure costs for ${trainings.length} active trainings`);

  const results = [];

  for (const training of trainings) {
    try {
      const costData = await fetchCostsForTraining(
        training.name,
        training.organization,
        startDate,
        endDate
      );

      if (!costData) continue;

      // Upsert: update if exists for this period, create if not
      await LabCost.findOneAndUpdate(
        {
          trainingName: training.name,
          organization: training.organization,
          periodStart: startDate,
        },
        costData,
        { upsert: true, new: true }
      );

      results.push({
        training: training.name,
        org: training.organization,
        azureCost: costData.totalAzureCost,
        billed: costData.totalBilledAmount,
        profit: costData.profit,
      });

      logger.info(`Synced costs for ${training.name}@${training.organization}: Azure=${costData.totalAzureCost}, Billed=${costData.totalBilledAmount}`);
    } catch (err) {
      logger.error(`Failed to sync costs for ${training.name}@${training.organization}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Fetch cost summary per organization (all labs aggregated).
 */
async function getOrganizationCostSummary() {
  const summary = await LabCost.aggregate([
    {
      $group: {
        _id: '$organization',
        totalAzureCost: { $sum: '$totalAzureCost' },
        totalBilledAmount: { $sum: '$totalBilledAmount' },
        totalProfit: { $sum: '$profit' },
        labCount: { $sum: 1 },
        totalVMs: { $sum: '$vmCount' },
        lastSynced: { $max: '$lastSyncedAt' },
      },
    },
    { $sort: { totalAzureCost: -1 } },
  ]);

  return summary.map(s => ({
    organization: s._id,
    totalAzureCost: Math.round(s.totalAzureCost * 100) / 100,
    totalBilledAmount: Math.round(s.totalBilledAmount * 100) / 100,
    totalProfit: Math.round(s.totalProfit * 100) / 100,
    margin: s.totalBilledAmount > 0
      ? Math.round((s.totalProfit / s.totalBilledAmount) * 10000) / 100
      : 0,
    labCount: s.labCount,
    totalVMs: s.totalVMs,
    lastSynced: s.lastSynced,
  }));
}

/**
 * Get detailed cost breakdown for a specific training/lab.
 */
async function getLabCostDetail(trainingName, organization) {
  const costs = await LabCost.find({ trainingName, organization })
    .sort({ periodStart: -1 })
    .limit(12); // Last 12 periods

  return costs;
}

module.exports = {
  fetchCostsForTraining,
  syncAllTrainingCosts,
  getOrganizationCostSummary,
  getLabCostDetail,
};
