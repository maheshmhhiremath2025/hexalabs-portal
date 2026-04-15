const { google } = require('googleapis');
const {logger} = require('./../../../plugins/logger')

// Replace with the correct path to your service account key file
const path = require('path');

// Correct path to your service account key file (two levels up)
const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

// Authenticate with Google Cloud
const auth = new google.auth.GoogleAuth({
  keyFilename: keyFilename,
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

// Function to check if GKE API is enabled
async function isGKEApiEnabled(projectId) {
  const serviceUsage = google.serviceusage('v1');
  const authClient = await auth.getClient();

  try {
    const res = await serviceUsage.services.get({
      name: `projects/${projectId}/services/container.googleapis.com`,
      auth: authClient
    });
    return res.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      return false;
    }
    throw error;
  }
}

// Function to delete GKE clusters
async function deleteGKEClusters(projectId) {
  // Validate projectId
  if (!projectId) {
    logger.error('Project ID is not provided.');
    throw new Error('Project ID is required.');
  }

  // Check if GKE API is enabled
  const isEnabled = await isGKEApiEnabled(projectId);
  if (!isEnabled) {
    logger.info(`GKE API is not enabled for project ${projectId}. Skipping cluster deletion.`);
    return;
  }

  const authClient = await auth.getClient();
  const container = google.container({
    version: 'v1',
    auth: authClient
  });

  try {
    // Fetch all clusters in the project
    const res = await container.projects.locations.clusters.list({
      parent: `projects/${projectId}/locations/-`
    });

    const clusters = res.data.clusters || [];
    const deletePromises = [];

    // Iterate through the clusters and delete them
    for (const cluster of clusters) {
      logger.info(`Deleting cluster: ${cluster.name} in location: ${cluster.location}`);
      deletePromises.push(
        container.projects.locations.clusters.delete({
          name: `projects/${projectId}/locations/${cluster.location}/clusters/${cluster.name}`
        }).then(() => {
          logger.info(`Deleted cluster: ${cluster.name} in location: ${cluster.location}`);
        }).catch(error => {
          logger.error(`Error deleting cluster: ${cluster.name} in location: ${cluster.location}`, error);
        })
      );

      // Add a small delay to avoid hitting API rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await Promise.all(deletePromises);
    logger.info('Deleted all GKE clusters');
  } catch (error) {
    logger.error('Error during GKE clusters deletion:', error);
    throw error;
  }
}

module.exports = { deleteGKEClusters };
