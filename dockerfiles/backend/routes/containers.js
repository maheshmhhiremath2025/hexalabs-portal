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

module.exports = router;
