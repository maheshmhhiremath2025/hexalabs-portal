/**
 * Sandbox tag-based cross-RG cleanup
 * ─────────────────────────────────────
 * Defense-in-depth for the Azure-standard-lab sandbox cohort. At provision
 * time we register an "append-tag" Azure Policy at the sandbox RG scope that
 * forces every new resource in the RG to carry `synergificSandboxRgName=<rg>`.
 *
 * At cleanup time, BEFORE the RG is deleted, we run an Azure Resource Graph
 * query subscription-wide for any resource with that tag and delete each one
 * that lives outside the sandbox RG. The RG delete then handles in-RG
 * resources as it always did.
 *
 * Why this matters: if a sandbox template ever accidentally grants subscription-
 * level role (or future templates do), learner-created shared storage accounts /
 * managed identities / role assignments etc. would otherwise survive the RG
 * delete and bill forever. The 2026-06 Networklab cost analysis surfaced one
 * sandbox at ₹1,224 — suspected outside-RG leak.
 *
 * Per memory:
 *   - feedback_no_regression_rule.md — new file, additive, env kill switch
 *   - feedback_sdk_package_check.md — raw REST instead of new @azure/arm-resourcegraph dep
 *   - feedback_minimal_scope_for_drift_bugs.md — only touches resources matching the
 *     specific RG-name tag; never sweeps untagged or other-RG resources
 *
 * Added 2026-06-15.
 */

const fetch = require('node-fetch');
const { ClientSecretCredential } = require('@azure/identity');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { logger } = require('../plugins/logger');

const TAG_NAME = 'synergificSandboxRgName';
const ARG_API_VERSION = '2022-10-01';
const DEFAULT_DELETE_API_VERSION = '2021-04-01';   // generic; specific resources may need their own

let _credential;
function getCredential() {
  if (!_credential) {
    _credential = new ClientSecretCredential(
      process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
    );
  }
  return _credential;
}

async function _mgmtToken() {
  const tk = await getCredential().getToken('https://management.azure.com/.default');
  return tk.token;
}

/**
 * Register the append-tag policy at the sandbox RG scope.
 * Called at provision time, right after the standard policy block.
 *
 * Effect: every resource created inside the RG (including indirectly, e.g.
 * managed identities created with VMs) gets the tag automatically. Standard
 * Azure built-in policy effect; no custom definition needed.
 *
 * @param {object} policyClient   - existing PolicyClient from provisioning
 * @param {string} subscriptionId
 * @param {string} rgName         - the sandbox RG name (used both as scope and tag value)
 */
async function applyAppendTagPolicy(policyClient, subscriptionId, rgName) {
  if (process.env.SANDBOX_TAG_CLEANUP_ENABLED !== 'true') return false;
  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${rgName}`;
  const shortRg = rgName.slice(0, 35);
  try {
    // Built-in "Append a tag and its value to resource groups" doesn't fit;
    // we want it on each resource. Use built-in: "Append tag and its value to resources"
    // policy definition id: 4f9dc7db-30c1-420c-b61a-e1d640128d26
    await policyClient.policyAssignments.create(scope, `sb-tag-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/4f9dc7db-30c1-420c-b61a-e1d640128d26',
      parameters: {
        tagName:  { value: TAG_NAME },
        tagValue: { value: rgName },
      },
      displayName: 'Sandbox: tag resources with sandbox RG name',
    });
    return true;
  } catch (e) {
    logger.warn(`[sandbox-tag] applyAppendTagPolicy ${rgName}: ${e.message}`);
    return false;
  }
}

/**
 * Query Resource Graph for resources subscription-wide that carry the
 * sandbox-RG tag but live OUTSIDE the sandbox RG. Returns an array of
 * { id, name, type, resourceGroup } so the caller can decide what to do.
 */
async function findCrossRgTaggedResources(subscriptionId, rgName) {
  const token = await _mgmtToken();
  const query = `Resources
    | where tags['${TAG_NAME}'] == '${rgName}'
    | where resourceGroup !~ '${rgName}'
    | project id, name, type, resourceGroup, location`;

  const res = await fetch(
    `https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=${ARG_API_VERSION}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptions: [subscriptionId], query }),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    logger.warn(`[sandbox-tag] ARG query failed for ${rgName}: ${res.status} ${txt.slice(0, 200)}`);
    return [];
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Sweep — find + delete cross-RG resources tagged with the sandbox RG.
 * Returns counts; logs every action.
 *
 * Safe to call always: if the append-tag policy was never assigned (e.g.
 * cleanup-enabled but provisioning predates this), ARG query returns 0.
 */
async function sweepCrossRgByTag(subscriptionId, rgName) {
  if (process.env.SANDBOX_TAG_CLEANUP_ENABLED !== 'true') return { found: 0, deleted: 0, failed: 0 };

  const found = await findCrossRgTaggedResources(subscriptionId, rgName);
  if (!found.length) return { found: 0, deleted: 0, failed: 0 };

  logger.info(`[sandbox-tag] ${rgName}: ARG found ${found.length} cross-RG tagged resource(s) — deleting`);
  const resourceClient = new ResourceManagementClient(getCredential(), subscriptionId);
  let deleted = 0, failed = 0;
  for (const r of found) {
    try {
      await resourceClient.resources.beginDeleteByIdAndWait(r.id, DEFAULT_DELETE_API_VERSION);
      logger.info(`[sandbox-tag] ${rgName}: deleted ${r.type} ${r.name} (in ${r.resourceGroup})`);
      deleted++;
    } catch (e) {
      // Most likely cause: resource type needs its own apiVersion. Don't crash —
      // log and continue; the daily orphan sweeper will catch survivors.
      logger.warn(`[sandbox-tag] ${rgName}: delete failed for ${r.id}: ${e.message}`);
      failed++;
    }
  }
  return { found: found.length, deleted, failed };
}

module.exports = {
  TAG_NAME,
  applyAppendTagPolicy,
  findCrossRgTaggedResources,
  sweepCrossRgByTag,
};
