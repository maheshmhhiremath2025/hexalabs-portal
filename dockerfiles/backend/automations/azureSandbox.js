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
                            const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
                            const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);

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

                    // Check if all sandboxes are deleted
                    const allDeleted = sandbox.every(sb => sb.status === 'deleted');
                    if (!allDeleted) continue; // Wait for sandbox cleanup to finish

                    try {
                        // Check if student still has remaining quota
                        const totalCap = user.totalCapHours || 0;
                        const hoursUsed = (user.usageSessions || []).reduce((sum, s) => sum + (s.ttlHours || 0), 0);
                        const hasQuotaLeft = totalCap === 0 || hoursUsed < totalCap;

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
