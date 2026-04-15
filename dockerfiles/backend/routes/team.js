const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middlewares/auth');
const { handleCreateTeam, handleGetTeam, handleInviteMember, handleRemoveMember, handleChangeMemberRole, handleUpdateSettings } = require('../controllers/team');

router.post('/', checkAuth, handleCreateTeam);
router.get('/', checkAuth, handleGetTeam);
router.post('/invite', checkAuth, handleInviteMember);
router.delete('/member', checkAuth, handleRemoveMember);
router.patch('/member-role', checkAuth, handleChangeMemberRole);
router.patch('/settings', checkAuth, handleUpdateSettings);

module.exports = router;
