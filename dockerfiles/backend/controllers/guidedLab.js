const GuidedLab = require('../models/guidedLab');
const LabProgress = require('../models/labProgress');
const Training = require('../models/training');
const { logger } = require('../plugins/logger');
const { createContainer, CONTAINER_IMAGES, getCostComparison, getContainers } = require('../services/containerService');
const Templates = require('../models/templates');
const queues = require('./newQueues');
const VM = require('../models/vm');
const { isWorkerAlive } = require('../services/queueHealth');
const { provisionSandboxForStudent, loadSandboxTemplate } = require('../services/sandboxProvisioner');
const SandboxUser = require('../models/sandboxuser');
const awsUser = require('../models/aws');
const GcpSandboxUser = require('../models/gcpSandboxUser');

// In-memory deploy job tracker (same pattern as controllers/containers.js)
const guidedLabDeployJobs = new Map();

// ─── List all active guided labs ────────────────────────────────────────
async function listGuidedLabs(req, res) {
  try {
    const { userType, organization } = req.user;
    const filter = { isActive: true };

    // Non-superadmin: only see default labs (no orgs assigned) + labs assigned to their org
    if (userType !== 'superadmin' && organization) {
      filter.$or = [
        { assignedOrgs: { $size: 0 } },
        { assignedOrgs: organization },
      ];
    }

    const labs = await GuidedLab.find(filter)
      .select('title slug description cloud difficulty duration category icon tags minTier steps sortOrder containerImage vmTemplateName containerConfig assignedOrgs sandboxTemplateSlug')
      .sort('sortOrder')
      .lean();
    res.json(labs.map(l => ({ ...l, stepCount: l.steps.length })));
  } catch (err) {
    logger.error(`[guided-labs] list error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch guided labs' });
  }
}

// ─── Get single guided lab ──────────────────────────────────────────────
async function getGuidedLab(req, res) {
  try {
    const lab = await GuidedLab.findById(req.params.id).lean();
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });

    // Non-superadmin: block access if lab is assigned to other orgs only
    const { userType, organization } = req.user;
    if (userType !== 'superadmin' && lab.assignedOrgs?.length > 0 && !lab.assignedOrgs.includes(organization)) {
      return res.status(403).json({ message: 'This lab is not available for your organization' });
    }

    res.json(lab);
  } catch (err) {
    logger.error(`[guided-labs] get error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch guided lab' });
  }
}

// ─── Get guided lab linked to a training ────────────────────────────────
async function getLabByTraining(req, res) {
  try {
    const training = await Training.findOne({ name: req.params.trainingName }).lean();
    if (!training?.guidedLabId) return res.json(null);
    const lab = await GuidedLab.findById(training.guidedLabId).lean();
    res.json(lab);
  } catch (err) {
    logger.error(`[guided-labs] by-training error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch guided lab for training' });
  }
}

// ─── Create guided lab (superadmin only) ────────────────────────────────
async function createGuidedLab(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const lab = await GuidedLab.create({ ...req.body, createdBy: req.user.email });
    res.status(201).json(lab);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A lab with this slug already exists' });
    logger.error(`[guided-labs] create error: ${err.message}`);
    res.status(500).json({ message: 'Failed to create guided lab' });
  }
}

// ─── Update guided lab (superadmin only) ────────────────────────────────
async function updateGuidedLab(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const lab = await GuidedLab.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });
    res.json(lab);
  } catch (err) {
    logger.error(`[guided-labs] update error: ${err.message}`);
    res.status(500).json({ message: 'Failed to update guided lab' });
  }
}

// ─── Delete guided lab (superadmin) ─────────────────────────────────────
async function deleteGuidedLab(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    await GuidedLab.findByIdAndDelete(req.params.id);
    await LabProgress.deleteMany({ guidedLabId: req.params.id });
    res.json({ success: true });
  } catch (err) {
    logger.error(`[guided-labs] delete error: ${err.message}`);
    res.status(500).json({ message: 'Failed to delete guided lab' });
  }
}

// ─── Link/unlink guided lab to training (superadmin only) ───────────────
async function linkGuidedLab(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { guidedLabId } = req.body; // null to unlink
    const result = await Training.updateOne(
      { name: req.params.trainingName },
      { guidedLabId: guidedLabId || null }
    );
    if (result.matchedCount === 0) return res.status(404).json({ message: 'Training not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error(`[guided-labs] link error: ${err.message}`);
    res.status(500).json({ message: 'Failed to link guided lab' });
  }
}

// ─── Get current user's progress ────────────────────────────────────────
async function getProgress(req, res) {
  try {
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName query param required' });

    let progress = await LabProgress.findOne({
      guidedLabId: req.params.id,
      trainingName,
      userEmail: req.user.email,
    }).lean();

    if (!progress) {
      const lab = await GuidedLab.findById(req.params.id).lean();
      if (!lab) return res.status(404).json({ message: 'Guided lab not found' });
      progress = await LabProgress.create({
        guidedLabId: req.params.id,
        trainingName,
        userEmail: req.user.email,
        steps: lab.steps.map(s => ({ stepId: s._id, completed: false, hintViewed: false })),
      });
      progress = progress.toObject();
    }
    res.json(progress);
  } catch (err) {
    logger.error(`[guided-labs] getProgress error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch progress' });
  }
}

// ─── Mark step complete (manual) ────────────────────────────────────────
async function completeStep(req, res) {
  try {
    const { trainingName } = req.body;
    const progress = await LabProgress.findOneAndUpdate(
      {
        guidedLabId: req.params.id,
        userEmail: req.user.email,
        trainingName,
        'steps.stepId': req.params.stepId,
      },
      {
        $set: {
          'steps.$.completed': true,
          'steps.$.completedAt': new Date(),
          'steps.$.verifyMethod': 'manual',
        },
      },
      { new: true }
    );
    if (!progress) return res.status(404).json({ message: 'Progress not found' });

    // Check if all steps done
    if (progress.steps.every(s => s.completed) && !progress.completedAt) {
      progress.completedAt = new Date();
      await progress.save();
    }
    res.json(progress);
  } catch (err) {
    logger.error(`[guided-labs] completeStep error: ${err.message}`);
    res.status(500).json({ message: 'Failed to complete step' });
  }
}

// ─── Auto-verify step ──────────────────────────────────────────────────
async function verifyStep(req, res) {
  try {
    const { vmName, trainingName } = req.body;
    if (!vmName) return res.status(400).json({ message: 'vmName required' });

    const lab = await GuidedLab.findById(req.params.id).lean();
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });

    const step = lab.steps.find(s => s._id.toString() === req.params.stepId);
    if (!step?.verifyCommand) {
      return res.status(400).json({ message: 'No verify command for this step' });
    }

    // Lazy-load to avoid import errors when Azure SDKs aren't configured
    const { runVerifyCommand } = require('../services/labVerificationService');
    const result = await runVerifyCommand(vmName, step.verifyCommand, step.verifyTimeout || 30);

    const passed = step.verifyExpectedOutput
      ? new RegExp(step.verifyExpectedOutput).test(result.output)
      : result.exitCode === 0;

    if (passed) {
      const progress = await LabProgress.findOneAndUpdate(
        {
          guidedLabId: req.params.id,
          userEmail: req.user.email,
          trainingName,
          'steps.stepId': req.params.stepId,
        },
        {
          $set: {
            'steps.$.completed': true,
            'steps.$.completedAt': new Date(),
            'steps.$.verifyMethod': 'auto',
            'steps.$.verifyOutput': result.output?.slice(0, 2000),
          },
        },
        { new: true }
      );
      if (progress && progress.steps.every(s => s.completed) && !progress.completedAt) {
        progress.completedAt = new Date();
        await progress.save();
      }
    }

    res.json({ passed, output: result.output?.slice(0, 2000) });
  } catch (err) {
    logger.error(`[guided-labs] verifyStep error: ${err.message}`);
    res.status(500).json({ message: `Verification failed: ${err.message}` });
  }
}

// ─── Mark hint as viewed ────────────────────────────────────────────────
async function markHintViewed(req, res) {
  try {
    const { trainingName } = req.body;
    const progress = await LabProgress.findOneAndUpdate(
      {
        guidedLabId: req.params.id,
        userEmail: req.user.email,
        trainingName,
        'steps.stepId': req.params.stepId,
      },
      { $set: { 'steps.$.hintViewed': true } },
      { new: true }
    );
    res.json(progress);
  } catch (err) {
    logger.error(`[guided-labs] markHint error: ${err.message}`);
    res.status(500).json({ message: 'Failed to mark hint' });
  }
}

// ─── Get all students' progress (admin) ─────────────────────────────────
async function getAllProgress(req, res) {
  try {
    const { userType } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { trainingName } = req.query;
    const progress = await LabProgress.find({
      guidedLabId: req.params.id,
      ...(trainingName && { trainingName }),
    }).lean();
    res.json(progress);
  } catch (err) {
    logger.error(`[guided-labs] getAllProgress error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch progress' });
  }
}

// ─── Export progress as CSV (admin + superadmin) ────────────────────────
// Admin: auto-filtered to their org.  Superadmin: must pass ?org=<name>
async function exportProgress(req, res) {
  try {
    const { userType, organization: userOrg } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Determine which org to export
    const org = userType === 'superadmin' ? req.query.org : userOrg;
    if (!org) {
      return res.status(400).json({ message: 'org query parameter is required' });
    }

    const lab = await GuidedLab.findById(req.params.id).select('title steps').lean();
    if (!lab) return res.status(404).json({ message: 'Lab not found' });

    // Find training names for this lab + org
    const trainings = await Training.find(
      { guidedLabId: req.params.id, organization: org },
      'name'
    ).lean();
    const trainingNames = trainings.map(t => t.name);

    if (trainingNames.length === 0) {
      return res.status(404).json({ message: `No deployments found for org "${org}" on this lab` });
    }

    const progressRecords = await LabProgress.find({
      guidedLabId: req.params.id,
      trainingName: { $in: trainingNames },
    }).lean();

    // Build step map for titles
    const sortedSteps = (lab.steps || []).sort((a, b) => a.order - b.order);

    // CSV header
    const stepHeaders = sortedSteps.map(s => `"Step ${s.order}: ${s.title.replace(/"/g, '""')}"`);
    const header = ['Email', 'Organization', 'Training', 'Started', 'Completed', 'Steps Done', 'Total Steps', ...stepHeaders, 'Completion %'];

    // CSV rows
    const rows = progressRecords.map(p => {
      const completedSteps = (p.steps || []).filter(s => s.completed).length;
      const totalSteps = sortedSteps.length;
      const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

      const progMap = {};
      (p.steps || []).forEach(s => { progMap[s.stepId.toString()] = s; });

      const stepCols = sortedSteps.map(s => {
        const sp = progMap[s._id.toString()];
        if (!sp) return 'Not Started';
        if (sp.completed) return sp.completedAt ? `Done (${new Date(sp.completedAt).toLocaleString()})` : 'Done';
        return 'In Progress';
      });

      return [
        p.userEmail,
        `"${org}"`,
        p.trainingName,
        p.startedAt ? new Date(p.startedAt).toLocaleString() : '',
        p.completedAt ? new Date(p.completedAt).toLocaleString() : '',
        completedSteps,
        totalSteps,
        ...stepCols.map(c => `"${c}"`),
        `${pct}%`,
      ].join(',');
    });

    const csv = [header.join(','), ...rows].join('\n');
    const safeTitle = lab.title.replace(/[^a-zA-Z0-9]/g, '_');
    const safeOrg = org.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${safeTitle}_${safeOrg}_progress.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logger.error(`[guided-labs] exportProgress error: ${err.message}`);
    res.status(500).json({ message: 'Failed to export progress' });
  }
}

// ─── Generate lab from PDF or CSV (superadmin only) ─────────────────────
async function generateFromFile(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!req.file && !req.body.rawText) {
      return res.status(400).json({ message: 'A PDF or CSV file (or rawText) is required' });
    }

    let contentText, pageCount = 0, fileType = 'text';

    if (req.file) {
      const originalName = (req.file.originalname || '').toLowerCase();
      const mimeType = req.file.mimetype || '';

      if (originalName.endsWith('.csv') || mimeType === 'text/csv') {
        // CSV — read buffer as UTF-8 text directly
        contentText = req.file.buffer.toString('utf-8');
        fileType = 'csv';
      } else {
        // PDF — extract text using pdf-parse
        const { extractPdfText } = require('../services/pdfExtractor');
        const extracted = await extractPdfText(req.file.buffer);
        contentText = extracted.text;
        pageCount = extracted.pageCount;
        fileType = 'pdf';
      }
    } else {
      contentText = req.body.rawText;
    }

    if (!contentText || contentText.length < 50) {
      return res.status(400).json({ message: 'File content is too short or could not be extracted' });
    }

    const { generateLabFromContent } = require('../services/labGenerator');
    const result = await generateLabFromContent(contentText, {
      cloudHint: req.body.cloudHint || 'auto',
      difficultyHint: req.body.difficultyHint || 'auto',
      customPrompt: req.body.customPrompt || '',
      fileType,
    });

    res.json({
      lab: result.lab,
      meta: { ...result.meta, pageCount, fileType },
    });
  } catch (err) {
    logger.error(`[guided-labs] generateFromFile error: ${err.message}`);
    res.status(500).json({ message: `Lab generation failed: ${err.message}` });
  }
}

// ─── Import steps from existing document (superadmin only) ──────────────
async function importFromFile(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'A PDF or CSV file is required' });
    }

    let contentText, pageCount = 0, fileType = 'text';
    const originalName = (req.file.originalname || '').toLowerCase();
    const mimeType = req.file.mimetype || '';

    if (originalName.endsWith('.csv') || mimeType === 'text/csv') {
      contentText = req.file.buffer.toString('utf-8');
      fileType = 'csv';
    } else {
      const { extractPdfText } = require('../services/pdfExtractor');
      const extracted = await extractPdfText(req.file.buffer);
      contentText = extracted.text;
      pageCount = extracted.pageCount;
      fileType = 'pdf';
    }

    if (!contentText || contentText.length < 20) {
      return res.status(400).json({ message: 'File content is too short or could not be extracted' });
    }

    const { importStepsFromContent } = require('../services/labGenerator');
    const result = await importStepsFromContent(contentText, {
      cloudHint: req.body.cloudHint || 'auto',
      difficultyHint: req.body.difficultyHint || 'auto',
      fileType,
    });

    res.json({
      lab: result.lab,
      meta: { ...result.meta, pageCount, fileType },
    });
  } catch (err) {
    logger.error(`[guided-labs] importFromFile error: ${err.message}`);
    res.status(500).json({ message: `Step import failed: ${err.message}` });
  }
}

// ─── Improve a single step field (superadmin only) ──────────────────────
async function improveStepField(req, res) {
  try {
    if (req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { step, field, labContext } = req.body;
    if (!step || !field) {
      return res.status(400).json({ message: 'step and field are required' });
    }

    const { improveStep } = require('../services/labGenerator');
    const result = await improveStep(step, field, labContext || {});
    res.json(result);
  } catch (err) {
    logger.error(`[guided-labs] improveStepField error: ${err.message}`);
    res.status(500).json({ message: `Step improvement failed: ${err.message}` });
  }
}

// ─── Deploy guided lab (admin + superadmin) ───────────────────────────
async function deployGuidedLab(req, res) {
  try {
    const { userType, organization: userOrg } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const lab = await GuidedLab.findById(req.params.id);
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });

    // Non-superadmin: verify lab is assigned to their org (or is default)
    if (userType !== 'superadmin' && lab.assignedOrgs?.length > 0 && !lab.assignedOrgs.includes(userOrg)) {
      return res.status(403).json({ message: 'This lab is not assigned to your organization' });
    }

    const {
      trainingName, organization, count = 1, emails = [],
      allocatedHours = 100, autoShutdown = true, idleMinutes = 30,
      expiresAt, guacamole = true, meshCentral = false, hybridBenefit = false,
    } = req.body;

    if (!trainingName || !organization) {
      return res.status(400).json({ message: 'trainingName and organization required' });
    }

    // Clean training name to match worker's format (worker strips non-alphanumeric chars)
    // This prevents duplicate Training documents (controller vs worker naming mismatch)
    const cleanTrainingName = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Load sandbox template if the lab has one configured
    let sandboxTemplate = null;
    if (lab.sandboxTemplateSlug) {
      sandboxTemplate = await loadSandboxTemplate(lab.sandboxTemplateSlug);
      if (!sandboxTemplate) {
        return res.status(404).json({ message: `Sandbox template "${lab.sandboxTemplateSlug}" not found or inactive.` });
      }
    }

    // ─── Container deployment ─────────────────────────────────────────
    if (lab.cloud === 'container') {
      const imageKey = lab.containerImage;
      if (!imageKey || !CONTAINER_IMAGES[imageKey]) {
        return res.status(400).json({ message: `Invalid container image: ${imageKey}. Configure containerImage on the guided lab.` });
      }

      const cpus = lab.containerConfig?.cpus || 2;
      const memory = lab.containerConfig?.memory || 2048;
      const comparison = await getCostComparison(cpus, memory);
      const jobId = `glab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      guidedLabDeployJobs.set(jobId, {
        status: 'running', phase: 'labs', total: count, completed: 0, failed: 0,
        current: '', results: [], costComparison: comparison,
        sandboxTotal: 0, sandboxCompleted: 0, sandboxFailed: 0,
        startedAt: Date.now(),
      });

      res.json({ jobId, total: count, message: 'Container deployment started', cloud: 'container', hasSandbox: !!sandboxTemplate });

      // Background creation loop
      (async () => {
        const job = guidedLabDeployJobs.get(jobId);
        const cleanName = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existingCount = await getContainers(cleanName, organization).then(c => c.length);

        for (let i = 0; i < count; i++) {
          const email = emails[i] || `user${i + 1}@${organization}.lab`;
          const name = `${cleanName}-c${existingCount + i + 1}`;
          job.current = `Creating ${name} (${i + 1}/${count})...`;

          try {
            const result = await createContainer({
              name, trainingName: cleanName, organization, email, imageKey,
              cpus, memory, allocatedHours,
              rate: comparison.containerRate,
              azureEquivalentRate: comparison.azureRate,
              expiresAt: expiresAt || null,
            });
            job.completed++;
            job.results.push({ success: true, ...result, email });
          } catch (err) {
            job.failed++;
            job.results.push({ success: false, name, error: err.message, email });
            logger.error(`[guided-lab-deploy] Failed to create container ${name}: ${err.message}`);
          }
        }

        // Link training to guided lab (containerService creates Training but doesn't set guidedLabId)
        try {
          await Training.updateOne(
            { name: cleanName, organization },
            { $set: { guidedLabId: lab._id } }
          );
        } catch (err) {
          logger.error(`[guided-lab-deploy] Failed to link training: ${err.message}`);
        }

        // ─── Sandbox provisioning phase (if template configured) ───
        if (sandboxTemplate) {
          job.phase = 'sandbox';
          job.sandboxTotal = count;
          job.current = 'Provisioning cloud sandboxes...';

          for (let i = 0; i < count; i++) {
            const email = emails[i] || `user${i + 1}@${organization}.lab`;
            job.current = `Provisioning ${sandboxTemplate.cloud.toUpperCase()} sandbox for ${email} (${i + 1}/${count})...`;

            const sbResult = await provisionSandboxForStudent({
              template: sandboxTemplate,
              email,
              ttlHours: sandboxTemplate.sandboxConfig?.ttlHours || 4,
              expiresAt: expiresAt || undefined,
              skipWelcomeEmail: true,
              deferActivation: true, // Timer starts when student clicks "Start Sandbox"
            });

            if (sbResult.success) {
              job.sandboxCompleted++;
            } else {
              job.sandboxFailed++;
              logger.error(`[guided-lab-deploy] Sandbox failed for ${email}: ${sbResult.error}`);
            }
          }
        }

        job.status = 'done';
        job.phase = 'done';
        job.current = '';
        job.finishedAt = Date.now();
        job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);

        // Clean up after 5 minutes
        setTimeout(() => guidedLabDeployJobs.delete(jobId), 5 * 60 * 1000);
      })();

      return;
    }

    // ─── Azure VM deployment (also handles cloud='vm') ─────────────────
    if (lab.cloud === 'azure' || lab.cloud === 'vm') {
      // Check worker health (warn but don't block — job stays in queue until worker starts)
      let workerWarning = '';
      try {
        const workerAlive = await isWorkerAlive();
        if (!workerAlive) {
          workerWarning = 'Warning: Queue worker may not be running. Jobs are queued and will be processed once the worker starts.';
          logger.warn('[guided-lab-deploy] Worker not alive — queuing Azure VM jobs anyway');
        }
      } catch (e) {
        logger.warn(`[guided-lab-deploy] Worker health check failed: ${e.message}`);
      }

      const templateName = lab.vmTemplateName;
      if (!templateName) {
        return res.status(400).json({ message: 'No vmTemplateName configured on this guided lab.' });
      }

      const templateData = await Templates.findOne({ name: templateName }, 'name creation rate kasmVnc hasXrdp -_id');
      if (!templateData) {
        return res.status(404).json({ message: `Template "${templateName}" not found.` });
      }

      const emailList = [];
      for (let i = 0; i < count; i++) {
        emailList.push(emails[i] || `user${i + 1}@${organization}.lab`);
      }

      // Pre-create/update Training with guidedLabId before queuing VM jobs
      // Use cleanTrainingName to match worker's format (prevents duplicates)
      const existingTraining = await Training.findOne({ name: cleanTrainingName, organization });
      if (existingTraining) {
        existingTraining.guidedLabId = lab._id;
        for (const email of emailList) {
          if (!existingTraining.vmUserMapping.find(m => m.userEmail === email)) {
            existingTraining.vmUserMapping.push({ vmName: '', userEmail: email });
          }
        }
        await existingTraining.save();
      } else {
        await Training.create({
          name: cleanTrainingName, organization, guidedLabId: lab._id,
          vmUserMapping: emailList.map(e => ({ vmName: '', userEmail: e })),
          schedules: [],
        });
      }

      // Queue VM creation jobs (same pattern as azureVmCreate.js)
      const { name: tName, rate, creation: template, kasmVnc: templateKasmVnc, hasXrdp: templateHasXrdp } = templateData;
      const currentVmCount = await VM.countDocuments({ trainingName: cleanTrainingName });

      for (let i = 0; i < count; i++) {
        const vmName = `${cleanTrainingName}-${currentVmCount + 1 + i}`;
        await queues['azure-create-vm'].add({
          vmName, email: emailList[i], trainingName: cleanTrainingName,
          allocatedHours, rate, templateName: tName,
          template, kasmVnc: !!templateKasmVnc, hasXrdp: !!templateHasXrdp,
          guacamole: !!guacamole, meshCentral: !!meshCentral,
          autoShutdown, idleMinutes,
          hybridBenefit: !!hybridBenefit,
          expiresAt: expiresAt || null,
          guidedLabId: lab._id.toString(),
          user: req.user,
          total: count + currentVmCount,
        });
      }

      // If sandbox template configured, provision sandboxes in background
      if (sandboxTemplate) {
        const sbJobId = `glab-sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        guidedLabDeployJobs.set(sbJobId, {
          status: 'running', phase: 'sandbox', total: count, completed: 0, failed: 0,
          sandboxTotal: count, sandboxCompleted: 0, sandboxFailed: 0,
          current: 'Provisioning cloud sandboxes...', results: [],
          startedAt: Date.now(),
        });

        // Background sandbox provisioning (runs in parallel with VM queue)
        (async () => {
          const sbJob = guidedLabDeployJobs.get(sbJobId);
          for (let i = 0; i < emailList.length; i++) {
            const studentEmail = emailList[i];
            sbJob.current = `Provisioning ${sandboxTemplate.cloud.toUpperCase()} sandbox for ${studentEmail} (${i + 1}/${emailList.length})...`;

            const sbResult = await provisionSandboxForStudent({
              template: sandboxTemplate,
              email: studentEmail,
              ttlHours: sandboxTemplate.sandboxConfig?.ttlHours || 4,
              expiresAt: expiresAt || undefined,
              skipWelcomeEmail: true,
              deferActivation: true,
            });

            if (sbResult.success) {
              sbJob.sandboxCompleted++;
              sbJob.completed++;
            } else {
              sbJob.sandboxFailed++;
              sbJob.failed++;
            }
          }
          sbJob.status = 'done';
          sbJob.phase = 'done';
          sbJob.current = '';
          sbJob.finishedAt = Date.now();
          sbJob.duration = Math.round((sbJob.finishedAt - sbJob.startedAt) / 1000);
          setTimeout(() => guidedLabDeployJobs.delete(sbJobId), 5 * 60 * 1000);
        })();

        return res.json({
          message: workerWarning
            ? `Azure VM creation queued + sandbox provisioning started. ${workerWarning}`
            : `Azure VM creation queued — ${count} VM(s) will be ready in 3-5 minutes. Sandbox provisioning started.`,
          cloud: 'azure',
          total: count,
          trainingName: cleanTrainingName,
          workerWarning: workerWarning || undefined,
          sandboxJobId: sbJobId,
          hasSandbox: true,
        });
      }

      return res.json({
        message: workerWarning
          ? `Azure VM creation queued. ${workerWarning}`
          : `Azure VM creation queued — ${count} VM(s) will be ready in 3-5 minutes.`,
        cloud: 'azure',
        total: count,
        trainingName: cleanTrainingName,
        workerWarning: workerWarning || undefined,
      });
    }

    // ─── AWS/GCP cloud labs (container + cloud sandbox) ────────────────
    if (lab.cloud === 'aws' || lab.cloud === 'gcp') {
      // AWS/GCP labs always get a container (jumper box) + cloud sandbox
      const imageKey = lab.containerImage;
      if (!imageKey || !CONTAINER_IMAGES[imageKey]) {
        return res.status(400).json({ message: `Invalid container image: ${imageKey}. Configure containerImage on the guided lab for the jumper box.` });
      }
      if (!sandboxTemplate) {
        return res.status(400).json({ message: `${lab.cloud.toUpperCase()} labs require a sandbox template. Configure sandboxTemplateSlug on the guided lab.` });
      }

      const cpus = lab.containerConfig?.cpus || 2;
      const memory = lab.containerConfig?.memory || 2048;
      const comparison = await getCostComparison(cpus, memory);
      const jobId = `glab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      guidedLabDeployJobs.set(jobId, {
        status: 'running', phase: 'labs', total: count, completed: 0, failed: 0,
        current: '', results: [], costComparison: comparison,
        sandboxTotal: count, sandboxCompleted: 0, sandboxFailed: 0,
        startedAt: Date.now(),
      });

      res.json({ jobId, total: count, message: `${lab.cloud.toUpperCase()} lab deployment started (container + sandbox)`, cloud: lab.cloud, hasSandbox: true });

      // Background: create containers then provision sandboxes
      (async () => {
        const job = guidedLabDeployJobs.get(jobId);
        const cleanName = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const existingCount = await getContainers(cleanName, organization).then(c => c.length);

        // Phase 1: Create containers
        for (let i = 0; i < count; i++) {
          const email = emails[i] || `user${i + 1}@${organization}.lab`;
          const name = `${cleanName}-c${existingCount + i + 1}`;
          job.current = `Creating container ${name} (${i + 1}/${count})...`;

          try {
            const result = await createContainer({
              name, trainingName: cleanName, organization, email, imageKey,
              cpus, memory, allocatedHours,
              rate: comparison.containerRate,
              azureEquivalentRate: comparison.azureRate,
              expiresAt: expiresAt || null,
            });
            job.completed++;
            job.results.push({ success: true, ...result, email });
          } catch (err) {
            job.failed++;
            job.results.push({ success: false, name, error: err.message, email });
            logger.error(`[guided-lab-deploy] Failed to create container ${name}: ${err.message}`);
          }
        }

        // Link training
        try {
          await Training.updateOne(
            { name: cleanName, organization },
            { $set: { guidedLabId: lab._id } }
          );
        } catch (err) {
          logger.error(`[guided-lab-deploy] Failed to link training: ${err.message}`);
        }

        // Phase 2: Provision cloud sandboxes
        job.phase = 'sandbox';
        job.current = `Provisioning ${lab.cloud.toUpperCase()} sandboxes...`;

        for (let i = 0; i < count; i++) {
          const email = emails[i] || `user${i + 1}@${organization}.lab`;
          job.current = `Provisioning ${lab.cloud.toUpperCase()} sandbox for ${email} (${i + 1}/${count})...`;

          const sbResult = await provisionSandboxForStudent({
            template: sandboxTemplate,
            email,
            ttlHours: sandboxTemplate.sandboxConfig?.ttlHours || 4,
            expiresAt: expiresAt || undefined,
            skipWelcomeEmail: true,
            deferActivation: true,
          });

          if (sbResult.success) {
            job.sandboxCompleted++;
          } else {
            job.sandboxFailed++;
            logger.error(`[guided-lab-deploy] Sandbox failed for ${email}: ${sbResult.error}`);
          }
        }

        job.status = 'done';
        job.phase = 'done';
        job.current = '';
        job.finishedAt = Date.now();
        job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);
        setTimeout(() => guidedLabDeployJobs.delete(jobId), 5 * 60 * 1000);
      })();

      return;
    }

    return res.status(400).json({ message: `Unsupported cloud type: ${lab.cloud}` });
  } catch (err) {
    logger.error(`[guided-lab-deploy] error: ${err.message}`);
    res.status(500).json({ message: 'Failed to deploy guided lab' });
  }
}

// ─── Get deploy status (polling) ──────────────────────────────────────
async function getDeployStatus(req, res) {
  const job = guidedLabDeployJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job not found' });

  res.json({
    status: job.status,
    phase: job.phase || 'labs',
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    current: job.current,
    progress: job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0,
    results: job.status === 'done' ? job.results : [],
    costComparison: job.costComparison,
    duration: job.duration || Math.round((Date.now() - job.startedAt) / 1000),
    sandboxTotal: job.sandboxTotal || 0,
    sandboxCompleted: job.sandboxCompleted || 0,
    sandboxFailed: job.sandboxFailed || 0,
  });
}

// ─── Paste text into container clipboard (for lab guide copy→paste) ───
const Container = require('../models/container');
const Docker = require('dockerode');

async function pasteToLab(req, res) {
  try {
    const { instanceName, text } = req.body;
    if (!instanceName || !text) {
      return res.status(400).json({ message: 'instanceName and text required' });
    }

    const container = await Container.findOne({ name: instanceName }).lean();
    if (!container) return res.status(404).json({ message: 'Container not found' });
    if (!container.isRunning) return res.status(400).json({ message: 'Container not running' });
    if (!container.containerId) return res.status(400).json({ message: 'No container ID' });

    const docker = (container.dockerHostIp && container.dockerHostIp !== 'localhost')
      ? new Docker({ host: container.dockerHostIp, port: container.dockerHostPort || 2376 })
      : new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

    const dockerContainer = docker.getContainer(container.containerId);

    // Base64-encode to safely pass arbitrary text through shell
    const b64 = Buffer.from(text).toString('base64');
    // Install xclip if missing, then set the X11 clipboard so Ctrl+Shift+V works in terminal
    const cmd = [
      'which xclip > /dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq xclip) > /dev/null 2>&1',
      `echo '${b64}' | base64 -d | DISPLAY=:1 xclip -selection clipboard`,
    ].join(' && ');

    const exec = await dockerContainer.exec({
      Cmd: ['bash', '-c', cmd],
      AttachStdout: true,
      AttachStderr: true,
      User: 'root',
      Env: ['DISPLAY=:1', 'DEBIAN_FRONTEND=noninteractive'],
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    await new Promise((resolve) => {
      stream.on('end', resolve);
      stream.on('error', resolve);
      setTimeout(resolve, 15000); // 15s timeout for xclip install
    });

    res.json({ success: true });
  } catch (err) {
    logger.error(`[guided-labs] pasteToLab error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

// ─── Analytics dashboard (admin + superadmin) ───────────────────────
async function getGuidedLabAnalytics(req, res) {
  try {
    const { userType, organization: userOrg } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const orgFilter = userType === 'admin' ? userOrg : (req.query.org || null);

    // 1. Get active guided labs (filtered by org visibility)
    const labFilter = { isActive: true };
    if (orgFilter) {
      labFilter.$or = [
        { assignedOrgs: { $size: 0 } },
        { assignedOrgs: orgFilter },
      ];
    }
    const labs = await GuidedLab.find(labFilter)
      .select('title slug cloud difficulty category duration steps assignedOrgs')
      .lean();

    const labIds = labs.map(l => l._id);
    const labMap = {};
    labs.forEach(l => { labMap[l._id.toString()] = l; });

    // 2. Get training names scoped to org
    const trainingFilter = { guidedLabId: { $in: labIds } };
    if (orgFilter) trainingFilter.organization = orgFilter;
    const trainings = await Training.find(trainingFilter, 'name organization guidedLabId').lean();
    const trainingNames = trainings.map(t => t.name);
    const trainingOrgMap = {};
    trainings.forEach(t => { trainingOrgMap[t.name] = t.organization || ''; });

    // 3. Get all LabProgress for these labs + trainings
    const progressFilter = { guidedLabId: { $in: labIds } };
    if (orgFilter && trainingNames.length > 0) {
      progressFilter.trainingName = { $in: trainingNames };
    } else if (orgFilter && trainingNames.length === 0) {
      // Org has no trainings → no progress
      return res.json({
        overview: { totalLabs: labs.length, totalStudents: 0, totalEnrollments: 0, completedCount: 0, overallCompletionRate: 0, avgTimeMinutes: 0 },
        perLab: labs.map(l => ({ labId: l._id.toString(), title: l.title, cloud: l.cloud, difficulty: l.difficulty, category: l.category, duration: l.duration, totalSteps: l.steps.length, totalStudents: 0, completedStudents: 0, completionRate: 0, avgTimeMinutes: 0, assignedOrgs: l.assignedOrgs || [] })),
        stepStats: [], perStudent: [], organizations: [],
      });
    }
    const allProgress = await LabProgress.find(progressFilter).lean();

    // 4. Overview KPIs
    const uniqueStudents = new Set(allProgress.map(p => p.userEmail)).size;
    const completedCount = allProgress.filter(p => !!p.completedAt).length;
    const overallCompletionRate = allProgress.length > 0 ? Math.round((completedCount / allProgress.length) * 100) : 0;
    const completedRecords = allProgress.filter(p => p.completedAt && p.startedAt);
    const avgTimeMs = completedRecords.length > 0
      ? completedRecords.reduce((sum, p) => sum + (new Date(p.completedAt) - new Date(p.startedAt)), 0) / completedRecords.length : 0;

    // 5. Per-lab breakdown
    const perLab = labs.map(lab => {
      const labId = lab._id.toString();
      const lp = allProgress.filter(p => p.guidedLabId.toString() === labId);
      const lc = lp.filter(p => !!p.completedAt).length;
      const lcr = lp.length > 0 ? Math.round((lc / lp.length) * 100) : 0;
      const lcRecs = lp.filter(p => p.completedAt && p.startedAt);
      const lcAvg = lcRecs.length > 0
        ? lcRecs.reduce((s, p) => s + (new Date(p.completedAt) - new Date(p.startedAt)), 0) / lcRecs.length : 0;
      return {
        labId, title: lab.title, cloud: lab.cloud, difficulty: lab.difficulty,
        category: lab.category, duration: lab.duration, totalSteps: lab.steps.length,
        totalStudents: lp.length, completedStudents: lc, completionRate: lcr,
        avgTimeMinutes: Math.round(lcAvg / 60000),
        assignedOrgs: lab.assignedOrgs || [],
      };
    });

    // 6. Step-wise analysis
    const stepStats = [];
    for (const lab of labs) {
      const labId = lab._id.toString();
      const lp = allProgress.filter(p => p.guidedLabId.toString() === labId);
      if (lp.length === 0) continue;
      for (const step of lab.steps) {
        const sid = step._id.toString();
        let done = 0, hints = 0, autoAttempts = 0, autoSuccess = 0;
        for (const prog of lp) {
          const sp = (prog.steps || []).find(s => s.stepId.toString() === sid);
          if (!sp) continue;
          if (sp.completed) done++;
          if (sp.hintViewed) hints++;
          if (sp.verifyMethod === 'auto') { autoAttempts++; if (sp.completed) autoSuccess++; }
        }
        stepStats.push({
          labId, labTitle: lab.title, stepOrder: step.order, stepTitle: step.title,
          verifyType: step.verifyType, totalStudents: lp.length,
          completedCount: done, completionRate: Math.round((done / lp.length) * 100),
          hintViewedCount: hints, hintRate: Math.round((hints / lp.length) * 100),
          autoVerifyFailRate: autoAttempts > 0 ? Math.round(((autoAttempts - autoSuccess) / autoAttempts) * 100) : 0,
        });
      }
    }

    // 7. Per-student table
    const perStudent = allProgress.map(p => {
      const lab = labMap[p.guidedLabId.toString()];
      const totalSteps = lab ? lab.steps.length : 0;
      const completedSteps = (p.steps || []).filter(s => s.completed).length;
      const timeTakenMs = (p.completedAt && p.startedAt) ? new Date(p.completedAt) - new Date(p.startedAt) : null;
      return {
        userEmail: p.userEmail, labTitle: lab?.title || 'Unknown', labId: p.guidedLabId.toString(),
        trainingName: p.trainingName, organization: trainingOrgMap[p.trainingName] || '',
        progressPct: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
        completedSteps, totalSteps, startedAt: p.startedAt, completedAt: p.completedAt,
        timeTakenMinutes: timeTakenMs ? Math.round(timeTakenMs / 60000) : null,
        hintsUsed: (p.steps || []).filter(s => s.hintViewed).length,
      };
    });

    // 8. Org list for superadmin
    const organizations = userType === 'superadmin'
      ? [...new Set(trainings.map(t => t.organization).filter(Boolean))].sort()
      : [];

    res.json({
      overview: {
        totalLabs: labs.length, totalStudents: uniqueStudents, totalEnrollments: allProgress.length,
        completedCount, overallCompletionRate, avgTimeMinutes: Math.round(avgTimeMs / 60000),
      },
      perLab, stepStats, perStudent, organizations,
    });
  } catch (err) {
    logger.error(`[guided-labs] analytics error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch guided lab analytics' });
  }
}

// ─── Get sandboxes for a guided lab's training (admin) ────────────────
async function getGuidedLabSandboxes(req, res) {
  try {
    const { userType } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const lab = await GuidedLab.findById(req.params.id).lean();
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });

    if (!lab.sandboxTemplateSlug) {
      return res.json({ sandboxes: [], message: 'This lab has no sandbox template configured.' });
    }

    const trainingName = req.query.training;
    if (!trainingName) {
      return res.status(400).json({ message: 'training query parameter required' });
    }

    // Get emails from the training deployment
    const training = await Training.findOne({ name: trainingName, guidedLabId: lab._id }).lean();
    const containerEmails = training
      ? []
      : await Container.find({ trainingName }).distinct('email');
    const trainingEmails = training
      ? training.vmUserMapping.map(m => m.userEmail).filter(Boolean)
      : containerEmails;

    if (trainingEmails.length === 0) {
      return res.json({ sandboxes: [], message: 'No students found for this training.' });
    }

    const template = await loadSandboxTemplate(lab.sandboxTemplateSlug);
    const cloud = template?.cloud || lab.cloud;
    const now = new Date();
    const sandboxes = [];

    if (cloud === 'azure' || (!cloud || cloud === 'container' || cloud === 'vm')) {
      // Azure — check SandboxUser collection
      const azureUsers = await SandboxUser.find({ email: { $in: trainingEmails } }).lean();
      for (const u of azureUsers) {
        for (const sb of (u.sandbox || [])) {
          const expiry = sb.expiresAt || sb.deleteTime;
          const isExpired = expiry && new Date(expiry) <= now;
          sandboxes.push({
            email: u.email,
            cloud: 'azure',
            username: sb.credentials?.username || u.userId,
            password: sb.credentials?.password || '',
            accessUrl: sb.accessUrl || 'https://portal.azure.com',
            region: sb.location || '',
            status: sb.status === 'deleted' ? 'deleted' : isExpired ? 'expired' : 'active',
            expiresAt: expiry,
            deletionStatus: u.deletionStatus || 'none',
            resourceId: sb.resourceGroupName,
          });
        }
        // User with no sandboxes but still in DB
        if (!u.sandbox?.length) {
          sandboxes.push({
            email: u.email, cloud: 'azure', username: u.userId, password: '',
            accessUrl: 'https://portal.azure.com', region: '', status: 'expired',
            expiresAt: null, deletionStatus: u.deletionStatus || 'none', resourceId: '',
          });
        }
      }
    }

    if (cloud === 'aws' || (!cloud || cloud === 'container')) {
      // AWS — check awsUser collection
      const awsUsers = await awsUser.find({ email: { $in: trainingEmails } }).lean();
      for (const u of awsUsers) {
        const latestSb = u.sandbox?.[u.sandbox.length - 1];
        const expiry = u.expiresAt || latestSb?.deleteTime;
        const isExpired = expiry && new Date(expiry) <= now;
        sandboxes.push({
          email: u.email,
          cloud: 'aws',
          username: u.userId,
          password: u.password,
          accessUrl: u.accessUrl || 'https://console.aws.amazon.com',
          region: u.region || 'ap-south-1',
          status: isExpired ? 'expired' : 'active',
          expiresAt: expiry,
          deletionStatus: u.deletionStatus || 'none',
          resourceId: u.userId,
        });
      }
    }

    if (cloud === 'gcp') {
      // GCP — check GcpSandboxUser collection
      const gcpUsers = await GcpSandboxUser.find({ email: { $in: trainingEmails } }).lean();
      for (const u of gcpUsers) {
        for (const sb of (u.sandbox || [])) {
          const expiry = sb.expiresAt || sb.deleteTime;
          const isExpired = expiry && new Date(expiry) <= now;
          sandboxes.push({
            email: u.email,
            cloud: 'gcp',
            username: u.googleEmail || u.email,
            password: '',
            accessUrl: `https://console.cloud.google.com/home/dashboard?project=${sb.projectId}`,
            region: '',
            status: isExpired ? 'expired' : 'active',
            expiresAt: expiry,
            deletionStatus: u.deletionStatus || 'none',
            resourceId: sb.projectId,
          });
        }
      }
    }

    res.json({ sandboxes, cloud, templateSlug: lab.sandboxTemplateSlug });
  } catch (err) {
    logger.error(`[guided-labs] getGuidedLabSandboxes error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch sandbox users' });
  }
}

// ─── Delete a sandbox user from a guided lab (admin) ─────────────────
async function deleteGuidedLabSandbox(req, res) {
  try {
    const { userType } = req.user;
    if (!['admin', 'superadmin'].includes(userType)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const lab = await GuidedLab.findById(req.params.id).lean();
    if (!lab) return res.status(404).json({ message: 'Guided lab not found' });

    const email = decodeURIComponent(req.params.email);
    if (!email) return res.status(400).json({ message: 'email parameter required' });

    const template = await loadSandboxTemplate(lab.sandboxTemplateSlug);
    const cloud = template?.cloud || lab.cloud;

    // ─── Azure cleanup ───────────────────────────────────────────────
    if (cloud === 'azure' || cloud === 'vm') {
      const userDoc = await SandboxUser.findOne({ email });
      if (!userDoc) return res.status(404).json({ message: 'Sandbox user not found' });

      const azureUserId = userDoc.sandbox?.[0]?.credentials?.username || userDoc.userId;
      const sandboxEntries = userDoc.sandbox || [];
      userDoc.deletionStatus = 'deleting';
      await userDoc.save();

      res.json({ message: 'Azure sandbox deletion started', email });

      // Background cleanup (same as sandbox.js:handleDeleteSandboxUser)
      (async () => {
        try {
          if (azureUserId) {
            try {
              const { ClientSecretCredential } = require('@azure/identity');
              require('isomorphic-fetch');
              const { Client } = require('@microsoft/microsoft-graph-client');
              const identityCredential = new ClientSecretCredential(
                process.env.IDENTITY_TENANT_ID || process.env.TENANT_ID,
                process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
                process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
              );
              const tokenRes = await identityCredential.getToken('https://graph.microsoft.com/.default');
              const graphClient = Client.init({ authProvider: (done) => done(null, tokenRes.token) });
              await graphClient.api(`/users/${azureUserId}`).delete();
              logger.info(`[guided-labs] Azure AD user ${azureUserId} deleted for ${email}`);
            } catch (azureErr) {
              logger.error(`[guided-labs] Azure AD user ${azureUserId} deletion failed: ${azureErr.message}`);
            }
          }

          if (sandboxEntries.length) {
            try {
              const { ClientSecretCredential } = require('@azure/identity');
              const { ResourceManagementClient } = require('@azure/arm-resources');
              const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
              const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);
              for (const sb of sandboxEntries) {
                if (sb.resourceGroupName) {
                  try {
                    await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
                    logger.info(`[guided-labs] Azure RG ${sb.resourceGroupName} deleted for ${email}`);
                  } catch (rgErr) {
                    logger.error(`[guided-labs] Azure RG ${sb.resourceGroupName} deletion failed: ${rgErr.message}`);
                  }
                }
              }
            } catch (rgSetupErr) {
              logger.error(`[guided-labs] Azure RG cleanup setup failed for ${email}: ${rgSetupErr.message}`);
            }
          }

          try { await queues['azure-delete-user'].add({ email }); } catch {}
          await SandboxUser.deleteOne({ email });
          logger.info(`[guided-labs] Azure sandbox user ${email} deleted from DB`);
        } catch (cleanupErr) {
          logger.error(`[guided-labs] Azure sandbox cleanup failed for ${email}: ${cleanupErr.message}`);
          await SandboxUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
      })();
      return;
    }

    // ─── AWS cleanup ─────────────────────────────────────────────────
    if (cloud === 'aws') {
      const userDoc = await awsUser.findOne({ email });
      if (!userDoc) return res.status(404).json({ message: 'AWS sandbox user not found' });

      userDoc.deletionStatus = 'deleting';
      await userDoc.save();
      res.json({ message: 'AWS sandbox deletion started', email });

      (async () => {
        try {
          try { await queues['aws-delete-user'].add({ email: userDoc.userId }); } catch {}
          await awsUser.deleteOne({ email });
          logger.info(`[guided-labs] AWS sandbox user ${email} (${userDoc.userId}) deleted`);
        } catch (cleanupErr) {
          logger.error(`[guided-labs] AWS sandbox cleanup failed for ${email}: ${cleanupErr.message}`);
          await awsUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
      })();
      return;
    }

    // ─── GCP cleanup ─────────────────────────────────────────────────
    if (cloud === 'gcp') {
      const userDoc = await GcpSandboxUser.findOne({ email });
      if (!userDoc) return res.status(404).json({ message: 'GCP sandbox user not found' });

      userDoc.deletionStatus = 'deleting';
      await userDoc.save();
      res.json({ message: 'GCP sandbox deletion started', email });

      (async () => {
        try {
          for (const sb of (userDoc.sandbox || [])) {
            if (sb.projectId) {
              try { await queues['gcp-delete-project'].add({ projectId: sb.projectId }); } catch {}
            }
          }
          await GcpSandboxUser.deleteOne({ email });
          logger.info(`[guided-labs] GCP sandbox user ${email} deleted`);
        } catch (cleanupErr) {
          logger.error(`[guided-labs] GCP sandbox cleanup failed for ${email}: ${cleanupErr.message}`);
          await GcpSandboxUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
      })();
      return;
    }

    return res.status(400).json({ message: `Unsupported cloud type for sandbox deletion: ${cloud}` });
  } catch (err) {
    logger.error(`[guided-labs] deleteGuidedLabSandbox error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Failed to delete sandbox user' });
    }
  }
}

module.exports = {
  listGuidedLabs,
  getGuidedLab,
  getLabByTraining,
  createGuidedLab,
  updateGuidedLab,
  deleteGuidedLab,
  linkGuidedLab,
  getProgress,
  completeStep,
  verifyStep,
  markHintViewed,
  getAllProgress,
  exportProgress,
  generateFromFile,
  importFromFile,
  improveStepField,
  deployGuidedLab,
  getDeployStatus,
  pasteToLab,
  getGuidedLabAnalytics,
  getGuidedLabSandboxes,
  deleteGuidedLabSandbox,
};
