const { ClientSecretCredential } = require('@azure/identity');
const { MonitorClient } = require('@azure/arm-monitor');
const VM = require('../models/vm');
const { logger } = require('../plugins/logger');
const { notifyAutoShutdown } = require('../services/emailNotifications');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;

// Bull queue for stopping VMs (reuse existing queue if available)
let stopQueue = null;
try {
  const Bull = require('bull');
  stopQueue = new Bull('azure-stop-vm', {
    redis: { host: process.env.REDIS_HOST || 'redis', port: process.env.REDIS_PORT || 6379 }
  });
} catch {
  // Worker queue not available in backend — we'll call Azure directly
}

/**
 * Check if a VM is idle by looking at CPU usage metrics.
 * Returns true if average CPU < threshold for the given period.
 */
async function isVmIdle(resourceGroup, vmName, idleMinutes = 15, cpuThreshold = 5) {
  try {
    const monitorClient = new MonitorClient(credential, subscriptionId);
    const resourceUri = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - idleMinutes * 60 * 1000);

    const timespan = `${startTime.toISOString()}/${endTime.toISOString()}`;

    const metrics = monitorClient.metrics.list(resourceUri, {
      timespan,
      interval: 'PT1M',
      metricnames: 'Percentage CPU',
      aggregation: 'Average',
    });

    let totalCpu = 0;
    let dataPoints = 0;

    for await (const metric of [metrics]) {
      if (metric.value) {
        for (const ts of metric.value) {
          if (ts.timeseries) {
            for (const series of ts.timeseries) {
              if (series.data) {
                for (const dp of series.data) {
                  if (dp.average !== undefined && dp.average !== null) {
                    totalCpu += dp.average;
                    dataPoints++;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (dataPoints === 0) return false; // No data = can't determine idle
    const avgCpu = totalCpu / dataPoints;

    logger.info(`VM ${vmName}: avg CPU ${avgCpu.toFixed(1)}% over ${idleMinutes}min (threshold: ${cpuThreshold}%)`);
    return avgCpu < cpuThreshold;
  } catch (err) {
    logger.error(`Failed to check idle status for ${vmName}: ${err.message}`);
    return false; // Don't shutdown on error
  }
}

/**
 * Stop an idle VM via Azure API directly.
 */
async function stopVmDirect(resourceGroup, vmName) {
  try {
    const { ComputeManagementClient } = require('@azure/arm-compute');
    const computeClient = new ComputeManagementClient(credential, subscriptionId);
    await computeClient.virtualMachines.beginDeallocate(resourceGroup, vmName);
    logger.info(`Idle VM ${vmName} deallocated`);
    return true;
  } catch (err) {
    logger.error(`Failed to stop idle VM ${vmName}: ${err.message}`);
    return false;
  }
}

/**
 * Main idle shutdown checker.
 * Runs periodically (every 5 minutes) to find and stop idle VMs.
 */
async function idleShutdownChecker() {
  try {
    // Find all running VMs that have autoShutdown enabled
    const vms = await VM.find({
      isRunning: true,
      isAlive: true,
      autoShutdown: true,
    });

    if (!vms.length) return;

    logger.info(`Checking ${vms.length} VMs for idle shutdown...`);

    for (const vm of vms) {
      const idleMinutes = vm.idleMinutes || 15;

      // First check if VM is already stopped/deallocated (user shut down from inside Windows)
      let alreadyStopped = false;
      try {
        const { ComputeManagementClient } = require('@azure/arm-compute');
        const computeCheck = new ComputeManagementClient(credential, subscriptionId);
        const azVm = await computeCheck.virtualMachines.get(vm.resourceGroup, vm.name, { expand: 'instanceView' });
        const statuses = azVm.instanceView?.statuses || [];
        const ps = statuses.find(s => s.code?.startsWith('PowerState/'));
        const powerState = ps?.code?.replace('PowerState/', '') || 'unknown';

        if (powerState === 'deallocated' || powerState === 'stopped') {
          // User shut down from inside — just update DB, DON'T delete the VM
          logger.info(`VM ${vm.name} already ${powerState} (user shutdown from inside) — updating DB only`);
          vm.isRunning = false;
          const lastLog = vm.logs[vm.logs.length - 1];
          if (lastLog && !lastLog.stop) {
            lastLog.stop = new Date();
            lastLog.duration = Math.floor((lastLog.stop - lastLog.start) / 1000);
            vm.duration = (vm.duration || 0) + lastLog.duration;
            vm.quota.consumed = Math.round((vm.duration / 3600) * 100) / 100;
          }
          vm.remarks = 'Stopped by user (no cost while deallocated)';
          await vm.save();
          alreadyStopped = true;
        }
      } catch (checkErr) {
        if (checkErr.statusCode === 404) {
          // VM doesn't exist — already deleted, just update DB
          logger.warn(`VM ${vm.name} not found in Azure — updating DB`);
          vm.isRunning = false;
          vm.remarks = 'VM not found in Azure';
          await vm.save();
          alreadyStopped = true;
        }
      }

      if (alreadyStopped) continue;

      // VM is still running — check if it's idle
      const idle = await isVmIdle(vm.resourceGroup, vm.name, idleMinutes);

      if (idle) {
        logger.info(`VM ${vm.name} is idle for ${idleMinutes}+ minutes — shutting down`);

        // Try queue first, fallback to direct API
        if (stopQueue) {
          await stopQueue.add({
            name: vm.name,
            resourceGroup: vm.resourceGroup,
          });
        } else {
          const stopped = await stopVmDirect(vm.resourceGroup, vm.name);
          if (stopped) {
            // Update DB
            vm.isRunning = false;
            const lastLog = vm.logs[vm.logs.length - 1];
            if (lastLog && !lastLog.stop) {
              lastLog.stop = new Date();
              lastLog.duration = Math.floor((lastLog.stop - lastLog.start) / 1000);
              vm.duration = (vm.duration || 0) + lastLog.duration;
              vm.quota.consumed = Math.round((vm.duration / 3600) * 100) / 100;
            }
            vm.remarks = 'Auto-stopped (idle)';
            await vm.save();

            // Send notification email
            notifyAutoShutdown({
              email: vm.email,
              name: vm.name,
              idleMinutes: idleMinutes,
              organization: vm.organization,
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Idle shutdown checker error: ${err.message}`);
  }
}

module.exports = { idleShutdownChecker, isVmIdle };
