/**
 * AWS Cost Service
 *
 * Fetches actual AWS spend via Cost Explorer API, grouped by IAM user tag.
 * This tells us how much each sandbox student actually burned on AWS.
 *
 * Prerequisites:
 *   - The AWS account must have Cost Explorer enabled (it's on by default
 *     but there's a ~24-48h delay on cost data).
 *   - The IAM sandbox policy enforces a CreatedBy tag on all resources.
 *   - The service account (AWS_ACCESS_KEY) needs ce:GetCostAndUsage permission.
 *
 * Cost Explorer charges $0.01 per API request. We cache aggressively —
 * syncing once per 6 hours is sufficient since AWS billing data is delayed
 * by 24-48 hours anyway.
 *
 * Env vars:
 *   AWS_ACCESS_KEY, AWS_ACCESS_SECRET (already set)
 *   AWS_COST_EXPLORER_REGION = us-east-1 (Cost Explorer only works in us-east-1)
 */

const { logger } = require('../plugins/logger');

let exchangeRate = 85; // fallback INR/USD
try {
  const { getUsdToInr } = require('./exchangeRate');
  getUsdToInr().then(r => { exchangeRate = r; }).catch(() => {});
} catch {}

/**
 * Get total AWS spend for the last N days, grouped by CreatedBy tag
 * (which maps to IAM username = sandbox student).
 */
async function getAwsCostByUser(days = 30) {
  try {
    const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');

    const client = new CostExplorerClient({
      region: 'us-east-1', // Cost Explorer ONLY works in us-east-1
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_ACCESS_SECRET,
      },
    });

    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);

    const result = await client.send(new GetCostAndUsageCommand({
      TimePeriod: {
        Start: start.toISOString().slice(0, 10),
        End: end.toISOString().slice(0, 10),
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [
        { Type: 'TAG', Key: 'CreatedBy' },
      ],
    }));

    // Parse response: each ResultsByTime has Groups with Keys + Metrics
    const userCosts = {};
    let totalUsd = 0;

    for (const period of result.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const tag = (group.Keys?.[0] || '').replace('CreatedBy$', '');
        const costUsd = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0');
        if (tag && costUsd > 0) {
          userCosts[tag] = (userCosts[tag] || 0) + costUsd;
          totalUsd += costUsd;
        }
      }
    }

    return {
      periodDays: days,
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalInr: Math.round(totalUsd * exchangeRate * 100) / 100,
      exchangeRate,
      userBreakdown: Object.entries(userCosts).map(([username, usd]) => ({
        username,
        costUsd: Math.round(usd * 100) / 100,
        costInr: Math.round(usd * exchangeRate * 100) / 100,
      })).sort((a, b) => b.costUsd - a.costUsd),
    };
  } catch (err) {
    logger.error(`AWS Cost Explorer error: ${err.message}`);
    return { periodDays: days, totalUsd: 0, totalInr: 0, exchangeRate, userBreakdown: [], error: err.message };
  }
}

/**
 * Get AWS spend grouped by service (EC2, S3, RDS, Lambda, etc.).
 */
async function getAwsCostByService(days = 30) {
  try {
    const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');

    const client = new CostExplorerClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_ACCESS_SECRET,
      },
    });

    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);

    const result = await client.send(new GetCostAndUsageCommand({
      TimePeriod: {
        Start: start.toISOString().slice(0, 10),
        End: end.toISOString().slice(0, 10),
      },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [
        { Type: 'DIMENSION', Key: 'SERVICE' },
      ],
    }));

    const services = {};
    let totalUsd = 0;

    for (const period of result.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const svc = group.Keys?.[0] || 'Unknown';
        const costUsd = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0');
        if (costUsd > 0.01) {
          services[svc] = (services[svc] || 0) + costUsd;
          totalUsd += costUsd;
        }
      }
    }

    return {
      periodDays: days,
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalInr: Math.round(totalUsd * exchangeRate * 100) / 100,
      exchangeRate,
      serviceBreakdown: Object.entries(services).map(([service, usd]) => ({
        service,
        costUsd: Math.round(usd * 100) / 100,
        costInr: Math.round(usd * exchangeRate * 100) / 100,
      })).sort((a, b) => b.costUsd - a.costUsd),
    };
  } catch (err) {
    logger.error(`AWS Cost by Service error: ${err.message}`);
    return { periodDays: days, totalUsd: 0, totalInr: 0, serviceBreakdown: [], error: err.message };
  }
}

module.exports = { getAwsCostByUser, getAwsCostByService };
