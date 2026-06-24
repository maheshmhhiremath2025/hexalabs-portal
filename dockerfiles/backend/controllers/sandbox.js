const { logger } = require('./../plugins/logger');
const queues = require('./newQueues')
const SandboxUser = require('./../models/sandboxuser')
const User = require('./../models/user')
const { notifySandboxWelcomeEmail } = require('./../services/emailNotifications')


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
    const { userType, organization } = req.user;
    try {
        if (userType !== 'superadmin' && userType !== 'admin') {
            return res.status(403).send('Unauthorized access')
        }
        const filter = {};
        if (userType === 'admin') filter.organization = organization;
        else if (userType === 'superadmin' && req.query.organization) filter.organization = req.query.organization;
        const users = await SandboxUser.find(filter).lean();

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

        // Authorization: only admins/superadmins can delete other users.
        // A sandboxuser can only delete their own account.
        const callerType = req.user?.userType;
        const callerEmail = req.user?.email;
        if (callerType !== 'admin' && callerType !== 'superadmin') {
            if (callerEmail !== email) {
                logger.warn(`[sandbox] ${callerEmail} (${callerType}) tried to delete user ${email} — denied`);
                return res.status(403).send('You do not have permission to delete this user');
            }
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
    const { resourceGroupName, resourceGroupLocation } = req.body;
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
        const data = {
            resourceGroupName: resourceGroupName.trim(),
            resourceGroupLocation: resourceGroupLocation.trim(),
            userId: user.userId,
            budgetLimit: req.body.budgetLimit || 500,
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

        // Ownership check: only admins/superadmins, or the sandbox user who owns
        // this resource group, may delete it.
        const callerType = req.user?.userType;
        const callerEmail = req.user?.email;
        if (callerType !== 'admin' && callerType !== 'superadmin') {
            const ownerDoc = await SandboxUser.findOne({
                email: callerEmail,
                'sandbox.resourceGroupName': resourceGroupName,
            });
            if (!ownerDoc) {
                logger.warn(`[sandbox] ${callerEmail} (${callerType}) tried to delete ${resourceGroupName} — denied`);
                return res.status(403).json({ error: 'You do not have permission to delete this sandbox' });
            }
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
    if (userType === 'admin' && emails.length > 200) {
        return res.status(400).json({ error: `Batch size of ${emails.length} exceeds the 200-student cap for admin role.` });
    }
    // admin is locked to their own org; superadmin may target any org via body
    const targetOrg = userType === 'superadmin' && req.body.organization
        ? req.body.organization
        : req.user.organization;

    const SandboxTemplate = require('../models/sandboxTemplate');
    const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'azure' });
    if (!template) return res.status(404).json({ error: 'Azure template not found' });

    // Org-template entitlement: auto-associate for superadmin; clear 403 for admin.
    const { ensureTemplateAssociation } = require('../services/orgTemplateAssociation');
    const _assoc = await ensureTemplateAssociation({ targetOrg, templateSlug, userType, adminEmail });
    if (!_assoc.ok) return res.status(_assoc.status).json({ error: _assoc.error });

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

            const azResult = await createAzureSandbox(rgName, region, null, userEmail, { allowedVmSkus: template.allowedInstanceTypes?.azure });

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

                // If template has a custom role, replace the default role assignment
                if (template.customRoleId) {
                    try {
                        const { AuthorizationManagementClient } = require('@azure/arm-authorization');
                        const authClient = new AuthorizationManagementClient(credential, process.env.SUBSCRIPTION_ID);
                        const crypto = require('crypto');

                        // Get the Azure AD user's object ID from the sandbox credentials
                        const azureObjectId = azResult.objectId || azResult.principalId;
                        if (azureObjectId) {
                            // Remove default Contributor role and assign custom role
                            await authClient.roleAssignments.create(
                                scope,
                                crypto.randomUUID(),
                                {
                                    principalId: azureObjectId,
                                    roleDefinitionId: template.customRoleId,
                                    scope,
                                }
                            );
                            logger.info(`[bulk-deploy-azure] Custom role ${template.customRoleId.split('/').pop()} assigned to ${userEmail} on ${rgName}`);

                            // Remove the default sandbox role that createAzureSandbox
                            // hardcodes — when the template has its own customRoleId,
                            // students should only have that role, not the default.
                            try {
                                const DEFAULT_SANDBOX_ROLE_SUFFIX = '57fce75e-14f9-4736-84e6-9c55ba17b975';
                                const existing = [];
                                for await (const ra of authClient.roleAssignments.listForScope(scope)) existing.push(ra);
                                const defaultRA = existing.find(ra =>
                                    ra.roleDefinitionId && ra.roleDefinitionId.includes(DEFAULT_SANDBOX_ROLE_SUFFIX) &&
                                    ra.principalId === azureObjectId &&
                                    ra.scope === scope
                                );
                                if (defaultRA) {
                                    await authClient.roleAssignments.deleteById(defaultRA.id);
                                    logger.info(`[bulk-deploy-azure] Default sandbox role removed from ${userEmail} on ${rgName} (custom role takes precedence)`);
                                }
                            } catch (rmErr) {
                                logger.warn(`[bulk-deploy-azure] Could not remove default role on ${rgName}: ${rmErr.message}`);
                            }
                        }
                    } catch (roleErr) {
                        logger.error(`[bulk-deploy-azure] Custom role assignment failed for ${rgName}: ${roleErr.message}`);
                    }
                }
            } catch (policyErr) {
                logger.error(`[bulk-deploy-azure] Azure Policy failed for ${rgName}: ${policyErr.message}`);
            }

            // Per-user TTL override: read sandboxTtlHours from the user's stored record
            // and use it as the effective TTL. Falls back to request-level ttlHours, then 4h.
            // Was hardcoded at the body-default level — meant changing a user's preferred TTL
            // in Mongo had no effect on new deploys until this patch (stripedata cohort had
            // sandboxTtlHours=2 set on user docs but deploys still got 4h). /* per-user-ttl-2026-05-28 */
            const sbUserExisting = await SandboxUser.findOne({ email: userEmail }, 'sandboxTtlHours').lean();
            // ttlHours === 0 is the "no-cleanup" sentinel: sandbox lives until batchExpiresAt
            // (caller-supplied), else User.accessExpiresAt, else 30 days. usageSessions records
            // the computed wall-clock hours so daily/total caps still meter correctly.
            const rawTtl = (sbUserExisting && typeof sbUserExisting.sandboxTtlHours === 'number' && sbUserExisting.sandboxTtlHours > 0)
                ? sbUserExisting.sandboxTtlHours
                : ttlHours;
            const isNoCleanup = (rawTtl === 0);
            let expiresAt;
            if (req.body.expiresAt) {
                expiresAt = new Date(req.body.expiresAt);
            } else if (isNoCleanup) {
                if (req.body.batchExpiresAt) {
                    expiresAt = new Date(req.body.batchExpiresAt);
                } else {
                    const portalUserForExp = await User.findOne({ email: userEmail }, 'accessExpiresAt').lean();
                    expiresAt = (portalUserForExp && portalUserForExp.accessExpiresAt)
                        ? new Date(portalUserForExp.accessExpiresAt)
                        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                }
            } else {
                expiresAt = new Date(Date.now() + rawTtl * 60 * 60 * 1000);
            }
            const effectiveTtlHours = isNoCleanup
                ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)))
                : rawTtl;

            // Find or create sandbox user record for this email
            let sandboxUser = await SandboxUser.findOne({ email: userEmail });
            if (!sandboxUser) {
                // Create a minimal sandbox user record
                sandboxUser = new SandboxUser({
                    email: userEmail,
                    userId: `tpl-${cleanName}-${randSuffix}`,
                    duration: Math.ceil(effectiveTtlHours / 24) || 1,
                    credits: { total: 1, consumed: 0 },
                    startDate: new Date(),
                    endDate: expiresAt,
                });
            }
            // Latest batch wins — overwrite batchExpiresAt if caller provided one
            if (req.body.batchExpiresAt) sandboxUser.batchExpiresAt = new Date(req.body.batchExpiresAt);
            sandboxUser.organization = targetOrg;

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

            sandboxUser.sandboxTtlHours = rawTtl;
            sandboxUser.dailyCapHours = dailyCapHours;
            sandboxUser.totalCapHours = totalCapHours;
            sandboxUser.usageSessions.push({ startedAt: new Date(), ttlHours: effectiveTtlHours, templateSlug });
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
                await User.create({ email: userEmail, name: userEmail, password: 'Welcome1234!', userType: 'sandboxuser', organization: targetOrg });
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
        ttlHours,
        region,
        results,
        errors,
    });
}

// ===== BULK DELETE: appended via patch 2026-05-04 =====
// Mounted at POST /sandbox/bulk-delete-users
// Body: { cloud: 'azure'|'aws'|'gcp'|'oci', emails: [string, ...] }
// Admin: restricted to own org. Superadmin: any org.
// Tears down cloud resources + Mongo doc per email. Async; responds immediately with jobId.

const bulkDeleteJobs = new Map();

async function handleBulkDeleteSandboxUsers(req, res) {
    const { userType, organization: callerOrg } = req.user || {};
    if (userType !== 'admin' && userType !== 'superadmin') {
        return res.status(403).json({ error: 'Admin/superadmin access required' });
    }
    const { cloud, emails } = req.body || {};
    if (!cloud || !['azure', 'aws', 'gcp', 'oci'].includes(cloud)) {
        return res.status(400).json({ error: 'cloud must be azure|aws|gcp|oci' });
    }
    if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'emails array required' });
    }
    if (emails.length > 200) {
        return res.status(400).json({ error: 'max 200 emails per bulk-delete' });
    }

    // Org-scope check for admin
    if (userType === 'admin') {
        const Model = cloud === 'aws' ? require('../models/aws')
                    : cloud === 'gcp' ? require('../models/gcpSandboxUser')
                    : cloud === 'oci' ? require('../models/ociSandboxUser')
                    : require('../models/sandboxuser');
        const owned = await Model.find({ email: { $in: emails }, organization: callerOrg }).select('email').lean();
        const ownedSet = new Set(owned.map(u => u.email));
        const violators = emails.filter(e => !ownedSet.has(e));
        if (violators.length) {
            return res.status(403).json({ error: `Cannot delete users outside your org`, violators });
        }
    }

    const jobId = `bulkdel-${cloud}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = { jobId, cloud, total: emails.length, completed: 0, failed: 0, status: 'running', startedAt: Date.now(), errors: [], deletedEmails: [] };
    bulkDeleteJobs.set(jobId, job);
    res.json({ jobId, total: emails.length, status: 'running' });

    (async () => {
        for (const email of emails) {
            try {
                if (cloud === 'azure') {
                    await tearDownAzureSandboxUser(email);
                } else if (cloud === 'aws') {
                    await tearDownAwsSandboxUser(email);
                } else if (cloud === 'gcp') {
                    await tearDownGcpSandboxUser(email);
                } else if (cloud === 'oci') {
                    await tearDownOciSandboxUser(email);
                }
                job.completed++;
                job.deletedEmails.push(email);
                logger.info(`[bulk-delete-${cloud}] deleted ${email}`);
            } catch (e) {
                job.failed++;
                job.errors.push({ email, message: e.message });
                logger.error(`[bulk-delete-${cloud}] ${email} failed: ${e.message}`);
            }
        }
        job.status = 'done';
        job.durationMs = Date.now() - job.startedAt;
        logger.info(`[bulk-delete-${cloud}] job ${jobId} done: ${job.completed}/${job.total} ok in ${job.durationMs}ms`);
        setTimeout(() => bulkDeleteJobs.delete(jobId), 30 * 60 * 1000);
    })().catch(e => {
        job.status = 'failed';
        job.errors.push({ message: `Background fatal: ${e.message}` });
        logger.error(`[bulk-delete-${cloud}] job ${jobId} fatal: ${e.message}`);
    });
}

async function handleBulkDeleteStatus(req, res) {
    const job = bulkDeleteJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found or expired' });
    res.json(job);
}

// ----- per-cloud teardown (extracted from existing per-user delete handlers) -----

async function tearDownAzureSandboxUser(email) {
    const userDoc = await SandboxUser.findOne({ email });
    if (!userDoc) return;
    const azureUserId = userDoc.sandbox?.[0]?.credentials?.username || userDoc.userId;
    const sandboxEntries = userDoc.sandbox || [];
    userDoc.deletionStatus = 'deleting';
    await userDoc.save();

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
            const graphClient = Client.init({ authProvider: (done) => done(null, tokenRes.token) });
            await graphClient.api(`/users/${azureUserId}`).delete();
        } catch (e) { logger.warn(`[bulk-delete-azure] AAD ${azureUserId} delete: ${e.message}`); }
    }
    if (sandboxEntries.length) {
        try {
            const { ClientSecretCredential } = require('@azure/identity');
            const { ResourceManagementClient } = require('@azure/arm-resources');
            const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
            const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);
            for (const sb of sandboxEntries) {
                if (sb.resourceGroupName) {
                    try { await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName); }
                    catch (e) { logger.warn(`[bulk-delete-azure] RG ${sb.resourceGroupName}: ${e.message}`); }
                }
            }
        } catch (e) { logger.error(`[bulk-delete-azure] RG cleanup setup: ${e.message}`); }
    }
    try { await queues['azure-delete-user'].add({ email }); } catch {}
    await SandboxUser.deleteOne({ email });
}

async function tearDownAwsSandboxUser(email) {
    const awsUser = require('../models/aws');
    const userDoc = await awsUser.findOne({ email });
    if (!userDoc) return;
    userDoc.deletionStatus = 'deleting';
    await userDoc.save();
    try { await queues['aws-delete-user'].add({ email, userId: userDoc.userId }); } catch {}
    // The aws-delete-user worker does the IAM teardown; we wait briefly then delete the doc.
    // For best-effort sync delete: also try direct IAM cleanup here.
    try {
        const { IAMClient, DeleteAccessKeyCommand, DetachUserPolicyCommand, DeleteUserPolicyCommand,
                ListAccessKeysCommand, ListAttachedUserPoliciesCommand, ListUserPoliciesCommand,
                DeleteLoginProfileCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
        const iam = new IAMClient({
            region: process.env.AWS_REGION || 'ap-south-1',
            credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
        });
        const userName = userDoc.userId;
        const keys = await iam.send(new ListAccessKeysCommand({ UserName: userName }));
        for (const k of keys.AccessKeyMetadata || []) await iam.send(new DeleteAccessKeyCommand({ UserName: userName, AccessKeyId: k.AccessKeyId })).catch(() => {});
        const attached = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: userName }));
        for (const p of attached.AttachedPolicies || []) await iam.send(new DetachUserPolicyCommand({ UserName: userName, PolicyArn: p.PolicyArn })).catch(() => {});
        const inline = await iam.send(new ListUserPoliciesCommand({ UserName: userName }));
        for (const pn of inline.PolicyNames || []) await iam.send(new DeleteUserPolicyCommand({ UserName: userName, PolicyName: pn })).catch(() => {});
        await iam.send(new DeleteLoginProfileCommand({ UserName: userName })).catch(() => {});
        await iam.send(new DeleteUserCommand({ UserName: userName })).catch(() => {});
    } catch (e) { logger.warn(`[bulk-delete-aws] IAM ${email}: ${e.message}`); }
    await awsUser.deleteOne({ email });
}

async function tearDownGcpSandboxUser(email) {
    const GcpSandboxUser = require('../models/gcpSandboxUser');
    const userDoc = await GcpSandboxUser.findOne({ email });
    if (!userDoc) return;
    userDoc.deletionStatus = 'deleting';
    await userDoc.save();
    // Delete each GCP project
    try {
        const { ProjectsClient } = require('@google-cloud/resource-manager');
        const client = new ProjectsClient({ keyFilename: process.env.KEYFILENAME });
        for (const sb of userDoc.sandbox || []) {
            if (sb.projectId) {
                try { await client.deleteProject({ name: `projects/${sb.projectId}` }); }
                catch (e) { logger.warn(`[bulk-delete-gcp] project ${sb.projectId}: ${e.message}`); }
            }
        }
    } catch (e) { logger.warn(`[bulk-delete-gcp] setup ${email}: ${e.message}`); }
    await GcpSandboxUser.deleteOne({ email });
}

async function tearDownOciSandboxUser(email) {
    const OciSandboxUser = require('../models/ociSandboxUser');
    const { deleteOciSandbox } = require('../services/ociSandbox');
    const doc = await OciSandboxUser.findOne({ email });
    if (!doc) return;
    try {
        await deleteOciSandbox(doc.compartmentId, doc.userId, doc.policyId);
        await OciSandboxUser.deleteOne({ email });
        logger.info(`[bulk-delete-oci] OCI sandbox + DB record removed for ${email}`);
    } catch (err) {
        logger.error(`[bulk-delete-oci] cleanup failed for ${email}: ${err.message}`);
        await OciSandboxUser.updateOne(
            { email },
            { $set: { cleanupError: err.message, cleanupFailedAt: new Date() }, $inc: { cleanupAttempts: 1 } }
        );
    }
}

// ===== END BULK DELETE =====

module.exports = { handleCreateSandboxUser, handleCreateSandbox, handleDeleteSandbox, handleGetSandbox, handleDeleteSandboxUser, handleGetSandboxUser, handleBulkCreateUsers, handleBulkStatus, handleBulkDeployAzure, handleBulkDeleteSandboxUsers, handleBulkDeleteStatus };
