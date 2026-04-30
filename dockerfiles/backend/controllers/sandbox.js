const { logger } = require('./../plugins/logger');
const queues = require('./newQueues')
const SandboxUser = require('./../models/sandboxuser')
const User = require('./../models/user')
const { notifySandboxWelcomeEmail } = require('./../services/emailNotifications')

// Sandbox type → custom Azure role/initiative IDs (types not listed here use worker defaults)
const SANDBOX_TYPE_CONFIG = {
    databricks: {
        customRoleId: '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/roleDefinitions/1043b243-4369-4a1b-a537-972204808823',
        policyInitiativeId: '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/policySetDefinitions/ae62970e3e1c40d1b8dd0827',
    },
};

async function handleGetSandbox(req, res) {
    const { email, userType } = req.user;
    try {
        if (userType !== 'sandboxuser') {
            return res.status(403).send('Unauthorized access')
        }
        if (!email) {
            return res.status(400).send('Invalid request please share email')
        }
        const user = await SandboxUser.findOne({ email }).lean();
        if (!user) {
            return res.status(404).send('User not found')
        }
        return res.status(200).send(user)
    } catch (error) {
        logger.error("Error in getting sandbox", error)
        return res.status(500).send('Internal server error')
    }
}

async function handleGetSandboxUser(req, res) {
    const { userType } = req.user;
    try {
        if (userType !== 'superadmin' && userType !== 'admin') {
            return res.status(403).send('Unauthorized access')
        }
        const users = await SandboxUser.find().lean();

        return res.status(200).send(users)
    } catch (error) {
        logger.error("Error in getting sandbox users", error)
        return res.status(500).send('Internal server error')
    }
}

async function handleCreateSandboxUser(req, res) {
    const { username, duration, personalEmail, sandboxTtlHours = 4, credits = 1, maxConcurrentSandboxes = 3 } = req.body;
    try {
        if (!username || !duration) {
            return res.status(400).send('Invalid request please share username and duration')
        }
        const data = { username, duration, personalEmail, sandboxTtlHours, credits, maxConcurrentSandboxes };
        await queues['azure-create-user'].add(data);
        return res.status(200).send('User created successfully')
    } catch (error) {
        logger.error('Error in creating sandbox user', error)
        return res.status(500).send('Internal server error')
    }
}

async function handleDeleteSandboxUser(req, res) {
    const { email } = req.body
    try {
        if (!email) {
            return res.status(400).send('Invalid request please share email')
        }

        // 1. Mark as deleting before starting cleanup
        const userDoc = await SandboxUser.findOne({ email });
        if (!userDoc) {
            return res.status(404).send('User not found');
        }
        const azureUserId = userDoc.sandbox?.[0]?.credentials?.username || userDoc.userId;
        const sandboxEntries = userDoc.sandbox || [];
        userDoc.deletionStatus = 'deleting';
        await userDoc.save();

        // 2. Respond immediately so frontend can poll
        res.status(200).send('User deletion started');

        // 3. Perform cloud cleanup in background
        try {
            // Delete Azure AD user directly (don't rely on queue/worker)
            if (azureUserId) {
                try {
                    const { ClientSecretCredential } = require('@azure/identity');
                    require('isomorphic-fetch');
                    const { Client } = require('@microsoft/microsoft-graph-client');

                    const identityCredential = new ClientSecretCredential(
                        process.env.IDENTITY_TENANT_ID || process.env.TENANT_ID,
                        process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
                        process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
                    );
                    const tokenRes = await identityCredential.getToken('https://graph.microsoft.com/.default');
                    const graphClient = Client.init({
                        authProvider: (done) => done(null, tokenRes.token),
                    });

                    await graphClient.api(`/users/${azureUserId}`).delete();
                    logger.info(`Azure AD user ${azureUserId} deleted directly for ${email}`);
                } catch (azureErr) {
                    logger.error(`Azure AD user ${azureUserId} direct deletion failed for ${email}: ${azureErr.message}. User may still exist in Azure AD.`);
                }
            }

            // Delete all associated resource groups directly
            if (sandboxEntries.length) {
                try {
                    const { ClientSecretCredential } = require('@azure/identity');
                    const { ResourceManagementClient } = require('@azure/arm-resources');

                    const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
                    const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);

                    for (const sb of sandboxEntries) {
                        if (sb.resourceGroupName) {
                            try {
                                await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
                                logger.info(`Azure resource group ${sb.resourceGroupName} deleted directly for ${email}`);
                            } catch (rgErr) {
                                logger.error(`Azure resource group ${sb.resourceGroupName} direct deletion failed: ${rgErr.message}`);
                            }
                        }
                    }
                } catch (rgSetupErr) {
                    logger.error(`Azure resource group cleanup setup failed for ${email}: ${rgSetupErr.message}`);
                }
            }

            // Also try queue as backup (for production with workers running)
            try {
                await queues['azure-delete-user'].add({ email });
            } catch {}

            // On success: delete the DB record
            await SandboxUser.deleteOne({ email });
            logger.info(`Azure sandbox user ${email} deleted from DB`);
        } catch (cleanupErr) {
            // On failure: mark as failed, keep the record
            logger.error(`Azure sandbox user ${email} cleanup failed: ${cleanupErr.message}`);
            await SandboxUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
    } catch (error) {
        logger.error('Error in deleting sandbox user', error)
        if (!res.headersSent) {
            return res.status(500).send('Internal server error')
        }
    }
}

async function handleCreateSandbox(req, res) {
    const { resourceGroupName, resourceGroupLocation, sandboxType } = req.body;
    const { email, userType } = req.user;

    try {
        // ✅ Check if user is allowed to create sandboxes
        if (userType !== 'sandboxuser') {
            return res.status(403).json({ error: 'Unauthorized access' });
        }

        // ✅ Validate input fields
        if (!resourceGroupName || !resourceGroupLocation) {
            return res.status(400).json({ error: 'Invalid request. Please provide resourceGroupName and resourceGroupLocation' });
        }

        // ✅ Find user in the database
        const user = await SandboxUser.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // ✅ Check for available credits
        const totalCredits = user.credits?.total || 0;
        const consumedCredits = user.credits?.consumed || 0;
        const availableCredits = totalCredits - consumedCredits;

        if (availableCredits <= 0) {
            return res.status(403).json({ error: 'User does not have enough credits to create a sandbox' });
        }

        // ✅ Check concurrent sandbox limit
        const activeSandboxes = (user.sandbox || []).length;
        const maxConcurrent = user.maxConcurrentSandboxes || 3;
        if (activeSandboxes >= maxConcurrent) {
            return res.status(403).json({ error: `Maximum ${maxConcurrent} concurrent sandboxes allowed. Delete one first.` });
        }

        // ✅ Prepare the sandbox creation request
        const typeConfig = SANDBOX_TYPE_CONFIG[sandboxType] || {};
        const data = {
            resourceGroupName: resourceGroupName.trim(),
            resourceGroupLocation: resourceGroupLocation.trim(),
            userId: user.userId,
            budgetLimit: req.body.budgetLimit || 500,
            ...(typeConfig.customRoleId && { customRoleId: typeConfig.customRoleId }),
            ...(typeConfig.policyInitiativeId && { policyInitiativeId: typeConfig.policyInitiativeId }),
        };

        // ✅ Add job to Azure create sandbox queue
        await queues['azure-create-sandbox'].add(data);

        logger.info(`Sandbox creation request submitted for user: ${email}`, { data });
        return res.status(200).json({ message: 'Sandbox creation request submitted successfully' });

    } catch (error) {
        logger.error('❌ Error in creating sandbox', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
}


async function handleDeleteSandbox(req, res) {
    const { resourceGroupName } = req.body;
    try {

        if (!resourceGroupName) {
            return res.status(400).json({ error: 'Invalid request. Please provide resourceGroupName' });
        }

        // 1. Delete resource group directly via Azure SDK
        try {
            const { ClientSecretCredential } = require('@azure/identity');
            const { ResourceManagementClient } = require('@azure/arm-resources');

            const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
            const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);

            await resourceClient.resourceGroups.beginDeleteAndWait(resourceGroupName);
            logger.info(`Azure resource group ${resourceGroupName} deleted directly`);
        } catch (azureErr) {
            logger.error(`Azure resource group ${resourceGroupName} direct deletion failed: ${azureErr.message}. Resource group may still exist.`);
        }

        // 2. Remove sandbox from user's DB record
        try {
            await SandboxUser.updateOne(
                { 'sandbox.resourceGroupName': resourceGroupName },
                { $pull: { sandbox: { resourceGroupName } }, $inc: { 'credits.consumed': -1 } }
            );
        } catch (dbErr) {
            logger.error(`DB cleanup for sandbox ${resourceGroupName} failed: ${dbErr.message}`);
        }

        // 3. Also try queue as backup (for production with workers running)
        try {
            await queues['azure-delete-sandbox'].add({ resourceGroupName });
        } catch {}

        logger.info(`Sandbox deletion completed for: ${resourceGroupName}`);
        return res.status(200).json({ message: 'Sandbox deletion request submitted successfully' });

    } catch (error) {
        logger.error('Error in deleting sandbox', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
}


// Bulk user creation with job tracking
const bulkJobs = new Map();

async function handleBulkCreateUsers(req, res) {
    const { users, platform = 'azure', sandboxTtlHours = 4, credits = 1 } = req.body; // users = [{ username, personalEmail }]
    if (!users?.length) return res.status(400).json({ message: 'users array required' });

    const jobId = `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bulkJobs.set(jobId, { status: 'running', total: users.length, completed: 0, failed: 0, current: '', startedAt: Date.now() });
    res.json({ jobId, total: users.length });

    // Background processing
    (async () => {
        const job = bulkJobs.get(jobId);
        for (let i = 0; i < users.length; i++) {
            const u = users[i];
            job.current = `Creating ${u.username} (${i + 1}/${users.length})`;
            try {
                const queueName = platform === 'aws' ? 'aws-create-user' : 'azure-create-user';
                await queues[queueName].add({
                    username: u.username,
                    personalEmail: u.personalEmail,
                    duration: u.duration || 5,
                    sandboxTtlHours,
                    credits,
                });
                job.completed++;
            } catch {
                job.failed++;
            }
        }
        job.status = 'done';
        job.current = '';
        job.duration = Math.round((Date.now() - job.startedAt) / 1000);
        setTimeout(() => bulkJobs.delete(jobId), 5 * 60 * 1000);
    })();
}

async function handleBulkStatus(req, res) {
    const job = bulkJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json({
        status: job.status, total: job.total, completed: job.completed, failed: job.failed,
        current: job.current, progress: job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0,
        duration: job.duration || Math.round((Date.now() - job.startedAt) / 1000),
    });
}

/**
 * POST /sandbox/bulk-deploy-azure
 * Bulk deploy Azure sandboxes from a template for a list of emails.
 * Creates Azure AD user + resource group + role assignment per email.
 * Stores templateId, allowedServices, blockedServices on each sandbox record.
 */
async function handleBulkDeployAzure(req, res) {
    const { userType, email: adminEmail } = req.user || {};
    if (userType !== 'admin' && userType !== 'superadmin') {
        return res.status(403).json({ error: 'Admin/superadmin access required' });
    }

    const { templateSlug, emails, ttlHours = 4, region = 'southindia', dailyCapHours = 12, totalCapHours = 0 } = req.body;
    if (!templateSlug) return res.status(400).json({ error: 'templateSlug is required' });
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'emails array is required and must not be empty' });
    }

    const SandboxTemplate = require('../models/sandboxTemplate');
    const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'azure' });
    if (!template) return res.status(404).json({ error: 'Azure template not found' });

    const { createAzureSandbox } = require('../services/directSandbox');

    const results = [];
    const errors = [];

    for (let i = 0; i < emails.length; i++) {
        const userEmail = emails[i].trim().toLowerCase();
        if (!userEmail) continue;

        try {
            const randSuffix = Math.random().toString(36).slice(2, 6);
            const cleanName = userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12);
            const rgName = `tpl-${(template.certificationCode || template.slug).slice(0, 10)}-${cleanName}-${randSuffix}-sbx`.toLowerCase().slice(0, 60);

            const azResult = await createAzureSandbox(rgName, region, null, userEmail, template.customRoleId);

            // Apply Azure Policies
            try {
                const { ClientSecretCredential } = require('@azure/identity');
                const { PolicyClient } = require('@azure/arm-policy');
                const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
                const policyClient = new PolicyClient(credential, process.env.SUBSCRIPTION_ID);
                const scope = `/subscriptions/${process.env.SUBSCRIPTION_ID}/resourceGroups/${rgName}`;

                if (template.policyInitiativeId) {
                    // Template has a pre-built policy initiative — apply it directly
                    await policyClient.policyAssignments.create(scope, `sb-init-${rgName.slice(0, 38)}`, {
                        policyDefinitionId: template.policyInitiativeId,
                        displayName: `Sandbox: ${template.name}`,
                    });
                    logger.info(`[bulk-deploy-azure] Policy initiative applied to ${rgName}`);
                } else {
                    // Standard sandbox — apply individual policies
                    const { applyAllSandboxPolicies } = require('../services/azureSandboxPolicies');
                    await applyAllSandboxPolicies(policyClient, process.env.SUBSCRIPTION_ID, rgName, template, region);
                }

                // Custom role is now handled by createAzureSandbox() via the customRoleId parameter
            } catch (policyErr) {
                logger.error(`[bulk-deploy-azure] Azure Policy failed for ${rgName}: ${policyErr.message}`);
            }

            const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + ttlHours * 60 * 60 * 1000);

            // Find or create sandbox user record for this email
            let sandboxUser = await SandboxUser.findOne({ email: userEmail });
            if (!sandboxUser) {
                // Create a minimal sandbox user record
                sandboxUser = new SandboxUser({
                    email: userEmail,
                    userId: `tpl-${cleanName}-${randSuffix}`,
                    duration: Math.ceil(ttlHours / 24) || 1,
                    credits: { total: 1, consumed: 0 },
                    startDate: new Date(),
                    endDate: expiresAt,
                });
            }

            // Push sandbox entry with template fields
            sandboxUser.sandbox.push({
                resourceGroupName: rgName,
                location: region,
                createdTime: new Date(),
                deleteTime: expiresAt,
                expiresAt,
                status: 'ready',
                accessUrl: azResult.accessUrl,
                credentials: {
                    username: azResult.username,
                    password: azResult.password,
                },
                templateId: template._id,
                allowedServices: (template.allowedServices || []).map(s => ({
                    service: s.service,
                    category: s.category,
                    restrictions: s.restrictions,
                })),
                blockedServices: (template.blockedServices || []).map(s => ({
                    service: s.service,
                    reason: s.reason,
                })),
            });

            sandboxUser.dailyCapHours = dailyCapHours;
            sandboxUser.totalCapHours = totalCapHours;
            sandboxUser.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug });
            await sandboxUser.save();

            results.push({
                email: userEmail,
                resourceGroupName: rgName,
                username: azResult.username,
                password: azResult.password,
                accessUrl: azResult.accessUrl,
                expiresAt,
            });

            // Auto-create portal login
            const existingUser = await User.findOne({ email: userEmail });
            if (!existingUser) {
                await User.create({ email: userEmail, name: userEmail, password: 'Welcome1234!', userType: 'sandboxuser', organization: template.name });
            }

            // Send welcome email
            notifySandboxWelcomeEmail({
                email: userEmail, cloud: 'azure', portalPassword: 'Welcome1234!',
                sandboxUsername: azResult.username, sandboxPassword: azResult.password,
                sandboxAccessUrl: azResult.accessUrl, region,
                expiresAt, templateName: template.name,
                allowedServices: template.allowedServices, blockedServices: template.blockedServices,
                resourceGroupName: rgName,
            }).catch(e => logger.error(`Welcome email failed for ${userEmail}: ${e.message}`));

            logger.info(`[bulk-deploy-azure] deployed ${rgName} for ${userEmail} from template ${templateSlug}`);
        } catch (err) {
            logger.error(`[bulk-deploy-azure] failed for ${userEmail}: ${err.message}`);
            errors.push({ email: userEmail, error: err.message });
        }
    }

    return res.json({
        total: emails.length,
        deployed: results.length,
        failed: errors.length,
        templateSlug,
        templateName: template.name,
        ttlHours,
        region,
        results,
        errors,
    });
}

module.exports = { handleCreateSandboxUser, handleCreateSandbox, handleDeleteSandbox, handleGetSandbox, handleDeleteSandboxUser, handleGetSandboxUser, handleBulkCreateUsers, handleBulkStatus, handleBulkDeployAzure };
