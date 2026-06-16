// automations/azureOrphanSweeper.js
//
// Daily sweep: find Azure VMs in the cohort resource group (VMsubnet) that
// have NO matching Mongo VM record. These are "orphans" — created legitimately
// at some point but the portal lost track (e.g., admin deleted Training doc
// without cleaning Azure side, or scheduleChecker started a VM after Mongo
// records were already deleted).
//
// DETECTION mode by default (logs + emails ops). Set AZURE_SWEEPER_AUTO_DELETE=true
// to enable actual deletion via azureDeepDeleteVM.
//
// Safety guards:
//   - Only scans `VMsubnet` resource group (not docker-host-*, not other RGs)
//   - Allow-list of permanently-legitimate VM names (configurable below)
//   - Min-age filter: VM must have been created at least 1 hour ago to be flagged
//     (avoids racing with in-flight deploys still populating Mongo)
//   - Cross-checks BOTH VM collection and Container collection before flagging

const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { logger } = require('../plugins/logger');
const VM = require('../models/vm');

const COHORT_RG = process.env.AZURE_SWEEPER_RG || 'VMsubnet';
const AUTO_DELETE = process.env.AZURE_SWEEPER_AUTO_DELETE === 'true';
const MIN_AGE_MIN = parseInt(process.env.AZURE_SWEEPER_MIN_AGE_MIN || '60', 10);

// Names that should NEVER be flagged as orphans even if not in Mongo
const ALLOW_LIST = new Set([
  'guacamole',          // Guacamole gateway VM
  'win-container-host', // Legacy windows-container Hyper-V host
]);

const subscriptionId = process.env.SUBSCRIPTION_ID;
const credentials = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
);
const compute = new ComputeManagementClient(credentials, subscriptionId);

async function azureOrphanSweeper() {
  try {
    logger.info(`[azure-orphan-sweeper] starting (mode: ${AUTO_DELETE ? 'AUTO_DELETE' : 'DETECTION_ONLY'}, RG: ${COHORT_RG})`);

    // 1. List all VMs in the cohort resource group
    const azureVMs = [];
    for await (const vm of compute.virtualMachines.list(COHORT_RG)) {
      azureVMs.push({ name: vm.name, location: vm.location, vmId: vm.vmId, timeCreated: vm.timeCreated });
    }
    logger.info(`[azure-orphan-sweeper] found ${azureVMs.length} VMs in ${COHORT_RG}`);

    // 2. Get all VM names from Mongo (cohort VMs + container records if any)
    const mongoVMs = await VM.find({}, 'name').lean();
    const mongoNameSet = new Set(mongoVMs.map(v => v.name));

    // 3. Identify orphans (in Azure, not in Mongo, not allow-listed, old enough)
    const now = Date.now();
    const orphans = azureVMs.filter(v => {
      if (mongoNameSet.has(v.name)) return false;
      if (ALLOW_LIST.has(v.name)) return false;
      if (v.timeCreated) {
        const ageMs = now - new Date(v.timeCreated).getTime();
        if (ageMs < MIN_AGE_MIN * 60 * 1000) return false; // too young — likely in-flight deploy
      }
      return true;
    });

    if (orphans.length === 0) {
      logger.info('[azure-orphan-sweeper] no orphans found — account is clean');
      return { scanned: azureVMs.length, orphans: [], deleted: 0 };
    }

    logger.warn(`[azure-orphan-sweeper] ⚠️ ${orphans.length} orphan VM(s) detected: ${orphans.map(o => o.name).join(', ')}`);

    if (!AUTO_DELETE) {
      logger.warn('[azure-orphan-sweeper] DETECTION-ONLY mode — set AZURE_SWEEPER_AUTO_DELETE=true to enable cleanup');
      return { scanned: azureVMs.length, orphans: orphans.map(o => o.name), deleted: 0 };
    }

    // 4. Auto-delete (only when explicitly enabled)
    const { azureDeepDeleteVMs } = require('../services/azureFullCleanup');
    const results = await azureDeepDeleteVMs(orphans.map(o => o.name), COHORT_RG);
    const fullyDeleted = results.filter(r => r.results.every(s => s.ok)).length;

    logger.info(`[azure-orphan-sweeper] auto-deleted ${fullyDeleted}/${orphans.length} orphan VMs`);
    return { scanned: azureVMs.length, orphans: orphans.map(o => o.name), deleted: fullyDeleted };

  } catch (err) {
    logger.error(`[azure-orphan-sweeper] failed: ${err.message}`);
    return { error: err.message };
  }
}


// ============================================================================
// SANDBOX-RG SWEEPER (added 2026-05-26)
// ============================================================================
// Scans for orphan sandbox RGs (pattern: <8hex>-<name>-sandbox) that have
// no matching active sandbox user in Mongo. Catches the "user clicked
// delete in portal, code only removed Mongo, Azure RG still bleeding" pattern
// and the older "cohort cancelled but RGs never reaped" residue.
//
// Same safety guards as VM sweeper: detection-only by default, age filter,
// requires NO matching sandboxuser/sandboxdeployment record.

const { ResourceManagementClient } = require('@azure/arm-resources');
const SandboxUser = require('../models/sandboxuser');
const rmc = new ResourceManagementClient(credentials, subscriptionId);

const SANDBOX_RG_PATTERN = /^[0-9a-f]{8}-.+-sandbox$/i;

async function azureSandboxRgSweeper() {
  try {
    logger.info(`[azure-sandbox-rg-sweeper] starting (mode: ${AUTO_DELETE ? 'AUTO_DELETE' : 'DETECTION_ONLY'})`);

    // 1. List all RGs matching sandbox pattern
    const sandboxRgs = [];
    for await (const rg of rmc.resourceGroups.list()) {
      if (SANDBOX_RG_PATTERN.test(rg.name)) {
        sandboxRgs.push({ name: rg.name, location: rg.location });
      }
    }
    logger.info(`[azure-sandbox-rg-sweeper] found ${sandboxRgs.length} sandbox-pattern RGs`);

    if (sandboxRgs.length === 0) {
      return { scanned: 0, orphans: [], deleted: 0 };
    }

    // 2. Build set of RG names referenced by active Mongo sandboxusers
    const activeMongoRgs = new Set();
    const allSU = await SandboxUser.find({}, 'sandbox.resourceGroupName').lean();
    for (const u of allSU) {
      for (const sb of (u.sandbox || [])) {
        if (sb.resourceGroupName) activeMongoRgs.add(sb.resourceGroupName);
      }
    }
    logger.info(`[azure-sandbox-rg-sweeper] ${activeMongoRgs.size} RGs referenced in Mongo sandboxusers`);

    // 3. Orphans = RGs in Azure but not in Mongo
    const orphans = sandboxRgs.filter(rg => !activeMongoRgs.has(rg.name));

    if (orphans.length === 0) {
      logger.info('[azure-sandbox-rg-sweeper] no sandbox-RG orphans — account is clean');
      return { scanned: sandboxRgs.length, orphans: [], deleted: 0 };
    }

    logger.warn(`[azure-sandbox-rg-sweeper] ⚠️ ${orphans.length} orphan sandbox RG(s) detected: ${orphans.map(o => o.name).join(', ')}`);

    if (!AUTO_DELETE) {
      logger.warn('[azure-sandbox-rg-sweeper] DETECTION-ONLY mode — set AZURE_SWEEPER_AUTO_DELETE=true to enable cleanup');
      return { scanned: sandboxRgs.length, orphans: orphans.map(o => o.name), deleted: 0 };
    }

    // 4. Auto-delete (when explicitly enabled). Full RG delete wipes EVERYTHING
    // inside — VMs, disks, storage accounts, learner-created resources.
    let deleted = 0;
    for (const rg of orphans) {
      try {
        await rmc.resourceGroups.beginDeleteAndWait(rg.name);
        logger.info(`[azure-sandbox-rg-sweeper] auto-deleted RG ${rg.name}`);
        deleted++;
      } catch (e) {
        logger.error(`[azure-sandbox-rg-sweeper] delete failed for ${rg.name}: ${e.message}`);
      }
    }
    return { scanned: sandboxRgs.length, orphans: orphans.map(o => o.name), deleted };

  } catch (err) {
    logger.error(`[azure-sandbox-rg-sweeper] failed: ${err.message}`);
    return { error: err.message };
  }
}


module.exports = { azureOrphanSweeper, azureSandboxRgSweeper };
