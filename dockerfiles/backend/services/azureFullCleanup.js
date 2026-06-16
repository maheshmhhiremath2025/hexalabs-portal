// services/azureFullCleanup.js
//
// Deep-delete Azure resources associated with a cohort VM:
//   VM → NIC → disk → public IP → NSG → snapshot
// Used by the portal's training-delete handler and the Azure orphan sweeper
// to ensure no Azure resources persist after a portal-side delete.
//
// Idempotent: 404s ("already gone") are treated as success.
// Order matters: NIC must be deleted before public IP (otherwise IP says
// "still allocated"). VM must be deleted before NIC.

const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { logger } = require('../plugins/logger');

const subscriptionId = process.env.SUBSCRIPTION_ID;
const credentials = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
);
const compute = new ComputeManagementClient(credentials, subscriptionId);
const network = new NetworkManagementClient(credentials, subscriptionId);

// Treat "not found" as success — the goal state is "doesn't exist"
function isNotFound(err) {
  return err && (err.statusCode === 404 || /ResourceNotFound|NotFound/i.test(err.code || err.message || ''));
}

async function safeDelete(label, fn) {
  try {
    await fn();
    return { ok: true, label };
  } catch (err) {
    if (isNotFound(err)) return { ok: true, label, alreadyGone: true };
    return { ok: false, label, error: err.message?.slice(0, 200) };
  }
}

/**
 * Deep-delete one VM and all its named-sibling resources in a given RG.
 * Resource naming convention (cohort pattern):
 *   VM:          <vmName>
 *   NIC:         <vmName>-nic
 *   Public IP:   <vmName>-public-IP
 *   NSG:         <vmName>-nsg          (or <vmName> — try both)
 *   OS disk:     <vmName>_OsDisk_*     (managed disk; queried via VM record before delete)
 *   Snapshots:   <vmName>-snap-*       (multiple may exist if cluster did stop-snapshot-delete cycles)
 */
async function azureDeepDeleteVM(vmName, resourceGroup) {
  const results = [];

  // 1. Look up disk name(s) attached to the VM BEFORE deleting the VM
  let attachedDisks = [];
  try {
    const vm = await compute.virtualMachines.get(resourceGroup, vmName);
    if (vm.storageProfile?.osDisk?.name) attachedDisks.push(vm.storageProfile.osDisk.name);
    (vm.storageProfile?.dataDisks || []).forEach(d => d.name && attachedDisks.push(d.name));
  } catch (err) {
    if (!isNotFound(err)) {
      logger.warn(`[azure-full-cleanup] ${vmName}: failed to inspect VM (${err.message?.slice(0, 100)}) — continuing`);
    }
  }

  // 2. Delete VM with force-deletion (skips graceful shutdown)
  results.push(await safeDelete('vm', () =>
    compute.virtualMachines.beginDeleteAndWait(resourceGroup, vmName, { forceDeletion: true })
  ));

  // 3. Delete NIC (must happen before public IP)
  results.push(await safeDelete('nic', () =>
    network.networkInterfaces.beginDeleteAndWait(resourceGroup, `${vmName}-nic`)
  ));

  // 4. Delete disks identified earlier (plus a fallback name guess)
  for (const d of attachedDisks) {
    results.push(await safeDelete(`disk:${d}`, () =>
      compute.disks.beginDeleteAndWait(resourceGroup, d)
    ));
  }
  // Heuristic fallback for the common cohort naming pattern
  results.push(await safeDelete('disk-guess', () =>
    compute.disks.beginDeleteAndWait(resourceGroup, vmName)
  ));

  // 5. Delete public IP (after NIC is gone)
  for (const ipName of [`${vmName}-public-IP`, `${vmName}-public-ip`, `${vmName}-pip`]) {
    results.push(await safeDelete(`pip:${ipName}`, () =>
      network.publicIPAddresses.beginDeleteAndWait(resourceGroup, ipName)
    ));
  }

  // 6. Delete NSG (try both naming conventions)
  for (const nsgName of [`${vmName}-nsg`, vmName]) {
    results.push(await safeDelete(`nsg:${nsgName}`, () =>
      network.networkSecurityGroups.beginDeleteAndWait(resourceGroup, nsgName)
    ));
  }

  // 7. Delete snapshots named after the VM (best-effort; may not exist)
  try {
    const allSnaps = [];
    for await (const s of compute.snapshots.list(resourceGroup)) {
      if (s.name && s.name.startsWith(vmName)) allSnaps.push(s.name);
    }
    for (const sn of allSnaps) {
      results.push(await safeDelete(`snap:${sn}`, () =>
        compute.snapshots.beginDeleteAndWait(resourceGroup, sn)
      ));
    }
  } catch (err) {
    logger.warn(`[azure-full-cleanup] ${vmName}: snapshot enumeration failed — ${err.message?.slice(0, 100)}`);
  }

  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) {
    logger.info(`[azure-full-cleanup] ${vmName}: fully deleted (${results.length} resources)`);
  } else {
    logger.warn(`[azure-full-cleanup] ${vmName}: ${failed.length}/${results.length} sub-operations failed — ${JSON.stringify(failed.slice(0, 3))}`);
  }
  return { vmName, results };
}

/**
 * Deep-delete a batch of VMs in parallel (max 10 concurrent to avoid Azure throttling).
 */
async function azureDeepDeleteVMs(vmNames, resourceGroup) {
  const CONCURRENCY = 10;
  const out = [];
  for (let i = 0; i < vmNames.length; i += CONCURRENCY) {
    const batch = vmNames.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(n => azureDeepDeleteVM(n, resourceGroup)));
    out.push(...batchResults);
  }
  const fullyOk = out.filter(r => r.results.every(s => s.ok)).length;
  logger.info(`[azure-full-cleanup] batch done: ${fullyOk}/${vmNames.length} VMs fully cleaned`);
  return out;
}

module.exports = { azureDeepDeleteVM, azureDeepDeleteVMs };
