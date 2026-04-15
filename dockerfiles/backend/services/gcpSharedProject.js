/**
 * GCP Shared Project Service
 *
 * Strategy: 1 project per 5 users.
 * - When user requests a sandbox, find an existing shared project with < 5 users
 * - If none found, create a new project
 * - Add user as IAM member with Editor role
 * - On cleanup: only remove user from project. Delete project when last user leaves or TTL expires.
 *
 * Benefits:
 * - Fewer projects = no quota issues (GCP default: 25 projects per org)
 * - Project deletion = 100% cleanup, zero orphans
 * - Shared billing/budget per project, not per user
 */

const GcpSandboxUser = require('../models/gcpSandboxUser');
const { logger } = require('../plugins/logger');

const MAX_USERS_PER_PROJECT = 5;

/**
 * Find or create a shared GCP project for a user.
 * Returns { projectId, isNew }
 */
async function getOrCreateSharedProject(organization, ttlHours = 2, budgetLimit = 200) {
  // Find an existing shared project with room
  const existingUser = await GcpSandboxUser.findOne({
    'sandbox.isShared': true,
    'sandbox.sharedUsers': { $exists: true },
  });

  if (existingUser) {
    for (const sb of existingUser.sandbox) {
      if (sb.isShared && (sb.sharedUsers || []).length < (sb.maxUsers || MAX_USERS_PER_PROJECT)) {
        // Check if not expired
        if (sb.deleteTime && new Date(sb.deleteTime) > new Date()) {
          return { projectId: sb.projectId, isNew: false, ownerEmail: existingUser.email };
        }
      }
    }
  }

  // Also check across all GCP sandbox users for shared projects
  const allUsers = await GcpSandboxUser.find({ 'sandbox.isShared': true });
  for (const user of allUsers) {
    for (const sb of user.sandbox) {
      if (sb.isShared && (sb.sharedUsers || []).length < (sb.maxUsers || MAX_USERS_PER_PROJECT)) {
        if (sb.deleteTime && new Date(sb.deleteTime) > new Date()) {
          return { projectId: sb.projectId, isNew: false, ownerEmail: user.email };
        }
      }
    }
  }

  // No available shared project — need to create one
  const projectId = `shared-${organization.replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${Date.now().toString(36)}`.slice(0, 30).toLowerCase();
  return { projectId, isNew: true, ownerEmail: null };
}

/**
 * Add a user to a shared project.
 * If project is new, creates it. If existing, just adds IAM binding.
 */
async function addUserToSharedProject(projectId, userEmail, isNew = false) {
  try {
    const { google } = require('googleapis');
    const keyFile = process.env.KEYFILENAME;

    if (!keyFile) {
      logger.error('GCP KEYFILENAME not set — cannot manage project IAM');
      return;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();

    if (isNew) {
      // Create project
      const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });
      const parentId = process.env.PARENTID || 'organizations/628552726767';

      try {
        await cloudResourceManager.projects.create({
          requestBody: { projectId, displayName: projectId, parent: parentId },
        });
        logger.info(`GCP shared project created: ${projectId}`);
      } catch (e) {
        logger.error(`GCP project creation failed: ${e.message}`);
      }
    }

    // Add user as Editor via IAM
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });
    try {
      // Get current IAM policy
      const { data: policy } = await cloudResourceManager.projects.getIamPolicy({
        resource: `projects/${projectId}`,
        requestBody: {},
      });

      // Add user as editor
      const editorBinding = policy.bindings?.find(b => b.role === 'roles/editor');
      if (editorBinding) {
        if (!editorBinding.members.includes(`user:${userEmail}`)) {
          editorBinding.members.push(`user:${userEmail}`);
        }
      } else {
        policy.bindings = policy.bindings || [];
        policy.bindings.push({ role: 'roles/editor', members: [`user:${userEmail}`] });
      }

      await cloudResourceManager.projects.setIamPolicy({
        resource: `projects/${projectId}`,
        requestBody: { policy },
      });
      logger.info(`Added ${userEmail} as Editor to project ${projectId}`);
    } catch (e) {
      logger.error(`IAM binding failed for ${userEmail} on ${projectId}: ${e.message}`);
    }
  } catch (e) {
    logger.error(`addUserToSharedProject error: ${e.message}`);
  }
}

/**
 * Remove a user from a shared project.
 * If last user, the project gets deleted by the cleanup cron.
 */
async function removeUserFromSharedProject(projectId, userEmail) {
  try {
    const { google } = require('googleapis');
    const keyFile = process.env.KEYFILENAME;
    if (!keyFile) return;

    const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

    const { data: policy } = await cloudResourceManager.projects.getIamPolicy({
      resource: `projects/${projectId}`,
      requestBody: {},
    });

    // Remove user from all bindings
    for (const binding of policy.bindings || []) {
      binding.members = (binding.members || []).filter(m => m !== `user:${userEmail}`);
    }

    await cloudResourceManager.projects.setIamPolicy({
      resource: `projects/${projectId}`,
      requestBody: { policy },
    });
    logger.info(`Removed ${userEmail} from project ${projectId}`);
  } catch (e) {
    logger.error(`removeUserFromSharedProject error: ${e.message}`);
  }
}

/**
 * Delete a GCP project entirely (all resources gone).
 * Called when all users have left or TTL expired.
 */
async function deleteSharedProject(projectId) {
  try {
    const { google } = require('googleapis');
    const keyFile = process.env.KEYFILENAME;
    if (!keyFile) return;

    const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

    await cloudResourceManager.projects.delete({ name: `projects/${projectId}` });
    logger.info(`GCP shared project deleted: ${projectId} — all resources cleaned up`);
  } catch (e) {
    logger.error(`deleteSharedProject error: ${e.message}`);
  }
}

module.exports = {
  getOrCreateSharedProject,
  addUserToSharedProject,
  removeUserFromSharedProject,
  deleteSharedProject,
  MAX_USERS_PER_PROJECT,
};
