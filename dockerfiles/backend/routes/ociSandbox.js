const express = require('express');
const router = express.Router();
const { handleGetOciUsers, handleBulkDeployOci, handleDeleteOciUser } = require('../controllers/ociSandbox');

// Admin: list all OCI sandbox users
router.get('/', handleGetOciUsers);

// Admin: bulk deploy OCI sandboxes from template
router.post('/bulk-deploy-oci', handleBulkDeployOci);

// Admin: delete a single OCI sandbox user + cleanup resources
router.delete('/:id', handleDeleteOciUser);

module.exports = router;
