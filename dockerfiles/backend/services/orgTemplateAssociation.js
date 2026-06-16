// Bulk-deploy entitlement check + auto-association helper.
//
// Called from every cloud-specific bulk-deploy handler (Azure / AWS / GCP / OCI)
// AFTER the template lookup but BEFORE the deploy loop starts. Behaviour:
//
//   - If the org doesn't exist → 404 with explicit error.
//   - If org has the template already in `org.templates[]` → no-op, deploy proceeds.
//   - If org doesn't have the template:
//       * superadmin caller → silently $addToSet the template, log it, deploy proceeds.
//       * admin (org-scoped) → 403 with actionable error message instead of generic
//         "Bulk deploy failed".
//
// Shipped 2026-05-08 in response to Vinay's bulk-deploy-on-new-org friction.
const Organization = require('../models/organization');
const { logger } = require('../plugins/logger');

async function ensureTemplateAssociation({ targetOrg, templateSlug, userType, adminEmail }) {
  const orgDoc = await Organization.findOne({
    organization: { $regex: new RegExp(`^${targetOrg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  });
  if (!orgDoc) {
    return { ok: false, status: 404, error: `Organization '${targetOrg}' not found.` };
  }

  const hasTemplate = (orgDoc.templates || []).some(
    t => typeof t === 'string' && t.toLowerCase() === templateSlug.toLowerCase()
  );
  if (hasTemplate) return { ok: true };

  if (userType === 'superadmin') {
    await Organization.updateOne(
      { _id: orgDoc._id },
      { $addToSet: { templates: templateSlug }, $set: { updatedAt: new Date() } }
    );
    logger.info(`[orgTemplateAssoc] AUTO-ASSOCIATED template '${templateSlug}' to org '${targetOrg}' (triggered by superadmin ${adminEmail || 'unknown'})`);
    return { ok: true, autoAssociated: true };
  }

  return {
    ok: false,
    status: 403,
    error: `Template '${templateSlug}' is not associated with org '${targetOrg}'. Ask a superadmin to associate it first, or use the ASSOCIATE button on the template card.`,
  };
}

module.exports = { ensureTemplateAssociation };
