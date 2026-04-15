const express = require('express');
const { handleCreateSandboxUser, handleCreateSandbox, handleDeleteSandbox, handleGetSandbox, handleDeleteSandboxUser, handleGetSandboxUser, handleBulkCreateUsers, handleBulkStatus, handleBulkDeployAzure } = require('../controllers/sandbox');
const { handleBulkDeploy } = require('../controllers/bulkDeploy');
const router = express.Router();

router.post('/user', handleCreateSandboxUser);
router.delete('/user', handleDeleteSandboxUser);
router.get('/user', handleGetSandboxUser);
router.post('/azure', handleCreateSandbox);
router.delete('/azure', handleDeleteSandbox);
router.get('/azure', handleGetSandbox);
router.post('/bulk-create', handleBulkCreateUsers);
router.get('/bulk-status/:jobId', handleBulkStatus);
router.post('/bulk-deploy', handleBulkDeploy);
router.post('/bulk-deploy-azure', handleBulkDeployAzure);

module.exports = router
