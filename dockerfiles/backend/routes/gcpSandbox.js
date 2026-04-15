const express = require('express');
const router = express.Router();
const { handleGetGcpSandboxUsers, handleCreateGcpSandboxUser, handleDeleteGcpSandboxUser, handleCreateGcpSandbox, handleDeleteGcpSandbox, handleGetGcpSandbox, handleBulkDeployGcp } = require('../controllers/gcpSandbox');

// Superadmin: manage GCP sandbox users
router.get('/user', handleGetGcpSandboxUsers);
router.post('/user', handleCreateGcpSandboxUser);
router.delete('/user', handleDeleteGcpSandboxUser);

// Admin: bulk deploy GCP sandboxes from template
router.post('/bulk-deploy-gcp', handleBulkDeployGcp);

// Sandbox user: manage own GCP sandboxes
router.get('/', handleGetGcpSandbox);
router.post('/', handleCreateGcpSandbox);
router.delete('/', handleDeleteGcpSandbox);

module.exports = router;
