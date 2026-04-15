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
                logger.info(`OCI sandbox expired for ${user.email}, cleaning up...`);
                await deleteOciSandbox(user.compartmentId, user.userId, user.policyId);
                user.status = 'deleted';
                await user.save();
                logger.info(`OCI sandbox marked as deleted: ${user.email}`);
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
