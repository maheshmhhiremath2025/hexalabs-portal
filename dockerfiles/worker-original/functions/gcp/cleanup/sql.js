const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./../../../plugins/logger');

const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

const auth = new google.auth.GoogleAuth({
  keyFilename,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// Function to check if Cloud SQL Admin API is enabled
async function isCloudSQLAdminApiEnabled(projectId) {
  const serviceUsage = google.serviceusage('v1');
  const authClient = await auth.getClient();

  try {
    const res = await serviceUsage.services.get({
      name: `projects/${projectId}/services/sqladmin.googleapis.com`,
      auth: authClient,
    });
    return res.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      logger.warn(`Cloud SQL Admin API not enabled for project: ${projectId}`);
      return false;
    }
    logger.error('Error checking Cloud SQL Admin API status:', error.message || error);
    throw error;
  }
}

// Function to disable deletion protection for a Cloud SQL instance
async function disableDeletionProtection(sqladmin, projectId, instance) {
  if (!instance.settings?.deletionProtectionEnabled) {
    logger.info(`Deletion protection already disabled for instance: ${instance.name}`);
    return;
  }

  logger.info(`Disabling deletion protection for instance: ${instance.name}`);
  await sqladmin.instances.patch({
    project: projectId,
    instance: instance.name,
    requestBody: {
      settings: { deletionProtectionEnabled: false },
    },
  });
  logger.info(`Deletion protection disabled for instance: ${instance.name}`);
}

// Function to delete a Cloud SQL instance
async function deleteInstance(sqladmin, projectId, instance) {
  logger.info(`Deleting Cloud SQL instance: ${instance.name}`);
  try {
    await sqladmin.instances.delete({
      project: projectId,
      instance: instance.name,
    });
    logger.info(`Successfully deleted instance: ${instance.name}`);
  } catch (error) {
    logger.error(`Error deleting instance: ${instance.name}`, error.message || error);
    throw error;
  }
}

// Helper function to process items in chunks with concurrency control
async function processInChunks(items, chunkSize, processFn) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(processFn));
  }
}

// Function to delete all Cloud SQL instances in a project
async function deleteCloudSQLInstances(projectId) {
  if (!projectId) {
    logger.error('Project ID is required but not provided.');
    throw new Error('Missing Project ID');
  }

  logger.info(`Starting Cloud SQL cleanup for project: ${projectId}`);

  const isEnabled = await isCloudSQLAdminApiEnabled(projectId);
  if (!isEnabled) {
    logger.info(`Skipping Cloud SQL cleanup as API is not enabled for project: ${projectId}`);
    return;
  }

  const authClient = await auth.getClient();
  const sqladmin = google.sqladmin({ version: 'v1', auth: authClient });

  try {
    const res = await sqladmin.instances.list({ project: projectId });
    const instances = res.data.items || [];

    if (instances.length === 0) {
      logger.info('No Cloud SQL instances found.');
      return;
    }

    logger.info(`Found ${instances.length} Cloud SQL instance(s) in project ${projectId}.`);

    await processInChunks(
      instances,
      5, // Set concurrency limit
      async (instance) => {
        try {
          await disableDeletionProtection(sqladmin, projectId, instance);
          await deleteInstance(sqladmin, projectId, instance);
        } catch (error) {
          logger.error(`Failed to process instance: ${instance.name}`, error.message || error);
        }
      }
    );

    logger.info('Completed Cloud SQL cleanup.');
  } catch (error) {
    logger.error('Error during Cloud SQL cleanup:', error.message || error);
    throw error;
  }
}

module.exports = { deleteCloudSQLInstances };
