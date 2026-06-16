/**
 * Per-template Azure sandbox resource cleanup.
 *
 * For each active SandboxUser whose `sandboxes[]` contains an entry tied to
 * a configured template slug (see CLEANUP_TEMPLATE_SLUGS), this automation
 * lists every resource in their resource group and deletes them — preserving
 * the RG itself, policy assignments on the RG, and role assignments. The
 * sandbox login (Azure AD user) is also untouched, so the student walks into
 * a clean RG without being kicked out.
 *
 * Triggered by cron entries wired in index.js (currently 15:00 + 17:00 IST,
 * idempotent — no-op if no active sandboxes for the template).
 */
const { ClientSecretCredential } = require('@azure/identity');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { logger } = require('../plugins/logger');
const SandboxUser = require('../models/sandboxuser');
const SandboxTemplate = require('../models/sandboxTemplate');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;

// Templates that opt in to scheduled cleanup.
const CLEANUP_TEMPLATE_SLUGS = ["azure-databricks-lab"];

/**
 * Delete every resource in the given RG. Resources of these meta types are
 * skipped because they're scope-attached, not "in" the RG, and removing them
 * would un-policy-assign / un-role-assign the student.
 */
const SKIP_TYPES = new Set([
  'Microsoft.Authorization/policyAssignments',
  'Microsoft.Authorization/roleAssignments',
]);

async function cleanupRg(rgName) {
  const client = new ResourceManagementClient(credential, subscriptionId);
  let listed = 0, deleted = 0, skipped = 0, failed = 0;
  const failures = [];

  try {
    // Confirm RG still exists; if not, this user already had a manual cleanup
    await client.resourceGroups.get(rgName);
  } catch (err) {
    if (err.statusCode === 404) {
      logger.info(`[sandbox-cleanup] RG ${rgName} not found (already deleted) — skipping`);
      return { listed: 0, deleted: 0, skipped: 0, failed: 0 };
    }
    throw err;
  }

  for await (const r of client.resources.listByResourceGroup(rgName)) {
    listed++;
    if (SKIP_TYPES.has(r.type)) { skipped++; continue; }
    try {
      // Use the resource's API version. Falls back to a generic if missing.
      const apiVersion = await getApiVersion(client, r.type);
      await client.resources.beginDeleteByIdAndWait(r.id, apiVersion);
      deleted++;
      logger.info(`[sandbox-cleanup] deleted ${r.type}/${r.name} in ${rgName}`);
    } catch (err) {
      failed++;
      failures.push(`${r.type}/${r.name}: ${err.message}`);
      logger.warn(`[sandbox-cleanup] failed to delete ${r.type}/${r.name} in ${rgName}: ${err.message}`);
    }
  }

  return { listed, deleted, skipped, failed, failures };
}

const apiVersionCache = new Map();
async function getApiVersion(client, resourceType) {
  if (apiVersionCache.has(resourceType)) return apiVersionCache.get(resourceType);
  const [providerNs, ...rest] = resourceType.split('/');
  const childType = rest.join('/');
  try {
    const provider = await client.providers.get(providerNs);
    const t = (provider.resourceTypes || []).find(rt => rt.resourceType === childType);
    const version = t?.apiVersions?.[0] || '2021-04-01';
    apiVersionCache.set(resourceType, version);
    return version;
  } catch {
    return '2021-04-01';
  }
}

async function sandboxResourceCleanup() {
  try {
    const templates = await SandboxTemplate.find({ slug: { $in: CLEANUP_TEMPLATE_SLUGS } }).select('_id slug').lean();
    if (!templates.length) {
      return; // No templates configured for cleanup — silent
    }
    const templateIds = templates.map(t => String(t._id));
    const slugBySlug = Object.fromEntries(templates.map(t => [String(t._id), t.slug]));

    // Find sandbox users with at least one sandbox tied to a configured template
    // and where that sandbox is still active (not expired).
    const now = new Date();
    const users = await SandboxUser.find({
      "sandbox.templateId": { $in: templateIds },
    }).lean();

    if (!users.length) {
      logger.info('[sandbox-cleanup] no active sandboxes for configured templates — skipping');
      return;
    }

    let totalUsers = 0, totalRgs = 0, totalDeleted = 0;
    for (const u of users) {
      const activeSandboxes = (u.sandbox || []).filter(s =>
        templateIds.includes(String(s.templateId)) &&
        (!s.deleteTime || new Date(s.deleteTime) > now) &&
        (!s.expiresAt   || new Date(s.expiresAt)   > now) &&
        s.resourceGroupName
      );
      if (!activeSandboxes.length) continue;

      totalUsers++;
      for (const s of activeSandboxes) {
        try {
          const result = await cleanupRg(s.resourceGroupName);
          totalRgs++;
          totalDeleted += result.deleted;
          logger.info(`[sandbox-cleanup] ${u.email} (${slugBySlug[String(s.templateId)]}/${s.resourceGroupName}): listed=${result.listed} deleted=${result.deleted} skipped=${result.skipped} failed=${result.failed}`);
        } catch (err) {
          logger.error(`[sandbox-cleanup] ${u.email} (${s.resourceGroupName}): ${err.message}`);
        }
      }
    }
    logger.info(`[sandbox-cleanup] sweep complete — users=${totalUsers} rgs=${totalRgs} resources_deleted=${totalDeleted}`);
  } catch (err) {
    logger.error(`[sandbox-cleanup] top-level error: ${err.message}`);
  }
}

module.exports = { sandboxResourceCleanup, CLEANUP_TEMPLATE_SLUGS };
