const {
  createContainer, stopContainer, startContainer, deleteContainer,
  getContainers, getAvailableImages, getCostComparison, CONTAINER_IMAGES,
  buildAccessUrl, buildExtraAccessUrls,
} = require('../services/containerService');
const { logger } = require('../plugins/logger');
const { notifyResourceWelcomeEmail, notifyOpsDeploySummary, isLikelyDeliverable } = require('../services/emailNotifications');

// In-memory deploy job tracker
const deployJobs = new Map();

/**
 * POST /containers/create
 * Deploy new containers — returns job ID immediately, creates in background.
 */
async function handleCreateContainers(req, res) {
  try {
    const { trainingName, organization, imageKey, count = 1, emails = [],
      cpus = 2, memory = 2048, allocatedHours = 100, expiresAt } = req.body;

    if (!trainingName || !organization) {
      return res.status(400).json({ message: 'trainingName and organization required' });
    }

    const comparison = await getCostComparison(cpus, memory);
    const jobId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Initialize job tracker
    deployJobs.set(jobId, {
      status: 'running',
      total: count,
      completed: 0,
      failed: 0,
      current: '',
      results: [],
      costComparison: comparison,
      startedAt: Date.now(),
    });

    // Return job ID immediately
    res.json({ jobId, total: count, message: 'Deployment started' });

    // Create containers in background
    (async () => {
      const job = deployJobs.get(jobId);
      const cleanName = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existingCount = await getContainers(cleanName, organization).then(c => c.length);

      for (let i = 0; i < count; i++) {
        const email = emails[i] || `user${i + 1}@${organization}.lab`;
        const name = `${cleanName}-c${existingCount + i + 1}`;
        job.current = `Creating ${name} (${i + 1}/${count})...`;

        try {
          const result = await createContainer({
            name, trainingName: cleanName,
            organization, email, imageKey,
            cpus, memory, allocatedHours,
            rate: comparison.containerRate,
            azureEquivalentRate: comparison.azureRate,
            expiresAt: expiresAt || null,
          });
          job.completed++;
          job.results.push({ success: true, ...result, email });

          // Send per-student welcome email ONLY if the email looks real
          // (has valid syntax + domain has MX records). Dummy placeholders
          // like hyperv@g.com or user1@<org>.lab are skipped — the
          // consolidated roster email to the org admin covers them.
          const imageConfig = CONTAINER_IMAGES[imageKey];
          isLikelyDeliverable(email).then(deliverable => {
            if (!deliverable) {
              logger.info(`[deploy] skipping welcome email to ${email} (not deliverable)`);
              return;
            }
            return notifyResourceWelcomeEmail({
              email,
              resourceType: 'workspace',
              portalPassword: 'Welcome1234!',
              accessUrl: result.accessUrl,
              accessUsername: 'lab',
              accessPassword: result.password,
              resourceName: name,
              trainingName,
              organization,
              imageKey,
              imageLabel: imageConfig?.label || imageKey,
              cpus,
              memoryMb: memory,
              expiresAt: expiresAt || null,
              hostIp: result.hostIp,
              sshPort: result.sshPort,
              vncPort: result.vncPort,
            });
          }).catch(e => logger.error(`Welcome email failed for ${email}: ${e.message}`));
        } catch (err) {
          job.failed++;
          job.results.push({ success: false, name, error: err.message, email });
          logger.error(`Failed to create container ${name}: ${err.message}`);
        }
      }

      job.status = 'done';
      job.current = '';
      job.finishedAt = Date.now();
      job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);

      // Send summary email to ops (the deployer) with all credentials in one table
      const opsEmail = req.user?.email;
      const successfulContainers = job.results.filter(r => r.success);
      if (opsEmail && successfulContainers.length > 0) {
        const imageConfig = CONTAINER_IMAGES[imageKey];
        notifyOpsDeploySummary({
          opsEmail,
          trainingName,
          organization,
          imageLabel: imageConfig?.label || imageKey,
          containers: successfulContainers.map(c => ({
            name: c.name,
            email: c.email || '—',
            accessUrl: c.accessUrl,
            password: c.password,
            sshPort: c.sshPort,
          })),
        }).catch(e => logger.error(`Ops summary email failed: ${e.message}`));
      }

      // Clean up job after 5 minutes
      setTimeout(() => deployJobs.delete(jobId), 5 * 60 * 1000);
    })();
  } catch (err) {
    logger.error(`Container creation error: ${err.message}`);
    res.status(500).json({ message: 'Failed to start deployment' });
  }
}

/**
 * GET /containers/deploy-status/:jobId
 * Poll deployment progress.
 */
async function handleDeployStatus(req, res) {
  const job = deployJobs.get(req.params.jobId);
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

/**
 * GET /containers?trainingName=xxx&organization=yyy
 * List containers for a training.
 */
async function handleGetContainers(req, res) {
  try {
    const { trainingName, organization } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName required' });
    const containers = await getContainers(trainingName, organization);
    // Enrich with computed access URLs for the frontend
    const enriched = containers.map(c => {
      const obj = c.toObject ? c.toObject() : c;
      obj.accessUrl = buildAccessUrl(c);
      obj.extraAccessUrls = buildExtraAccessUrls(c);
      return obj;
    });
    res.json(enriched);
  } catch (err) {
    logger.error(`Get containers error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch containers' });
  }
}

/**
 * PATCH /containers/start
 * Start containers by IDs.
 */
async function handleStartContainers(req, res) {
  try {
    const { containerIds } = req.body;
    if (!containerIds?.length) return res.status(400).json({ message: 'containerIds required' });

    const results = [];
    for (const id of containerIds) {
      try {
        await startContainer(id);
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }
    res.json({ message: `${results.filter(r => r.success).length}/${containerIds.length} started`, results });
  } catch (err) {
    res.status(500).json({ message: 'Failed to start containers' });
  }
}

/**
 * PATCH /containers/stop
 * Stop containers by IDs.
 */
async function handleStopContainers(req, res) {
  try {
    const { containerIds } = req.body;
    if (!containerIds?.length) return res.status(400).json({ message: 'containerIds required' });

    const results = [];
    for (const id of containerIds) {
      try {
        await stopContainer(id);
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err.message });
      }
    }
    res.json({ message: `${results.filter(r => r.success).length}/${containerIds.length} stopped`, results });
  } catch (err) {
    res.status(500).json({ message: 'Failed to stop containers' });
  }
}

/**
 * DELETE /containers
 * Delete containers by IDs.
 */
async function handleDeleteContainers(req, res) {
  try {
    const { containerIds } = req.body;
    if (!containerIds?.length) return res.status(400).json({ message: 'containerIds required' });

    for (const id of containerIds) {
      await deleteContainer(id);
    }
    res.json({ message: `${containerIds.length} containers deleted` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete containers' });
  }
}

/**
 * GET /containers/images
 * List available container images.
 */
async function handleGetImages(req, res) {
  res.json(getAvailableImages());
}

/**
 * GET /containers/cost-compare?cpus=2&memory=4096
 * Show cost savings vs Azure.
 */
async function handleCostCompare(req, res) {
  const cpus = parseInt(req.query.cpus || '2');
  const memory = parseInt(req.query.memory || '4096');
  res.json(await getCostComparison(cpus, memory));
}

module.exports = {
  handleCreateContainers,
  handleDeployStatus,
  handleGetContainers,
  handleStartContainers,
  handleStopContainers,
  handleDeleteContainers,
  handleGetImages,
  handleCostCompare,
};
