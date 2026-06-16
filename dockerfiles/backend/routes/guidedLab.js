const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const {
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
  startTocPipeline,
  getTocPipelineStatus,
  getTocPipelineResult,
  saveTocLabSuite,
} = require('../controllers/guidedLab');

// ─── AI Generation (must be before /:id catch-all) ─────────────────────
router.post('/generate', upload.single('file'), generateFromFile);
router.post('/import-steps', upload.single('file'), importFromFile);
router.post('/improve-step', improveStepField);

// ─── TOC-to-Lab Suite Pipeline (must be before /:id catch-all) ─────────
router.post('/toc-pipeline', upload.single('file'), startTocPipeline);
router.get('/toc-pipeline/:jobId', getTocPipelineStatus);
router.get('/toc-pipeline/:jobId/result', getTocPipelineResult);
router.post('/toc-pipeline/:jobId/save', saveTocLabSuite);

// ─── Lab clipboard (copy from guide → paste in container terminal) ─────
router.post('/paste-to-lab', pasteToLab);

// ─── Analytics (must be before /:id catch-all) ──────────────────────
router.get('/analytics', getGuidedLabAnalytics);

// ─── Deployment ────────────────────────────────────────────────────────
router.post('/:id/deploy', deployGuidedLab);
router.get('/:id/deploy-status/:jobId', getDeployStatus);

// ─── Sandbox management (admin) ─────────────────────────────────────
router.get('/:id/sandboxes', getGuidedLabSandboxes);
router.delete('/:id/sandboxes/:email', deleteGuidedLabSandbox);

// ─── CRUD ───────────────────────────────────────────────────────────────
router.get('/', listGuidedLabs);
router.get('/by-training/:trainingName', getLabByTraining);
router.get('/:id', getGuidedLab);
router.post('/', createGuidedLab);
router.put('/:id', updateGuidedLab);
router.delete('/:id', deleteGuidedLab);

// ─── Training linking ───────────────────────────────────────────────────
router.patch('/link/:trainingName', linkGuidedLab);

// ─── Progress tracking ─────────────────────────────────────────────────
router.get('/:id/progress', getProgress);
router.get('/:id/progress/all', getAllProgress);
router.get('/:id/progress/export', exportProgress);
router.post('/:id/steps/:stepId/complete', completeStep);
router.post('/:id/steps/:stepId/verify', verifyStep);
router.post('/:id/steps/:stepId/hint', markHintViewed);

module.exports = router;
