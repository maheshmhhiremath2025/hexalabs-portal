/**
 * TOC-to-Lab Suite Pipeline
 *
 * Orchestrates the full pipeline: PDF upload → TOC analysis → per-module
 * guided lab generation → AWS SandboxTemplate with IAM policies.
 *
 * Uses existing services (no logic duplication):
 *   - pdfExtractor.extractPdfText()
 *   - courseAnalyzer.analyzeCourseText()
 *   - labGenerator.generateLabFromContent()
 *   - templateFromAnalysis.buildTemplateFromAnalysis()
 *
 * Jobs are tracked in-memory (same pattern as guidedLabDeployJobs in
 * controllers/guidedLab.js) with 30-minute TTL.
 */

const crypto = require('crypto');
const { logger } = require('../plugins/logger');

// ─── In-memory job store ────────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup expired jobs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

function generateJobId() {
  return crypto.randomBytes(8).toString('hex');
}

// ─── Concurrency helper ────────────────────────────────────────────────
// Run tasks in batches of `limit` to avoid Claude API rate limits.
async function batchConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Start Pipeline ────────────────────────────────────────────────────

function startPipeline(pdfBuffer, options = {}) {
  const {
    providerHint = 'aws',
    difficultyHint = 'auto',
    customPrompt = '',
    ttlHours = 4,
    organization = '',
    createdBy = '',
  } = options;

  const jobId = generateJobId();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    status: 'extracting',
    stage: 'Extracting PDF text',
    progress: { total: 0, completed: 0, current: '' },
    modules: [],
    labs: [],
    template: null,
    analysis: null,
    meta: {},
    errors: [],
    options: { providerHint, difficultyHint, customPrompt, ttlHours, organization, createdBy },
  };

  jobs.set(jobId, job);

  // Run pipeline in background
  runPipeline(job, pdfBuffer).catch(err => {
    logger.error(`[tocPipeline] job ${jobId} failed: ${err.message}`);
    job.status = 'failed';
    job.stage = 'Pipeline failed';
    job.errors.push(err.message);
  });

  return { jobId };
}

// ─── Pipeline Orchestration ─────────────────────────────────────────────

async function runPipeline(job, pdfBuffer) {
  const { providerHint, difficultyHint, customPrompt, ttlHours, createdBy } = job.options;

  // ─── Stage 1: Extract PDF text ──────────────────────────────────────
  job.status = 'extracting';
  job.stage = 'Extracting PDF text';
  logger.info(`[tocPipeline] ${job.id}: extracting PDF text`);

  const { extractPdfText } = require('./pdfExtractor');
  const { text, pageCount } = await extractPdfText(pdfBuffer);

  if (!text || text.length < 50) {
    throw new Error('PDF appears empty or has too little extractable text');
  }

  job.meta.pageCount = pageCount;
  job.meta.pdfChars = text.length;

  // ─── Stage 2: Analyze TOC ──────────────────────────────────────────
  job.status = 'analyzing';
  job.stage = 'Analyzing course TOC';
  logger.info(`[tocPipeline] ${job.id}: analyzing TOC (${text.length} chars, ${pageCount} pages)`);

  const { analyzeCourseText } = require('./courseAnalyzer');
  const { analysis, meta: analysisMeta } = await analyzeCourseText(text, {
    providerHint,
    forceType: 'cloud_sandbox',
  });

  job.analysis = analysis;
  job.meta.analysisModel = analysisMeta.model;
  job.meta.analysisMs = analysisMeta.elapsedMs;
  job.modules = (analysis.modules || []).map((m, i) => ({
    index: i,
    name: m.name,
    hours: m.hours,
    services: (m.services || []).map(s => s.name),
    status: 'pending',
    stepCount: 0,
  }));

  if (job.modules.length === 0) {
    throw new Error('No modules could be extracted from the TOC. Ensure the PDF contains a course outline.');
  }

  job.progress.total = job.modules.length;
  logger.info(`[tocPipeline] ${job.id}: found ${job.modules.length} modules`);

  // ─── Stage 3: Generate labs for each module ─────────────────────────
  job.status = 'generating';
  job.stage = 'Generating labs';
  logger.info(`[tocPipeline] ${job.id}: generating labs for ${job.modules.length} modules`);

  const { generateLabFromContent } = require('./labGenerator');

  await batchConcurrent(analysis.modules, 3, async (module, idx) => {
    const moduleInfo = job.modules[idx];
    moduleInfo.status = 'generating';
    job.progress.current = module.name;

    const serviceList = (module.services || []).map(s => s.name).join(', ');
    const modulePrompt = buildModulePrompt(module, analysis, customPrompt);

    try {
      logger.info(`[tocPipeline] ${job.id}: generating lab for module ${idx + 1}/${job.modules.length}: ${module.name}`);

      const result = await generateLabFromContent(modulePrompt, {
        cloudHint: providerHint,
        difficultyHint,
        customPrompt: '',
        fileType: 'text',
      });

      job.labs[idx] = result.lab;
      moduleInfo.status = 'done';
      moduleInfo.stepCount = (result.lab.steps || []).length;
      job.progress.completed++;

      logger.info(`[tocPipeline] ${job.id}: module ${idx + 1} done (${moduleInfo.stepCount} steps)`);
    } catch (err) {
      logger.error(`[tocPipeline] ${job.id}: module ${idx + 1} failed: ${err.message}`);
      moduleInfo.status = 'failed';
      moduleInfo.error = err.message;
      job.progress.completed++;
      job.errors.push(`Module "${module.name}": ${err.message}`);
    }
  });

  // ─── Stage 4: Build SandboxTemplate ─────────────────────────────────
  job.status = 'building_template';
  job.stage = 'Building AWS sandbox template';
  logger.info(`[tocPipeline] ${job.id}: building sandbox template`);

  const { buildTemplateFromAnalysis } = require('./templateFromAnalysis');

  // Build a synthetic CourseAnalysis-like object for the template builder.
  // Merge services from all successfully generated labs + the original analysis.
  const allServices = collectAllServices(analysis, job.labs);
  const syntheticAnalysis = {
    analysis: {
      ...analysis,
      modules: analysis.modules.map((m, i) => ({
        ...m,
        services: allServices.get(m.name) || m.services || [],
      })),
    },
    requestedTtlHours: ttlHours,
    uploadedBy: createdBy,
    originalFilename: analysis.courseName || 'toc-suite',
    cost: { perSeatInr: 500 },
  };

  try {
    const templateDoc = buildTemplateFromAnalysis(syntheticAnalysis);
    // Convert to plain object (not saved yet — admin reviews first)
    job.template = templateDoc.toObject();
    job.template._isSaved = false;
    logger.info(`[tocPipeline] ${job.id}: template built (slug: ${job.template.slug}, ${job.template.allowedServices?.length || 0} allowed services)`);
  } catch (err) {
    logger.warn(`[tocPipeline] ${job.id}: template build failed: ${err.message}`);
    job.errors.push(`Template generation: ${err.message}`);
    // Don't fail the whole pipeline — labs are still useful without template
  }

  // ─── Stage 5: Done ──────────────────────────────────────────────────
  const successCount = job.labs.filter(l => l).length;
  job.status = 'done';
  job.stage = `Generated ${successCount}/${job.modules.length} labs`;
  job.meta.totalMs = Date.now() - job.createdAt;

  logger.info(`[tocPipeline] ${job.id}: pipeline complete — ${successCount} labs, ${job.errors.length} errors, ${job.meta.totalMs}ms`);
}

// ─── Build per-module prompt ────────────────────────────────────────────

function buildModulePrompt(module, analysis, customPrompt) {
  const serviceList = (module.services || []).map(s => {
    return s.usage ? `${s.name} (${s.usage})` : s.name;
  }).join(', ');

  const otherModules = (analysis.modules || [])
    .filter(m => m.name !== module.name)
    .map(m => `- ${m.name}`)
    .join('\n');

  let prompt = `COURSE: ${analysis.courseName || 'AWS Training Course'}
DIFFICULTY: ${analysis.difficulty || 'intermediate'}
TOTAL COURSE HOURS: ${analysis.totalHours || 'unknown'}

MODULE TO GENERATE LAB FOR:
Title: ${module.name}
Estimated Hours: ${module.hours || 2}
AWS Services Used: ${serviceList || 'general AWS services'}
${module.notes ? `Notes: ${module.notes}` : ''}

OTHER MODULES IN THIS COURSE (for context — do NOT cover these):
${otherModules || '(this is the only module)'}

REQUIREMENTS:
- Generate a hands-on AWS guided lab specifically for this module
- The student has an AWS sandbox account with IAM permissions for: ${serviceList}
- Focus on practical exercises using the AWS Console and AWS CLI
- Every command must use the AWS CLI (aws ...) or reference specific AWS Console paths
- Include resource cleanup steps at the end (delete created resources)
- Steps should build on each other progressively
- Use realistic resource names (e.g., my-training-bucket, lab-vpc)
- All regions should default to us-east-1 unless the exercise requires multi-region`;

  if (customPrompt) {
    prompt += `\n\nINSTRUCTOR ADDITIONAL INSTRUCTIONS:\n${customPrompt}`;
  }

  return prompt;
}

// ─── Collect services from analysis + generated labs ────────────────────

function collectAllServices(analysis, labs) {
  // Map module name → merged services array
  const moduleServices = new Map();

  for (const mod of analysis.modules || []) {
    const services = [...(mod.services || [])];
    moduleServices.set(mod.name, services);
  }

  // Also extract service names mentioned in lab steps (from generated labs)
  // This is a best-effort extraction — the template builder handles unknown services gracefully
  for (let i = 0; i < labs.length; i++) {
    const lab = labs[i];
    if (!lab) continue;
    const mod = (analysis.modules || [])[i];
    if (!mod) continue;

    const existing = moduleServices.get(mod.name) || [];
    const existingNames = new Set(existing.map(s => s.name));

    // Check if lab description mentions additional services
    const labText = [
      lab.description || '',
      ...(lab.steps || []).map(s => s.description || ''),
    ].join(' ').toLowerCase();

    const awsServicePatterns = [
      'ec2', 's3', 'lambda', 'iam', 'vpc', 'rds', 'dynamodb', 'cloudwatch',
      'cloudtrail', 'cloudformation', 'sns', 'sqs', 'ecs', 'eks', 'ecr',
      'route53', 'elasticache', 'redshift', 'glue', 'athena', 'kinesis',
      'sagemaker', 'kms', 'secrets-manager', 'ssm', 'config', 'guardduty',
      'waf', 'shield', 'inspector', 'macie', 'codepipeline', 'codebuild',
      'codecommit', 'codedeploy', 'elasticbeanstalk', 'lightsail', 'efs',
      'fsx', 'backup', 'organizations', 'step-functions', 'eventbridge',
      'api-gateway', 'cognito', 'amplify', 'app-runner', 'fargate',
    ];

    for (const svc of awsServicePatterns) {
      if (!existingNames.has(svc) && labText.includes(svc)) {
        existing.push({ name: svc, usage: 'Referenced in lab exercises' });
        existingNames.add(svc);
      }
    }

    moduleServices.set(mod.name, existing);
  }

  return moduleServices;
}

// ─── Public API ─────────────────────────────────────────────────────────

function getStatus(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  return {
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    modules: job.modules,
    errors: job.errors,
    meta: job.meta,
  };
}

function getResult(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status !== 'done' && job.status !== 'failed') return null;

  return {
    status: job.status,
    labs: job.labs,
    template: job.template,
    analysis: job.analysis,
    modules: job.modules,
    errors: job.errors,
    meta: job.meta,
  };
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { startPipeline, getStatus, getResult, getJob };
