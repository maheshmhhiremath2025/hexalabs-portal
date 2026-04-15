const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./../../../plugins/logger');

// Correct path to your service account key file
const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

// Authenticate with Google Cloud
const auth = new google.auth.GoogleAuth({
  keyFilename: keyFilename,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// Function to check if Compute Engine API is enabled
async function isComputeEngineApiEnabled(projectId) {
  const serviceUsage = google.serviceusage('v1');
  const authClient = await auth.getClient();

  try {
    const response = await serviceUsage.services.get({
      name: `projects/${projectId}/services/compute.googleapis.com`,
      auth: authClient,
    });
    return response.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      logger.warn(`Compute Engine API not enabled or inaccessible for project: ${projectId}`);
      return false;
    }
    logger.error('Error checking Compute Engine API status:', error.message || error);
    throw error;
  }
}

// Function to delete Compute Engine VMs
async function deleteComputeEngineVMs(projectId) {
  if (!projectId) {
    logger.error('Project ID is required but not provided.');
    throw new Error('Missing Project ID');
  }

  logger.info(`Starting Compute Engine cleanup for project: ${projectId}`);

  // Check if Compute Engine API is enabled
  const isEnabled = await isComputeEngineApiEnabled(projectId);
  if (!isEnabled) {
    logger.info(`Skipping Compute Engine cleanup as API is not enabled for project: ${projectId}`);
    return;
  }

  const authClient = await auth.getClient();
  const compute = google.compute({
    version: 'v1',
    auth: authClient,
  });

  try {
    // Fetch all instances in the project across all zones
    const res = await compute.instances.aggregatedList({ project: projectId });
    const instances = res.data.items || {};
    const deletePromises = [];

    // Iterate through the aggregated list and delete instances
    for (const zone in instances) {
      if (instances[zone].instances) {
        for (const instance of instances[zone].instances) {
          logger.info(`Deleting instance: ${instance.name} in zone: ${zone.split('/').pop()}`);
          deletePromises.push(
            compute.instances
              .delete({
                project: projectId,
                zone: zone.split('/').pop(),
                instance: instance.name,
              })
              .then(() => {
                logger.info(`Successfully deleted instance: ${instance.name} in zone: ${zone.split('/').pop()}`);
              })
              .catch((error) => {
                logger.error(`Error deleting instance: ${instance.name} in zone: ${zone.split('/').pop()}`, error);
              })
          );
        }
      }
    }

    // Await all delete operations
    await Promise.all(deletePromises);
    logger.info('All Compute Engine VMs have been deleted successfully.');
  } catch (error) {
    logger.error('Error during Compute Engine cleanup:', error.message || error);
    throw error;
  }
}

module.exports = { deleteComputeEngineVMs };
