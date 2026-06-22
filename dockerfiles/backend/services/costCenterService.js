/**
 * Cost Center Service — pure spend, no revenue.
 *
 * Single source of truth for "what did <org> burn on Azure/AWS/GCP/OCI?"
 *
 * Tree shape:
 *   { totalSpendInr, lastSynced, period: { days, from, to },
 *     azure: {
 *       totalInr, sharedInfraInr, unattributedInr,
 *       byOrg: [{
 *         org, totalInr,
 *         trainingLabs: [{ trainingName, totalInr, vms: [{ name, totalInr, hours, breakdown }] }],
 *         sandboxes:    [{ templateSlug, templateName, totalInr, deployments: [{ user, rg, totalInr }] }],
 *       }],
 *       sharedInfra: [{ name, rg, totalInr }],
 *       unattributed: [{ resourceId, totalInr }],
 *     },
 *     aws / gcp / oci: same shape (sharedInfra empty for those; no per-RG analog).
 *   }
 *
 * All numbers are *real* Azure/AWS/GCP bill amounts in INR. Nothing is rate×hours.
 */

const { ClientSecretCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const VM = require('../models/vm');
const Training = require('../models/training');
const SandboxUser = require('../models/sandboxuser');
const AwsUser = require('../models/aws');
const GcpSandboxUser = require('../models/gcpSandboxUser');
const OciSandboxUser = require('../models/ociSandboxUser');
const SandboxTemplate = require('../models/sandboxTemplate');
const { logger } = require('../plugins/logger');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const costClient = new CostManagementClient(credential);

const SHARED_INFRA_RG = 'SYNERGIFIC';

let exchangeRate = 85; // USD→INR fallback for AWS/GCP costs that come back in USD
try {
  const { getUsdToInr } = require('./exchangeRate');
  getUsdToInr().then(r => { exchangeRate = r; }).catch(() => {});
} catch {}

const round2 = n => Math.round((n || 0) * 100) / 100;
const lc = s => (s || '').toLowerCase();

// ─── Azure ──────────────────────────────────────────────────────────────────

// Single ≤30-day chunk against Azure Cost Mgmt. Past ~30d the API silently truncates rows;
// chunking and summing in JS is the only reliable way to cover long windows.
async function queryOneAzureChunk(chunkFrom, chunkTo) {
  const scope = `subscriptions/${subscriptionId}`;
  const body = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: chunkFrom, to: chunkTo },
    dataset: {
      granularity: 'None',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
      grouping: [
        { type: 'Dimension', name: 'ResourceId' },
        { type: 'Dimension', name: 'ResourceGroup' },
        { type: 'Dimension', name: 'MeterCategory' },
      ],
    },
  };
  let lastErr;
  // Three retry waves on 429 with exponential backoff.
  // Azure Cost Mgmt rate-limit resets after ~60-90s; give it ample room.
  for (const wait of [0, 30000, 90000, 180000]) {
    if (wait) {
      logger.warn(`[costCenter] 429 on chunk ${chunkFrom.toISOString().slice(0,10)}→${chunkTo.toISOString().slice(0,10)} — waiting ${wait/1000}s before retry`);
      await new Promise(r => setTimeout(r, wait));
    }
    try {
      return await costClient.query.usage(scope, body);
    } catch (err) {
      lastErr = err;
      if (!/too many requests|429/i.test(err.message)) throw err;
    }
  }
  logger.error(`[costCenter] chunk ${chunkFrom.toISOString().slice(0,10)}→${chunkTo.toISOString().slice(0,10)} failed after all retries`);
  throw lastErr;
}

// Track partial fetches across the request so we can surface them in the UI.
let lastFetchPartial = { chunksTotal: 0, chunksFailed: [] };

async function queryAzureCostByResource(startDate, endDate) {
  // Patched 2026-05-21: chunk size 30→7 days. Monthly query becomes 3-5 chunks instead of 1.
  // Reason: single 30-day chunk that hits a 429 wiped out the entire month of data
  // (the screenshot bug where Untracked showed ₹3.1L). Multiple smaller chunks let some
  // succeed even if others fail; each chunk also less likely to hit the 5000-row first-page cap.
  const CHUNK_DAYS = 7;
  const INTER_CHUNK_MS = 8000;
  const chunks = [];
  let cursor = new Date(startDate);
  while (cursor < endDate) {
    const next = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 86400000, endDate.getTime()));
    chunks.push([new Date(cursor), next]);
    cursor = next;
  }
  logger.info(`[costCenter] Azure cost query: ${chunks.length} chunk(s) covering ${startDate.toISOString().slice(0,10)} → ${endDate.toISOString().slice(0,10)}`);

  const failed = [];
  const allRows = [];
  for (let i = 0; i < chunks.length; i++) {
    const [from, to] = chunks[i];
    if (i > 0) await new Promise(r => setTimeout(r, INTER_CHUNK_MS));
    try {
      const r = await queryOneAzureChunk(from, to);
      if (r?.rows) allRows.push(...r.rows);
      // Follow Azure pagination — grouped queries return up to ~5000 rows per page.
      // Without this loop we silently drop everything past page 1.
      let nextLink = r?.nextLink;
      while (nextLink) {
        try {
          const token = await credential.getToken('https://management.azure.com/.default');
          const pageBody = {
            type: 'ActualCost',
            timeframe: 'Custom',
            timePeriod: { from, to },
            dataset: {
              granularity: 'None',
              aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
              grouping: [
                { type: 'Dimension', name: 'ResourceId' },
                { type: 'Dimension', name: 'ResourceGroup' },
                { type: 'Dimension', name: 'MeterCategory' },
              ],
            },
          };
          const pageRes = await fetch(nextLink, { method: "POST", headers: { "Content-Type": "application/json", Authorization: 'Bearer ' + token.token }, body: JSON.stringify(pageBody) });
          if (!pageRes.ok) { logger.warn('[costCenter] pagination fetch ' + pageRes.status); break; }
          const pageJson = await pageRes.json();
          if (pageJson?.properties?.rows) allRows.push(...pageJson.properties.rows);
          nextLink = pageJson?.properties?.nextLink || null;
        } catch (e) {
          logger.warn('[costCenter] pagination error: ' + e.message);
          break;
        }
      }
    } catch (err) {
      failed.push({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), error: err.message });
      logger.error(`[costCenter] chunk ${from.toISOString().slice(0,10)}→${to.toISOString().slice(0,10)} failed permanently: ${err.message}`);
    }
  }
  lastFetchPartial = { chunksTotal: chunks.length, chunksFailed: failed };
  const result = { rows: allRows };

  // Each row = [cost, resourceId, resourceGroup, meterCategory, currency]
  // Aggregate per resourceId, also bucketing by category for breakdown.
  const byResource = {};
  for (const row of (result.rows || [])) {
    const cost = row[0] || 0;
    const resourceId = lc(row[1]);
    const rg = lc(row[2]);
    const meter = lc(row[3]);

    if (!resourceId) continue;
    if (!byResource[resourceId]) {
      byResource[resourceId] = { resourceId, rg, totalInr: 0, compute: 0, osDisk: 0, dataDisk: 0, networking: 0, snapshots: 0, other: 0 };
    }
    const entry = byResource[resourceId];
    entry.totalInr += cost;

    if (meter.includes('virtual machines')) entry.compute += cost;
    else if (meter.includes('storage') && resourceId.includes('snapshot')) entry.snapshots += cost;
    else if (meter.includes('storage') && (resourceId.includes('osdisk') || resourceId.includes('_osdisk'))) entry.osDisk += cost;
    else if (meter.includes('storage')) entry.dataDisk += cost;
    else if (meter.includes('networking') || meter.includes('virtual network') || meter.includes('ip addresses') || meter.includes('load balancer')) entry.networking += cost;
    else entry.other += cost;
  }
  return byResource;
}

// Fetch the ungrouped grand-total for the same period.
// Azure Cost Mgmt API truncates grouped queries to ~5000 rows; the ungrouped
// total is authoritative and matches the Azure native portal exactly.
async function queryAzureUngroupedTotal(startDate, endDate) {
  const scope = 'subscriptions/' + subscriptionId;
  const body = {
    type: 'ActualCost',
    timeframe: 'Custom',
    timePeriod: { from: startDate, to: endDate },
    dataset: {
      granularity: 'None',
      aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
    },
  };
  for (const wait of [0, 30000, 90000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      const r = await costClient.query.usage(scope, body);
      return r && r.rows && r.rows[0] ? (r.rows[0][0] || 0) : 0;
    } catch (err) {
      if (!/too many requests|429/i.test(err.message)) {
        logger.warn('[costCenter] ungrouped total failed: ' + err.message);
        return 0;
      }
      logger.warn('[costCenter] 429 on ungrouped total — waiting ' + (wait ? wait/1000 : 30) + 's');
    }
  }
  return 0;
}


async function buildAzureTree(startDate, endDate) {
  let byResource;
  try {
    byResource = await queryAzureCostByResource(startDate, endDate);
  } catch (err) {
    logger.error(`[costCenter] Azure Cost Management query failed: ${err.message}`);
    return { totalInr: 0, sharedInfraInr: 0, unattributedInr: 0, byOrg: [], sharedInfra: [], unattributed: [], error: err.message };
  }

  // 1) Training VMs — match by Mongo VM.name appearing in the LAST resource-id segment.
  //    Critical: prior version used `rid.includes(vmName)` which was a substring match, causing
  //    `admintrack-1` to absorb cost from `admintrack-10..-19` (11 VMs of cost stacked on one row).
  //    Fix: extract the last `/` segment (the actual resource name), then match on word boundaries
  //    (exact, OR vmName + '_' suffix, OR vmName + '-' suffix). Iterate longest VM names first
  //    so `admintrack-10` claims its own resources before `admintrack-1` ever sees them.
  const trainingVMs = await VM.find({}).select('name trainingName organization duration sku vmSize').lean();
  const sortedVMs = [...trainingVMs]
    .filter(v => v.name && v.organization && v.trainingName)
    .sort((a, b) => b.name.length - a.name.length);

  // Map each Azure resourceId → the VM that owns it (at most one). First match wins thanks to length-desc sort.
  const ridToVM = new Map();
  for (const [rid] of Object.entries(byResource)) {
    const segments = rid.split('/');
    const resName = lc(segments[segments.length - 1] || '');
    for (const vm of sortedVMs) {
      const vmNameLc = lc(vm.name);
      if (resName === vmNameLc || resName.startsWith(vmNameLc + '_') || resName.startsWith(vmNameLc + '-')) {
        ridToVM.set(rid, vm);
        break;
      }
    }
  }

  // Aggregate cost per VM via the resolved mapping.
  const trainingClaim = new Set();
  const trainingByOrg = {}; // org → trainingName → { vms: [...], totalInr }
  const vmAgg = new Map(); // vm.name → aggregated cost+breakdown
  for (const [rid, vm] of ridToVM.entries()) {
    const entry = byResource[rid];
    trainingClaim.add(rid);
    if (!vmAgg.has(vm.name)) vmAgg.set(vm.name, { vm, cost: 0, breakdown: { compute: 0, osDisk: 0, dataDisk: 0, networking: 0, snapshots: 0, other: 0 } });
    const agg = vmAgg.get(vm.name);
    agg.cost += entry.totalInr;
    agg.breakdown.compute += entry.compute;
    agg.breakdown.osDisk += entry.osDisk;
    agg.breakdown.dataDisk += entry.dataDisk;
    agg.breakdown.networking += entry.networking;
    agg.breakdown.snapshots += entry.snapshots;
    agg.breakdown.other += entry.other;
  }
  for (const { vm, cost, breakdown } of vmAgg.values()) {
    if (cost <= 0) continue;
    const org = vm.organization, tn = vm.trainingName;
    if (!trainingByOrg[org]) trainingByOrg[org] = {};
    if (!trainingByOrg[org][tn]) trainingByOrg[org][tn] = { trainingName: tn, totalInr: 0, vms: [] };
    trainingByOrg[org][tn].vms.push({
      name: vm.name,
      sku: vm.vmSize || vm.sku || null,
      hours: round2((vm.duration || 0) / 60),
      totalInr: round2(cost),
      breakdown: { compute: round2(breakdown.compute), osDisk: round2(breakdown.osDisk), dataDisk: round2(breakdown.dataDisk), networking: round2(breakdown.networking), snapshots: round2(breakdown.snapshots), other: round2(breakdown.other) },
    });
    trainingByOrg[org][tn].totalInr += cost;
  }

  // 2) Azure sandboxes — match RG. Two collections feed this:
  //   a) `sandboxusers` (bulk-deploy path): nested user.sandbox[].resourceGroupName.
  //   b) `sandboxdeployments` (template-deploy path): doc.azure.resourceGroupName, deployedBy = customer email.
  const allTemplates = await SandboxTemplate.find({}).select('_id slug name cloud').lean();
  const tplById = {};
  for (const t of allTemplates) tplById[String(t._id)] = t;

  // Helper — sum cost for one RG and mark its rids as claimed.
  const costForRG = (rgName) => {
    const rgLc = lc(rgName);
    let cost = 0;
    for (const [rid, entry] of Object.entries(byResource)) {
      if (entry.rg === rgLc) { cost += entry.totalInr; trainingClaim.add(rid); }
    }
    return cost;
  };

  const sandboxesByOrg = {}; // org → templateSlug → { template, totalInr, deployments: [] }
  const pushDeployment = (org, slug, tname, dep) => {
    if (!org) return;
    if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
    if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
    sandboxesByOrg[org][slug].deployments.push(dep);
    sandboxesByOrg[org][slug].totalInr += dep.totalInr;
  };

  // 2a) bulk-deploy path
  const azureSandboxUsers = await SandboxUser.find({ 'sandbox.0': { $exists: true } })
    .select('email organization sandbox.resourceGroupName sandbox.templateId sandbox.status').lean();
  for (const u of azureSandboxUsers) {
    if (!u.organization || !u.sandbox?.length) continue;
    for (const sb of u.sandbox) {
      if (!sb.resourceGroupName) continue;
      const cost = costForRG(sb.resourceGroupName);
      if (cost <= 0) continue;
      const tpl = sb.templateId ? tplById[String(sb.templateId)] : null;
      pushDeployment(u.organization, tpl?.slug || 'unknown-template', tpl?.name || tpl?.slug || 'Unknown', {
        user: u.email, rg: sb.resourceGroupName, status: sb.status || 'unknown', totalInr: round2(cost),
      });
    }
  }

  // 2b) template-deploy path (SandboxDeployment) — deployedBy is usually the customer email,
  // so we look up that email in the `users` collection to get the org. Falls back to the email
  // domain prefix if no User record exists.
  const SandboxDeployment = require('../models/sandboxDeployment');
  const User = require('../models/user');
  const sds = await SandboxDeployment.find({ cloud: 'azure', 'azure.resourceGroupName': { $exists: true, $ne: null } })
    .select('templateSlug templateName deployedBy state azure').lean();
  if (sds.length) {
    const deployers = [...new Set(sds.map(d => d.deployedBy).filter(Boolean))];
    const userDocs = await User.find({ email: { $in: deployers } }).select('email organization').lean();
    const orgByEmail = {};
    for (const u of userDocs) orgByEmail[lc(u.email)] = u.organization || null;

    for (const d of sds) {
      const cost = costForRG(d.azure.resourceGroupName);
      if (cost <= 0) continue;
      const slug = d.templateSlug || 'unknown-template';
      const tname = d.templateName || slug;
      // Resolve org: User's organization > email domain (e.g. stripe-1@stripedata.net → stripedata.net)
      const lcEmail = lc(d.deployedBy || '');
      let org = orgByEmail[lcEmail];
      if (!org) {
        const m = /@([^.]+)/.exec(lcEmail);
        org = m ? m[1] : '(unmapped)';
      }
      pushDeployment(org, slug, tname, {
        user: d.deployedBy, rg: d.azure.resourceGroupName, status: d.state || 'unknown', totalInr: round2(cost),
      });
    }
  }

  // 3) Shared infrastructure. Three classes:
  //   a) RG = SYNERGIFIC (the explicit shared infra RG: portal, guacamole, LMS, HRM, etc.)
  //   b) Azure auto-created platform RGs (NetworkWatcher, DefaultResourceGroup-*, MA_*, AzureBackupRG_*, automation-accounts)
  //   c) Productized assets: Compute Galleries (image versions ARE our IP — every template lives here), automation runbooks (fabrics RG)
  // Anything matched here is NOT customer-attributable — it's overhead we own.
  const isSharedInfraRG = (rg) => {
    if (!rg) return false;
    if (rg === lc(SHARED_INFRA_RG)) return true;
    if (rg === 'fabrics') return true;
    if (rg === 'networkwatcherrg') return true;
    if (rg === 'automation-accounts') return true;
    if (rg.startsWith('defaultresourcegroup-')) return true;
    if (rg.startsWith('ma_default')) return true;             // Monitor Agent log-analytics workspaces
    if (rg.startsWith('azurebackuprg_')) return true;
    return false;
  };
  const isGalleryResource = (rid) => rid.includes('/galleries/'); // gallery image versions = productized templates

  const sharedInfra = [];
  let sharedInfraInr = 0;
  const sharedByRes = {};
  for (const [rid, entry] of Object.entries(byResource)) {
    const isShared = isSharedInfraRG(entry.rg) || isGalleryResource(rid);
    if (!isShared) continue;
    trainingClaim.add(rid);
    // Extract a sensible group key. For galleries: /galleries/<name>/images/<imgName>/versions/X — group by imgName.
    let groupKey;
    if (isGalleryResource(rid)) {
      const m = /\/galleries\/[^/]+\/images\/([^/]+)/.exec(rid);
      groupKey = m ? `gallery:${m[1]}` : 'gallery:other';
    } else {
      const parts = rid.split('/');
      const name = parts[parts.length - 1] || rid;
      groupKey = name.replace(/[-_]?(osdisk|disk\d*|nic\d*|ip\d*|nsg\d*|publicip)\b.*$/i, '') || name;
    }
    if (!sharedByRes[groupKey]) sharedByRes[groupKey] = { name: groupKey, rg: entry.rg, totalInr: 0, compute: 0, networking: 0, storage: 0 };
    sharedByRes[groupKey].totalInr += entry.totalInr;
    sharedByRes[groupKey].compute += entry.compute;
    sharedByRes[groupKey].networking += entry.networking;
    sharedByRes[groupKey].storage += entry.osDisk + entry.dataDisk + entry.snapshots;
    sharedInfraInr += entry.totalInr;
  }
  for (const r of Object.values(sharedByRes)) {
    sharedInfra.push({ name: r.name, rg: r.rg, totalInr: round2(r.totalInr), compute: round2(r.compute), networking: round2(r.networking), storage: round2(r.storage) });
  }
  sharedInfra.sort((a, b) => b.totalInr - a.totalInr);

  // 4) Unattributed — any cost row not claimed by training/sandbox/shared.
  const unattributed = [];
  let unattributedInr = 0;
  for (const [rid, entry] of Object.entries(byResource)) {
    if (trainingClaim.has(rid)) continue;
    if (entry.totalInr < 0.01) continue;
    unattributed.push({ resourceId: rid, rg: entry.rg, totalInr: round2(entry.totalInr) });
    unattributedInr += entry.totalInr;
  }
  unattributed.sort((a, b) => b.totalInr - a.totalInr);

  // 5) Assemble byOrg
  const orgs = new Set([...Object.keys(trainingByOrg), ...Object.keys(sandboxesByOrg)]);
  const byOrg = [];
  for (const org of orgs) {
    const trainingLabs = Object.values(trainingByOrg[org] || {})
      .map(t => ({ ...t, totalInr: round2(t.totalInr), vms: t.vms.sort((a, b) => b.totalInr - a.totalInr) }))
      .sort((a, b) => b.totalInr - a.totalInr);
    const sandboxes = Object.values(sandboxesByOrg[org] || {})
      .map(s => ({ ...s, totalInr: round2(s.totalInr), deployments: s.deployments.sort((a, b) => b.totalInr - a.totalInr) }))
      .sort((a, b) => b.totalInr - a.totalInr);
    const totalInr = trainingLabs.reduce((s, t) => s + t.totalInr, 0) + sandboxes.reduce((s, t) => s + t.totalInr, 0);
    byOrg.push({ org, totalInr: round2(totalInr), trainingLabs, sandboxes });
  }
  byOrg.sort((a, b) => b.totalInr - a.totalInr);

  const breakdownSum = byOrg.reduce((s, o) => s + o.totalInr, 0) + sharedInfraInr + unattributedInr;
  // Fetch the authoritative ungrouped grand total. Grouped queries truncate at ~5000 rows;
  // difference becomes untrackedInr (real spend we can't break down without pagination).
  const ungroupedTotalInr = await queryAzureUngroupedTotal(startDate, endDate);
  const untrackedInr = Math.max(0, ungroupedTotalInr - breakdownSum);
  const totalInr = ungroupedTotalInr > 0 ? ungroupedTotalInr : breakdownSum;
  return {
    totalInr: round2(totalInr),
    sharedInfraInr: round2(sharedInfraInr),
    unattributedInr: round2(unattributedInr),
    untrackedInr: round2(untrackedInr),
    byOrg,
    sharedInfra,
    unattributed: unattributed.slice(0, 50),
    partial: lastFetchPartial.chunksFailed.length > 0 ? lastFetchPartial : null,
  };
}

// ─── AWS ────────────────────────────────────────────────────────────────────

async function buildAwsTree(start, end) {
  try {
    // SDK package isn't installed in production node_modules; fall back to AWS CLI.
    const { execSync } = require('child_process');
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_ACCESS_SECRET,
      AWS_DEFAULT_REGION: 'us-east-1',
    };
    const ce = (args) => {
      try {
        return JSON.parse(execSync(`aws ce ${args} --output json`, { env, encoding: 'utf8', timeout: 30000 }));
      } catch (e) { throw new Error(`aws ce CLI failed: ${(e.stderr || e.message || '').toString().slice(0, 200)}`); }
    };

    // Pull two views in parallel-equivalent: account total + per-IAM-user grouping.
    // The CreatedBy tag must be activated as a cost-allocation tag in AWS Billing for per-user
    // grouping to work. If not, ResultsByTime[*].Groups will be empty and we fall back to
    // attributing the full account spend to the only org that has AWS users (typical for a
    // Connect-training engagement) or to "(unattributed AWS)".
    const totalResult = ce(`get-cost-and-usage --time-period Start=${startStr},End=${endStr} --granularity MONTHLY --metrics UnblendedCost`);
    const byUserResult = ce(`get-cost-and-usage --time-period Start=${startStr},End=${endStr} --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=CreatedBy`);

    let totalUsd = 0;
    for (const p of (totalResult.ResultsByTime || [])) totalUsd += parseFloat(p.Total?.UnblendedCost?.Amount || '0');

    const byUser = {};
    let groupedUsd = 0;
    for (const period of (byUserResult.ResultsByTime || [])) {
      for (const grp of (period.Groups || [])) {
        const tag = grp.Keys?.[0] || '';
        const username = lc(tag.split('$')[1] || '');
        if (!username) continue;
        const usd = parseFloat(grp.Metrics?.UnblendedCost?.Amount || '0');
        byUser[username] = (byUser[username] || 0) + usd;
        groupedUsd += usd;
      }
    }
    const tagAttributionWorking = groupedUsd > 0.01;

    // AWS: one user = one IAM identity at top level (userId), with a templateId at top level too.
    const awsUsers = await AwsUser.find({ userId: { $exists: true, $ne: '' } })
      .select('email organization userId templateId deletionStatus').lean();
    const allTemplates = await SandboxTemplate.find({ cloud: 'aws' }).select('_id slug name').lean();
    const tplById = {}; for (const t of allTemplates) tplById[String(t._id)] = t;

    const sandboxesByOrg = {};
    let attributedUsd = 0;
    for (const u of awsUsers) {
      if (!u.organization || !u.userId) continue;
      const iam = lc(u.userId);
      const usd = byUser[iam] || 0;
      if (usd <= 0) continue;
      attributedUsd += usd;
      const tpl = u.templateId ? tplById[String(u.templateId)] : null;
      const slug = tpl?.slug || 'unknown-template';
      const tname = tpl?.name || slug;
      const org = u.organization;
      if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
      if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
      sandboxesByOrg[org][slug].deployments.push({
        user: u.email, iamUser: u.userId, status: u.deletionStatus || 'active',
        totalInr: round2(usd * exchangeRate),
      });
      sandboxesByOrg[org][slug].totalInr += usd * exchangeRate;
    }

    // Also pull AWS template-deploy sandboxes (sandboxdeployments collection).
    // These typically don't reuse the awsuser.userId IAM identity, so map them by deployedBy email's org.
    const SandboxDeployment = require('../models/sandboxDeployment');
    const User = require('../models/user');
    const sds = await SandboxDeployment.find({ cloud: 'aws', 'aws.iamUsername': { $exists: true } })
      .select('templateSlug templateName deployedBy state aws').lean();
    if (sds.length) {
      const deployers = [...new Set(sds.map(d => d.deployedBy).filter(Boolean))];
      const userDocs = await User.find({ email: { $in: deployers } }).select('email organization').lean();
      const orgByEmail = {};
      for (const u of userDocs) orgByEmail[lc(u.email)] = u.organization || null;
      for (const d of sds) {
        const iam = lc(d.aws?.iamUsername || '');
        const usd = byUser[iam] || 0;
        if (usd <= 0) continue;
        attributedUsd += usd;
        const slug = d.templateSlug || 'unknown-template';
        const tname = d.templateName || slug;
        const lcEmail = lc(d.deployedBy || '');
        let org = orgByEmail[lcEmail];
        if (!org) { const m = /@([^.]+)/.exec(lcEmail); org = m ? m[1] : '(unmapped)'; }
        if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
        if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
        sandboxesByOrg[org][slug].deployments.push({ user: d.deployedBy, iamUser: d.aws.iamUsername, status: d.state || 'unknown', totalInr: round2(usd * exchangeRate) });
        sandboxesByOrg[org][slug].totalInr += usd * exchangeRate;
      }
    }

    let unattributedInr = round2((totalUsd - attributedUsd) * exchangeRate);
    let note = null;

    // Fallback 1: tag attribution didn't return anything (no cost-allocation tag activated)
    // but we know all AWS users belong to one org → attribute the whole account total to that org.
    if (!tagAttributionWorking && totalUsd > 0.01) {
      const orgs = [...new Set(awsUsers.map(u => u.organization).filter(Boolean))];
      if (orgs.length === 1 && Object.keys(sandboxesByOrg).length === 0) {
        const onlyOrg = orgs[0];
        // Group all 12 IAM users under the one template
        const groups = {};
        for (const u of awsUsers) {
          const tpl = u.templateId ? tplById[String(u.templateId)] : null;
          const slug = tpl?.slug || 'unknown-template';
          const tname = tpl?.name || slug;
          if (!groups[slug]) groups[slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
          groups[slug].deployments.push({ user: u.email, iamUser: u.userId, status: u.deletionStatus || 'active', totalInr: 0 });
        }
        // Distribute the total evenly across groups by deployment count.
        const totalDeployments = Object.values(groups).reduce((s, g) => s + g.deployments.length, 0) || 1;
        for (const g of Object.values(groups)) {
          g.totalInr = round2(totalUsd * exchangeRate * (g.deployments.length / totalDeployments));
          for (const d of g.deployments) d.totalInr = round2(g.totalInr / g.deployments.length);
        }
        sandboxesByOrg[onlyOrg] = groups;
        unattributedInr = 0;
        note = 'AWS CreatedBy cost-allocation tag not activated in AWS Billing → attributing full account spend to the only org with AWS users (' + onlyOrg + '). For per-user breakdown: AWS Billing → Cost allocation tags → activate "CreatedBy" → wait 24h.';
      } else {
        note = 'AWS CreatedBy cost-allocation tag not activated in AWS Billing → cannot attribute spend to specific orgs/users. Showing account total only. Activate the tag in AWS Billing console for per-user breakdown.';
      }
    }

    const byOrg = Object.entries(sandboxesByOrg).map(([org, tpls]) => {
      const sandboxes = Object.values(tpls).map(s => ({ ...s, totalInr: round2(s.totalInr), deployments: s.deployments.sort((a, b) => b.totalInr - a.totalInr) })).sort((a, b) => b.totalInr - a.totalInr);
      return { org, totalInr: round2(sandboxes.reduce((s, t) => s + t.totalInr, 0)), trainingLabs: [], sandboxes };
    }).sort((a, b) => b.totalInr - a.totalInr);

    return { totalInr: round2(totalUsd * exchangeRate), unattributedInr, byOrg, sharedInfra: [], unattributed: [], exchangeRate, note };
  } catch (err) {
    logger.error(`[costCenter] AWS cost build failed: ${err.message}`);
    return { totalInr: 0, unattributedInr: 0, byOrg: [], sharedInfra: [], unattributed: [], error: err.message };
  }
}

// ─── GCP ────────────────────────────────────────────────────────────────────

async function buildGcpTree(start, end) {
  try {
    const { getGcpCostByProject } = require('./gcpCostService');
    const days = Math.max(1, Math.round((end - start) / 86400000));
    const breakdown = await getGcpCostByProject(days);
    const projUsd = {};
    for (const p of (breakdown.projectBreakdown || [])) projUsd[lc(p.projectId)] = p.usd || 0;

    const gcpUsers = await GcpSandboxUser.find({ 'sandbox.0': { $exists: true } })
      .select('email organization sandbox.projectId sandbox.templateId sandbox.status').lean();
    const allTemplates = await SandboxTemplate.find({ cloud: 'gcp' }).select('_id slug name').lean();
    const tplById = {}; for (const t of allTemplates) tplById[String(t._id)] = t;

    const sandboxesByOrg = {};
    let attributedUsd = 0;
    for (const u of gcpUsers) {
      if (!u.organization || !u.sandbox?.length) continue;
      for (const sb of u.sandbox) {
        const pid = lc(sb.projectId);
        if (!pid) continue;
        const usd = projUsd[pid] || 0;
        if (usd <= 0) continue;
        attributedUsd += usd;
        const tpl = sb.templateId ? tplById[String(sb.templateId)] : null;
        const slug = tpl?.slug || 'unknown-template';
        const tname = tpl?.name || slug;
        const org = u.organization;
        if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
        if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
        sandboxesByOrg[org][slug].deployments.push({
          user: u.email, projectId: sb.projectId, status: sb.status || 'unknown',
          totalInr: round2(usd * exchangeRate),
        });
        sandboxesByOrg[org][slug].totalInr += usd * exchangeRate;
      }
    }

    // Also pull GCP template-deploy sandboxes (sandboxdeployments).
    const SandboxDeployment = require('../models/sandboxDeployment');
    const User = require('../models/user');
    const gcpSds = await SandboxDeployment.find({ cloud: 'gcp', 'gcp.projectId': { $exists: true } })
      .select('templateSlug templateName deployedBy state gcp').lean();
    if (gcpSds.length) {
      const deployers = [...new Set(gcpSds.map(d => d.deployedBy).filter(Boolean))];
      const userDocs = await User.find({ email: { $in: deployers } }).select('email organization').lean();
      const orgByEmail = {};
      for (const u of userDocs) orgByEmail[lc(u.email)] = u.organization || null;
      for (const d of gcpSds) {
        const pid = lc(d.gcp?.projectId || '');
        const usd = projUsd[pid] || 0;
        if (usd <= 0) continue;
        attributedUsd += usd;
        const slug = d.templateSlug || 'unknown-template';
        const tname = d.templateName || slug;
        const lcEmail = lc(d.deployedBy || '');
        let org = orgByEmail[lcEmail];
        if (!org) { const m = /@([^.]+)/.exec(lcEmail); org = m ? m[1] : '(unmapped)'; }
        if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
        if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
        sandboxesByOrg[org][slug].deployments.push({ user: d.deployedBy, projectId: d.gcp.projectId, status: d.state || 'unknown', totalInr: round2(usd * exchangeRate) });
        sandboxesByOrg[org][slug].totalInr += usd * exchangeRate;
      }
    }

    const totalUsd = breakdown.totalUsd || 0;
    const unattributedInr = round2((totalUsd - attributedUsd) * exchangeRate);
    const note = totalUsd === 0 ? 'No GCP spend recorded for this period (no sandboxes deployed, or projects not linked to billing account).' : null;

    const byOrg = Object.entries(sandboxesByOrg).map(([org, tpls]) => {
      const sandboxes = Object.values(tpls).map(s => ({ ...s, totalInr: round2(s.totalInr), deployments: s.deployments.sort((a, b) => b.totalInr - a.totalInr) })).sort((a, b) => b.totalInr - a.totalInr);
      return { org, totalInr: round2(sandboxes.reduce((s, t) => s + t.totalInr, 0)), trainingLabs: [], sandboxes };
    }).sort((a, b) => b.totalInr - a.totalInr);

    return { totalInr: round2(totalUsd * exchangeRate), unattributedInr, byOrg, sharedInfra: [], unattributed: [], exchangeRate, note };
  } catch (err) {
    logger.error(`[costCenter] GCP cost build failed: ${err.message}`);
    return { totalInr: 0, unattributedInr: 0, byOrg: [], sharedInfra: [], unattributed: [], error: err.message };
  }
}

// ─── OCI (placeholder; OCI Usage API not yet wired) ─────────────────────────

async function buildOciTree(_start, _end) {
  try {
    // OCI: flat schema, one user = one OCI sandbox.
    const ociUsers = await OciSandboxUser.find({ compartmentId: { $exists: true, $ne: '' } })
      .select('email organization compartmentId templateId status').lean();
    const allTemplates = await SandboxTemplate.find({ cloud: 'oci' }).select('_id slug name').lean();
    const tplById = {}; for (const t of allTemplates) tplById[String(t._id)] = t;

    // Without OCI Usage API plumbing we can't pull real cost yet — return active-deployment count only,
    // so the UI shows a clear "OCI cost API not wired" state instead of zero/missing.
    const sandboxesByOrg = {};
    for (const u of ociUsers) {
      if (!u.organization || !u.compartmentId) continue;
      const tpl = u.templateId ? tplById[String(u.templateId)] : null;
      const slug = tpl?.slug || 'unknown-template';
      const tname = tpl?.name || slug;
      const org = u.organization;
      if (!sandboxesByOrg[org]) sandboxesByOrg[org] = {};
      if (!sandboxesByOrg[org][slug]) sandboxesByOrg[org][slug] = { templateSlug: slug, templateName: tname, totalInr: 0, deployments: [] };
      sandboxesByOrg[org][slug].deployments.push({
        user: u.email, compartmentId: u.compartmentId, status: u.status || 'active', totalInr: 0,
      });
    }
    const byOrg = Object.entries(sandboxesByOrg).map(([org, tpls]) => ({
      org, totalInr: 0, trainingLabs: [],
      sandboxes: Object.values(tpls).map(s => ({ ...s, totalInr: 0 })),
    }));

    return { totalInr: 0, unattributedInr: 0, byOrg, sharedInfra: [], unattributed: [], note: 'OCI Usage API not wired — counts shown, costs not yet available.' };
  } catch (err) {
    logger.error(`[costCenter] OCI cost build failed: ${err.message}`);
    return { totalInr: 0, unattributedInr: 0, byOrg: [], sharedInfra: [], unattributed: [], error: err.message };
  }
}

// ─── Public entry ───────────────────────────────────────────────────────────

// Cache keyed by (from|to) so multiple range selections coexist.
// Persisted to disk so pm2 reloads / backend restarts don't wipe it — without
// this, the first user to load the page after every restart hits Azure cold
// and often sees "Network Error" because Cost Mgmt throttles immediately.
const cacheByRange = new Map();
const inFlightByRange = new Map();
const CACHE_MS = 30 * 60 * 1000; // 30 min
const MAX_DAYS = 364; // Azure Cost Mgmt API rejects > 365 days inclusive (treats it as >1yr); 364 is the safe cap.
const CACHE_PERSIST_PATH = require('path').join(__dirname, '..', '.cache', 'costCenter-cache.json');

(function hydrateCacheFromDisk() {
  try {
    const fs = require('fs');
    if (!fs.existsSync(CACHE_PERSIST_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(CACHE_PERSIST_PATH, 'utf8'));
    for (const [k, v] of Object.entries(raw || {})) cacheByRange.set(k, v);
    logger.info(`[costCenter] hydrated ${cacheByRange.size} cache entries from ${CACHE_PERSIST_PATH}`);
  } catch (e) { logger.warn(`[costCenter] cache hydrate failed: ${e.message}`); }
})();

function persistCacheToDisk() {
  try {
    const fs = require('fs'), path = require('path');
    fs.mkdirSync(path.dirname(CACHE_PERSIST_PATH), { recursive: true });
    const obj = Object.fromEntries(cacheByRange);
    fs.writeFileSync(CACHE_PERSIST_PATH + '.tmp', JSON.stringify(obj));
    fs.renameSync(CACHE_PERSIST_PATH + '.tmp', CACHE_PERSIST_PATH);
  } catch (e) { logger.warn(`[costCenter] cache persist failed: ${e.message}`); }
}

async function getCostCenter({ from, to, days, force = false } = {}) {
  // Resolve start/end. Priority: explicit from/to > legacy `days` > default = last MAX_DAYS.
  let end = to ? new Date(to) : new Date();
  let start;
  if (from) {
    start = new Date(from);
  } else if (days != null) {
    start = new Date(end.getTime() - Math.max(1, Math.min(MAX_DAYS, days)) * 86400000);
  } else {
    start = new Date(end.getTime() - MAX_DAYS * 86400000);
  }
  // Clamp range: Cost Mgmt API rejects > ~13 months; keep 365 days max.
  const span = (end - start) / 86400000;
  if (span > MAX_DAYS) start = new Date(end.getTime() - MAX_DAYS * 86400000);
  if (start > end) start = new Date(end.getTime() - 86400000);

  // Round start/end to the nearest hour so cache keys are stable across
  // rapid-fire frontend requests (each sends to=new Date() which differs
  // by milliseconds, creating new keys and new Azure API calls every time).
  const ROUND_MS = 60 * 60 * 1000; // 1 hour
  start = new Date(Math.floor(start.getTime() / ROUND_MS) * ROUND_MS);
  end   = new Date(Math.ceil(end.getTime() / ROUND_MS) * ROUND_MS);

  const cacheKey = `${start.toISOString()}|${end.toISOString()}`;
  const cached = cacheByRange.get(cacheKey);
  if (!force && cached && Date.now() - cached.builtAt < CACHE_MS) {
    return { ...cached.data, fromCache: true, ageMs: Date.now() - cached.builtAt };
  }

  // Stale-while-revalidate: if !force AND any cache exists (exact or nearest),
  // serve it IMMEDIATELY and refresh in the background. Otherwise a frontend
  // HTTP timeout (~30s) would fire before our Azure retry cycle (up to 90s on
  // 429) completes — surfacing "Network Error" even when we have valid stale
  // data. Force=1 (the Sync now button) still does a foreground fetch.
  // Patched 2026-05-21: extended SWR to also serve force=1 when cache exists.
  // Previously force=1 did foreground fetch which timed out on 429-throttled syncs.
  // Now force=1 returns cached data immediately + kicks background refresh; client polls.
  if (cacheByRange.size > 0) {
    const nearest = cached || [...cacheByRange.values()].sort((a, b) => b.builtAt - a.builtAt)[0];
    // Fire-and-forget background refresh (don't wait, don't surface errors)
    if (!inFlightByRange.has(cacheKey)) {
      const bg = (async () => {
        const [azure, aws, gcp, oci] = await Promise.all([
          buildAzureTree(start, end), buildAwsTree(start, end), buildGcpTree(start, end), buildOciTree(start, end),
        ]);
        return {
          totalSpendInr: round2(azure.totalInr + aws.totalInr + gcp.totalInr + oci.totalInr),
          period: { from: start.toISOString(), to: end.toISOString(), days: Math.round((end - start) / 86400000) },
          lastSynced: new Date().toISOString(),
          azure, aws, gcp, oci,
        };
      })();
      inFlightByRange.set(cacheKey, bg);
      bg.then(data => {
        cacheByRange.set(cacheKey, { data, builtAt: Date.now() });
        if (cacheByRange.size > 8) {
          const oldest = [...cacheByRange.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0][0];
          cacheByRange.delete(oldest);
        }
        persistCacheToDisk();
      }).catch(err => { logger.warn(`[costCenter] background refresh failed: ${err.message}`); })
        .finally(() => { inFlightByRange.delete(cacheKey); });
    }
    return { ...nearest.data, fromCache: true, ageMs: Date.now() - nearest.builtAt, swr: true, refreshing: inFlightByRange.has(cacheKey) };
  }

  // De-duplicate concurrent in-flight builds: if the same range is already
  // being fetched, return the in-flight promise rather than starting another
  // (which would just hit the same 429 throttle).
  if (inFlightByRange.has(cacheKey)) {
    try {
      const data = await inFlightByRange.get(cacheKey);
      return { ...data, fromCache: false, deduped: true };
    } catch (e) { /* fall through to fresh attempt below */ }
  }

  const buildPromise = (async () => {
    const [azure, aws, gcp, oci] = await Promise.all([
      buildAzureTree(start, end),
      buildAwsTree(start, end),
      buildGcpTree(start, end),
      buildOciTree(start, end),
    ]);
    return {
      totalSpendInr: round2(azure.totalInr + aws.totalInr + gcp.totalInr + oci.totalInr),
      period: { from: start.toISOString(), to: end.toISOString(), days: Math.round((end - start) / 86400000) },
      lastSynced: new Date().toISOString(),
      azure, aws, gcp, oci,
    };
  })();
  inFlightByRange.set(cacheKey, buildPromise);

  let data;
  try {
    data = await buildPromise;
  } catch (err) {
    // Azure Cost Mgmt rate-limited (429) and our retries inside buildAzureTree
    // gave up. Rather than show "Network Error" to the user, serve the most
    // recent known-good data we have — exact-key match first, then any other
    // cached range (a day-old "this month" snapshot is fine; the date range
    // changes daily so the exact key is often empty even when a near-equivalent
    // cache exists). Frontend already renders fromCache as a stale banner.
    let stale = cacheByRange.get(cacheKey);
    if (!stale && cacheByRange.size > 0) {
      // pick the newest cached entry across all keys
      stale = [...cacheByRange.values()].sort((a, b) => b.builtAt - a.builtAt)[0];
      if (stale) logger.warn(`[costCenter] 429 + no exact-key cache; falling back to nearest entry (built ${new Date(stale.builtAt).toISOString()})`);
    }
    if (stale) {
      return { ...stale.data, fromCache: true, stale: true, ageMs: Date.now() - stale.builtAt, throttleNote: 'Azure Cost API is throttled right now — showing last successful sync. Try again in a few minutes.' };
    }
    throw err;
  } finally {
    inFlightByRange.delete(cacheKey);
  }

  cacheByRange.set(cacheKey, { data, builtAt: Date.now() });
  // Evict old keys (keep last 8 ranges).
  if (cacheByRange.size > 8) {
    const oldest = [...cacheByRange.entries()].sort((a, b) => a[1].builtAt - b[1].builtAt)[0][0];
    cacheByRange.delete(oldest);
  }
  persistCacheToDisk();
  return data;
}

module.exports = { getCostCenter };
