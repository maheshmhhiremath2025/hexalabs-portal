const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middlewares/auth');
const {
  handleGetPlans, handleSignup, handleVerifyPayment,
  handleDashboard, handleGetSandboxes, handleSelfDeploy, handleSelfSandbox,
  handleSelfStop, handleSelfStart, handleSelfDelete,
} = require('../controllers/selfservice');
const { handleSubmitFeedback, handleCheckFeedback, handleGetTrainingRatings } = require('../controllers/feedback');

// Public routes (no auth)
router.get('/plans', handleGetPlans);
router.post('/signup', handleSignup);
router.post('/verify-payment', handleVerifyPayment);

// Guided labs (public)
router.get('/guided-labs', async (req, res) => {
  const GuidedLab = require('../models/guidedLab');
  const labs = await GuidedLab.find({ isActive: true }).sort({ sortOrder: 1 }).select('-steps');
  res.json(labs);
});
router.get('/guided-labs/:slug', async (req, res) => {
  const GuidedLab = require('../models/guidedLab');
  const lab = await GuidedLab.findOne({ slug: req.params.slug, isActive: true });
  if (!lab) return res.status(404).json({ message: 'Lab not found' });
  res.json(lab);
});

// Feedback (public, no auth)
router.post('/feedback', handleSubmitFeedback);
router.get('/feedback/check', handleCheckFeedback);
router.get('/feedback/:trainingName', handleGetTrainingRatings);

// AI lab chatbot
router.post('/chat', checkAuth, async (req, res) => {
  try {
    const { message, trainingName, labType, imageKey } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    const { chat } = require('../services/labChatbot');
    const userEmail = req.user?.email || 'anonymous';
    const result = await chat(
      message.trim(),
      { trainingName, labType, imageKey },
      userEmail
    );
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Chatbot error' });
  }
});

// Auth required routes
router.get('/dashboard', checkAuth, handleDashboard);
router.get('/sandboxes', checkAuth, handleGetSandboxes);
router.post('/deploy', checkAuth, handleSelfDeploy);
router.post('/sandbox', checkAuth, handleSelfSandbox);
router.post('/stop', checkAuth, handleSelfStop);
router.post('/start', checkAuth, handleSelfStart);
router.delete('/instance', checkAuth, handleSelfDelete);

module.exports = router;
