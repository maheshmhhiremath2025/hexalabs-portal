const CustomImage = require('../models/customImage');
const Docker = require('dockerode');
const { logger } = require('../plugins/logger');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

/**
 * POST /custom-images
 * Register a custom container image.
 */
async function handleCreateImage(req, res) {
  try {
    const { name, image, description, category, os, port, protocol, envVars, defaultUser, shmSize, isPublic, allowedEmails, allowedTeams, defaultCpus, defaultMemory } = req.body;

    if (!name || !image) return res.status(400).json({ message: 'name and image required' });

    const key = `custom-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36).slice(-4)}`;

    const customImage = await CustomImage.create({
      name, key, image, description, category: category || 'custom', os: os || 'Linux',
      port: port || 3000, protocol: protocol || 'http',
      envVars: envVars || [], defaultUser, shmSize: shmSize || '512m',
      createdBy: req.user.email, organization: req.user.organization,
      isPublic: isPublic || false, allowedEmails: allowedEmails || [], allowedTeams: allowedTeams || [],
      defaultCpus: defaultCpus || 2, defaultMemory: defaultMemory || 4096,
    });

    logger.info(`Custom image registered: ${name} (${image}) by ${req.user.email}`);
    res.json({ message: 'Image registered', key: customImage.key, image: customImage.image });
  } catch (err) {
    logger.error(`Create custom image error: ${err.message}`);
    res.status(500).json({ message: 'Failed to register image' });
  }
}

/**
 * GET /custom-images
 * List images available to the current user.
 */
async function handleListImages(req, res) {
  try {
    const images = await CustomImage.find({
      isActive: true,
      $or: [
        { isPublic: true },
        { createdBy: req.user.email },
        { allowedEmails: req.user.email },
        { organization: req.user.organization },
      ],
    }).sort({ createdAt: -1 });

    res.json(images.map(img => ({
      key: img.key, name: img.name, image: img.image, description: img.description,
      category: img.category, os: img.os, port: img.port, protocol: img.protocol,
      isPublic: img.isPublic, isPulled: img.isPulled, createdBy: img.createdBy,
      defaultCpus: img.defaultCpus, defaultMemory: img.defaultMemory,
    })));
  } catch (err) {
    res.status(500).json({ message: 'Failed to list images' });
  }
}

/**
 * POST /custom-images/pull
 * Pre-pull an image on the server.
 */
async function handlePullImage(req, res) {
  try {
    const { key } = req.body;
    const img = await CustomImage.findOne({ key });
    if (!img) return res.status(404).json({ message: 'Image not found' });

    // Only owner or superadmin can pull
    if (img.createdBy !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Only the image owner can pull' });
    }

    res.json({ message: `Pulling ${img.image}... This may take a few minutes.` });

    // Pull in background
    docker.pull(img.image, (err, stream) => {
      if (err) { logger.error(`Pull failed for ${img.image}: ${err.message}`); return; }
      docker.modem.followProgress(stream, async (err) => {
        if (err) { logger.error(`Pull failed: ${err.message}`); return; }
        img.isPulled = true;
        await img.save();
        logger.info(`Custom image pulled: ${img.image}`);
      });
    });
  } catch (err) {
    res.status(500).json({ message: 'Pull failed' });
  }
}

/**
 * DELETE /custom-images
 * Delete a custom image registration.
 */
async function handleDeleteImage(req, res) {
  try {
    const { key } = req.body;
    const img = await CustomImage.findOne({ key });
    if (!img) return res.status(404).json({ message: 'Image not found' });

    if (img.createdBy !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Only the image owner can delete' });
    }

    await CustomImage.deleteOne({ key });
    res.json({ message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete image' });
  }
}

module.exports = { handleCreateImage, handleListImages, handlePullImage, handleDeleteImage };
