const { logger } = require('./../plugins/logger');
const awsUser = require('./../models/aws');
let fullAwsCleanup;
try { fullAwsCleanup = require('../services/awsResourceCleanup').fullAwsCleanup; } catch {}

let deleteAwsUser;
try {
  const { IAMClient, DeleteLoginProfileCommand, ListAttachedUserPoliciesCommand, DetachUserPolicyCommand, ListUserPoliciesCommand, DeleteUserPolicyCommand, ListAccessKeysCommand, DeleteAccessKeyCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
  const client = new IAMClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
  });

  // Also import EC2 and S3 for resource cleanup
  const { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
  const ec2Client = new EC2Client({ region: 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

  deleteAwsUser = async (username) => {
    // 1. Terminate any EC2 instances created by this user (tagged or named with username)
    try {
      const instances = await ec2Client.send(new DescribeInstancesCommand({
        Filters: [{ Name: 'tag:CreatedBy', Values: [username] }],
      }));
      const instanceIds = [];
      for (const r of instances.Reservations || []) {
        for (const i of r.Instances || []) {
          if (i.State?.Name !== 'terminated') instanceIds.push(i.InstanceId);
        }
      }
      if (instanceIds.length) {
        await ec2Client.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }));
        logger.info(`Terminated ${instanceIds.length} EC2 instances for ${username}`);
      }
    } catch (e) { logger.error(`EC2 cleanup for ${username}: ${e.message}`); }

    // 2. Delete IAM user
    // Delete login profile
    try { await client.send(new DeleteLoginProfileCommand({ UserName: username })); } catch {}
    // Delete inline policies
    try {
      const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: username }));
      for (const name of PolicyNames || []) { await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: name })); }
    } catch {}
    // Detach managed policies
    try {
      const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: username }));
      for (const p of AttachedPolicies || []) { await client.send(new DetachUserPolicyCommand({ UserName: username, PolicyArn: p.PolicyArn })); }
    } catch {}
    // Delete access keys
    try {
      const { AccessKeyMetadata } = await client.send(new ListAccessKeysCommand({ UserName: username }));
      for (const ak of AccessKeyMetadata || []) { await client.send(new DeleteAccessKeyCommand({ UserName: username, AccessKeyId: ak.AccessKeyId })); }
    } catch {}
    // Delete the IAM user
    await client.send(new DeleteUserCommand({ UserName: username }));
    logger.info(`AWS IAM user deleted: ${username}`);
  };
} catch {
  // AWS SDK not available — use queue fallback
  deleteAwsUser = async (username) => {
    try {
      const queues = require('./../controllers/newQueues');
      await queues['aws-delete-user'].add({ email: username });
    } catch {}
  };
}

const MAX_CLEANUP_RETRIES = 3;
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const awsCleanup = async () => {
  try {
    logger.info("Running AWS sandbox cleanup...");
    const users = await awsUser.find({});
    const now = new Date();

    for (const user of users) {
      const userExpiry = user.expiresAt ? new Date(user.expiresAt) : user.endDate ? new Date(user.endDate) : null;
      if (!userExpiry || userExpiry > now) continue;

      // Stale safety net: warn if expired > 2 hours ago and still not cleaned up
      const expiredMs = now - userExpiry;
      if (expiredMs > STALE_THRESHOLD_MS) {
        logger.error(`[CRITICAL] AWS sandbox for ${user.userId} (${user.email}) has been expired for ${Math.round(expiredMs / 60000)} minutes and is still not cleaned up`);
      }

      // Skip if max retries exceeded
      if ((user.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
        logger.error(`[CRITICAL] AWS cleanup for ${user.userId} exceeded ${MAX_CLEANUP_RETRIES} retries, skipping. Last error: ${user.cleanupError}`);
        continue;
      }

      try {
        logger.info(`AWS user ${user.userId} expired, cleaning up resources + deleting...`);
        // 1. Clean up ALL resources the user created
        if (fullAwsCleanup) {
          try { await fullAwsCleanup(user.userId); } catch (e) { logger.error(`AWS resource cleanup for ${user.userId}: ${e.message}`); }
        }
        // 2. Delete the IAM user
        await deleteAwsUser(user.userId);
        // 3. Also try queue as backup (for production with workers running)
        try {
          const queues = require('./../controllers/newQueues');
          await queues['aws-delete-user'].add({ email: user.userId });
        } catch {}
        // 4. Remove from DB on success
        await awsUser.deleteOne({ _id: user._id });
        logger.info(`AWS user ${user.userId} removed from DB`);
      } catch (e) {
        logger.error(`Failed to clean up AWS user ${user.userId}: ${e.message}`);
        // Track the failure for retry on next cron run
        try {
          await awsUser.updateOne({ _id: user._id }, {
            $inc: { cleanupAttempts: 1 },
            $set: { cleanupError: e.message, cleanupFailedAt: now },
          });
        } catch (dbErr) {
          logger.error(`Failed to update cleanup status for ${user.userId}: ${dbErr.message}`);
        }
      }
    }

    logger.info("AWS sandbox cleanup completed.");
  } catch (error) {
    logger.error(`AWS cleanup error: ${error.message}`);
  }
};

module.exports = { awsCleanup };
