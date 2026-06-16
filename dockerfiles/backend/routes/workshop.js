/**
 * Workshop routes — all gated by WORKSHOP_ENABLED=true env flag.
 * When the flag is off, every endpoint returns 404 (mimics not existing).
 */
const express = require('express');
const router = express.Router();
const c = require('../controllers/workshop');

// Kill switch — if WORKSHOP_ENABLED isn't exactly 'true', return 404 for every route.
function checkEnabled(req, res, next) {
  if (process.env.WORKSHOP_ENABLED !== 'true') {
    return res.status(404).json({ message: 'Not found' });
  }
  next();
}
router.use(checkEnabled);

router.use(express.json());

router.get('/bases', c.handleGetCatalog);
router.get('/my-builds', c.handleListMyBuilds);
router.post('/build', c.handleBuild);
router.post('/:vmName/resize', c.handleResize);
router.post('/:vmName/grow-disk', c.handleGrowDisk);
router.post('/:vmName/snapshot', c.handleSnapshot);
router.delete('/:vmName', c.handleDelete);

module.exports = router;
