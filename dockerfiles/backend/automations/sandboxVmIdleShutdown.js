/**
 * Sandbox VM idle-shutdown (Azure)
 * ──────────────────────────────────
 * Scope: VMs that learners launch INSIDE their azure-standard-lab sandbox RGs.
 * These VMs are not in the `vms` Mongo collection (they're learner-created in
 * `lab-b2b-*-sbx` RGs) so the existing `idleShutdown.js` doesn't see them.
 *
 * Pattern: every 5 min, enumerate active sandbox RGs from `sandboxdeployments`,
 * list each RG's VMs via Azure SDK, query Azure Monitor for avg `Percentage CPU`
 * over the last `idleMinutes` window, deallocate any VM whose avg < cpuThreshold.
 *
 * Kill switch: SANDBOX_IDLE_SHUTDOWN_ENABLED=true (default off — opt-in).
 * Tunables:
 *   SANDBOX_IDLE_MINUTES        (default 30)
 *   SANDBOX_IDLE_CPU_THRESHOLD  (default 5, percent)
 *
 * Added 2026-06-15 as part of the Phase-2 cost-tightening (Networklab cohort
 * saw ~₹1.2k racked up by one learner via VMs left running through the 3h
 * sandbox window).
 *
 * Per-memory rules:
 *   - feedback_no_regression_rule.md — new file, additive, kill switch
 *   - feedback_no_cpu_load_spike.md — hooked into existing 5-min tick, no new cron
 *   - feedback_minimal_scope_for_drift_bugs.md — only touches sandbox RGs
 */

const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { MonitorClient } = require('@azure/arm-monitor');
const { logger } = require('../plugins/logger');

const TENANT = process.env.TENANT_ID;
const CLIENT = process.env.CLIENT_ID;
const SECRET = process.env.CLIENT_SECRET;
const SUB    = process.env.SUBSCRIPTION_ID;

// Lazy clients — built once per process.
let _credential;
let _compute;
let _monitor;
function getClients() {
  if (!_credential) {
    _credential = new ClientSecretCredential(TENANT, CLIENT, SECRET);
    _compute = new ComputeManagementClient(_credential, SUB);
    _monitor = new MonitorClient(_credential, SUB);
  }
  return { compute: _compute, monitor: _monitor };
}

async function getVmIsIdle(monitor, vmResourceId, idleMinutes, cpuThreshold) {
  const end = new Date();
  const start = new Date(end.getTime() - idleMinutes * 60 * 1000);
  try {
    const res = await monitor.metrics.list(vmResourceId, {
      timespan: `${start.toISOString()}/${end.toISOString()}`,
      interval: 'PT1M',
      metricnames: 'Percentage CPU',
      aggregation: 'Average',
    });
    const pts = (res.value?.[0]?.timeseries?.[0]?.data || [])
      .map(d => d.average)
      .filter(v => v != null);
    // Coverage rule: need at least 90% of expected minutes of data, capped at idleMinutes
    const minPts = Math.max(1, Math.floor(idleMinutes * 0.9));
    if (pts.length < minPts) return { idle: false, reason: `only ${pts.length}/${minPts} datapoints` };
    const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
    return { idle: avg < cpuThreshold, avg, count: pts.length };
  } catch (e) {
    return { idle: false, reason: `metric err: ${e.message}` };
  }
}

async function sandboxVmIdleShutdown() {
  if (process.env.SANDBOX_IDLE_SHUTDOWN_ENABLED !== 'true') return;   // opt-in only

  const idleMinutes  = Number(process.env.SANDBOX_IDLE_MINUTES) || 30;
  const cpuThreshold = Number(process.env.SANDBOX_IDLE_CPU_THRESHOLD) || 5;

  const mongoose = require('mongoose');
  const db = mongoose.connection.db;
  if (!db) { logger.warn('[sandbox-idle] Mongo not connected — skipping tick'); return; }

  const { compute, monitor } = getClients();

  // Active Azure sandboxes only — not deleted, not expired.
  const now = new Date();
  const active = await db.collection('sandboxdeployments').find({
    cloud: 'azure',
    state: { $nin: ['deleted', 'failed'] },
    'azure.resourceGroupName': { $exists: true, $ne: null },
    expiresAt: { $gt: now },
  }).project({ azure: 1, deployedBy: 1, expiresAt: 1 }).toArray();

  if (!active.length) return;
  logger.info(`[sandbox-idle] Scanning ${active.length} active Azure sandbox RG(s)`);

  let scanned = 0, stopped = 0, skipped = 0;
  for (const sbx of active) {
    const rg = sbx.azure.resourceGroupName;
    let vms;
    try {
      const it = compute.virtualMachines.list(rg);
      vms = [];
      for await (const v of it) vms.push(v);
    } catch (e) {
      logger.warn(`[sandbox-idle] ${rg}: list VMs err ${e.message}`);
      continue;
    }

    for (const vm of vms) {
      scanned++;
      const vmName = vm.name;
      // Check power state — only consider running VMs
      let powerState;
      try {
        const iv = await compute.virtualMachines.instanceView(rg, vmName);
        powerState = iv.statuses?.find(s => s.code?.startsWith('PowerState/'))?.code;
      } catch (e) {
        logger.warn(`[sandbox-idle] ${rg}/${vmName}: instanceView err ${e.message}`);
        continue;
      }
      if (powerState !== 'PowerState/running') { skipped++; continue; }

      const result = await getVmIsIdle(monitor, vm.id, idleMinutes, cpuThreshold);
      if (!result.idle) {
        logger.info(`[sandbox-idle] ${rg}/${vmName}: keep (${result.reason || `avg=${result.avg?.toFixed(1)}% over ${result.count} pts`})`);
        continue;
      }

      logger.info(`[sandbox-idle] ${rg}/${vmName}: idle (avg ${result.avg.toFixed(1)}% < ${cpuThreshold}% over ${idleMinutes} min) — deallocating`);
      try {
        await compute.virtualMachines.beginDeallocate(rg, vmName);
        stopped++;
        // Best-effort audit trail on the sandbox doc
        await db.collection('sandboxdeployments').updateOne(
          { _id: sbx._id },
          { $push: { idleShutdownLog: { at: new Date(), vmName, avgCpu: result.avg, idleMinutes } } }
        ).catch(() => {});
      } catch (e) {
        logger.error(`[sandbox-idle] ${rg}/${vmName}: deallocate err ${e.message}`);
      }
    }
  }

  logger.info(`[sandbox-idle] tick done: scanned=${scanned}, stopped=${stopped}, skipped-not-running=${skipped}`);
}

module.exports = { sandboxVmIdleShutdown };
