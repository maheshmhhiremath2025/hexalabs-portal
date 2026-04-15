/**
 * ARO Cluster Cleanup Automation
 *
 * Runs every 5 minutes (registered in index.js).
 *
 * Responsibilities:
 *   1. Delete expired clusters (expiresAt < now, status != deleted)
 *   2. Night scale-down / morning scale-up for cost optimization
 *   3. Update running cost totals
 *
 * Each cluster is handled in its own try-catch so one failure does not
 * block cleanup of other clusters.
 */
const { logger } = require('./../plugins/logger');
const AroCluster = require('./../models/aroCluster');
const aroService = require('./../services/aroService');

const MAX_CLEANUP_RETRIES = 3;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

async function aroCleanup() {
  try {
    logger.info('[aro-cleanup] Running ARO cluster cleanup...');

    const clusters = await AroCluster.find({ status: { $nin: ['deleted', 'failed'] } });
    const now = new Date();

    for (const cluster of clusters) {
      // ---------------------------------------------------------------
      // 1. Expired cluster deletion
      // ---------------------------------------------------------------
      if (cluster.expiresAt && new Date(cluster.expiresAt) < now && cluster.status !== 'deleting') {
        // Stale safety net
        const expiredMs = now - new Date(cluster.expiresAt);
        if (expiredMs > STALE_THRESHOLD_MS) {
          logger.error(`[CRITICAL] ARO cluster ${cluster.name} (${cluster.clusterId}) expired ${Math.round(expiredMs / 60000)} minutes ago and is still not cleaned up`);
        }

        // Skip if max retries exceeded
        if ((cluster.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
          logger.error(`[CRITICAL] ARO cleanup for ${cluster.name} exceeded ${MAX_CLEANUP_RETRIES} retries, skipping. Last error: ${cluster.cleanupError}`);
          continue;
        }

        try {
          logger.info(`[aro-cleanup] Cluster ${cluster.name} expired, initiating deletion...`);

          // Remove all active student namespaces
          for (const student of cluster.students) {
            if (student.status === 'active') {
              try {
                await aroService.removeStudentFromCluster({
                  apiUrl: cluster.apiUrl,
                  adminUsername: cluster.adminUsername,
                  adminPassword: cluster.adminPassword,
                  namespace: student.namespace,
                  username: student.username,
                });
                student.status = 'deleted';
              } catch (err) {
                logger.error(`[aro-cleanup] Failed to remove student ${student.email} from ${cluster.name}: ${err.message}`);
              }
            }
          }

          // Delete the cluster
          await aroService.deleteAroCluster(cluster.resourceGroup, cluster.name);
          cluster.status = 'deleted';
          await cluster.save();
          logger.info(`[aro-cleanup] Cluster ${cluster.name} marked as deleted`);
        } catch (err) {
          logger.error(`[aro-cleanup] Failed to delete cluster ${cluster.name}: ${err.message}`);
          try {
            await AroCluster.updateOne({ _id: cluster._id }, {
              $inc: { cleanupAttempts: 1 },
              $set: { cleanupError: err.message, cleanupFailedAt: new Date() },
            });
          } catch (dbErr) {
            logger.error(`[aro-cleanup] Failed to update cleanup status for ${cluster.name}: ${dbErr.message}`);
          }
        }

        continue; // Skip cost/scaling for clusters being deleted
      }

      // ---------------------------------------------------------------
      // 2. Night scale-down / morning scale-up
      // ---------------------------------------------------------------
      if (cluster.status === 'ready') {
        try {
          const scaleResult = await aroService.scheduleNightScale(cluster);

          if (scaleResult.action === 'scale-down') {
            await aroService.scaleAroCluster(cluster.resourceGroup, cluster.name, 0);
            cluster.workerNodes = 0;
            cluster.estimatedHourlyCostInr = await aroService.estimateHourlyCost(0, cluster.workerVmSize);
            await cluster.save();
            logger.info(`[aro-cleanup] Night scale-down complete for ${cluster.name}`);
          } else if (scaleResult.action === 'scale-up') {
            const targetNodes = scaleResult.targetNodes;
            await aroService.scaleAroCluster(cluster.resourceGroup, cluster.name, targetNodes);
            cluster.workerNodes = targetNodes;
            cluster.estimatedHourlyCostInr = await aroService.estimateHourlyCost(targetNodes, cluster.workerVmSize);
            await cluster.save();
            logger.info(`[aro-cleanup] Morning scale-up complete for ${cluster.name}: ${targetNodes} workers`);
          }
        } catch (err) {
          logger.error(`[aro-cleanup] Night scaling failed for ${cluster.name}: ${err.message}`);
        }
      }

      // ---------------------------------------------------------------
      // 3. Accumulate running cost (every 5 minutes = 1/12 of an hour)
      // ---------------------------------------------------------------
      if (cluster.status === 'ready' || cluster.status === 'scaling') {
        try {
          const hourlyCost = cluster.estimatedHourlyCostInr || 0;
          const incrementInr = Math.round((hourlyCost / 12) * 100) / 100; // 5-minute share
          if (incrementInr > 0) {
            await AroCluster.updateOne({ _id: cluster._id }, {
              $inc: { totalCostInr: incrementInr },
            });
          }
        } catch (err) {
          logger.error(`[aro-cleanup] Cost update failed for ${cluster.name}: ${err.message}`);
        }
      }
    }

    logger.info('[aro-cleanup] ARO cluster cleanup completed.');
  } catch (error) {
    logger.error(`[aro-cleanup] Top-level error: ${error.message}`);
  }
}

module.exports = { aroCleanup };
