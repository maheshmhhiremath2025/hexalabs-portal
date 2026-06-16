/**
 * Batch Expiry — hard deadline enforcer across all clouds.
 *
 * Per-session TTL (existing) cleans up resources but keeps cloud identities warm
 * for re-launch. This automation goes one step further: when a record's
 * `batchExpiresAt` date has passed, the entire batch is OVER — destroy the
 * cloud identity, destroy all resources, and remove the record from our DB.
 *
 * Runs every 10 minutes alongside the other cleanup automations.
 *
 * For each cloud, separately and tolerantly:
 *   1. Find records where batchExpiresAt is set AND <= now
 *   2. Run full resource cleanup (existing per-cloud helper)
 *   3. Destroy cloud identity (IAM user / Azure AD user / GCP project access / OCI user)
 *   4. Delete the cloud-user record from the DB
 *   5. Delete the corresponding portal `users` doc
 *
 * Errors in one cloud never block another — each is wrapped in its own try.
 */
const awsUser = require('../models/aws');
const SandboxUser = require('../models/sandboxuser');
const GcpSandboxUser = require('../models/gcpSandboxUser');
const OciSandboxUser = require('../models/ociSandboxUser');
const Container = require('../models/container');
const User = require('../models/user');
const { logger } = require('../plugins/logger');

let fullAwsCleanup;
try { fullAwsCleanup = require('../services/awsResourceCleanup').fullAwsCleanup; } catch {}

let deleteOciSandbox;
try { deleteOciSandbox = require('../services/ociSandbox').deleteOciSandbox; } catch {}

let deleteSharedProject;
try { deleteSharedProject = require('../services/gcpSharedProject').deleteSharedProject; } catch {}

let deleteContainer;
try { deleteContainer = require('../services/containerService').deleteContainer; } catch {}

// ---------- AWS ----------
async function expireAwsBatches() {
  if (!awsUser) return;
  const now = new Date();
  const expired = await awsUser.find({ batchExpiresAt: { $ne: null, $lte: now } }).lean();
  if (!expired.length) return;
  logger.info(`[batch-expiry] AWS: ${expired.length} user(s) past batch end — destroying`);

  let iam = null;
  try {
    const { IAMClient, DeleteLoginProfileCommand, ListAttachedUserPoliciesCommand,
      DetachUserPolicyCommand, ListUserPoliciesCommand, DeleteUserPolicyCommand,
      ListAccessKeysCommand, DeleteAccessKeyCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
    iam = {
      client: new IAMClient({ region: process.env.AWS_REGION || 'ap-south-1',
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } }),
      cmd: { DeleteLoginProfileCommand, ListAttachedUserPoliciesCommand, DetachUserPolicyCommand,
             ListUserPoliciesCommand, DeleteUserPolicyCommand, ListAccessKeysCommand,
             DeleteAccessKeyCommand, DeleteUserCommand },
    };
  } catch (e) {
    logger.error(`[batch-expiry] AWS SDK not available: ${e.message}`);
    return;
  }

  for (const u of expired) {
    try {
      if (fullAwsCleanup && u.userId) await fullAwsCleanup(u.userId);

      if (u.userId) {
        const c = iam.client; const x = iam.cmd;
        try { await c.send(new x.DeleteLoginProfileCommand({ UserName: u.userId })); } catch {}
        try {
          const { PolicyNames } = await c.send(new x.ListUserPoliciesCommand({ UserName: u.userId }));
          for (const n of PolicyNames || []) await c.send(new x.DeleteUserPolicyCommand({ UserName: u.userId, PolicyName: n }));
        } catch {}
        try {
          const { AttachedPolicies } = await c.send(new x.ListAttachedUserPoliciesCommand({ UserName: u.userId }));
          for (const p of AttachedPolicies || []) await c.send(new x.DetachUserPolicyCommand({ UserName: u.userId, PolicyArn: p.PolicyArn }));
        } catch {}
        try {
          const { AccessKeyMetadata } = await c.send(new x.ListAccessKeysCommand({ UserName: u.userId }));
          for (const k of AccessKeyMetadata || []) await c.send(new x.DeleteAccessKeyCommand({ UserName: u.userId, AccessKeyId: k.AccessKeyId }));
        } catch {}
        try { await c.send(new x.DeleteUserCommand({ UserName: u.userId })); } catch {}
      }

      await awsUser.deleteOne({ _id: u._id });
      if (u.email) await User.deleteOne({ email: u.email });
      logger.info(`[batch-expiry] AWS ${u.email}: IAM user ${u.userId} + DB record destroyed`);
    } catch (e) {
      logger.error(`[batch-expiry] AWS ${u.email} cleanup failed: ${e.message}`);
    }
  }
}

// ---------- Azure ----------
async function expireAzureBatches() {
  const now = new Date();
  const expired = await SandboxUser.find({ batchExpiresAt: { $ne: null, $lte: now } });
  if (!expired.length) return;
  logger.info(`[batch-expiry] Azure: ${expired.length} user(s) past batch end — destroying`);

  let resourceClient = null, graphClient = null;
  try {
    const { ClientSecretCredential } = require('@azure/identity');
    const { ResourceManagementClient } = require('@azure/arm-resources');
    const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
    resourceClient = new ResourceManagementClient(cred, process.env.SUBSCRIPTION_ID);

    try {
      const { Client } = require('@microsoft/microsoft-graph-client');
      require('isomorphic-fetch');
      graphClient = Client.init({
        authProvider: async (done) => {
          const tok = await cred.getToken('https://graph.microsoft.com/.default');
          done(null, tok.token);
        },
      });
    } catch (e) { logger.warn(`[batch-expiry] Azure Graph client unavailable: ${e.message}`); }
  } catch (e) {
    logger.error(`[batch-expiry] Azure SDK init failed: ${e.message}`);
    return;
  }

  for (const u of expired) {
    try {
      for (const sb of u.sandbox || []) {
        if (sb.resourceGroupName && sb.status !== 'deleted') {
          try {
            await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
            logger.info(`[batch-expiry] Azure RG ${sb.resourceGroupName} deleted for ${u.email}`);
          } catch (e) {
            logger.error(`[batch-expiry] Azure RG ${sb.resourceGroupName}: ${e.message}`);
          }
        }
      }
      if (graphClient && u.userId) {
        try { await graphClient.api(`/users/${u.userId}`).delete(); }
        catch (e) { logger.error(`[batch-expiry] Azure AD user ${u.userId}: ${e.message}`); }
      }
      await SandboxUser.deleteOne({ _id: u._id });
      if (u.email) await User.deleteOne({ email: u.email });
      logger.info(`[batch-expiry] Azure ${u.email}: AD user + RGs + DB record destroyed`);
    } catch (e) {
      logger.error(`[batch-expiry] Azure ${u.email} cleanup failed: ${e.message}`);
    }
  }
}

// ---------- GCP ----------
async function expireGcpBatches() {
  const now = new Date();
  const expired = await GcpSandboxUser.find({ batchExpiresAt: { $ne: null, $lte: now } });
  if (!expired.length) return;
  logger.info(`[batch-expiry] GCP: ${expired.length} user(s) past batch end — destroying`);

  for (const u of expired) {
    try {
      for (const sb of u.sandbox || []) {
        if (sb.projectId && deleteSharedProject) {
          try { await deleteSharedProject(sb.projectId); }
          catch (e) { logger.error(`[batch-expiry] GCP project ${sb.projectId}: ${e.message}`); }
        }
      }
      await GcpSandboxUser.deleteOne({ _id: u._id });
      if (u.email) await User.deleteOne({ email: u.email });
      logger.info(`[batch-expiry] GCP ${u.email}: project(s) + DB record destroyed`);
    } catch (e) {
      logger.error(`[batch-expiry] GCP ${u.email} cleanup failed: ${e.message}`);
    }
  }
}

// ---------- OCI ----------
async function expireOciBatches() {
  const now = new Date();
  const expired = await OciSandboxUser.find({ batchExpiresAt: { $ne: null, $lte: now } });
  if (!expired.length) return;
  logger.info(`[batch-expiry] OCI: ${expired.length} user(s) past batch end — destroying`);

  for (const u of expired) {
    try {
      if (deleteOciSandbox && u.compartmentId) {
        try { await deleteOciSandbox(u.compartmentId, u.userId, u.policyId); }
        catch (e) { logger.error(`[batch-expiry] OCI sandbox ${u.email}: ${e.message}`); }
      }
      await OciSandboxUser.deleteOne({ _id: u._id });
      if (u.email) await User.deleteOne({ email: u.email });
      logger.info(`[batch-expiry] OCI ${u.email}: compartment + DB record destroyed`);
    } catch (e) {
      logger.error(`[batch-expiry] OCI ${u.email} cleanup failed: ${e.message}`);
    }
  }
}

// ---------- Containers ----------
async function expireContainerBatches() {
  const now = new Date();
  const expired = await Container.find({ batchExpiresAt: { $ne: null, $lte: now }, isAlive: true });
  if (!expired.length) return;
  logger.info(`[batch-expiry] Container: ${expired.length} container(s) past batch end — destroying`);

  for (const c of expired) {
    try {
      if (deleteContainer && c.containerId) {
        try { await deleteContainer(c.containerId); }
        catch (e) { logger.error(`[batch-expiry] container ${c.containerId}: ${e.message}`); }
      }
      // Containers are linked to users via email — keep portal user (they may
      // own resources on other clouds with later batchExpiresAt).
      await Container.deleteOne({ _id: c._id });
      logger.info(`[batch-expiry] Container ${c.name} (${c.email}) destroyed`);
    } catch (e) {
      logger.error(`[batch-expiry] Container ${c.name} cleanup failed: ${e.message}`);
    }
  }
}

// ---------- Main ----------
async function batchExpiryCheck() {
  await Promise.allSettled([
    expireAwsBatches().catch(e => logger.error(`[batch-expiry] AWS sweep: ${e.message}`)),
    expireAzureBatches().catch(e => logger.error(`[batch-expiry] Azure sweep: ${e.message}`)),
    expireGcpBatches().catch(e => logger.error(`[batch-expiry] GCP sweep: ${e.message}`)),
    expireOciBatches().catch(e => logger.error(`[batch-expiry] OCI sweep: ${e.message}`)),
    expireContainerBatches().catch(e => logger.error(`[batch-expiry] Container sweep: ${e.message}`)),
  ]);
}

module.exports = { batchExpiryCheck };
