const Team = require('../models/team');
const User = require('../models/user');
const Subscription = require('../models/subscription');
const { logger } = require('../plugins/logger');
const { sendEmail } = require('../services/emailNotifications');

/**
 * POST /teams
 * Create a team (enterprise plan only).
 */
async function handleCreateTeam(req, res) {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Team name required' });

    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });
    if (!sub || sub.planTier !== 'enterprise') {
      return res.status(403).json({ message: 'Team management requires Enterprise plan' });
    }

    const existing = await Team.findOne({ ownerEmail: req.user.email });
    if (existing) return res.status(409).json({ message: 'You already have a team. Use the existing one.' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);

    const team = await Team.create({
      name,
      slug,
      ownerEmail: req.user.email,
      subscriptionId: sub._id,
      members: [{ email: req.user.email, role: 'owner' }],
      maxMembers: 20,
      sharedQuota: {
        containerHoursTotal: sub.containerHoursTotal || 500,
        containerHoursUsed: 0,
        sandboxCredits: {
          azure: { total: sub.sandboxCredits?.azure?.total || 100, used: 0 },
          aws: { total: sub.sandboxCredits?.aws?.total || 100, used: 0 },
          gcp: { total: sub.sandboxCredits?.gcp?.total || 50, used: 0 },
        },
      },
    });

    res.json({ message: 'Team created', team: { name: team.name, slug: team.slug, members: team.members.length } });
  } catch (err) {
    logger.error(`Create team error: ${err.message}`);
    res.status(500).json({ message: 'Failed to create team' });
  }
}

/**
 * GET /teams
 * Get user's team.
 */
async function handleGetTeam(req, res) {
  try {
    const team = await Team.findOne({
      $or: [{ ownerEmail: req.user.email }, { 'members.email': req.user.email }],
    });
    if (!team) return res.json(null);

    const userRole = team.members.find(m => m.email === req.user.email)?.role || 'member';

    res.json({
      name: team.name,
      slug: team.slug,
      ownerEmail: team.ownerEmail,
      myRole: userRole,
      members: team.members,
      maxMembers: team.maxMembers,
      sharedQuota: team.sharedQuota,
      settings: team.settings,
      memberCount: team.members.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get team' });
  }
}

/**
 * POST /teams/invite
 * Invite a member to the team.
 */
async function handleInviteMember(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const team = await Team.findOne({ ownerEmail: req.user.email });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    // Check caller is owner or admin
    const callerRole = team.members.find(m => m.email === req.user.email)?.role;
    if (!['owner', 'admin'].includes(callerRole)) {
      return res.status(403).json({ message: 'Only owner/admin can invite members' });
    }

    if (team.members.length >= team.maxMembers) {
      return res.status(403).json({ message: `Team is full (max ${team.maxMembers} members)` });
    }

    if (team.members.find(m => m.email === email)) {
      return res.status(409).json({ message: 'User is already a team member' });
    }

    // Create user account if doesn't exist
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        email,
        password: 'Welcome1234!',
        name: email,
        organization: `team-${team.slug}`,
        userType: 'selfservice',
      });
      await user.save();
    }

    team.members.push({ email, role: 'member' });
    await team.save();

    // Send invitation email
    if (sendEmail) {
      sendEmail(email, `You've been invited to ${team.name} on GetLabs`,
        `<div style="font-family: -apple-system, sans-serif; max-width: 500px;">
          <div style="background: #11192a; padding: 16px 20px; border-radius: 8px 8px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 16px;">Team Invitation</h2>
          </div>
          <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p>You've been invited to join <strong>${team.name}</strong> on GetLabs Cloud Portal.</p>
            <p>Login at <a href="https://getlabs.cloud/login">getlabs.cloud/login</a> with your email: <strong>${email}</strong></p>
            <p>Default password: <strong>Welcome1234!</strong> (change it after first login)</p>
          </div>
        </div>`
      ).catch(() => {});
    }

    logger.info(`${email} invited to team ${team.name} by ${req.user.email}`);
    res.json({ message: `${email} invited to team`, memberCount: team.members.length });
  } catch (err) {
    logger.error(`Invite member error: ${err.message}`);
    res.status(500).json({ message: 'Failed to invite member' });
  }
}

/**
 * DELETE /teams/member
 * Remove a member from the team.
 */
async function handleRemoveMember(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const team = await Team.findOne({ ownerEmail: req.user.email });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    if (email === team.ownerEmail) return res.status(400).json({ message: 'Cannot remove the team owner' });

    team.members = team.members.filter(m => m.email !== email);
    await team.save();

    res.json({ message: `${email} removed from team`, memberCount: team.members.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove member' });
  }
}

/**
 * PATCH /teams/member-role
 * Change a member's role.
 */
async function handleChangeMemberRole(req, res) {
  try {
    const { email, role } = req.body;
    if (!email || !['admin', 'member'].includes(role)) return res.status(400).json({ message: 'Email and valid role required' });

    const team = await Team.findOne({ ownerEmail: req.user.email });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const member = team.members.find(m => m.email === email);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    if (member.role === 'owner') return res.status(400).json({ message: 'Cannot change owner role' });

    member.role = role;
    await team.save();

    res.json({ message: `${email} role changed to ${role}` });
  } catch (err) {
    res.status(500).json({ message: 'Failed to change role' });
  }
}

/**
 * PATCH /teams/settings
 * Update team settings.
 */
async function handleUpdateSettings(req, res) {
  try {
    const team = await Team.findOne({ ownerEmail: req.user.email });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const { allowMemberContainers, allowMemberSandboxes, maxContainersPerMember, maxSandboxesPerMember } = req.body;
    if (allowMemberContainers !== undefined) team.settings.allowMemberContainers = allowMemberContainers;
    if (allowMemberSandboxes !== undefined) team.settings.allowMemberSandboxes = allowMemberSandboxes;
    if (maxContainersPerMember !== undefined) team.settings.maxContainersPerMember = maxContainersPerMember;
    if (maxSandboxesPerMember !== undefined) team.settings.maxSandboxesPerMember = maxSandboxesPerMember;
    await team.save();

    res.json({ message: 'Settings updated', settings: team.settings });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update settings' });
  }
}

module.exports = { handleCreateTeam, handleGetTeam, handleInviteMember, handleRemoveMember, handleChangeMemberRole, handleUpdateSettings };
