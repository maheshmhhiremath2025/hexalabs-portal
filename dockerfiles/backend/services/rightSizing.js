const { ClientSecretCredential } = require('@azure/identity');
const { MonitorClient } = require('@azure/arm-monitor');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const monitorClient = new MonitorClient(credential, subscriptionId);

// VM size hierarchy for downsizing recommendations (Spot pricing, INR/hr)
const VM_SIZE_MAP = {
  'Standard_D4s_v3':  { cpus: 4,  ram: 16, cost: 12,  onDemand: 40,  downTo: 'Standard_D2s_v3' },
  'Standard_D2s_v3':  { cpus: 2,  ram: 8,  cost: 8,   onDemand: 20,  downTo: 'Standard_B2s' },
  'Standard_B4ms':    { cpus: 4,  ram: 16, cost: 10,  onDemand: 32,  downTo: 'Standard_B2ms' },
  'Standard_B2ms':    { cpus: 2,  ram: 8,  cost: 6,   onDemand: 18,  downTo: 'Standard_B2s' },
  'Standard_B2s':     { cpus: 2,  ram: 4,  cost: 4,   onDemand: 10,  downTo: 'Standard_B1ms' },
  'Standard_B1ms':    { cpus: 1,  ram: 2,  cost: 2,   onDemand: 6,   downTo: null },
  'Standard_D8s_v3':  { cpus: 8,  ram: 32, cost: 24,  onDemand: 80,  downTo: 'Standard_D4s_v3' },
  'Standard_D16s_v3': { cpus: 16, ram: 64, cost: 48,  onDemand: 160, downTo: 'Standard_D8s_v3' },
};

/**
 * Get average CPU and memory usage for a VM over the last 7 days.
 */
async function getVmMetrics(resourceGroup, vmName, days = 7) {
  const resourceUri = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${startTime.toISOString()}/${endTime.toISOString()}`;

  try {
    const result = await monitorClient.metrics.list(resourceUri, {
      timespan,
      interval: 'PT1H',
      metricnames: 'Percentage CPU',
      aggregation: 'Average,Maximum',
    });

    let totalAvg = 0, totalMax = 0, count = 0;

    if (result.value) {
      for (const metric of result.value) {
        if (metric.timeseries) {
          for (const ts of metric.timeseries) {
            if (ts.data) {
              for (const dp of ts.data) {
                if (dp.average != null) { totalAvg += dp.average; count++; }
                if (dp.maximum != null && dp.maximum > totalMax) totalMax = dp.maximum;
              }
            }
          }
        }
      }
    }

    return {
      avgCpu: count > 0 ? Math.round(totalAvg / count * 10) / 10 : null,
      peakCpu: Math.round(totalMax * 10) / 10,
      dataPoints: count,
    };
  } catch (err) {
    logger.error(`Metrics fetch failed for ${vmName}: ${err.message}`);
    return { avgCpu: null, peakCpu: null, dataPoints: 0 };
  }
}

/**
 * Analyze all running VMs and generate right-sizing recommendations.
 */
async function analyzeRightSizing() {
  const vms = await VM.find({ isAlive: true, isRunning: true }).lean();
  const recommendations = [];
  let totalMonthlySavings = 0;

  for (const vm of vms) {
    const vmSize = vm.vmTemplate?.vmSize || vm.vmSize;
    if (!vmSize) continue;

    const sizeInfo = VM_SIZE_MAP[vmSize];
    if (!sizeInfo || !sizeInfo.downTo) continue; // Already smallest or unknown size

    const metrics = await getVmMetrics(vm.resourceGroup, vm.name);
    if (metrics.avgCpu === null) continue; // No data

    // Rule: If avg CPU < 20% AND peak < 50% over 7 days → recommend downsize
    if (metrics.avgCpu < 20 && metrics.peakCpu < 50) {
      const downInfo = VM_SIZE_MAP[sizeInfo.downTo];
      const monthlySaving = downInfo ? (sizeInfo.cost - downInfo.cost) * 720 : 0; // 720 hrs/month
      const hourlySaving = downInfo ? sizeInfo.cost - downInfo.cost : 0;

      recommendations.push({
        vmName: vm.name,
        trainingName: vm.trainingName,
        organization: vm.organization,
        currentSize: vmSize,
        currentCost: sizeInfo.cost,
        recommendedSize: sizeInfo.downTo,
        recommendedCost: downInfo?.cost || sizeInfo.cost,
        metrics: {
          avgCpu: metrics.avgCpu,
          peakCpu: metrics.peakCpu,
          days: 7,
        },
        savings: {
          hourly: hourlySaving,
          monthly: monthlySaving,
        },
        confidence: metrics.avgCpu < 10 ? 'high' : 'medium',
        reason: `Avg CPU ${metrics.avgCpu}% (peak ${metrics.peakCpu}%) over 7 days — well below ${vmSize} capacity`,
      });

      totalMonthlySavings += monthlySaving;
    }
  }

  // Sort by savings descending
  recommendations.sort((a, b) => b.savings.monthly - a.savings.monthly);

  return {
    recommendations,
    summary: {
      totalVmsAnalyzed: vms.length,
      oversizedCount: recommendations.length,
      totalMonthlySavings: Math.round(totalMonthlySavings),
      highConfidence: recommendations.filter(r => r.confidence === 'high').length,
    },
  };
}

module.exports = { analyzeRightSizing, getVmMetrics, VM_SIZE_MAP };
