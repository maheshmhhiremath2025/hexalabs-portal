const { logger } = require('./../plugins/logger');
const queues = require('./newQueues');
const GcpSandboxUser = require('./../models/gcpSandboxUser');
const SandboxTemplate = require('./../models/sandboxTemplate');
const User = require('./../models/user');
const { notifySandboxWelcomeEmail } = require('./../services/emailNotifications');

async function handleGetGcpSandboxUsers(req, res) {
    try {
        if (req.user.userType !== 'superadmin') return res.status(403).send('Unauthorized');
        const users = await GcpSandboxUser.find().lean();
        res.json(users);
    } catch (err) {
        logger.error('GCP sandbox get users error:', err.message);
        res.status(500).send('Internal server error');
    }
}

async function handleCreateGcpSandboxUser(req, res) {
    try {
        if (req.user.userType !== 'superadmin') return res.status(403).send('Unauthorized');
        const { googleEmail, duration = 5, sandboxTtlHours = 4, credits = 1, budgetLimit = 500 } = req.body;
        if (!googleEmail) return res.status(400).json({ message: 'googleEmail required' });

        const existing = await GcpSandboxUser.findOne({ email: googleEmail });
        if (existing) return res.status(409).json({ message: 'User already exists' });

        const user = await GcpSandboxUser.create({
            email: googleEmail,
            googleEmail,
            duration,
            sandboxTtlHours,
            credits: { total: credits, consumed: 0 },
            budgetLimit,
            startDate: new Date(),
            endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
        });

        logger.info(`GCP sandbox user created: ${googleEmail}`);
        res.json({ message: 'GCP sandbox user created', user });
    } catch (err) {
        logger.error('GCP sandbox create user error:', err.message);
        res.status(500).send('Internal server error');
    }
}

async function handleDeleteGcpSandboxUser(req, res) {
    try {
        if (req.user.userType !== 'superadmin') return res.status(403).send('Unauthorized');
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'email required' });

        const user = await GcpSandboxUser.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // 1. Mark as deleting before starting cleanup
        user.deletionStatus = 'deleting';
        await user.save();

        // 2. Respond immediately so frontend can poll
        res.json({ message: 'User deletion started' });

        // 3. Perform cloud cleanup in background
        try {
            // Delete all sandboxes (GCP projects) directly via Google API
            for (const sb of user.sandbox || []) {
                if (!sb.projectId) continue;

                // Remove user IAM binding from project
                try {
                    const { removeUserFromSharedProject } = require('../services/gcpSharedProject');
                    await removeUserFromSharedProject(sb.projectId, user.googleEmail || email);
                    logger.info(`GCP IAM binding removed for ${email} from project ${sb.projectId}`);
                } catch (iamErr) {
                    logger.error(`GCP IAM binding removal failed for ${email} on ${sb.projectId}: ${iamErr.message}`);
                }

                // Delete the GCP project directly
                try {
                    const { google } = require('googleapis');
                    const keyFile = process.env.KEYFILENAME;
                    const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
                    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

                    await cloudResourceManager.projects.delete({ name: `projects/${sb.projectId}` });
                    logger.info(`GCP project ${sb.projectId} deleted directly for ${email}`);
                } catch (projErr) {
                    logger.error(`GCP project ${sb.projectId} direct deletion failed: ${projErr.message}. Project may still exist.`);
                }

                // Also try queue as backup (for production with workers running)
                try {
                    await queues['gcp-delete-project'].add({ projectId: sb.projectId });
                } catch {}
            }

            // On success: delete the DB record
            await GcpSandboxUser.deleteOne({ email });
            logger.info(`GCP sandbox user ${email} deleted from DB`);
        } catch (cleanupErr) {
            // On failure: mark as failed, keep the record
            logger.error(`GCP sandbox user ${email} cleanup failed: ${cleanupErr.message}`);
            await GcpSandboxUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
    } catch (err) {
        logger.error('GCP sandbox delete user error:', err.message);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
}

async function handleCreateGcpSandbox(req, res) {
    try {
        const { email } = req.user;
        const { projectName } = req.body;
        if (!projectName) return res.status(400).json({ message: 'projectName required' });

        const user = await GcpSandboxUser.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const available = (user.credits?.total || 0) - (user.credits?.consumed || 0);
        if (available <= 0) return res.status(403).json({ message: 'No credits available' });

        const activeSandboxes = (user.sandbox || []).length;
        if (activeSandboxes >= (user.maxConcurrentSandboxes || 2)) {
            return res.status(403).json({ message: `Max ${user.maxConcurrentSandboxes} concurrent sandboxes` });
        }

        // Use shared project (1 project per 5 users) to avoid quota issues
        const { getOrCreateSharedProject, addUserToSharedProject } = require('../services/gcpSharedProject');
        const org = user.email.split('@')[0] || 'sandbox';
        const { projectId, isNew } = await getOrCreateSharedProject(org, user.sandboxTtlHours || 4, user.budgetLimit || 500);
        const ttl = user.sandboxTtlHours || 4;

        // Only create new project if needed (shared project may already exist)
        if (isNew) {
            await queues['gcp-create-project'].add({
                projectId,
                projectName,
                userEmail: user.googleEmail || email,
                budgetLimit: user.budgetLimit || 500,
            });
        }

        // Add user as Editor to the shared project
        await addUserToSharedProject(projectId, user.googleEmail || email, isNew);

        // Save sandbox to user record
        user.sandbox.push({
            projectId,
            projectName,
            createdTime: new Date(),
            deleteTime: new Date(Date.now() + ttl * 60 * 60 * 1000),
            isShared: true,
            sharedUsers: [user.googleEmail || email],
            maxUsers: 5,
        });
        user.credits.consumed = (user.credits.consumed || 0) + 1;
        await user.save();

        // Track shared user across all records
        await GcpSandboxUser.updateOne(
            { 'sandbox.projectId': projectId },
            { $addToSet: { 'sandbox.$.sharedUsers': user.googleEmail || email } }
        );

        logger.info(`GCP sandbox: ${email} added to shared project ${projectId} (${isNew ? 'new' : 'existing'})`);
        res.json({ message: `GCP sandbox ${isNew ? 'created' : 'joined shared project'}`, projectId, ttlHours: ttl, shared: !isNew });
    } catch (err) {
        logger.error('GCP sandbox create error:', err.message);
        res.status(500).send('Internal server error');
    }
}

async function handleDeleteGcpSandbox(req, res) {
    try {
        const { projectId } = req.body;
        if (!projectId) return res.status(400).json({ message: 'projectId required' });

        // 1. Delete GCP project directly via Google API
        try {
            const { google } = require('googleapis');
            const keyFile = process.env.KEYFILENAME;
            const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
            const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

            await cloudResourceManager.projects.delete({ name: `projects/${projectId}` });
            logger.info(`GCP project ${projectId} deleted directly`);
        } catch (projErr) {
            logger.error(`GCP project ${projectId} direct deletion failed: ${projErr.message}. Project may still exist.`);
        }

        // 2. Remove from user record in DB
        await GcpSandboxUser.updateOne(
            { 'sandbox.projectId': projectId },
            { $pull: { sandbox: { projectId } }, $inc: { 'credits.consumed': -1 } }
        );

        // 3. Also try queue as backup (for production with workers running)
        try {
            await queues['gcp-delete-project'].add({ projectId });
        } catch {}

        logger.info(`GCP sandbox deletion completed: ${projectId}`);
        res.json({ message: 'GCP sandbox deleted' });
    } catch (err) {
        logger.error('GCP sandbox delete error:', err.message);
        res.status(500).send('Internal server error');
    }
}

async function handleGetGcpSandbox(req, res) {
    try {
        const user = await GcpSandboxUser.findOne({ email: req.user.email }).lean();
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).send('Internal server error');
    }
}

async function handleBulkDeployGcp(req, res) {
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

        const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'gcp' });
        if (!template) return res.status(404).json({ message: 'GCP template not found' });

        const { createGcpSandbox } = require('../services/directSandbox');
        const results = [];

        for (const email of emails) {
            const trimmed = email.trim().toLowerCase();
            if (!trimmed) continue;

            try {
                // Generate a unique project ID
                const randSuffix = Math.random().toString(36).slice(2, 6);
                const certCode = (template.certificationCode || 'gcp').toLowerCase();
                const projectId = `lab-${certCode}-${randSuffix}-${Date.now().toString(36)}`.slice(0, 30);

                // Create the GCP project + IAM binding
                const gcpResult = await createGcpSandbox(
                    projectId,
                    trimmed,
                    template.sandboxConfig?.budgetInr || 500
                );

                const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + ttlHours * 60 * 60 * 1000);

                // Upsert user record — create if not exists, add sandbox entry
                let user = await GcpSandboxUser.findOne({ email: trimmed });
                if (!user) {
                    user = await GcpSandboxUser.create({
                        email: trimmed,
                        googleEmail: trimmed,
                        duration: Math.ceil(ttlHours / 24) || 1,
                        sandboxTtlHours: ttlHours,
                        credits: { total: 99, consumed: 0 },
                        budgetLimit: template.sandboxConfig?.budgetInr || 500,
                        startDate: new Date(),
                        endDate: expiresAt,
                    });
                }

                user.sandbox.push({
                    projectId,
                    projectName: `${template.name} sandbox`,
                    createdTime: new Date(),
                    deleteTime: expiresAt,
                    templateId: String(template._id),
                    expiresAt,
                    allowedServices: (template.allowedServices || []).map(s => ({
                        service: s.service, category: s.category, restrictions: s.restrictions,
                    })),
                    blockedServices: (template.blockedServices || []).map(s => ({
                        service: s.service, reason: s.reason,
                    })),
                });
                user.credits.consumed = (user.credits.consumed || 0) + 1;
                user.dailyCapHours = dailyCapHours;
                user.totalCapHours = totalCapHours;
                user.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug });
                await user.save();

                results.push({
                    email: trimmed,
                    projectId,
                    status: 'success',
                    iamBindingSuccess: gcpResult.iamBindingSuccess,
                    accessUrl: gcpResult.accessUrl,
                    expiresAt,
                });

                // Auto-create portal login
                const existingUser = await User.findOne({ email: trimmed });
                if (!existingUser) {
                    await User.create({ email: trimmed, name: trimmed, password: 'Welcome1234!', userType: 'sandboxuser', organization: template.name });
                }

                // Send welcome email
                notifySandboxWelcomeEmail({
                    email: trimmed, cloud: 'gcp', portalPassword: 'Welcome1234!',
                    sandboxUsername: trimmed, sandboxPassword: 'Use your Google account',
                    sandboxAccessUrl: gcpResult.accessUrl,
                    region: template.sandboxConfig?.region || 'asia-south1',
                    expiresAt, templateName: template.name,
                    allowedServices: template.allowedServices, blockedServices: template.blockedServices,
                    projectId,
                }).catch(e => logger.error(`Welcome email failed for ${trimmed}: ${e.message}`));

                logger.info(`[bulk-deploy-gcp] deployed ${projectId} for ${trimmed}`);
            } catch (err) {
                results.push({
                    email: trimmed,
                    status: 'failed',
                    error: err.message,
                });
                logger.error(`[bulk-deploy-gcp] failed for ${trimmed}: ${err.message}`);
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
        logger.error('Bulk deploy GCP error:', err.message);
        res.status(500).json({ message: `Bulk deploy failed: ${err.message}` });
    }
}

module.exports = { handleGetGcpSandboxUsers, handleCreateGcpSandboxUser, handleDeleteGcpSandboxUser, handleCreateGcpSandbox, handleDeleteGcpSandbox, handleGetGcpSandbox, handleBulkDeployGcp };
