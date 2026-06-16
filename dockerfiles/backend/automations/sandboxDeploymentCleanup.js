/**
 * Sandbox Deployment Cleanup
 *
 * Drains the `sandboxdeployments` collection (records created by the
 * /sandbox-templates/:slug/deploy flow). Runs every minute from index.js.
 *
 * For each active deployment whose expiresAt has passed:
 *   - aws:   delete the IAM user + detach all policies (inline + attached)
 *   - azure: enqueue resource-group deletion (same pattern as azureSandbox automation)
 *   - gcp:   enqueue project deletion (same pattern as gcpSandbox automation)
 * Then mark the record state='deleted' so it doesn't re-process.
 *
 * Also sends a warning email 30 minutes before expiry (matching the pattern
 * used by the existing Azure/GCP cleanup automations).
 *
 * IMPORTANT: this file does NOT import or modify the existing
 * automations/awsSandbox.js, automations/azureSandbox.js, or
 * automations/gcpSandbox.js files. It is a parallel cleanup path that only
 * touches the new `sandboxdeployments` collection.
 */

const { logger } = require('../plugins/logger');
const SandboxDeployment = require('../models/sandboxDeployment');

// Email sender is optional — don't fail the cleanup pass if it's unavailable.
let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

// Bull queues for Azure / GCP async deletes (same queue names the existing
// automations use).
let queues;
try { queues = require('../controllers/newQueues'); } catch {}

// AWS IAM direct delete — duplicated from automations/awsSandbox.js so we
// don't have to export from that file and risk breaking its contract.
let deleteAwsUser;
try {
  const {
    IAMClient,
    DeleteLoginProfileCommand,
    ListAttachedUserPoliciesCommand,
    DetachUserPolicyCommand,
    ListUserPoliciesCommand,
    DeleteUserPolicyCommand,
    DeleteUserCommand,
  } = require('@aws-sdk/client-iam');

  const client = new IAMClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_ACCESS_SECRET,
    },
  });

  deleteAwsUser = async (username) => {
    if (!username) return;
    // Detach attached managed policies
    try { await client.send(new DeleteLoginProfileCommand({ UserName: username })); } catch {}
    try {
      const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: username }));
      for (const p of AttachedPolicies || []) {
        try { await client.send(new DetachUserPolicyCommand({ UserName: username, PolicyArn: p.PolicyArn })); } catch {}
      }
    } catch {}
    // Delete inline policies
    try {
      const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: username }));
      for (const name of PolicyNames || []) {
        try { await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: name })); } catch {}
      }
    } catch {}
    // Finally delete the user
    await client.send(new DeleteUserCommand({ UserName: username }));
    logger.info(`[sandbox-deploy-cleanup] AWS IAM user deleted: ${username}`);
  };
} catch (e) {
  // SDK not available at require time — fall back to queue-based delete.
  deleteAwsUser = async (username) => {
    if (!queues) return;
    try { await queues['aws-delete-user'].add({ email: username }); } catch {}
  };
}

/**
 * Send a one-time warning email 30 minutes before expiry.
 */
async function maybeSendWarning(doc, minutesLeft) {
  if (!sendEmail || doc.warningEmailSent) return;
  if (!doc.deployedBy) return;
  try {
    await sendEmail(
      doc.deployedBy,
      `Sandbox deployment expires in ${minutesLeft} minutes`,
      `<div style="font-family: -apple-system, sans-serif; max-width: 520px;">
        <div style="background: #f59e0b; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 16px;">Sandbox expiring soon</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="color: #374151;">The <strong>${doc.templateName || doc.templateSlug}</strong> sandbox deployed
          for <strong>${doc.deployedBy}</strong> will be automatically cleaned up in <strong>${minutesLeft} minutes</strong>.</p>
          <p style="color: #374151; font-size: 13px;">
            Cloud: <strong>${doc.cloud.toUpperCase()}</strong>
            ${doc.username ? `· User: <code>${doc.username}</code>` : ''}
          </p>
          <p style="color: #6b7280; font-size: 13px;">Save any in-progress work. The resources will be torn down automatically at the expiry time.</p>
        </div>
      </div>`
    );
    // Persist the flag so we don't re-send on the next tick
    await SandboxDeployment.updateOne({ _id: doc._id }, { $set: { warningEmailSent: true } });
  } catch (e) {
    logger.error(`[sandbox-deploy-cleanup] warning email failed for ${doc._id}: ${e.message}`);
  }
}

const sandboxDeploymentCleanup = async () => {
  try {
    const now = new Date();

    // 1) Warning emails — active deployments expiring in the next 30 min
    //    that haven't already been warned.
    const warning = await SandboxDeployment.find({
      state: 'active',
      warningEmailSent: { $ne: true },
      expiresAt: { $gt: now, $lte: new Date(now.getTime() + 30 * 60 * 1000) },
    }).lean();
    for (const d of warning) {
      const minutesLeft = Math.max(1, Math.round((new Date(d.expiresAt) - now) / 60000));
      await maybeSendWarning(d, minutesLeft);
    }

    // 2) Expired cleanup — drain any active deployments past their TTL.
    const expired = await SandboxDeployment.find({
      state: 'active',
      expiresAt: { $lt: now },
    }).lean();

    if (expired.length === 0) return;

    logger.info(`[sandbox-deploy-cleanup] found ${expired.length} expired deployment(s)`);

    for (const d of expired) {
      // Track whether the cloud-side teardown succeeded for THIS deployment.
      // P1-10: don't unconditionally mark state='deleted' — that masks leaked
      // resources. Mirror the awsSandbox.js retry pattern instead.
      let cleanupSuccess = true;
      let cleanupErrorMsg = null;
      try {
        if (d.cloud === 'aws') {
          const username = d.aws?.iamUsername || d.username;
          if (username) {
            try {
              await deleteAwsUser(username);
            } catch (e) {
              logger.error(`[sandbox-deploy-cleanup] AWS delete failed for ${username}: ${e.message}`);
              cleanupSuccess = false; cleanupErrorMsg = `AWS: ${e.message}`;
            }
          }
        } else if (d.cloud === 'azure') {
          const rg = d.azure?.resourceGroupName;
          if (rg && queues && queues['azure-delete-sandbox']) {
            try {
              await queues['azure-delete-sandbox'].add({ resourceGroupName: rg });
              logger.info(`[sandbox-deploy-cleanup] queued Azure RG delete: ${rg}`);
            } catch (e) {
              logger.error(`[sandbox-deploy-cleanup] Azure enqueue failed for ${rg}: ${e.message}`);
              cleanupSuccess = false; cleanupErrorMsg = `Azure: ${e.message}`;
            }
          } else if (rg) {
            cleanupSuccess = false; cleanupErrorMsg = 'Azure queue unavailable';
          }
        } else if (d.cloud === 'gcp') {
          const projectId = d.gcp?.projectId;
          // Path 3: if the user's gcpsandboxuser doc has persistentProjectId == this
          // project, KEEP the project. TTL expiry releases the session, but the
          // project must survive so the next relaunch reset-in-place skips GCP's
          // 30-day soft-delete window.
          let isPersistent = false;
          try {
            const GcpSandboxUser = require('../models/gcpSandboxUser');
            const userEmail = d.userEmail || d.email;
            if (userEmail) {
              const gDoc = await GcpSandboxUser.findOne({ email: userEmail }, 'persistentProjectId').lean();
              if (gDoc && gDoc.persistentProjectId && gDoc.persistentProjectId === projectId) {
                isPersistent = true;
              }
            }
          } catch (e) {
            logger.warn(`[sandbox-deploy-cleanup] persistentProjectId lookup failed: ${e.message}`);
          }
          if (isPersistent) {
            logger.info(`[sandbox-deploy-cleanup] skipping GCP project delete — persistentProjectId set: ${projectId}`);
          } else if (projectId && queues && queues['gcp-delete-project']) {
            try {
              await queues['gcp-delete-project'].add({ projectId });
              logger.info(`[sandbox-deploy-cleanup] queued GCP project delete: ${projectId}`);
            } catch (e) {
              logger.error(`[sandbox-deploy-cleanup] GCP enqueue failed for ${projectId}: ${e.message}`);
              cleanupSuccess = false; cleanupErrorMsg = `GCP: ${e.message}`;
            }
          } else if (projectId) {
            cleanupSuccess = false; cleanupErrorMsg = 'GCP queue unavailable';
          }
        } else if (d.cloud === 'oci') {
          // OCI teardown is synchronous (no Bull queue) because the createOciSandbox
          // path is also synchronous. Direct call into services/ociSandbox.deleteOciSandbox.
          const compartmentId = d.oci?.compartmentId;
          const userId = d.oci?.userId;
          const policyId = d.oci?.policyId;
          if (compartmentId && userId) {
            try {
              const { deleteOciSandbox } = require('../services/ociSandbox');
              await deleteOciSandbox(compartmentId, userId, policyId);
              logger.info(`[sandbox-deploy-cleanup] OCI sandbox torn down: compartment=${compartmentId}`);
            } catch (e) {
              logger.error(`[sandbox-deploy-cleanup] OCI delete failed for ${compartmentId}: ${e.message}`);
              cleanupSuccess = false; cleanupErrorMsg = `OCI: ${e.message}`;
            }
          } else {
            cleanupSuccess = false; cleanupErrorMsg = 'OCI compartment/user OCID missing on deployment doc';
          }
        }

        // Skip if max retries exceeded — same pattern as awsSandbox.js
        const MAX_CLEANUP_RETRIES = 3;
        if (!cleanupSuccess && (d.cleanupAttempts || 0) >= MAX_CLEANUP_RETRIES) {
          logger.error(`[CRITICAL] sandbox-deploy-cleanup for ${d._id} exceeded ${MAX_CLEANUP_RETRIES} retries — leaving state=cleanup_failed`);
          await SandboxDeployment.updateOne(
            { _id: d._id },
            { $set: { state: 'cleanup_failed', cleanupError: cleanupErrorMsg } }
          );
          continue;
        }

        if (cleanupSuccess) {
          await SandboxDeployment.updateOne(
            { _id: d._id },
            { $set: { state: 'deleted', deletedAt: new Date() } }
          );
        } else {
          await SandboxDeployment.updateOne(
            { _id: d._id },
            {
              $set: { state: 'cleanup_failed', cleanupError: cleanupErrorMsg, cleanupFailedAt: new Date() },
              $inc: { cleanupAttempts: 1 },
            }
          );
        }
      } catch (err) {
        logger.error(`[sandbox-deploy-cleanup] error draining ${d._id}: ${err.message}`);
        try {
          await SandboxDeployment.updateOne(
            { _id: d._id },
            {
              $set: { state: 'cleanup_failed', cleanupError: err.message, cleanupFailedAt: new Date() },
              $inc: { cleanupAttempts: 1 },
            }
          );
        } catch {}
      }
    }

    logger.info(`[sandbox-deploy-cleanup] processed ${expired.length} deployment(s)`);
  } catch (err) {
    logger.error(`[sandbox-deploy-cleanup] fatal: ${err.message}`);
  }
};

module.exports = { sandboxDeploymentCleanup };
