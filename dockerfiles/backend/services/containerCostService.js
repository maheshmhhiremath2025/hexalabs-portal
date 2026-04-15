/**
 * Container Cost Service
 *
 * Aggregates actual container costs from the Container model. Each container
 * already has rate (INR/hr), duration (seconds), and azureEquivalentRate.
 * This service just queries and aggregates — no external API calls needed.
 *
 * Cost formula per container:
 *   actual_cost = rate × (duration / 3600)
 *   azure_equivalent = azureEquivalentRate × (duration / 3600)
 *   savings = azure_equivalent - actual_cost
 */

const Container = require('../models/container');
const { logger } = require('../plugins/logger');

/**
 * Get cost summary across all containers, grouped by training.
 */
async function getContainerCostSummary() {
  const summary = await Container.aggregate([
    { $match: { duration: { $gt: 0 } } },
    {
      $group: {
        _id: { trainingName: '$trainingName', organization: '$organization' },
        containerCount: { $sum: 1 },
        totalDurationSecs: { $sum: '$duration' },
        totalActualCost: {
          $sum: { $multiply: ['$rate', { $divide: ['$duration', 3600] }] },
        },
        totalAzureEquivalent: {
          $sum: {
            $multiply: [
              { $ifNull: ['$azureEquivalentRate', { $multiply: ['$rate', 8] }] }, // fallback: assume 8x Azure cost
              { $divide: ['$duration', 3600] },
            ],
          },
        },
      },
    },
    {
      $project: {
        trainingName: '$_id.trainingName',
        organization: '$_id.organization',
        containerCount: 1,
        totalHours: { $round: [{ $divide: ['$totalDurationSecs', 3600] }, 1] },
        actualCostInr: { $round: ['$totalActualCost', 2] },
        azureEquivalentInr: { $round: ['$totalAzureEquivalent', 2] },
        savingsInr: { $round: [{ $subtract: ['$totalAzureEquivalent', '$totalActualCost'] }, 2] },
        savingsPercent: {
          $cond: [
            { $gt: ['$totalAzureEquivalent', 0] },
            { $round: [{ $multiply: [{ $divide: [{ $subtract: ['$totalAzureEquivalent', '$totalActualCost'] }, '$totalAzureEquivalent'] }, 100] }, 1] },
            0,
          ],
        },
      },
    },
    { $sort: { actualCostInr: -1 } },
  ]);

  return summary;
}

/**
 * Get total container cost across the entire platform.
 */
async function getContainerCostOverview() {
  const [result] = await Container.aggregate([
    { $match: { duration: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        totalContainers: { $sum: 1 },
        activeContainers: { $sum: { $cond: ['$isRunning', 1, 0] } },
        totalDurationSecs: { $sum: '$duration' },
        totalActualCost: {
          $sum: { $multiply: ['$rate', { $divide: ['$duration', 3600] }] },
        },
        totalAzureEquivalent: {
          $sum: {
            $multiply: [
              { $ifNull: ['$azureEquivalentRate', { $multiply: ['$rate', 8] }] },
              { $divide: ['$duration', 3600] },
            ],
          },
        },
      },
    },
  ]);

  if (!result) return { totalContainers: 0, totalHours: 0, actualCostInr: 0, azureEquivalentInr: 0, savingsInr: 0 };

  return {
    totalContainers: result.totalContainers,
    activeContainers: result.activeContainers,
    totalHours: Math.round(result.totalDurationSecs / 3600 * 10) / 10,
    actualCostInr: Math.round(result.totalActualCost * 100) / 100,
    azureEquivalentInr: Math.round(result.totalAzureEquivalent * 100) / 100,
    savingsInr: Math.round((result.totalAzureEquivalent - result.totalActualCost) * 100) / 100,
    savingsPercent: result.totalAzureEquivalent > 0
      ? Math.round((result.totalAzureEquivalent - result.totalActualCost) / result.totalAzureEquivalent * 10000) / 100
      : 0,
  };
}

module.exports = { getContainerCostSummary, getContainerCostOverview };
