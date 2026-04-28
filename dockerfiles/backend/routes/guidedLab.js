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
  generateFromFile,
  improveStepField,
  deployGuidedLab,
  getDeployStatus,
  pasteToLab,
} = require('../controllers/guidedLab');

// ─── AI Generation (must be before /:id catch-all) ─────────────────────
router.post('/generate', upload.single('file'), generateFromFile);
router.post('/improve-step', improveStepField);

// ─── Lab clipboard (copy from guide → paste in container terminal) ─────
router.post('/paste-to-lab', pasteToLab);

// ─── Deployment ────────────────────────────────────────────────────────
router.post('/:id/deploy', deployGuidedLab);
router.get('/:id/deploy-status/:jobId', getDeployStatus);

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
router.post('/:id/steps/:stepId/complete', completeStep);
router.post('/:id/steps/:stepId/verify', verifyStep);
router.post('/:id/steps/:stepId/hint', markHintViewed);

module.exports = router;
