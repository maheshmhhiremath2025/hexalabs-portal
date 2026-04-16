const express = require('express');
const router = express.Router();
const {
  handleCreateContainers,
  handleDeployStatus,
  handleGetContainers,
  handleStartContainers,
  handleStopContainers,
  handleDeleteContainers,
  handleGetImages,
  handleCostCompare,
} = require('../controllers/containers');

router.post('/create', handleCreateContainers);
router.get('/deploy-status/:jobId', handleDeployStatus);
router.get('/', handleGetContainers);
router.patch('/start', handleStartContainers);
router.patch('/stop', handleStopContainers);
router.delete('/', handleDeleteContainers);
router.get('/images', handleGetImages);
router.get('/cost-compare', handleCostCompare);

// Pre-pull an image so it's cached before the first student deploys.
// POST /containers/pre-pull  body: { imageKey: 'bigdata-workspace' }
router.post('/pre-pull', async (req, res) => {
  const { userType } = req.user || {};
  if (userType !== 'admin' && userType !== 'superadmin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  const { imageKey } = req.body;
  if (!imageKey) return res.status(400).json({ message: 'imageKey required' });

  const { prePullImage } = require('../services/containerService');
  const result = await prePullImage(imageKey);
  res.json(result);
});

// Capture a running container as a reusable template
// POST /containers/capture  body: { containerId, templateName, templateLabel }
router.post('/capture', async (req, res) => {
  const { userType } = req.user || {};
  if (userType !== 'admin' && userType !== 'superadmin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { captureContainerAsTemplate } = require('../services/containerService');
    const { containerId, templateName, templateLabel } = req.body;
    if (!containerId || !templateName) {
      return res.status(400).json({ message: 'containerId and templateName are required' });
    }
    const result = await captureContainerAsTemplate({ containerId, templateName, templateLabel });

    // Save to custom images collection for the portal dropdown
    const CustomImage = require('../models/customImage');
    await CustomImage.create({
      key: result.templateKey,
      label: result.label,
      type: result.type,
      image: result.image || null,
      diskPath: result.diskPath || null,
      sourceImage: result.sourceImage || null,
      vncPort: result.vncPort || null,
      protocol: result.protocol || null,
      organization: req.user.organization,
      createdBy: req.user.email,
      createdAt: new Date(),
    });

    res.json({ message: `Template "${result.label}" created successfully`, template: result });
  } catch (err) {
    res.status(500).json({ message: `Capture failed: ${err.message}` });
  }
});

module.exports = router;
