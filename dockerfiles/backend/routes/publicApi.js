const express = require('express');
const router = express.Router();
const ApiKey = require('../models/apiKey');
const Container = require('../models/container');
const { createContainer, stopContainer, startContainer, deleteContainer, getAvailableImages, buildAccessUrl } = require('../services/containerService');
const { logger } = require('../plugins/logger');

// API Key authentication middleware
async function apiKeyAuth(req, res, next) {
  const authHeader = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (!authHeader) return res.status(401).json({ error: 'API key required. Pass via X-Api-Key header.' });

  const apiKey = await ApiKey.findByKey(authHeader);
  if (!apiKey) return res.status(401).json({ error: 'Invalid API key' });

  apiKey.lastUsedAt = new Date();
  await apiKey.save();

  req.apiKey = apiKey;
  req.user = { email: apiKey.ownerEmail, organization: apiKey.organization };
  next();
}

// API Key management (authenticated via JWT)
const { restrictToLoggedinUserOnly } = require('../middlewares/auth');

router.post('/keys', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name required' });

    const { key, hashedKey } = ApiKey.generateKey();
    const apiKey = await ApiKey.create({
      name, key, hashedKey,
      ownerEmail: req.user.email,
      organization: req.user.organization,
      permissions: permissions || {},
    });

    // Return the actual key ONCE (never stored in plaintext)
    res.json({
      message: 'API key created. Save this key — it won\'t be shown again.',
      apiKey: key,
      name: apiKey.name,
      id: apiKey._id,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create key' });
  }
});

router.get('/keys', restrictToLoggedinUserOnly, async (req, res) => {
  const keys = await ApiKey.find({ ownerEmail: req.user.email }).select('-key -hashedKey');
  res.json(keys);
});

router.delete('/keys/:id', restrictToLoggedinUserOnly, async (req, res) => {
  await ApiKey.findOneAndUpdate({ _id: req.params.id, ownerEmail: req.user.email }, { isActive: false });
  res.json({ message: 'Key revoked' });
});

// ===== PUBLIC API ENDPOINTS (API Key auth) =====

/**
 * GET /api/v1/images
 * List available container images.
 */
router.get('/v1/images', apiKeyAuth, (req, res) => {
  res.json(getAvailableImages());
});

/**
 * POST /api/v1/containers
 * Deploy a container programmatically.
 *
 * Body: { name, trainingName, imageKey, email, cpus, memory, allocatedHours }
 */
router.post('/v1/containers', apiKeyAuth, async (req, res) => {
  try {
    if (!req.apiKey.permissions.containers) return res.status(403).json({ error: 'Container permission not granted for this key' });

    const { name, trainingName, imageKey = 'ubuntu-xfce', email, cpus = 2, memory = 4096, allocatedHours = 100 } = req.body;
    if (!name || !trainingName) return res.status(400).json({ error: 'name and trainingName required' });

    const result = await createContainer({
      name, trainingName,
      organization: req.apiKey.organization || req.apiKey.ownerEmail,
      email: email || req.apiKey.ownerEmail,
      imageKey, cpus, memory, allocatedHours,
      rate: 0, azureEquivalentRate: 0,
      password: 'Welcome1234!',
    });

    res.json({
      id: result.containerId,
      name: result.name,
      accessUrl: result.accessUrl,
      port: result.vncPort,
      password: result.password,
    });
  } catch (err) {
    logger.error(`API container create error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/containers
 * List containers for a training.
 *
 * Query: ?trainingName=xxx
 */
router.get('/v1/containers', apiKeyAuth, async (req, res) => {
  const { trainingName } = req.query;
  if (!trainingName) return res.status(400).json({ error: 'trainingName query param required' });

  const containers = await Container.find({
    trainingName,
    organization: req.apiKey.organization || req.apiKey.ownerEmail,
    isAlive: true,
  }).select('name containerId isRunning os vncPort hostIp accessProtocol password cpus memory duration quota');

  res.json(containers.map(c => ({
    id: c.containerId, name: c.name, isRunning: c.isRunning, os: c.os,
    accessUrl: buildAccessUrl(c),
    cpus: c.cpus, memory: c.memory,
    runtimeHours: Math.round((c.duration || 0) / 3600 * 10) / 10,
  })));
});

/**
 * POST /api/v1/containers/:id/start
 */
router.post('/v1/containers/:id/start', apiKeyAuth, async (req, res) => {
  try {
    await startContainer(req.params.id);
    res.json({ message: 'Container started' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/containers/:id/stop
 */
router.post('/v1/containers/:id/stop', apiKeyAuth, async (req, res) => {
  try {
    await stopContainer(req.params.id);
    res.json({ message: 'Container stopped' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/v1/containers/:id
 */
router.delete('/v1/containers/:id', apiKeyAuth, async (req, res) => {
  try {
    await deleteContainer(req.params.id);
    res.json({ message: 'Container deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/containers/batch
 * Deploy multiple containers at once.
 *
 * Body: { trainingName, imageKey, count, emails: [] }
 */
router.post('/v1/containers/batch', apiKeyAuth, async (req, res) => {
  try {
    if (!req.apiKey.permissions.containers) return res.status(403).json({ error: 'Container permission not granted' });

    const { trainingName, imageKey = 'ubuntu-xfce', count = 1, emails = [], cpus = 2, memory = 4096, allocatedHours = 100 } = req.body;
    if (!trainingName) return res.status(400).json({ error: 'trainingName required' });

    const results = [];
    for (let i = 0; i < count; i++) {
      const email = emails[i] || `user${i + 1}@api.lab`;
      const name = `${trainingName}-${i + 1}`;
      try {
        const r = await createContainer({
          name, trainingName, organization: req.apiKey.organization || req.apiKey.ownerEmail,
          email, imageKey, cpus, memory, allocatedHours, rate: 0, password: 'Welcome1234!',
        });
        results.push({ name, id: r.containerId, accessUrl: r.accessUrl, status: 'created' });
      } catch (err) {
        results.push({ name, status: 'failed', error: err.message });
      }
    }

    res.json({ total: count, created: results.filter(r => r.status === 'created').length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
