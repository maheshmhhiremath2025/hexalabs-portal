const { logger } = require('./../plugins/logger');
const OciSandboxUser = require('./../models/ociSandboxUser');
const SandboxTemplate = require('./../models/sandboxTemplate');
const User = require('./../models/user');
const { createOciSandbox, deleteOciSandbox } = require('./../services/ociSandbox');
const { notifySandboxWelcomeEmail } = require('./../services/emailNotifications');

async function handleGetOciUsers(req, res) {
    try {
        if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
        const users = await OciSandboxUser.find({ status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean();
        res.json(users || []);
    } catch (err) {
        logger.error('OCI sandbox get users error:', err.message);
        res.status(500).json({ message: 'Internal server error' });
    }
}

async function handleBulkDeployOci(req, res) {
    try {
        if (req.user.userType !== 'superadmin' && req.user.userType !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        const { templateSlug, emails, ttlHours, dailyCapHours = 12, totalCapHours = 0 } = req.body;
        if (!templateSlug) return res.status(400).json({ message: 'templateSlug required' });
        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ message: 'emails array required' });
        }
        if (!ttlHours || ttlHours < 1) return res.status(400).json({ message: 'ttlHours required (minimum 1)' });

        const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'oci' });
        if (!template) return res.status(404).json({ message: 'OCI template not found' });

        const results = [];

        for (const email of emails) {
            const trimmed = email.trim().toLowerCase();
            if (!trimmed) continue;

            try {
                // Generate a unique compartment name
                const randSuffix = Math.random().toString(36).slice(2, 6);
                const certCode = (template.certificationCode || 'oci').toLowerCase();
                const compartmentName = `lab-${certCode}-${randSuffix}-${Date.now().toString(36)}`.slice(0, 30);

                const region = template.sandboxConfig?.region || process.env.OCI_REGION || 'ap-mumbai-1';

                // Create OCI compartment + user + policy
                const ociResult = await createOciSandbox(compartmentName, region, trimmed);

                const expiresAt = req.body.expiresAt
                    ? new Date(req.body.expiresAt)
                    : new Date(Date.now() + ttlHours * 60 * 60 * 1000);

                // Upsert user record
                let user = await OciSandboxUser.findOne({ email: trimmed });
                if (user) {
                    // Update existing user with new sandbox details
                    user.compartmentId = ociResult.compartmentId;
                    user.compartmentName = compartmentName;
                    user.userId = ociResult.userId;
                    user.username = ociResult.username;
                    user.password = ociResult.password;
                    user.policyId = ociResult.policyId;
                    user.region = region;
                    user.accessUrl = ociResult.accessUrl;
                    user.expiresAt = expiresAt;
                    user.status = 'active';
                } else {
                    user = new OciSandboxUser({
                        email: trimmed,
                        compartmentId: ociResult.compartmentId,
                        compartmentName,
                        userId: ociResult.userId,
                        username: ociResult.username,
                        password: ociResult.password,
                        policyId: ociResult.policyId,
                        region,
                        accessUrl: ociResult.accessUrl,
                        duration: Math.ceil(ttlHours / 24) || 1,
                        sandboxTtlHours: ttlHours,
                        startDate: new Date(),
                        endDate: expiresAt,
                        expiresAt,
                        templateId: template._id,
                        allowedServices: (template.allowedServices || []).map(s => ({
                            service: s.service, category: s.category, restrictions: s.restrictions,
                        })),
                        blockedServices: (template.blockedServices || []).map(s => ({
                            service: s.service, reason: s.reason,
                        })),
                    });
                }

                user.dailyCapHours = dailyCapHours;
                user.totalCapHours = totalCapHours;
                user.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug });
                await user.save();

                // Auto-create portal login for the student
                const existingPortalUser = await User.findOne({ email: trimmed });
                if (!existingPortalUser) {
                    await User.create({
                        email: trimmed, name: trimmed,
                        password: 'Welcome1234!',
                        userType: 'sandboxuser',
                        organization: template.name,
                    });
                    logger.info(`[bulk-deploy-oci] Portal user created for ${trimmed}`);
                }

                // Send welcome email (non-blocking)
                notifySandboxWelcomeEmail({
                    email: trimmed, cloud: 'oci', portalPassword: 'Welcome1234!',
                    sandboxUsername: ociResult.username, sandboxPassword: ociResult.password,
                    sandboxAccessUrl: ociResult.accessUrl, region,
                    expiresAt, templateName: template.name,
                    allowedServices: template.allowedServices,
                    blockedServices: template.blockedServices,
                    compartmentName,
                }).catch(e => logger.error(`Welcome email failed for ${trimmed}: ${e.message}`));

                results.push({
                    email: trimmed,
                    compartmentId: ociResult.compartmentId,
                    compartmentName,
                    username: ociResult.username,
                    password: ociResult.password,
                    status: 'success',
                    accessUrl: ociResult.accessUrl,
                    expiresAt,
                });

                logger.info(`[bulk-deploy-oci] deployed ${compartmentName} for ${trimmed}`);
            } catch (err) {
                results.push({
                    email: trimmed,
                    status: 'failed',
                    error: err.message,
                });
                logger.error(`[bulk-deploy-oci] failed for ${trimmed}: ${err.message}`);
            }
        }

        const succeeded = results.filter(r => r.status === 'success').length;
        const failed = results.filter(r => r.status === 'failed').length;

        res.json({
            message: `Bulk deploy complete: ${succeeded} succeeded, ${failed} failed`,
            templateName: template.name,
            total: results.length,
            succeeded,
            failed,
            results,
        });
    } catch (err) {
        logger.error('Bulk deploy OCI error:', err.message);
        res.status(500).json({ message: `Bulk deploy failed: ${err.message}` });
    }
}

async function handleDeleteOciUser(req, res) {
    try {
        if (req.user.userType !== 'superadmin' && req.user.userType !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        const { id } = req.params;
        if (!id) return res.status(400).json({ message: 'id required' });

        const user = await OciSandboxUser.findById(id);
        if (!user) return res.status(404).json({ message: 'OCI sandbox user not found' });

        // 1. Mark as deleting before starting cleanup
        user.deletionStatus = 'deleting';
        await user.save();

        // 2. Respond immediately so frontend can poll
        res.json({ message: 'OCI sandbox user deletion started', email: user.email });

        // 3. Perform cloud cleanup in background
        try {
            await deleteOciSandbox(user.compartmentId, user.userId, user.policyId);

            // On success: mark as deleted
            user.status = 'deleted';
            user.deletionStatus = 'none';
            await user.save();

            logger.info(`OCI sandbox user deleted: ${user.email}`);
        } catch (cleanupErr) {
            // On failure: mark as failed, keep the record
            logger.error(`OCI resource cleanup failed for ${user.email}: ${cleanupErr.message}`);
            await OciSandboxUser.updateOne({ _id: id }, { $set: { deletionStatus: 'failed' } });
        }
    } catch (err) {
        logger.error('OCI sandbox delete user error:', err.message);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
}

module.exports = { handleGetOciUsers, handleBulkDeployOci, handleDeleteOciUser };
