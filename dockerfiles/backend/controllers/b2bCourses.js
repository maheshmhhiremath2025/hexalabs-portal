/**
 * B2B Courses Controller
 *
 * Endpoints for the ops-facing "upload a course PDF, get feasibility + cost,
 * generate a sandbox template on deal lock" flow. B2B cloud accounts only.
 *
 * NOTE: This controller is completely self-contained. It does not import
 * or modify any existing sandbox/selfservice/admin controllers. The
 * SandboxTemplate it produces on the final step is consumed by the
 * existing sandbox provisioner unchanged.
 */

const { logger } = require('../plugins/logger');
const CourseAnalysis = require('../models/courseAnalysis');
const SandboxTemplate = require('../models/sandboxTemplate');
const { extractPdfText } = require('../services/pdfExtractor');
const { analyzeCourseText } = require('../services/courseAnalyzer');
const { evaluateFeasibility } = require('../services/feasibilityEngine');
const { evaluateContainerFeasibility } = require('../services/containerFeasibilityEngine');
const { calculateCost } = require('../services/b2bCostCalculator');
const { generateAndSaveTemplate } = require('../services/templateFromAnalysis');

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

function requireAdmin(req, res) {
  const role = req.user && req.user.userType;
  if (!ADMIN_ROLES.has(role)) {
    res.status(403).json({ error: 'Admin or superadmin access required' });
    return false;
  }
  return true;
}

/**
 * POST /b2b/courses/analyze
 *
 * Multipart form:
 *   file              - the course PDF (required)
 *   seats             - number of seats to quote for (default 1)
 *   providerHint      - 'aws' | 'azure' | 'gcp' | 'auto'  (default 'auto')
 *   customerName      - optional label
 *   requestedTtlHours - per-sandbox cleanup TTL for the eventual template
 *   marginPercent     - override default 40% margin
 *
 * Synchronous: does the PDF extract + LLM call + feasibility + cost in one
 * request. For a 20-50 page TOC PDF this runs in under 30s on Sonnet.
 */
async function handleAnalyze(req, res) {
  if (!requireAdmin(req, res)) return;

  const inputMode = req.body.inputMode || 'pdf';
  const rawTextInput = req.body.rawText || '';

  if (inputMode === 'pdf' && (!req.file || !req.file.buffer)) {
    return res.status(400).json({ error: 'PDF file is required (multipart field "file")' });
  }
  if (inputMode === 'text' && !rawTextInput.trim()) {
    return res.status(400).json({ error: 'rawText is required when inputMode is "text"' });
  }

  const {
    seats = 1,
    providerHint = 'auto',
    customerName,
    requestedTtlHours = 4,
    marginPercent = 40,
    forceType = null,        // 'cloud_sandbox' | 'container_lab' | null (auto)
  } = req.body;

  const seatCount = Math.max(1, parseInt(seats, 10) || 1);
  const ttl = Math.max(1, parseInt(requestedTtlHours, 10) || 4);
  const margin = Math.max(0, parseInt(marginPercent, 10) || 40);
  const validForceType = forceType === 'cloud_sandbox' || forceType === 'container_lab' ? forceType : null;

  // Create the CourseAnalysis doc in "analyzing" state up front so we have
  // an _id even if the Claude call fails (ops can see failed records).
  let record;
  try {
    record = await CourseAnalysis.create({
      originalFilename: inputMode === 'text' ? 'pasted-text' : (req.file.originalname || 'upload.pdf'),
      uploadedBy: req.user.email,
      customerName,
      seats: seatCount,
      providerHint,
      requestedTtlHours: ttl,
      requestedMarginPercent: margin,
      status: 'analyzing',
    });
  } catch (err) {
    logger.error(`[b2bCourses] failed to create CourseAnalysis: ${err.message}`);
    return res.status(500).json({ error: 'Could not create analysis record' });
  }

  try {
    // 1. Extract text — from PDF or from pasted raw text
    let text, pageCount;
    if (inputMode === 'text' && rawTextInput.trim()) {
      text = rawTextInput.trim();
      pageCount = 0;
    } else {
      const extracted = await extractPdfText(req.file.buffer);
      text = extracted.text;
      pageCount = extracted.pageCount;
    }
    if (!text || text.length < 20) {
      throw new Error(inputMode === 'text'
        ? 'The pasted text is too short. Please provide more detail about the course requirements.'
        : 'PDF appears to be empty or image-only (no extractable text)');
    }

    // 2. Structured LLM analysis (with optional ops-forced classification)
    const { analysis, meta } = await analyzeCourseText(text, { providerHint, forceType: validForceType });

    // Belt-and-suspenders: if ops forced a type, override whatever Claude returned
    // in case the model decided to ignore the directive.
    if (validForceType) {
      analysis.recommendedDeployment = validForceType;
    }

    // 3+4. Feasibility + cost — branched by analysis type.
    // cloud_sandbox  → walks the cloud SERVICE catalog, computes cloud quote
    // container_lab  → walks the CONTAINER IMAGE catalog, picks best-fit image
    let feasibility = null;
    let containerFeasibility = null;
    let cost = null;

    if (analysis.recommendedDeployment === 'container_lab') {
      // Run the deterministic container image matcher
      containerFeasibility = evaluateContainerFeasibility(analysis);

      // Override the LLM's recommendedImageKey with the engine's deterministic
      // best match. The engine is the source of truth — Claude's pick is just
      // a starting suggestion that may not even be a real catalog key.
      if (containerFeasibility.bestMatch) {
        if (!analysis.containerLab) analysis.containerLab = {};
        analysis.containerLab.recommendedImageKey = containerFeasibility.bestMatch.imageKey;
        analysis.containerLab.recommendedImageLabel = containerFeasibility.bestMatch.label;
      }

      // Mirror the verdict into the standard feasibility shape so the list
      // page's verdict badge keeps working uniformly across both types.
      feasibility = {
        verdict: containerFeasibility.verdict,
        supported: containerFeasibility.bestMatch
          ? containerFeasibility.bestMatch.matched.map(s => ({ service: s, category: 'preinstalled' }))
          : [],
        needsReview: containerFeasibility.bestMatch
          ? containerFeasibility.bestMatch.addable.map(s => ({ service: s, category: 'addable at runtime' }))
          : [],
        unsupported: containerFeasibility.bestMatch
          ? containerFeasibility.bestMatch.missing.map(s => ({ service: s, category: 'not in catalog' }))
          : [],
        riskFlags: containerFeasibility.riskFlags || [],
      };

      // No cloud-services cost for container labs. Per-seat cost depends on
      // host density (covered by the host sizing guide), not per-service rates.
      cost = {
        perSeatInr: 0,
        totalInr: 0,
        breakdown: [],
        marginPercent: margin,
        baselineSeatInr: 0,
        currency: 'INR',
        unpriced: [],
      };
    } else {
      // cloud_sandbox path — unchanged
      feasibility = evaluateFeasibility(analysis);
      cost = calculateCost(analysis, { seats: seatCount, marginPercent: margin });
    }

    // 5. Persist
    record.analysis = analysis;
    record.feasibility = feasibility;
    record.containerFeasibility = containerFeasibility;
    record.cost = cost;
    record.pageCount = pageCount;
    record.rawTextPreview = text.slice(0, 2000);
    record.forceType = validForceType;
    record.status = 'analyzed';
    record.statusMessage = `Analyzed in ${meta.elapsedMs}ms with ${meta.model}`;
    await record.save();

    logger.info(`[b2bCourses] analyzed ${record._id} type=${analysis.recommendedDeployment} verdict=${feasibility.verdict} ${containerFeasibility ? `bestImage=${containerFeasibility.bestMatch?.imageKey}` : `perSeat=₹${cost.perSeatInr}`}`);

    return res.status(200).json({
      id: record._id,
      status: record.status,
      analysis,
      feasibility,
      containerFeasibility,
      cost,
      pageCount,
      meta,
    });
  } catch (err) {
    logger.error(`[b2bCourses] analysis failed for ${record._id}: ${err.message}`);
    record.status = 'failed';
    record.statusMessage = err.message;
    await record.save().catch(() => {});
    return res.status(500).json({
      id: record._id,
      status: 'failed',
      error: err.message,
    });
  }
}

/**
 * GET /b2b/courses
 *
 * List all course analyses. Newest first. Supports ?status= filter.
 */
async function handleList(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const items = await CourseAnalysis.find(filter)
      .select('-rawTextPreview')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    logger.error(`[b2bCourses] list failed: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /b2b/courses/:id
 */
async function handleGet(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const doc = await CourseAnalysis.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(doc);
  } catch (err) {
    logger.error(`[b2bCourses] get failed: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /b2b/courses/:id/override
 *
 * Ops can tweak the analysis before template generation — add/remove
 * services, adjust hours, edit course name, change provider. This is
 * stored in .overrides and does NOT clobber the original LLM output, so
 * we can always diff what ops changed.
 *
 * Body: { analysis: { ... full analysis-shape object ... }, recompute: true }
 */
async function handleOverride(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const doc = await CourseAnalysis.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (doc.status === 'template_generated') {
      return res.status(400).json({ error: 'Template already generated; override is locked' });
    }

    const { analysis: overrideAnalysis, recompute = true } = req.body || {};
    if (!overrideAnalysis || typeof overrideAnalysis !== 'object') {
      return res.status(400).json({ error: 'Request body must include analysis object' });
    }

    doc.overrides = { analysis: overrideAnalysis };

    if (recompute) {
      if (overrideAnalysis.recommendedDeployment === 'container_lab') {
        const cf = evaluateContainerFeasibility(overrideAnalysis);
        doc.containerFeasibility = cf;
        doc.feasibility = {
          verdict: cf.verdict,
          supported: cf.bestMatch ? cf.bestMatch.matched.map(s => ({ service: s, category: 'preinstalled' })) : [],
          needsReview: cf.bestMatch ? cf.bestMatch.addable.map(s => ({ service: s, category: 'addable at runtime' })) : [],
          unsupported: cf.bestMatch ? cf.bestMatch.missing.map(s => ({ service: s, category: 'not in catalog' })) : [],
          riskFlags: cf.riskFlags || [],
        };
        // Mirror engine pick into the override
        if (cf.bestMatch && doc.overrides.analysis.containerLab) {
          doc.overrides.analysis.containerLab.recommendedImageKey = cf.bestMatch.imageKey;
          doc.overrides.analysis.containerLab.recommendedImageLabel = cf.bestMatch.label;
        }
        doc.cost = {
          perSeatInr: 0, totalInr: 0, breakdown: [],
          marginPercent: doc.requestedMarginPercent, baselineSeatInr: 0,
          currency: 'INR', unpriced: [],
        };
      } else {
        doc.feasibility = evaluateFeasibility(overrideAnalysis);
        doc.cost = calculateCost(overrideAnalysis, {
          seats: doc.seats,
          marginPercent: doc.requestedMarginPercent,
        });
        doc.containerFeasibility = null;
      }
    }

    await doc.save();
    return res.status(200).json({
      id: doc._id,
      feasibility: doc.feasibility,
      containerFeasibility: doc.containerFeasibility,
      cost: doc.cost,
      overrides: doc.overrides,
    });
  } catch (err) {
    logger.error(`[b2bCourses] override failed: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /b2b/courses/:id/generate-template
 *
 * Deal locked — build and persist a SandboxTemplate from this analysis.
 * The existing sandbox provisioner can then use it as-is.
 */
async function handleGenerateTemplate(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const doc = await CourseAnalysis.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!doc.analysis) {
      return res.status(400).json({ error: 'CourseAnalysis has no analysis; run /analyze first' });
    }
    if (doc.analysis.recommendedDeployment === 'container_lab') {
      return res.status(400).json({
        error: 'This course is classified as a container_lab — sandbox templates do not apply. Deploy via the container catalog using the recommended image instead.',
        recommendedImageKey: doc.analysis.containerLab?.recommendedImageKey,
      });
    }
    if (doc.status === 'template_generated' && doc.generatedTemplateId) {
      const existing = await SandboxTemplate.findById(doc.generatedTemplateId).lean();
      return res.status(200).json({ alreadyGenerated: true, template: existing, id: doc._id });
    }

    // Safety: refuse to generate if verdict is infeasible unless caller forces it.
    const force = req.body && req.body.force === true;
    if (doc.feasibility && doc.feasibility.verdict === 'infeasible' && !force) {
      return res.status(400).json({
        error: 'Analysis verdict is infeasible. Pass { force: true } to generate anyway.',
        feasibility: doc.feasibility,
      });
    }

    const template = await generateAndSaveTemplate(doc);
    doc.status = 'template_generated';
    doc.statusMessage = `Generated template ${template._id}`;
    doc.generatedTemplateId = template._id;
    doc.generatedTemplateSlug = template.slug;
    doc.generatedTemplateName = template.name;
    await doc.save();

    return res.status(200).json({
      id: doc._id,
      status: doc.status,
      templateId: template._id,
      templateSlug: template.slug,
      templateName: template.name,
      template,
    });
  } catch (err) {
    logger.error(`[b2bCourses] generate-template failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /b2b/courses/:id
 *
 * Removes the CourseAnalysis document. Does NOT cascade-delete any
 * SandboxTemplate that was generated from it — templates may already be
 * in use by the provisioner or referenced elsewhere. If the caller wants
 * the template gone too they should delete it via the existing
 * /sandbox-templates flow.
 */
async function handleDelete(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    const doc = await CourseAnalysis.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    // Cascade-delete the linked SandboxTemplate so it doesn't orphan
    // in the Course Catalog. If the template has active deployments,
    // those deployments continue until TTL expiry — we only remove
    // the template definition, not the running resources.
    let templateDeleted = false;
    if (doc.generatedTemplateId) {
      try {
        await SandboxTemplate.deleteOne({ _id: doc.generatedTemplateId });
        templateDeleted = true;
        logger.info(`[b2bCourses] cascade-deleted SandboxTemplate ${doc.generatedTemplateId}`);
      } catch (e) {
        logger.error(`[b2bCourses] failed to delete linked template: ${e.message}`);
      }
    }

    await CourseAnalysis.deleteOne({ _id: doc._id });

    logger.info(`[b2bCourses] deleted CourseAnalysis ${req.params.id}`);
    return res.status(200).json({
      deleted: true,
      id: req.params.id,
      templateDeleted,
    });
  } catch (err) {
    logger.error(`[b2bCourses] delete failed: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  handleAnalyze,
  handleList,
  handleGet,
  handleOverride,
  handleGenerateTemplate,
  handleDelete,
};
