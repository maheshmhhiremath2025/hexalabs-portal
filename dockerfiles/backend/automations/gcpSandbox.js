const { logger } = require('./../plugins/logger');
const GcpSandboxUser = require('./../models/gcpSandboxUser');
let removeUserFromSharedProject, deleteSharedProject;
try {
  const shared = require('../services/gcpSharedProject');
  removeUserFromSharedProject = shared.removeUserFromSharedProject;
  deleteSharedProject = shared.deleteSharedProject;
} catch {}

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

// Direct GCP project deletion using googleapis SDK
let deleteGcpProject;
try {
  const { google } = require('googleapis');
  deleteGcpProject = async (projectId) => {
    const keyFile = process.env.KEYFILENAME;
    const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });
    await cloudResourceManager.projects.delete({ name: `projects/${projectId}` });
    logger.info(`GCP project ${projectId} deleted directly via SDK`);
  };
} catch {
  // googleapis not available — fall back to queue
  deleteGcpProject = async (projectId) => {
    const queues = require('./../controllers/newQueues');
    await queues['gcp-delete-project'].add({ projectId });
    logger.info(`Queued GCP project deletion (SDK unavailable): ${projectId}`);
  };
}

const MAX_CLEANUP_RETRIES = 3;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const gcpSandboxCleanup = async () => {
    try {
        logger.info("Running GCP sandbox cleanup...");
        const users = await GcpSandboxUser.find({});
        const now = new Date();

        for (const user of users) {
            try {
                let modified = false;

                for (const sb of user.sandbox) {
                    const deleteTime = sb.expiresAt ? new Date(sb.expiresAt) : sb.deleteTime ? new Date(sb.deleteTime) : null;
                    if (!deleteTime) continue;

                    const timeLeft = deleteTime - now;

                    // Warning email 30 min before expiry
                    if (timeLeft > 0 && timeLeft <= 30 * 60 * 1000 && !sb.warningEmailSent && sendEmail) {
                        try {
                            await sendEmail(user.email,
                                `GCP Sandbox ${sb.projectId} expires in ${Math.round(timeLeft / 60000)} minutes`,
                                `<p>Your GCP sandbox <strong>${sb.projectId}</strong> will be deleted in ${Math.round(timeLeft / 60000)} minutes. Save your work.</p>`
                            );
                            sb.warningEmailSent = true;
                            modified = true;
                        } catch (emailErr) {
                            logger.error(`Failed to send GCP warning email to ${user.email}: ${emailErr.message}`);
                        }
                    }

                    // Delete expired
                    if (deleteTime <= now) {
                        try {
                            // Stale safety net
                            const expiredMs = now - deleteTime;
                            if (expiredMs > STALE_THRESHOLD_MS) {
                                logger.error(`[CRITICAL] GCP sandbox ${sb.projectId} for ${user.email} has been expired for ${Math.round(expiredMs / 60000)} minutes and is still not cleaned up`);
                            }

                            if (sb.isShared && removeUserFromSharedProject) {
                                await removeUserFromSharedProject(sb.projectId, user.email);
                                const otherUsers = await GcpSandboxUser.countDocuments({
                                    'sandbox.projectId': sb.projectId,
                                    'sandbox.deleteTime': { $gt: now },
                                    email: { $ne: user.email },
                                });
                                if (otherUsers === 0 && deleteSharedProject) {
                                    await deleteSharedProject(sb.projectId);
                                    logger.info(`Shared project ${sb.projectId} deleted -- last user expired`);
                                } else {
                                    logger.info(`Removed ${user.email} from shared project ${sb.projectId} (${otherUsers} users remaining)`);
                                }
                            } else {
                                // Direct project deletion via SDK
                                try {
                                    await deleteGcpProject(sb.projectId);
                                    logger.info(`GCP sandbox project ${sb.projectId} deleted directly`);
                                } catch (directErr) {
                                    logger.error(`GCP direct delete failed for ${sb.projectId}: ${directErr.message}`);
                                }
                                // Also try queue as backup
                                try {
                                    const queues = require('./../controllers/newQueues');
                                    await queues['gcp-delete-project'].add({ projectId: sb.projectId });
                                } catch {}
                            }
                        } catch (sbErr) {
                            logger.error(`Failed to clean up GCP sandbox ${sb.projectId} for ${user.email}: ${sbErr.message}`);
                        }
                    }
                }

                if (modified) await user.save();

                // Delete expired user — check both expiresAt and endDate
                const userExpiry = user.expiresAt ? new Date(user.expiresAt) : user.endDate ? new Date(user.endDate) : null;
                if (userExpiry && userExpiry <= now) {
                    // Skip if max retries exceeded
                    if ((user.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
                        logger.error(`[CRITICAL] GCP cleanup for ${user.email} exceeded ${MAX_CLEANUP_RETRIES} retries, skipping. Last error: ${user.cleanupError}`);
                        continue;
                    }

                    try {
                        // Check if student still has remaining quota
                        const totalCap = user.totalCapHours || 0;
                        const hoursUsed = (user.usageSessions || []).reduce((sum, s) => sum + (s.ttlHours || 0), 0);
                        const hasQuotaLeft = totalCap === 0 || hoursUsed < totalCap;

                        // Always clean up GCP projects (resources)
                        for (const sb of user.sandbox) {
                            try {
                                await deleteGcpProject(sb.projectId);
                            } catch (directErr) {
                                logger.error(`GCP direct delete failed for ${sb.projectId}: ${directErr.message}`);
                            }
                            try {
                                const queues = require('./../controllers/newQueues');
                                await queues['gcp-delete-project'].add({ projectId: sb.projectId });
                            } catch {}
                        }

                        if (hasQuotaLeft) {
                            // Keep user for re-launch
                            logger.info(`GCP sandbox ${user.email}: session expired but quota remaining — keeping for re-launch`);
                            await GcpSandboxUser.updateOne({ _id: user._id }, {
                                $set: { expiresAt: null, sandbox: [], cleanupAttempts: 0, cleanupError: null },
                            });
                        } else {
                            await GcpSandboxUser.deleteOne({ _id: user._id });
                            logger.info(`Deleted expired GCP user: ${user.email} (quota exhausted)`);
                        }
                    } catch (cleanupErr) {
                        logger.error(`Failed to clean up expired GCP user ${user.email}: ${cleanupErr.message}`);
                        try {
                            await GcpSandboxUser.updateOne({ _id: user._id }, {
                                $inc: { cleanupAttempts: 1 },
                                $set: { cleanupError: cleanupErr.message, cleanupFailedAt: now },
                            });
                        } catch (dbErr) {
                            logger.error(`Failed to update cleanup status for GCP user ${user.email}: ${dbErr.message}`);
                        }
                    }
                }
            } catch (userErr) {
                logger.error(`GCP cleanup failed for user ${user.email || user._id}: ${userErr.message}`);
            }
        }
        logger.info("GCP sandbox cleanup completed.");
    } catch (err) {
        logger.error(`GCP sandbox cleanup error: ${err.message}`);
    }
};

module.exports = { gcpSandboxCleanup };
