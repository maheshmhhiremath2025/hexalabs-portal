/**
 * sandboxCleanup.js
 * Cleans up cloud sandboxes when a training is deleted/killed.
 * Called from: killTraining.js, admin.js (handleDeleteLogs), labExpiry.js
 */
const Training = require('../models/training');
const GuidedLab = require('../models/guidedLab');
const SandboxTemplate = require('../models/sandboxTemplate');
const SandboxUser = require('../models/sandboxuser');
const awsUser = require('../models/aws');
const GcpSandboxUser = require('../models/gcpSandboxUser');
const { logger } = require('../plugins/logger');

let queues;
try { queues = require('../controllers/newQueues'); } catch {}

/**
 * Clean up all sandboxes provisioned for a training's guided lab.
 * Safe to call even if no guided lab or sandboxes exist — exits silently.
 * Runs cloud cleanup in background (fire-and-forget).
 *
 * @param {string} trainingName - The training name
 */
async function cleanupTrainingSandboxes(trainingName) {
  try {
    // 1. Look up the training → get guidedLabId and user emails
    const training = await Training.findOne({ name: trainingName }).lean();
    if (!training?.guidedLabId) return; // No guided lab linked — nothing to clean

    const userEmails = (training.vmUserMapping || []).map(m => m.userEmail).filter(Boolean);
    if (!userEmails.length) return;

    // 2. Look up the guided lab → get sandboxTemplateSlug
    const lab = await GuidedLab.findById(training.guidedLabId).lean();
    if (!lab?.sandboxTemplateSlug) return; // No sandbox template — nothing to clean

    // 3. Look up the sandbox template → determine cloud type
    const template = await SandboxTemplate.findOne({ slug: lab.sandboxTemplateSlug }).lean();
    const cloud = template?.cloud || lab.cloud || 'azure';

    logger.info(`[sandbox-cleanup] Cleaning ${cloud} sandboxes for training "${trainingName}" (${userEmails.length} users, template: ${lab.sandboxTemplateSlug})`);

    // 4. Clean up per user in background
    for (const email of userEmails) {
      try {
        await _cleanupUserSandbox(email, cloud, template);
      } catch (err) {
        logger.error(`[sandbox-cleanup] Failed for ${email}: ${err.message}`);
      }
    }

    logger.info(`[sandbox-cleanup] Finished cleanup for training "${trainingName}"`);
  } catch (err) {
    logger.error(`[sandbox-cleanup] Error cleaning sandboxes for training "${trainingName}": ${err.message}`);
  }
}

/**
 * Clean up a single user's sandbox by cloud type.
 */
async function _cleanupUserSandbox(email, cloud, template) {
  if (cloud === 'azure' || cloud === 'vm') {
    await _cleanupAzure(email);
  } else if (cloud === 'aws') {
    await _cleanupAws(email);
  } else if (cloud === 'gcp') {
    await _cleanupGcp(email);
  }
}

async function _cleanupAzure(email) {
  const userDoc = await SandboxUser.findOne({ email });
  if (!userDoc) return;

  const azureUserId = userDoc.sandbox?.[0]?.credentials?.username || userDoc.userId;
  const sandboxEntries = userDoc.sandbox || [];

  // Delete Azure AD user
  if (azureUserId) {
    try {
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
      await graphClient.api(`/users/${azureUserId}`).delete();
      logger.info(`[sandbox-cleanup] Azure AD user ${azureUserId} deleted for ${email}`);
    } catch (err) {
      if (!err.message?.includes('does not exist')) {
        logger.error(`[sandbox-cleanup] Azure AD user deletion failed for ${email}: ${err.message}`);
      }
    }
  }

  // Delete resource groups
  if (sandboxEntries.length) {
    try {
      const { ClientSecretCredential } = require('@azure/identity');
      const { ResourceManagementClient } = require('@azure/arm-resources');
      const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
      const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);
      for (const sb of sandboxEntries) {
        if (sb.resourceGroupName) {
          try {
            await resourceClient.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
            logger.info(`[sandbox-cleanup] Azure RG ${sb.resourceGroupName} deleted for ${email}`);
          } catch (rgErr) {
            if (!rgErr.message?.includes('could not be found')) {
              logger.error(`[sandbox-cleanup] Azure RG ${sb.resourceGroupName} deletion failed: ${rgErr.message}`);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`[sandbox-cleanup] Azure RG setup failed for ${email}: ${err.message}`);
    }
  }

  // Queue user deletion + remove DB record
  try { if (queues) await queues['azure-delete-user'].add({ email }); } catch {}
  await SandboxUser.deleteOne({ email });
  logger.info(`[sandbox-cleanup] Azure sandbox user ${email} removed from DB`);
}

async function _cleanupAws(email) {
  const userDoc = await awsUser.findOne({ email });
  if (!userDoc) return;

  // Queue IAM user deletion
  try { if (queues) await queues['aws-delete-user'].add({ email: userDoc.userId }); } catch {}
  await awsUser.deleteOne({ email });
  logger.info(`[sandbox-cleanup] AWS sandbox user ${email} (${userDoc.userId}) removed from DB`);
}

async function _cleanupGcp(email) {
  const userDoc = await GcpSandboxUser.findOne({ email });
  if (!userDoc) return;

  // Queue GCP project deletion
  for (const sb of (userDoc.sandbox || [])) {
    if (sb.projectId) {
      try { if (queues) await queues['gcp-delete-project'].add({ projectId: sb.projectId }); } catch {}
    }
  }
  await GcpSandboxUser.deleteOne({ email });
  logger.info(`[sandbox-cleanup] GCP sandbox user ${email} removed from DB`);
}

module.exports = { cleanupTrainingSandboxes };
