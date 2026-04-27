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

        // 0. If this user was on the Connect (US) account, clean up Connect instances first
        const isConnectAccount = user.usageSessions?.some(s => s.templateSlug === 'aws-connect-fundamentals');
        if (isConnectAccount && process.env.AWS_CONNECT_ACCESS_KEY) {
          try {
            const { ConnectClient, ListInstancesCommand, DeleteInstanceCommand } = require('@aws-sdk/client-connect');
            const connectClient = new ConnectClient({
              region: process.env.AWS_CONNECT_REGION || 'us-east-1',
              credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
            });
            const instances = await connectClient.send(new ListInstancesCommand({}));
            for (const inst of (instances.InstanceSummaryList || [])) {
              // Delete any Connect instances created by this user (match by alias containing username prefix)
              const userPrefix = user.userId?.split('-').slice(2, 4).join('-') || '';
              if (inst.InstanceAlias?.includes(userPrefix) || inst.InstanceStatus === 'ACTIVE') {
                try {
                  await connectClient.send(new DeleteInstanceCommand({ InstanceId: inst.Id }));
                  logger.info(`[connect-cleanup] Deleted Connect instance ${inst.InstanceAlias} (${inst.Id}) for ${user.userId}`);
                } catch (ce) {
                  logger.error(`[connect-cleanup] Failed to delete Connect instance ${inst.Id}: ${ce.message}`);
                }
              }
            }
          } catch (e) { logger.error(`Connect cleanup for ${user.userId}: ${e.message}`); }
        }

        // 1. Clean up ALL resources the user created
        if (fullAwsCleanup) {
          const cleanupCreds = isConnectAccount && process.env.AWS_CONNECT_ACCESS_KEY
            ? { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET }
            : undefined;
          try { await fullAwsCleanup(user.userId, cleanupCreds); } catch (e) { logger.error(`AWS resource cleanup for ${user.userId}: ${e.message}`); }
        }
        // 2. Check if student still has remaining quota (totalCapHours)
        const totalCap = user.totalCapHours || 0;
        const sessionsUsed = (user.usageSessions || []).length;
        const hoursUsed = (user.usageSessions || []).reduce((sum, s) => sum + (s.ttlHours || 0), 0);
        const hasQuotaLeft = totalCap === 0 || hoursUsed < totalCap;

        if (hasQuotaLeft) {
          // Student has remaining quota — keep IAM user + DB record, just mark session expired
          // They can re-launch from the portal to get a new session
          logger.info(`AWS user ${user.userId}: session expired but ${totalCap > 0 ? (totalCap - hoursUsed) + 'h quota remaining' : 'unlimited quota'} — keeping IAM user for re-launch`);
          await awsUser.updateOne({ _id: user._id }, {
            $set: { expiresAt: null, cleanupAttempts: 0, cleanupError: null },
          });
        } else {
          // Quota exhausted — full cleanup: delete IAM user + DB record
          logger.info(`AWS user ${user.userId}: quota exhausted (${hoursUsed}/${totalCap}h) — full cleanup`);
          if (isConnectAccount && process.env.AWS_CONNECT_ACCESS_KEY) {
            try {
              const { IAMClient, DeleteLoginProfileCommand, ListAttachedUserPoliciesCommand, DetachUserPolicyCommand, ListUserPoliciesCommand, DeleteUserPolicyCommand, ListAccessKeysCommand, DeleteAccessKeyCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
              const connectIam = new IAMClient({
                region: 'us-east-1',
                credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
              });
              try { await connectIam.send(new DeleteLoginProfileCommand({ UserName: user.userId })); } catch {}
              try {
                const { PolicyNames } = await connectIam.send(new ListUserPoliciesCommand({ UserName: user.userId }));
                for (const name of PolicyNames || []) { await connectIam.send(new DeleteUserPolicyCommand({ UserName: user.userId, PolicyName: name })); }
              } catch {}
              try {
                const { AttachedPolicies } = await connectIam.send(new ListAttachedUserPoliciesCommand({ UserName: user.userId }));
                for (const p of AttachedPolicies || []) { await connectIam.send(new DetachUserPolicyCommand({ UserName: user.userId, PolicyArn: p.PolicyArn })); }
              } catch {}
              try {
                const { AccessKeyMetadata } = await connectIam.send(new ListAccessKeysCommand({ UserName: user.userId }));
                for (const ak of AccessKeyMetadata || []) { await connectIam.send(new DeleteAccessKeyCommand({ UserName: user.userId, AccessKeyId: ak.AccessKeyId })); }
              } catch {}
              await connectIam.send(new DeleteUserCommand({ UserName: user.userId }));
              logger.info(`AWS Connect IAM user deleted: ${user.userId}`);
            } catch (e) { logger.error(`Connect IAM cleanup for ${user.userId}: ${e.message}`); }
          } else {
            await deleteAwsUser(user.userId);
          }
          // Remove from DB
          await awsUser.deleteOne({ _id: user._id });
          logger.info(`AWS user ${user.userId} removed from DB (quota exhausted)`);
        }
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
