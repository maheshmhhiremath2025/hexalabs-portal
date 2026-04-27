/**
 * Seed the Oracle Analytics Cloud sandbox template into the database.
 * Run once: node scripts/seed-oac-template.js
 */
require('dotenv').config();
const { connectMongoDB } = require('../connection');
const SandboxTemplate = require('../models/sandboxTemplate');

const template = {
  name: 'Oracle Analytics Cloud Lab',
  slug: 'oac-analytics-lab',
  cloud: 'oci',
  description: 'Hands-on Oracle Analytics Cloud — build dashboards, data visualizations, and reports using OAC with sample datasets. Students access a shared OAC instance via OCI Console.',
  certificationCode: 'OAC-Lab',
  certificationLevel: 'associate',
  sandboxConfig: {
    ttlHours: 4,
    budgetInr: 300,
    region: 'ap-hyderabad-1',
    dailyCapHours: 8,
    totalCapHours: 36,
    maxInstances: 1,
  },
  allowedServices: [
    { service: 'Analytics Cloud', category: 'Analytics', actions: ['CreateAnalyticsInstance', 'GetAnalyticsInstance', 'ListAnalyticsInstances', 'UpdateAnalyticsInstance'], restrictions: 'Access shared pre-provisioned OAC instance only' },
    { service: 'Autonomous Database', category: 'Database', actions: ['CreateAutonomousDatabase', 'GetAutonomousDatabase'], restrictions: 'ATP/ADW Free Tier or shared instance only' },
    { service: 'Object Storage', category: 'Storage', actions: ['CreateBucket', 'PutObject', 'GetObject', 'ListObjects'], restrictions: 'Max 2 buckets, 5 GB total — for uploading datasets' },
    { service: 'Cloud Shell', category: 'Management', actions: [], restrictions: 'Full access — browser-based terminal' },
    { service: 'IAM', category: 'Security', actions: ['ListPolicies', 'GetUser'], restrictions: 'Read-only — view own permissions' },
    { service: 'Data Integration', category: 'Analytics', actions: ['CreateWorkspace', 'CreateDataFlow'], restrictions: 'Basic data flows for loading data into OAC' },
  ],
  blockedServices: [
    { service: 'Compute', reason: 'Not needed — OAC is managed service' },
    { service: 'Exadata', reason: 'Cost control' },
    { service: 'Data Science', reason: 'Not in scope — use OAC built-in ML' },
    { service: 'GoldenGate', reason: 'Not in scope' },
    { service: 'FastConnect', reason: 'Networking not needed' },
    { service: 'Bare Metal', reason: 'Cost control' },
    { service: 'GPU Instances', reason: 'Cost control' },
    { service: 'OKE (Kubernetes)', reason: 'Not in scope' },
  ],
};

async function seed() {
  await connectMongoDB(process.env.MONGO_URI);

  const existing = await SandboxTemplate.findOne({ slug: template.slug });
  if (existing) {
    await SandboxTemplate.updateOne({ slug: template.slug }, { $set: template });
    console.log('Template updated:', template.slug);
  } else {
    await SandboxTemplate.create(template);
    console.log('Template created:', template.slug);
  }

  process.exit(0);
}

seed().catch(e => { console.error(e.message); process.exit(1); });
