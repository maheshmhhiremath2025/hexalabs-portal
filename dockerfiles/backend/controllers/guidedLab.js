const GuidedLab = require('../models/guidedLab');
const LabProgress = require('../models/labProgress');
const Training = require('../models/training');
const { logger } = require('../plugins/logger');
const { createContainer, CONTAINER_IMAGES, getCostComparison, getContainers } = require('../services/containerService');
const Templates = require('../models/templates');
const queues = require('./newQueues');
const VM = require('../models/vm');
const { isWorkerAlive } = require('../services/queueHealth');

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
      .select('title slug description cloud difficulty duration category icon tags minTier steps sortOrder containerImage vmTemplateName containerConfig assignedOrgs')
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
        status: 'running', total: count, completed: 0, failed: 0,
        current: '', results: [], costComparison: comparison,
        startedAt: Date.now(),
      });

      res.json({ jobId, total: count, message: 'Container deployment started', cloud: 'container' });

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

        job.status = 'done';
        job.current = '';
        job.finishedAt = Date.now();
        job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);

        // Clean up after 5 minutes
        setTimeout(() => guidedLabDeployJobs.delete(jobId), 5 * 60 * 1000);
      })();

      return;
    }

    // ─── Azure VM deployment ──────────────────────────────────────────
    if (lab.cloud === 'azure') {
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

    // ─── AWS/GCP sandbox — placeholder ────────────────────────────────
    if (lab.cloud === 'aws' || lab.cloud === 'gcp') {
      // Pre-create training with guidedLabId
      const existingTraining = await Training.findOne({ name: trainingName, organization });
      if (existingTraining) {
        existingTraining.guidedLabId = lab._id;
        await existingTraining.save();
      } else {
        await Training.create({
          name: trainingName, organization, guidedLabId: lab._id,
          vmUserMapping: [], schedules: [],
        });
      }

      return res.json({
        message: `${lab.cloud.toUpperCase()} sandbox deployment — training linked. Provision sandboxes from the Sandbox page.`,
        cloud: lab.cloud,
        trainingName,
      });
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
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    current: job.current,
    progress: job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0,
    results: job.status === 'done' ? job.results : [],
    costComparison: job.costComparison,
    duration: job.duration || Math.round((Date.now() - job.startedAt) / 1000),
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
  generateFromFile,
  improveStepField,
  deployGuidedLab,
  getDeployStatus,
  pasteToLab,
};
