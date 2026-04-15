const { Bigtable } = require('@google-cloud/bigtable');
const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./../../../plugins/logger');

// Path to your service account key file
const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

// Function to check if Bigtable Admin API is enabled
async function isBigtableApiEnabled(projectId) {
  try {
    const serviceUsage = google.serviceusage('v1');
    const auth = new google.auth.GoogleAuth({
      keyFilename,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();

    const response = await serviceUsage.services.get({
      name: `projects/${projectId}/services/bigtableadmin.googleapis.com`,
      auth: authClient,
    });

    return response.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      logger.warn(`Bigtable Admin API not enabled or inaccessible for project: ${projectId}`);
      return false;
    }
    logger.error('Error checking Bigtable Admin API status:', error.message || error);
    throw error;
  }
}

// Function to delete Bigtable instances
async function deleteBigtableInstances(projectId) {
  if (!projectId) {
    logger.error('Project ID is required to delete Bigtable instances.');
    throw new Error('Missing Project ID');
  }

  logger.info(`Starting Bigtable cleanup for project: ${projectId}`);

  // Check if the Bigtable Admin API is enabled
  const isEnabled = await isBigtableApiEnabled(projectId);
  if (!isEnabled) {
    logger.info('Skipping Bigtable instance deletion as the API is not enabled.');
    return;
  }

  const bigtable = new Bigtable({ projectId, keyFilename });

  try {
    const [instances] = await bigtable.getInstances();

    if (!instances.length) {
      logger.info('No Bigtable instances found in the project.');
      return;
    }

    logger.info(`Found ${instances.length} instance(s) in Bigtable.`);

    const deleteInstance = async (instance) => {
      try {
        logger.info(`Deleting instance: ${instance.id}`);
        await instance.delete();
        logger.info(`Deleted instance: ${instance.id}`);
      } catch (error) {
        logger.error(`Error deleting instance: ${instance.id}`, error.message || error);
        throw error;
      }
    };

    // Introduce concurrency control for deletion
    const promises = instances.map((instance) => deleteInstance(instance));
    await Promise.allSettled(promises);

    logger.info('All Bigtable instances deletion attempted successfully.');
  } catch (error) {
    logger.error('Error while deleting Bigtable instances:', error.message || error);
    throw error;
  }
}

module.exports = { deleteBigtableInstances };
