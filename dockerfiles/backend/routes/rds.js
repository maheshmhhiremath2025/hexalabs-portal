const express = require('express');
const router = express.Router();
const { handleCreateRds, handleRdsDeployStatus, handleRdsCostCompare, handleGetRdsOptions } = require('../controllers/rds');

router.post('/create', handleCreateRds);
router.get('/deploy-status/:jobId', handleRdsDeployStatus);
router.get('/cost-compare', handleRdsCostCompare);
router.get('/options', handleGetRdsOptions);

module.exports = router;
