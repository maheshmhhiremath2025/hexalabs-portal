const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./../../../plugins/logger');

const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

const auth = new google.auth.GoogleAuth({
  keyFilename,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// Function to delete all objects (and versions) in a bucket
async function deleteBucketObjects(storage, bucketName) {
  try {
    const res = await storage.objects.list({
      bucket: bucketName,
      versions: true, // Fetch all object versions if versioning is enabled
    });

    const objects = res.data.items || [];
    if (objects.length === 0) {
      logger.info(`No objects found in bucket: ${bucketName}`);
      return;
    }

    logger.info(`Found ${objects.length} object(s) in bucket: ${bucketName}. Deleting...`);

    // Manual concurrency control
    const concurrencyLimit = 5;
    const chunks = Array.from({ length: Math.ceil(objects.length / concurrencyLimit) }, (_, i) =>
      objects.slice(i * concurrencyLimit, i * concurrencyLimit + concurrencyLimit)
    );

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (object) => {
          try {
            await storage.objects.delete({
              bucket: bucketName,
              object: object.name,
              generation: object.generation, // Delete specific object version
            });
            logger.info(`Deleted object: ${object.name} (generation: ${object.generation}) from bucket: ${bucketName}`);
          } catch (error) {
            logger.error(`Error deleting object: ${object.name} from bucket: ${bucketName}`, error.message || error);
          }
        })
      );
    }

    logger.info(`Deleted all objects in bucket: ${bucketName}`);
  } catch (error) {
    logger.error(`Error listing objects in bucket: ${bucketName}`, error.message || error);
    throw error;
  }
}

// Function to delete Cloud Storage buckets
async function deleteCloudStorageBuckets(projectId) {
  if (!projectId) {
    logger.error('Project ID is required but not provided.');
    throw new Error('Missing Project ID');
  }

  logger.info(`Starting Cloud Storage cleanup for project: ${projectId}`);

  const authClient = await auth.getClient();
  const storage = google.storage({
    version: 'v1',
    auth: authClient,
  });

  try {
    const res = await storage.buckets.list({ project: projectId });
    const buckets = res.data.items || [];

    if (buckets.length === 0) {
      logger.info('No buckets found in Cloud Storage.');
      return;
    }

    logger.info(`Found ${buckets.length} bucket(s) in project ${projectId}.`);

    // Manual concurrency control
    const concurrencyLimit = 3;
    const chunks = Array.from({ length: Math.ceil(buckets.length / concurrencyLimit) }, (_, i) =>
      buckets.slice(i * concurrencyLimit, i * concurrencyLimit + concurrencyLimit)
    );

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (bucket) => {
          try {
            // Delete all objects in the bucket
            await deleteBucketObjects(storage, bucket.name);

            // Delete the bucket itself
            await storage.buckets.delete({ bucket: bucket.name });
            logger.info(`Deleted bucket: ${bucket.name}`);
          } catch (error) {
            if (error.code === 409 && error.message.includes('The bucket you tried to delete is not empty.')) {
              logger.error(`Cannot delete bucket: ${bucket.name}, as it is not empty.`);
            } else {
              logger.error(`Error deleting bucket: ${bucket.name}`, error.message || error);
            }
          }
        })
      );
    }

    logger.info('Completed Cloud Storage cleanup.');
  } catch (error) {
    logger.error('Error during Cloud Storage cleanup:', error.message || error);
    throw error;
  }
}

module.exports = { deleteCloudStorageBuckets };
