const { logger } = require('./../plugins/logger');
const OciSandboxUser = require('./../models/ociSandboxUser');
const { deleteOciSandbox } = require('./../services/ociSandbox');

const MAX_CLEANUP_RETRIES = 3;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const ociSandboxCleanup = async () => {
    try {
        logger.info("Running OCI sandbox cleanup...");
        const now = new Date();

        // Find expired sandboxes that have not been deleted yet
        const expiredUsers = await OciSandboxUser.find({
            expiresAt: { $lte: now },
            status: { $ne: 'deleted' },
        });

        for (const user of expiredUsers) {
            // Stale safety net
            const expiredMs = now - new Date(user.expiresAt);
            if (expiredMs > STALE_THRESHOLD_MS) {
                logger.error(`[CRITICAL] OCI sandbox for ${user.email} has been expired for ${Math.round(expiredMs / 60000)} minutes and is still not cleaned up`);
            }

            // Skip if max retries exceeded
            if ((user.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
                logger.error(`[CRITICAL] OCI cleanup for ${user.email} exceeded ${MAX_CLEANUP_RETRIES} retries, skipping. Last error: ${user.cleanupError}`);
                continue;
            }

            try {
                // Check if student still has remaining quota
                const totalCap = user.totalCapHours || 0;
                const hoursUsed = (user.usageSessions || []).reduce((sum, s) => sum + (s.ttlHours || 0), 0);
                const hasQuotaLeft = totalCap === 0 || hoursUsed < totalCap;

                logger.info(`OCI sandbox expired for ${user.email}, cleaning up resources...`);
                await deleteOciSandbox(user.compartmentId, user.userId, user.policyId);

                if (hasQuotaLeft) {
                    // Keep user for re-launch
                    logger.info(`OCI sandbox ${user.email}: resources cleaned but quota remaining — keeping for re-launch`);
                    await OciSandboxUser.updateOne({ _id: user._id }, {
                        $set: { expiresAt: null, status: 'expired', cleanupAttempts: 0, cleanupError: null,
                                compartmentId: null, userId: null, policyId: null },
                    });
                } else {
                    user.status = 'deleted';
                    await user.save();
                    logger.info(`OCI sandbox marked as deleted: ${user.email} (quota exhausted)`);
                }
            } catch (e) {
                logger.error(`OCI resource cleanup failed for ${user.email}: ${e.message}`);
                try {
                    await OciSandboxUser.updateOne({ _id: user._id }, {
                        $inc: { cleanupAttempts: 1 },
                        $set: { cleanupError: e.message, cleanupFailedAt: now },
                    });
                } catch (dbErr) {
                    logger.error(`Failed to update cleanup status for OCI user ${user.email}: ${dbErr.message}`);
                }
            }
        }

        logger.info("OCI sandbox cleanup completed.");
    } catch (error) {
        logger.error(`OCI sandbox cleanup error: ${error.message}`);
    }
};

module.exports = { ociSandboxCleanup };
