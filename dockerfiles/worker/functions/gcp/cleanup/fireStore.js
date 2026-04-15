const { Firestore } = require('@google-cloud/firestore');
const { google } = require('googleapis');

const { logger } = require('./../../../plugins/logger');

// Correct path to your service account key file
const path = require('path');
const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

function initializeFirestore(projectId) {
  return new Firestore({
    projectId,
    keyFilename,
  });
}

async function isFirestoreApiEnabled(projectId) {
  const serviceUsage = google.serviceusage('v1');
  const auth = new google.auth.GoogleAuth({
    keyFilename,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const authClient = await auth.getClient();

  try {
    const res = await serviceUsage.services.get({
      name: `projects/${projectId}/services/firestore.googleapis.com`,
      auth: authClient,
    });
    return res.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      logger.warn(`Firestore API not enabled for project: ${projectId}`);
      return false;
    }
    logger.error('Error checking Firestore API status:', error.message || error);
    throw error;
  }
}

async function deleteFirestoreCollections(projectId) {
  if (!projectId) {
    logger.error('Project ID is required.');
    throw new Error('Missing Project ID');
  }

  logger.info(`Starting Firestore cleanup for project: ${projectId}`);

  const isEnabled = await isFirestoreApiEnabled(projectId);
  if (!isEnabled) {
    logger.info(`Skipping Firestore cleanup as API is not enabled for project: ${projectId}`);
    return;
  }

  const firestore = initializeFirestore(projectId);

  try {
    const collections = await firestore.listCollections();
    if (collections.length === 0) {
      logger.info('No collections found in Firestore.');
      return;
    }

    for (const collection of collections) {
      try {
        logger.info(`Starting deletion for collection: ${collection.id}`);
        await deleteCollection(firestore, collection);
        logger.info(`Successfully deleted collection: ${collection.id}`);
      } catch (error) {
        logger.error(`Error deleting collection ${collection.id}:`, error.message || error);
      }
    }

    logger.info('All Firestore collections processed.');
  } catch (error) {
    if (error.code === 5 && error.message.includes('NOT_FOUND')) {
      logger.info(`Firestore is not set up for project ${projectId}. Visit https://console.cloud.google.com/datastore/setup?project=${projectId} to set up Firestore.`);
    } else {
      logger.error('Error during Firestore cleanup:', error.message || error);
      throw error;
    }
  }
}

async function deleteCollection(firestore, collection) {
  const query = collection.limit(500);
  let batchCount = 0;

  while (true) {
    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    const batch = firestore.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    batchCount += snapshot.size;

    logger.info(`Deleted batch of ${snapshot.size} documents from collection: ${collection.id}`);
  }

  logger.info(`Completed deletion for collection: ${collection.id}, total documents deleted: ${batchCount}`);
}

module.exports = { deleteFirestoreCollections };
