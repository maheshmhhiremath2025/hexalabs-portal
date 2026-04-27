/**
 * Oracle Analytics Cloud (OAC) Lab Manager
 *
 * Provisions and destroys shared OAC instances for training batches.
 * Each training batch gets ONE OAC instance that all students share.
 * Students are created as OCI IAM users with access to the shared compartment.
 *
 * Usage:
 *   node scripts/oac-lab-manager.js provision --name "batch-apr-2026" --region ap-hyderabad-1 --ocpus 2
 *   node scripts/oac-lab-manager.js status --name "batch-apr-2026"
 *   node scripts/oac-lab-manager.js destroy --name "batch-apr-2026"
 *
 * The OCI sandbox template (oac-analytics-lab) handles per-student IAM user creation
 * via the standard bulk-deploy flow. This script only manages the shared OAC instance.
 */
require('dotenv').config();
const { logger } = require('../plugins/logger');

let ociSdkAvailable = false;
let identity, common, analytics;
try {
  identity = require('oci-identity');
  common = require('oci-common');
  analytics = require('oci-analytics');
  ociSdkAvailable = true;
} catch {
  console.error('oci-sdk or oci-analytics not installed. Run: npm install oci-analytics');
  process.exit(1);
}

// Reuse the provider from ociSandbox
let _rsaKeyContent = null;
function getProvider() {
  const tenancyId = process.env.OCI_TENANCY_OCID;
  const userId = process.env.OCI_USER_OCID;
  const fingerprint = process.env.OCI_FINGERPRINT;
  const privateKeyBase64 = process.env.OCI_PRIVATE_KEY;
  const region = process.env.OCI_REGION || 'ap-hyderabad-1';

  if (!tenancyId || !userId || !fingerprint || !privateKeyBase64) {
    console.error('OCI credentials not configured in .env');
    process.exit(1);
  }

  if (!_rsaKeyContent) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    if (pem.includes('BEGIN PRIVATE KEY') && !pem.includes('BEGIN RSA PRIVATE KEY')) {
      try {
        const { execSync } = require('child_process');
        const inPath = path.join(os.tmpdir(), '.oci_pk8.pem');
        const outPath = path.join(os.tmpdir(), '.oci_rsa.pem');
        fs.writeFileSync(inPath, pem, { mode: 0o600 });
        execSync(`openssl rsa -in "${inPath}" -out "${outPath}" -traditional 2>/dev/null`);
        _rsaKeyContent = fs.readFileSync(outPath, 'utf8');
        fs.unlinkSync(inPath);
        fs.unlinkSync(outPath);
      } catch {
        _rsaKeyContent = pem;
      }
    } else {
      _rsaKeyContent = pem;
    }
  }

  return new common.SimpleAuthenticationDetailsProvider(
    process.env.OCI_TENANCY_OCID,
    process.env.OCI_USER_OCID,
    process.env.OCI_FINGERPRINT,
    _rsaKeyContent,
    null,
    common.Region.fromRegionId(process.env.OCI_REGION || 'ap-hyderabad-1')
  );
}

async function provisionOac(batchName, region, ocpus = 2) {
  const provider = getProvider();
  const identityClient = new identity.IdentityClient({ authenticationDetailsProvider: provider });
  const analyticsClient = new analytics.AnalyticsClient({ authenticationDetailsProvider: provider });

  const parentCompartmentId = process.env.OCI_PARENT_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID;
  const compartmentName = `oac-lab-${batchName}`;

  // 1. Create shared compartment for this training batch
  console.log(`1. Creating compartment: ${compartmentName}`);
  const compartmentResponse = await identityClient.createCompartment({
    createCompartmentDetails: {
      compartmentId: parentCompartmentId,
      name: compartmentName,
      description: `Oracle Analytics Cloud lab — ${batchName}`,
    },
  });
  const compartmentId = compartmentResponse.compartment.id;
  console.log(`   Compartment: ${compartmentId}`);

  // Wait for compartment to propagate
  console.log('   Waiting for compartment propagation (30s)...');
  await new Promise(r => setTimeout(r, 30000));

  // 2. Provision OAC instance
  console.log(`2. Provisioning OAC instance (${ocpus} OCPUs, Professional edition)...`);
  console.log('   This takes ~20 minutes...');

  const oacResponse = await analyticsClient.createAnalyticsInstance({
    createAnalyticsInstanceDetails: {
      name: `oaclab${batchName.replace(/[^a-z0-9]/gi, '')}`,
      compartmentId: compartmentId,
      featureSet: analytics.models.FeatureSet.EnterpriseAnalytics,
      capacity: {
        capacityType: analytics.models.CapacityType.OlpuCount,
        capacityValue: ocpus,
      },
      licenseType: analytics.models.LicenseType.LicenseIncluded,
      description: `Training batch: ${batchName}`,
      networkEndpointDetails: {
        networkEndpointType: 'PUBLIC',
      },
    },
  });

  const workRequestId = oacResponse.opcWorkRequestId;
  console.log(`   Work request: ${workRequestId}`);

  // 3. Poll until OAC is active
  let oacInstanceId = null;
  let oacUrl = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 30000)); // poll every 30s
    try {
      const instances = await analyticsClient.listAnalyticsInstances({
        compartmentId: compartmentId,
      });
      const inst = instances.items?.find(x => x.lifecycleState === 'ACTIVE');
      if (inst) {
        oacInstanceId = inst.id;
        oacUrl = inst.serviceUrl;
        console.log(`   OAC ACTIVE!`);
        console.log(`   Instance ID: ${oacInstanceId}`);
        console.log(`   URL: ${oacUrl}`);
        break;
      }
      const pending = instances.items?.[0];
      process.stdout.write(`   Status: ${pending?.lifecycleState || 'CREATING'}...\r`);
    } catch (e) {
      process.stdout.write('.');
    }
  }

  if (!oacInstanceId) {
    console.error('OAC instance did not become ACTIVE within 20 minutes. Check OCI console.');
    return;
  }

  // 4. Save batch info to a local JSON file for reference
  const fs = require('fs');
  const batchInfo = {
    batchName,
    compartmentId,
    compartmentName,
    oacInstanceId,
    oacUrl,
    region: region || process.env.OCI_REGION,
    ocpus,
    provisionedAt: new Date().toISOString(),
  };
  const infoPath = `/tmp/oac-batch-${batchName}.json`;
  fs.writeFileSync(infoPath, JSON.stringify(batchInfo, null, 2));

  console.log('');
  console.log('=== OAC Lab Ready ===');
  console.log(`Batch:        ${batchName}`);
  console.log(`Compartment:  ${compartmentId}`);
  console.log(`OAC URL:      ${oacUrl}`);
  console.log(`OCPUs:        ${ocpus}`);
  console.log(`Batch info:   ${infoPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Deploy student sandboxes using template "oac-analytics-lab"');
  console.log('  2. Students log in to OCI Console → navigate to Analytics Cloud');
  console.log('  3. After training: node scripts/oac-lab-manager.js destroy --name ' + batchName);

  return batchInfo;
}

async function destroyOac(batchName) {
  const provider = getProvider();
  const identityClient = new identity.IdentityClient({ authenticationDetailsProvider: provider });
  const analyticsClient = new analytics.AnalyticsClient({ authenticationDetailsProvider: provider });

  const parentCompartmentId = process.env.OCI_PARENT_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID;
  const compartmentName = `oac-lab-${batchName}`;

  // Find the compartment
  console.log(`1. Finding compartment: ${compartmentName}`);
  const compartments = await identityClient.listCompartments({
    compartmentId: parentCompartmentId,
    name: compartmentName,
    lifecycleState: 'ACTIVE',
  });

  if (!compartments.items?.length) {
    console.error(`Compartment "${compartmentName}" not found. Already deleted?`);
    return;
  }

  const compartmentId = compartments.items[0].id;
  console.log(`   Found: ${compartmentId}`);

  // Delete OAC instances in this compartment
  console.log('2. Deleting OAC instances...');
  const instances = await analyticsClient.listAnalyticsInstances({ compartmentId });
  for (const inst of (instances.items || [])) {
    if (inst.lifecycleState === 'ACTIVE' || inst.lifecycleState === 'INACTIVE') {
      console.log(`   Deleting: ${inst.name} (${inst.id})`);
      await analyticsClient.deleteAnalyticsInstance({ analyticsInstanceId: inst.id });
      console.log('   Delete initiated (takes ~10 min in background)');
    }
  }

  // Wait for OAC deletion before deleting compartment
  console.log('3. Waiting for OAC deletion (polling)...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 20000));
    const check = await analyticsClient.listAnalyticsInstances({ compartmentId });
    const remaining = check.items?.filter(x => x.lifecycleState !== 'DELETED');
    if (!remaining?.length) {
      console.log('   All OAC instances deleted');
      break;
    }
    process.stdout.write(`   Waiting... (${remaining[0]?.lifecycleState})\r`);
  }

  // Delete compartment
  console.log('4. Deleting compartment...');
  await identityClient.deleteCompartment({ compartmentId });
  console.log('   Compartment deletion initiated');

  console.log('');
  console.log(`=== OAC Lab "${batchName}" destroyed ===`);
}

// CLI
const args = process.argv.slice(2);
const command = args[0];
const nameIdx = args.indexOf('--name');
const batchName = nameIdx !== -1 ? args[nameIdx + 1] : null;
const regionIdx = args.indexOf('--region');
const region = regionIdx !== -1 ? args[regionIdx + 1] : null;
const ocpuIdx = args.indexOf('--ocpus');
const ocpus = ocpuIdx !== -1 ? parseInt(args[ocpuIdx + 1]) : 2;

if (!command || !batchName) {
  console.log('Usage:');
  console.log('  node scripts/oac-lab-manager.js provision --name "batch-name" [--region ap-hyderabad-1] [--ocpus 2]');
  console.log('  node scripts/oac-lab-manager.js destroy --name "batch-name"');
  process.exit(1);
}

if (command === 'provision') {
  provisionOac(batchName, region, ocpus).catch(e => { console.error('Error:', e.message); process.exit(1); });
} else if (command === 'destroy') {
  destroyOac(batchName).catch(e => { console.error('Error:', e.message); process.exit(1); });
} else {
  console.error('Unknown command:', command);
  process.exit(1);
}
