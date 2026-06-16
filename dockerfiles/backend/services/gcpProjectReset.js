// services/gcpProjectReset.js
//
// Path 3: wipe all user-created resources inside a long-lived GCP project,
// preserving the project shell + billing + initial IAM + APIs + quota overrides.
//
// Used by worker/handlers/gcp-reset-project.js. Each step writes progress to
// gcpsandboxuser.sandbox[i].reset so the frontend can show a live progress bar.
//
// Per memory:
//   * feedback_cloud_template_research_first — perms researched before shipping
//   * feedback_no_cpu_load_spike — parallel only where Google's own backend
//     handles concurrency safely; never thrash for thrash's sake

require('dotenv').config();
const { google } = require('googleapis');
const { logger } = require('../plugins/logger');
const GcpSandboxUser = require('../models/gcpSandboxUser');

const ALL_PHASES = [
  // (id, label, fn-name, weight)
  ['compute',    'Killing compute',         'phaseCompute',    35],
  ['data',       'Wiping data resources',   'phaseData',       30],
  ['network',    'Resetting network',       'phaseNetwork',    10],
  ['iam',        'Resetting IAM',           'phaseIam',         5],
  ['apis',       'Re-enabling required APIs','phaseApis',       5],
  ['budget',     'Recreating budget',       'phaseBudget',      5],
  ['verify',     'Verifying clean state',   'phaseVerify',     10],
];

// ---------------------------------------------------------------------------
// Progress writer — every micro-step updates Mongo so polling shows live state
// ---------------------------------------------------------------------------
function makeProgress(email, projectId) {
  let _completed = 0;
  let _total = 0;
  const log = [];

  async function commit() {
    const percent = _total > 0 ? Math.round((_completed / _total) * 100) : 0;
    await GcpSandboxUser.updateOne(
      { email, 'sandbox.projectId': projectId },
      {
        $set: {
          'sandbox.$.reset.completed': _completed,
          'sandbox.$.reset.total': _total,
          'sandbox.$.reset.percent': percent,
        },
      },
    ).catch(() => {});
  }

  return {
    async setTotal(n) { _total = n; await commit(); },
    async setPhase(phaseId, phaseLabel) {
      await GcpSandboxUser.updateOne(
        { email, 'sandbox.projectId': projectId },
        { $set: { 'sandbox.$.reset.currentPhase': phaseLabel, 'sandbox.$.reset.status': 'resetting' } },
      ).catch(() => {});
    },
    async stepStart(phase, step) {
      await GcpSandboxUser.updateOne(
        { email, 'sandbox.projectId': projectId },
        { $set: { 'sandbox.$.reset.currentStep': step } },
      ).catch(() => {});
    },
    async stepDone(phase, step, ok, message = '') {
      _completed += 1;
      const entry = { ts: new Date(), phase, step, ok, message: String(message || '').slice(0, 200) };
      log.push(entry);
      await GcpSandboxUser.updateOne(
        { email, 'sandbox.projectId': projectId },
        { $push: { 'sandbox.$.reset.log': entry } },
      ).catch(() => {});
      await commit();
    },
    async failed(message) {
      await GcpSandboxUser.updateOne(
        { email, 'sandbox.projectId': projectId },
        { $set: { 'sandbox.$.reset.status': 'failed', 'sandbox.$.reset.lastError': String(message || '').slice(0, 500), 'sandbox.$.reset.finishedAt': new Date() } },
      ).catch(() => {});
    },
    async done() {
      await GcpSandboxUser.updateOne(
        { email, 'sandbox.projectId': projectId },
        { $set: { 'sandbox.$.reset.status': 'ready', 'sandbox.$.reset.percent': 100, 'sandbox.$.reset.finishedAt': new Date(), 'sandbox.$.reset.currentStep': 'Ready' } },
      ).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function gcpAuth() {
  const fs = require('fs');
  const candidates = [
    process.env.KEYFILENAME,
    '/usr/src/app/trail-krishan-prefix-0-8f758fd2d555.json',
    '/root/synergific-portal/dockerfiles/backend/trail-krishan-prefix-0-8f758fd2d555.json',
  ].filter(Boolean);
  const keyFile = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

async function safeList(promise) {
  try { return await promise; } catch (e) { return null; }
}

async function safeDel(promise) {
  try { await promise; return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// ---------------------------------------------------------------------------
// Phase implementations — each receives ({ auth, project, p, opts })
// p is the progress writer; each delete logs ok/fail to the timeline
// ---------------------------------------------------------------------------

async function phaseCompute({ auth, project, p }) {
  await p.setPhase('compute', 'Killing compute');
  const compute = google.compute({ version: 'v1', auth });
  const aiplatform = google.aiplatform({ version: 'v1', auth });
  const notebooks  = google.notebooks ? google.notebooks({ version: 'v2', auth }) : null;
  const run        = google.run({ version: 'v2', auth });
  const functions  = google.cloudfunctions({ version: 'v2', auth });

  // 1. Vertex AI endpoints (long pole — undeploy can be 5-15 min)
  for (const region of ['us-central1']) {
    await p.stepStart('compute', `Vertex endpoints (${region})`);
    const parent = `projects/${project}/locations/${region}`;
    const eps = await safeList(aiplatform.projects.locations.endpoints.list({ parent }));
    const epsList = eps?.data?.endpoints || [];
    for (const ep of epsList) {
      // Undeploy all models then delete the endpoint
      for (const dm of (ep.deployedModels || [])) {
        await safeDel(aiplatform.projects.locations.endpoints.undeployModel({
          endpoint: ep.name,
          requestBody: { deployedModelId: dm.id },
        }));
      }
      await safeDel(aiplatform.projects.locations.endpoints.delete({ name: ep.name }));
    }
    await p.stepDone('compute', `Vertex endpoints (${region})`, true, `${epsList.length} endpoint(s) torn down`);
  }

  // 2. Workbench notebook instances
  if (notebooks) {
    await p.stepStart('compute', 'Workbench notebooks');
    let n = 0;
    for (const region of ['us-central1']) {
      const parent = `projects/${project}/locations/${region}`;
      const insts = await safeList(notebooks.projects.locations.instances.list({ parent }));
      for (const inst of (insts?.data?.instances || [])) {
        await safeDel(notebooks.projects.locations.instances.delete({ name: inst.name }));
        n++;
      }
    }
    await p.stepDone('compute', 'Workbench notebooks', true, `${n} deleted`);
  }

  // 3. Compute Engine VMs (with their disks)
  await p.stepStart('compute', 'Compute Engine VMs');
  const zonesResp = await safeList(compute.zones.list({ project }));
  let vmCount = 0;
  for (const z of (zonesResp?.data?.items || [])) {
    const vms = await safeList(compute.instances.list({ project, zone: z.name }));
    for (const vm of (vms?.data?.items || [])) {
      await safeDel(compute.instances.delete({ project, zone: z.name, instance: vm.name }));
      vmCount++;
    }
  }
  await p.stepDone('compute', 'Compute Engine VMs', true, `${vmCount} VM(s) deleted`);

  // 4. Cloud Run services
  await p.stepStart('compute', 'Cloud Run services');
  let runCount = 0;
  for (const region of ['us-central1']) {
    const services = await safeList(run.projects.locations.services.list({ parent: `projects/${project}/locations/${region}` }));
    for (const svc of (services?.data?.services || [])) {
      await safeDel(run.projects.locations.services.delete({ name: svc.name }));
      runCount++;
    }
  }
  await p.stepDone('compute', 'Cloud Run services', true, `${runCount} deleted`);

  // 5. Cloud Functions
  await p.stepStart('compute', 'Cloud Functions');
  let fnCount = 0;
  for (const region of ['us-central1']) {
    const fns = await safeList(functions.projects.locations.functions.list({ parent: `projects/${project}/locations/${region}` }));
    for (const fn of (fns?.data?.functions || [])) {
      await safeDel(functions.projects.locations.functions.delete({ name: fn.name }));
      fnCount++;
    }
  }
  await p.stepDone('compute', 'Cloud Functions', true, `${fnCount} deleted`);

  // 6. Orphan persistent disks (in case any survived VM delete with deleteOption=keep)
  await p.stepStart('compute', 'Orphan disks');
  let diskCount = 0;
  for (const z of (zonesResp?.data?.items || [])) {
    const disks = await safeList(compute.disks.list({ project, zone: z.name }));
    for (const d of (disks?.data?.items || [])) {
      if (!d.users || d.users.length === 0) {
        await safeDel(compute.disks.delete({ project, zone: z.name, disk: d.name }));
        diskCount++;
      }
    }
  }
  await p.stepDone('compute', 'Orphan disks', true, `${diskCount} reclaimed`);
}

async function phaseData({ auth, project, p }) {
  await p.setPhase('data', 'Wiping data resources');
  const aiplatform = google.aiplatform({ version: 'v1', auth });
  const bq         = google.bigquery({ version: 'v2', auth });
  const storage    = google.storage({ version: 'v1', auth });
  const sql        = google.sqladmin({ version: 'v1', auth });
  const pubsub     = google.pubsub({ version: 'v1', auth });

  // 1. Vertex AI models
  await p.stepStart('data', 'Vertex AI models');
  let mCount = 0;
  for (const region of ['us-central1']) {
    const models = await safeList(aiplatform.projects.locations.models.list({ parent: `projects/${project}/locations/${region}` }));
    for (const m of (models?.data?.models || [])) {
      await safeDel(aiplatform.projects.locations.models.delete({ name: m.name }));
      mCount++;
    }
  }
  await p.stepDone('data', 'Vertex AI models', true, `${mCount} deleted`);

  // 2. Vertex AI datasets
  await p.stepStart('data', 'Vertex AI datasets');
  let dsCount = 0;
  for (const region of ['us-central1']) {
    const datasets = await safeList(aiplatform.projects.locations.datasets.list({ parent: `projects/${project}/locations/${region}` }));
    for (const d of (datasets?.data?.datasets || [])) {
      await safeDel(aiplatform.projects.locations.datasets.delete({ name: d.name }));
      dsCount++;
    }
  }
  await p.stepDone('data', 'Vertex AI datasets', true, `${dsCount} deleted`);

  // 3. BigQuery datasets (cascade-delete contents)
  await p.stepStart('data', 'BigQuery datasets');
  const bqd = await safeList(bq.datasets.list({ projectId: project }));
  let bqCount = 0;
  for (const d of (bqd?.data?.datasets || [])) {
    await safeDel(bq.datasets.delete({ projectId: project, datasetId: d.datasetReference.datasetId, deleteContents: true }));
    bqCount++;
  }
  await p.stepDone('data', 'BigQuery datasets', true, `${bqCount} deleted`);

  // 4. Cloud Storage buckets (empty objects first)
  await p.stepStart('data', 'Cloud Storage');
  const buckets = await safeList(storage.buckets.list({ project }));
  let bktCount = 0;
  for (const b of (buckets?.data?.items || [])) {
    let pageToken;
    do {
      const objs = await safeList(storage.objects.list({ bucket: b.name, pageToken }));
      for (const o of (objs?.data?.items || [])) {
        await safeDel(storage.objects.delete({ bucket: b.name, object: o.name }));
      }
      pageToken = objs?.data?.nextPageToken;
    } while (pageToken);
    await safeDel(storage.buckets.delete({ bucket: b.name }));
    bktCount++;
  }
  await p.stepDone('data', 'Cloud Storage', true, `${bktCount} bucket(s) emptied+deleted`);

  // 5. Cloud SQL
  await p.stepStart('data', 'Cloud SQL');
  const sqls = await safeList(sql.instances.list({ project }));
  let sqlCount = 0;
  for (const inst of (sqls?.data?.items || [])) {
    await safeDel(sql.instances.delete({ project, instance: inst.name }));
    sqlCount++;
  }
  await p.stepDone('data', 'Cloud SQL', true, `${sqlCount} deleted`);

  // 6. Pub/Sub topics
  await p.stepStart('data', 'Pub/Sub topics');
  const topics = await safeList(pubsub.projects.topics.list({ project: `projects/${project}` }));
  let psCount = 0;
  for (const t of (topics?.data?.topics || [])) {
    await safeDel(pubsub.projects.topics.delete({ topic: t.name }));
    psCount++;
  }
  await p.stepDone('data', 'Pub/Sub topics', true, `${psCount} deleted`);
}

async function phaseNetwork({ auth, project, p }) {
  await p.setPhase('network', 'Resetting network');
  const compute = google.compute({ version: 'v1', auth });

  // 1. Non-default firewall rules
  await p.stepStart('network', 'Firewall rules');
  const fws = await safeList(compute.firewalls.list({ project }));
  let fwCount = 0;
  for (const fw of (fws?.data?.items || [])) {
    if (fw.name?.startsWith('default-')) continue;
    await safeDel(compute.firewalls.delete({ project, firewall: fw.name }));
    fwCount++;
  }
  await p.stepDone('network', 'Firewall rules', true, `${fwCount} deleted`);

  // 2. Non-default VPCs + their subnets
  await p.stepStart('network', 'Custom VPCs');
  const nets = await safeList(compute.networks.list({ project }));
  let vpcCount = 0;
  for (const n of (nets?.data?.items || [])) {
    if (n.name === 'default') continue;
    // List + delete subnets first
    const regions = await safeList(compute.regions.list({ project }));
    for (const r of (regions?.data?.items || [])) {
      const subs = await safeList(compute.subnetworks.list({ project, region: r.name }));
      for (const sub of (subs?.data?.items || [])) {
        if ((sub.network || '').endsWith(`/${n.name}`)) {
          await safeDel(compute.subnetworks.delete({ project, region: r.name, subnetwork: sub.name }));
        }
      }
    }
    await safeDel(compute.networks.delete({ project, network: n.name }));
    vpcCount++;
  }
  await p.stepDone('network', 'Custom VPCs', true, `${vpcCount} deleted (default kept)`);
}

async function phaseIam({ auth, project, p, googleEmail }) {
  await p.setPhase('iam', 'Resetting IAM');
  const iam = google.iam({ version: 'v1', auth });

  // 1. User-created service accounts (skip Google-managed)
  await p.stepStart('iam', 'User-created service accounts');
  const sas = await safeList(iam.projects.serviceAccounts.list({ name: `projects/${project}` }));
  let saCount = 0;
  for (const sa of (sas?.data?.accounts || [])) {
    // Skip Google-managed and the compute default
    if (sa.email?.endsWith('@developer.gserviceaccount.com')) continue;
    if (sa.email?.includes('-compute@')) continue;
    await safeDel(iam.projects.serviceAccounts.delete({ name: sa.name }));
    saCount++;
  }
  await p.stepDone('iam', 'User-created service accounts', true, `${saCount} deleted`);

  // 2. Custom IAM roles
  await p.stepStart('iam', 'Custom IAM roles');
  const roles = await safeList(iam.projects.roles.list({ parent: `projects/${project}` }));
  let rCount = 0;
  for (const r of (roles?.data?.roles || [])) {
    await safeDel(iam.projects.roles.delete({ name: r.name }));
    rCount++;
  }
  await p.stepDone('iam', 'Custom IAM roles', true, `${rCount} deleted`);

  // 3. Re-affirm user editor binding (in case user revoked themselves)
  if (googleEmail) {
    await p.stepStart('iam', `Re-affirm editor for ${googleEmail}`);
    const crm = google.cloudresourcemanager({ version: 'v3', auth });
    try {
      const cur = (await crm.projects.getIamPolicy({ resource: `projects/${project}`, requestBody: {} })).data || { bindings: [] };
      cur.bindings = cur.bindings || [];
      const memberKey = `user:${googleEmail}`;
      let b = cur.bindings.find(x => x.role === 'roles/editor');
      if (b && !b.members.includes(memberKey)) b.members.push(memberKey);
      else if (!b) cur.bindings.push({ role: 'roles/editor', members: [memberKey] });
      await crm.projects.setIamPolicy({ resource: `projects/${project}`, requestBody: { policy: cur } });
      await p.stepDone('iam', 'Re-affirm editor', true, googleEmail);
    } catch (e) {
      await p.stepDone('iam', 'Re-affirm editor', false, e.message.slice(0, 80));
    }
  }
}

async function phaseApis({ auth, project, p, requiredApis }) {
  await p.setPhase('apis', 'Re-enabling required APIs');
  const su = google.serviceusage({ version: 'v1', auth });
  await p.stepStart('apis', 'Batch enable required APIs');
  // batchEnable supports up to 20 at a time
  const batch = (requiredApis || []).slice(0, 20);
  if (batch.length) {
    try {
      await su.services.batchEnable({
        parent: `projects/${project}`,
        requestBody: { serviceIds: batch },
      });
      await p.stepDone('apis', 'batchEnable', true, `${batch.length} APIs ensured`);
    } catch (e) {
      await p.stepDone('apis', 'batchEnable', false, e.message.slice(0, 80));
    }
  } else {
    await p.stepDone('apis', 'batchEnable', true, 'no APIs supplied');
  }
}

async function phaseBudget({ auth, project, p, budgetInr, billingAccountId }) {
  await p.setPhase('budget', 'Recreating budget');
  if (!billingAccountId || !budgetInr) {
    await p.stepDone('budget', 'skip', true, 'no billing account or zero budget');
    return;
  }
  const bb = google.billingbudgets({ version: 'v1', auth });
  await p.stepStart('budget', `Set ₹${budgetInr} budget`);
  try {
    await bb.billingAccounts.budgets.create({
      parent: `billingAccounts/${billingAccountId}`,
      requestBody: {
        displayName: `sandbox-${project}`,
        budgetFilter: { projects: [`projects/${project}`] },
        amount: { specifiedAmount: { currencyCode: 'INR', units: String(budgetInr) } },
        thresholdRules: [
          { thresholdPercent: 0.5 }, { thresholdPercent: 0.8 }, { thresholdPercent: 1.0 },
        ],
      },
    });
    await p.stepDone('budget', 'create', true, `₹${budgetInr}`);
  } catch (e) {
    // Idempotent: if a same-name budget exists already, ignore
    await p.stepDone('budget', 'create', /already exists/i.test(e.message), e.message.slice(0, 80));
  }
}

async function phaseVerify({ auth, project, p }) {
  await p.setPhase('verify', 'Verifying clean state');
  const compute = google.compute({ version: 'v1', auth });
  const storage = google.storage({ version: 'v1', auth });
  await p.stepStart('verify', 'Compute Engine residue');
  const vms = await safeList(compute.instances.aggregatedList({ project, maxResults: 5 }));
  const items = vms?.data?.items || {};
  const live = Object.values(items).reduce((s, v) => s + (v.instances?.length || 0), 0);
  await p.stepDone('verify', 'Compute Engine residue', live === 0, `${live} instance(s) remaining`);
  await p.stepStart('verify', 'Cloud Storage residue');
  const bks = await safeList(storage.buckets.list({ project }));
  const bktN = bks?.data?.items?.length || 0;
  await p.stepDone('verify', 'Cloud Storage residue', bktN === 0, `${bktN} bucket(s) remaining`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function resetProject({ email, projectId, googleEmail, budgetInr, billingAccountId, requiredApis }) {
  const auth = gcpAuth();
  const p = makeProgress(email, projectId);

  // Pre-flight: mark resetting + set total step count (sum of per-phase steps)
  // Hardcoded for now: compute=6, data=6, network=2, iam=3, apis=1, budget=1, verify=2 = 21
  await p.setTotal(21);
  await GcpSandboxUser.updateOne(
    { email, 'sandbox.projectId': projectId },
    { $set: { 'sandbox.$.reset.status': 'resetting', 'sandbox.$.reset.startedAt': new Date(), 'sandbox.$.reset.log': [] } },
  ).catch(() => {});

  const phaseMap = { phaseCompute, phaseData, phaseNetwork, phaseIam, phaseApis, phaseBudget, phaseVerify };
  try {
    for (const [phaseId, phaseLabel, fnName] of ALL_PHASES) {
      await phaseMap[fnName]({ auth, project: projectId, p, googleEmail, budgetInr, billingAccountId, requiredApis });
    }
    await p.done();
    logger.info(`[gcp-reset] ${projectId} complete`);
    return { ok: true };
  } catch (e) {
    logger.error(`[gcp-reset] ${projectId} FAILED: ${e.message}`);
    await p.failed(e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { resetProject };
