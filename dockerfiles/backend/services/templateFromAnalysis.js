/**
 * Template Generator
 *
 * Converts an approved CourseAnalysis into a concrete SandboxTemplate
 * (the existing model at models/sandboxTemplate.js) with:
 *
 *   - allowedServices   — from the catalog hits
 *   - blockedServices   — default deny list + anything flagged infeasible
 *   - allowedInstanceTypes - conservative defaults per provider
 *   - sandboxConfig      — TTL, region, budget (from cost calculator)
 *   - iamPolicy          — generated via existing iamPolicyGenerator.js
 *
 * The generated template is saved to the database and its _id is returned
 * so the caller can link it from the CourseAnalysis.
 *
 * IMPORTANT: this file does NOT touch any existing provisioning code or
 * queues. It only produces a SandboxTemplate document — the existing
 * sandbox provisioner picks it up via the existing flow.
 */

const SandboxTemplate = require('../models/sandboxTemplate');
const {
  catalog,
  defaultDenyList,
  defaultAllowedInstanceTypes,
  defaultRegions,
} = require('../data/cloudServiceCatalog');
const {
  generateAwsIamPolicy,
  generateAzurePolicy,
  generateGcpOrgPolicy,
} = require('./iamPolicyGenerator');
const { logger } = require('../plugins/logger');

function slugify(s) {
  return String(s || 'course')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Collect unique (service → category) map from the analysis modules.
 */
function collectServiceMap(analysis) {
  const map = new Map();
  for (const mod of analysis.modules || []) {
    for (const svc of mod.services || []) {
      const key = (svc.name || '').toLowerCase().trim();
      if (!key || map.has(key)) continue;
      map.set(key, { name: key, usage: svc.usage || '' });
    }
  }
  return map;
}

/**
 * Build (but do not persist) a SandboxTemplate mongoose document from an
 * approved CourseAnalysis. The caller decides whether to .save() it.
 */
function buildTemplateFromAnalysis(courseAnalysis) {
  const analysis = (courseAnalysis.overrides && courseAnalysis.overrides.analysis) || courseAnalysis.analysis;
  if (!analysis) {
    throw new Error('CourseAnalysis has no analysis payload');
  }

  const provider = analysis.detectedProvider === 'multi' ? 'aws' : analysis.detectedProvider;
  if (!['aws', 'azure', 'gcp'].includes(provider)) {
    throw new Error(`Unsupported provider for template: ${provider}`);
  }

  const providerCatalog = catalog[provider] || {};
  const serviceMap = collectServiceMap(analysis);

  // allowedServices — every catalog-known, non-blocked service from the course
  const allowedServices = [];
  const courseServicesSet = new Set();
  for (const [svcName] of serviceMap) {
    const entry = providerCatalog[svcName];
    if (!entry || entry.riskTier === 'blocked') continue;
    allowedServices.push({
      service: svcName,
      category: entry.category,
      actions: [],               // empty = all actions for the service; policy generator handles this
      restrictions: entry.notes || '',
    });
    courseServicesSet.add(svcName);
  }

  // blockedServices — default deny list, plus any catalog-blocked services
  // that actually appeared in the course (so they're documented).
  const blockedServices = [];
  const defaultDenies = defaultDenyList[provider] || [];
  for (const svc of defaultDenies) {
    if (courseServicesSet.has(svc)) continue;   // don't block something the course needs
    const entry = providerCatalog[svc];
    blockedServices.push({
      service: svc,
      reason: (entry && entry.notes) || 'Default deny to control sandbox cost.',
    });
  }
  // Also explicitly block any catalog-blocked service referenced in the course
  for (const [svcName] of serviceMap) {
    const entry = providerCatalog[svcName];
    if (entry && entry.riskTier === 'blocked') {
      blockedServices.push({
        service: svcName,
        reason: entry.notes || 'Blocked by catalog policy.',
      });
    }
  }

  // Instance-type whitelist per provider (all 3 filled so the policy
  // generator has defaults; the active provider is the one used).
  const allowedInstanceTypes = {
    aws: defaultAllowedInstanceTypes.aws,
    azure: defaultAllowedInstanceTypes.azure,
    gcp: defaultAllowedInstanceTypes.gcp,
  };

  // Per-seat budget from the cost calculator (already margin-applied).
  const perSeatInr = courseAnalysis.cost && courseAnalysis.cost.perSeatInr
    ? Math.ceil(courseAnalysis.cost.perSeatInr)
    : 500;

  const ttlHours = courseAnalysis.requestedTtlHours || 4;
  const regionDefault = defaultRegions[provider];

  // Assemble SandboxTemplate
  const slugBase = slugify(analysis.courseName || courseAnalysis.originalFilename);
  const slug = `${slugBase}-${Date.now().toString(36)}`;

  const templateDoc = new SandboxTemplate({
    name: analysis.courseName || courseAnalysis.originalFilename || 'B2B Course',
    slug,
    cloud: provider,
    description: analysis.description || '',
    sandboxConfig: {
      ttlHours,
      budgetInr: perSeatInr,
      region: regionDefault,
    },
    allowedServices,
    blockedServices,
    allowedInstanceTypes,
    isActive: true,
    createdBy: courseAnalysis.uploadedBy,
  });

  // Generate the actual cloud-native policy doc from the template shape.
  // Reuses the existing generator so this stays consistent with hand-built
  // SandboxTemplates created via the current UI.
  if (provider === 'aws') {
    templateDoc.iamPolicy = generateAwsIamPolicy(templateDoc);
  } else if (provider === 'azure') {
    templateDoc.iamPolicy = generateAzurePolicy(templateDoc);
  } else if (provider === 'gcp') {
    templateDoc.iamPolicy = generateGcpOrgPolicy(templateDoc);
  }

  return templateDoc;
}

/**
 * Build and persist. Returns the saved SandboxTemplate document.
 */
async function generateAndSaveTemplate(courseAnalysis) {
  const doc = buildTemplateFromAnalysis(courseAnalysis);
  const saved = await doc.save();
  logger.info(`[templateFromAnalysis] saved SandboxTemplate ${saved._id} (${saved.slug}) for course ${courseAnalysis._id}`);
  return saved;
}

module.exports = { buildTemplateFromAnalysis, generateAndSaveTemplate };
