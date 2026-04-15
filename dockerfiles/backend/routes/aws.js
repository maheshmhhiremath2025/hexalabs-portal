const express = require('express');
const { handleCreateSandboxUser, handleDeleteSandboxUser, handleGetSandboxUser } = require('../controllers/aws');
const router = express.Router();

router.post('/user', handleCreateSandboxUser);
router.delete('/user', handleDeleteSandboxUser);
router.get('/user', handleGetSandboxUser);

module.exports = router