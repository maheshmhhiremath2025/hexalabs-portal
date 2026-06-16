const { logger } = require('./../plugins/logger');
const SandboxUser = require('./../models/sandboxuser');

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

const MAX_CLEANUP_RETRIES = 3;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const azureSandbox = async () => {
    try {
        logger.info("Running Azure sandbox cleanup automation...");
        const users = await SandboxUser.find({ deletionStatus: { $ne: 'deleting' } });
        const now = new Date();

        for (const user of users) {
            try {
                const { email, sandbox, endDate, expiresAt } = user;
                let modified = false;

                // Check each sandbox entry
                for (let i = sandbox.length - 1; i >= 0; i--) {
                    const sb = sandbox[i];
                    const expiry = sb.expiresAt ? new Date(sb.expiresAt) : sb.deleteTime ? new Date(sb.deleteTime) : null;
                    if (!expiry) continue;

                    const timeLeft = expiry - now;
                    const minutesLeft = Math.round(timeLeft / 60000);

                    // Warning email 30 minutes before expiry
                    if (timeLeft > 0 && timeLeft <= 30 * 60 * 1000 && !sb.warningEmailSent && sendEmail) {
                        try {
                            await sendEmail(email,
                                `Sandbox ${sb.resourceGroupName} expires in ${minutesLeft} minutes`,
                                `<div style="font-family: -apple-system, sans-serif; max-width: 500px;">
                                    <div style="background: #f59e0b; padding: 16px 20px; border-radius: 8px 8px 0 0;">
                                        <h2 style="color: white; margin: 0; font-size: 16px;">Sandbox Expiring Soon</h2>
                                    </div>
                                    <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                                        <p style="color: #374151;">Your sandbox <strong>${sb.resourceGroupName}</strong> will be automatically deleted in <strong>${minutesLeft} minutes</strong>.</p>
                                        <p style="color: #6b7280; font-size: 13px;">Save any important work before it expires.</p>
                                    </div>
                                </div>`
                            );
                            sb.warningEmailSent = true;
                            modified = true;
                            logger.info(`Warning email sent to ${email} for sandbox ${sb.resourceGroupName}`);
                        } catch (err) {
                            logger.error(`Failed to send warning email: ${err.message}`);
                        }
                    }

                    // Delete expired sandbox — DIRECTLY, not via queue
                    if (expiry <= now && sb.status !== 'deleted') {
                        const expiredMs = now - expiry;
                        if (expiredMs > STALE_THRESHOLD_MS) {
                            logger.error(`[CRITICAL] Azure sandbox ${sb.resourceGroupName} for ${email} expired ${Math.round(expiredMs / 60000)} min ago — still alive`);
                        }

                        try {
                            const { ClientSecretCredential } = require('@azure/identity');
                            const { ResourceManagementClient } = require('@azure/arm-resources');
                            const { ManagementLockClient } = require('@azure/arm-locks');
                            const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
                            const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);

                            // Strip any learner-applied resource locks before delete.
                            // Hit a `ReadOnly` lock on a VM inside lab-b2b-navaneetha.kumar-5xxe-sbx
                            // that blocked cleanup indefinitely (learner-applied via az lock create).
                            // Lock-bypass = forever-orphan VM bill. List + remove every lock in
                            // the RG scope (which covers nested-resource locks too) before delete.
                            try {
                                const lockClient = new ManagementLockClient(credential, process.env.SUBSCRIPTION_ID);
                                const locks = [];
                                for await (const l of lockClient.managementLocks.listAtResourceGroupLevel(sb.resourceGroupName)) {
                                    locks.push(l);
                                }
                                for (const l of locks) {
                                    try {
                                        const scope = l.id.replace(/\/providers\/Microsoft\.Authorization\/locks\/.*$/, '');
                                        await lockClient.managementLocks.deleteByScope(scope, l.name);
                                        logger.info(`Azure RG ${sb.resourceGroupName}: stripped lock "${l.name}" before delete`);
                                    } catch (lockErr) {
                                        logger.warn(`Azure RG ${sb.resourceGroupName}: failed to strip lock ${l.name}: ${lockErr.message}`);
                                    }
                                }
                            } catch (listLockErr) {
                                logger.warn(`Azure RG ${sb.resourceGroupName}: lock-list pre-check failed (proceeding anyway): ${listLockErr.message}`);
                            }

                            await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
                            logger.info(`Azure RG ${sb.resourceGroupName} deleted (expired) for ${email}`);

                            sb.status = 'deleted';
                            modified = true;
                        } catch (delErr) {
                            logger.error(`Azure RG ${sb.resourceGroupName} cleanup failed: ${delErr.message}`);
                        }

                        // Also try queue as backup
                        try {
                            const queues = require('./../controllers/newQueues');
                            await queues['azure-delete-sandbox'].add({ resourceGroupName: sb.resourceGroupName });
                        } catch {}
                    }
                }

                if (modified) await user.save();

                // If user-level expiry has passed, delete the Azure AD user too
                const userExpiry = expiresAt ? new Date(expiresAt) : endDate ? new Date(endDate) : null;
                if (userExpiry && userExpiry <= now && user.deletionStatus !== 'deleting') {
                    // Skip if max retries exceeded
                    if ((user.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
                        logger.error(`[CRITICAL] Azure cleanup for ${email} exceeded ${MAX_CLEANUP_RETRIES} retries, skipping`);
                        continue;
                    }

                    // P1-12: gate on allDeleted-OR-abandoned. A single
                    // sandbox stuck in a non-'deleted' state (delete API
                    // failure, RG already gone, etc.) used to block AAD-user
                    // reap forever. Treat sandboxes whose expiresAt is more
                    // than 24h in the past as effectively-done for gating.
                    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    const allDeletedOrAbandoned = sandbox.every(sb =>
                        sb.status === 'deleted' ||
                        (sb.expiresAt && new Date(sb.expiresAt) < oneDayAgo)
                    );
                    if (!allDeletedOrAbandoned) continue; // Wait for sandbox cleanup to finish

                    try {
                        // Check if student still has remaining quota.
                        // endDatePassed is the absolute cohort cutoff; once it fires,
                        // hasQuotaLeft must be false so the soft-cleanup branch doesn't
                        // loop forever for unlimited-quota users (totalCap=0).
                        const totalCap = user.totalCapHours || 0;
                        const hoursUsed = (user.usageSessions || []).reduce((sum, s) => sum + (s.ttlHours || 0), 0);
                        const endDatePassed = user.endDate && new Date(user.endDate) < now;
                        const hasQuotaLeft = !endDatePassed && (totalCap === 0 || hoursUsed < totalCap);

                        if (hasQuotaLeft) {
                            // Keep user for re-launch — just clear expiry
                            logger.info(`Azure sandbox ${email}: session expired but quota remaining — keeping for re-launch`);
                            await SandboxUser.updateOne({ _id: user._id }, {
                                $set: { expiresAt: null, cleanupAttempts: 0, cleanupError: null },
                            });
                        } else {
                            // Quota exhausted — full cleanup
                            const azureUserId = sandbox[0]?.credentials?.username || user.userId;
                            if (azureUserId) {
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

                                try {
                                    await graphClient.api(`/users/${azureUserId}`).delete();
                                    logger.info(`Azure AD user ${azureUserId} deleted (quota exhausted) for ${email}`);
                                } catch (adErr) {
                                    logger.warn(`Azure AD user delete failed: ${adErr.message}`);
                                }
                            }

                            await SandboxUser.deleteOne({ _id: user._id });
                            logger.info(`Azure sandbox user ${email} cleaned up (quota exhausted)`);
                        }
                    } catch (err) {
                        logger.error(`Azure user cleanup failed for ${email}: ${err.message}`);
                        await SandboxUser.updateOne({ _id: user._id }, {
                            $inc: { cleanupAttempts: 1 },
                            $set: { cleanupError: err.message, cleanupFailedAt: now },
                        });
                    }
                }
            } catch (userErr) {
                logger.error(`Azure cleanup failed for user ${user.email || user._id}: ${userErr.message}`);
            }
        }

        logger.info("Azure sandbox cleanup process completed.");
    } catch (error) {
        logger.error(`Error in azureSandbox cleanup: ${error.message}`);
    }
};

module.exports = { azureSandbox };
