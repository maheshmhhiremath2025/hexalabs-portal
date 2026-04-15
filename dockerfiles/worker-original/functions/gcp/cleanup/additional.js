const { google } = require('googleapis');
const path = require('path');
const { logger } = require('./../../../plugins/logger');

// Correct path to your service account key file
const keyFilename = path.resolve(__dirname, './../../../trail-krishan-prefix-0-8f758fd2d555.json');

const auth = new google.auth.GoogleAuth({
  keyFilename,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

// Helper function to delay API calls (rate-limiting)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper function to process items in chunks with concurrency control
async function processInChunks(items, chunkSize, processFn) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(processFn));
  }
}

// Utility to check if an API is enabled
async function isApiEnabled(projectId, apiName) {
  const serviceUsage = google.serviceusage('v1');
  const authClient = await auth.getClient();

  try {
    const res = await serviceUsage.services.get({
      name: `projects/${projectId}/services/${apiName}`,
      auth: authClient,
    });
    return res.data.state === 'ENABLED';
  } catch (error) {
    if (error.code === 403 || error.code === 404) {
      return false;
    }
    throw error;
  }
}

// Generic deletion function
async function deleteResources(apiFn, resources, resourceType) {
  const chunkSize = 5; // Maximum number of concurrent API requests
  await processInChunks(resources, chunkSize, async (resource) => {
    try {
      await apiFn(resource);
      logger.info(`Deleted ${resourceType}: ${resource}`);
    } catch (error) {
      logger.error(`Error deleting ${resourceType}: ${resource}`, error.message || error);
    }
  });
}

async function cleanupResources(projectId) {
  if (!projectId) {
    logger.error('Project ID is required');
    throw new Error('Project ID not provided.');
  }

  const authClient = await auth.getClient();

  // Cleanup Pub/Sub
  if (await isApiEnabled(projectId, 'pubsub.googleapis.com')) {
    const pubsub = google.pubsub({ version: 'v1', auth: authClient });
    const topicsRes = await pubsub.projects.topics.list({ project: `projects/${projectId}` });
    const topics = topicsRes.data.topics || [];
    logger.info(`Found ${topics.length} Pub/Sub topics`);
    await deleteResources(
      (topic) => pubsub.projects.topics.delete({ topic: topic.name }),
      topics,
      'Pub/Sub topic'
    );

    const subscriptionsRes = await pubsub.projects.subscriptions.list({ project: `projects/${projectId}` });
    const subscriptions = subscriptionsRes.data.subscriptions || [];
    logger.info(`Found ${subscriptions.length} Pub/Sub subscriptions`);
    await deleteResources(
      (sub) => pubsub.projects.subscriptions.delete({ subscription: sub.name }),
      subscriptions,
      'Pub/Sub subscription'
    );
  }

  // Cleanup Cloud Functions
  if (await isApiEnabled(projectId, 'cloudfunctions.googleapis.com')) {
    const cloudFunctions = google.cloudfunctions({ version: 'v1', auth: authClient });
    const functionsRes = await cloudFunctions.projects.locations.functions.list({
      parent: `projects/${projectId}/locations/-`,
    });
    const functions = functionsRes.data.functions || [];
    logger.info(`Found ${functions.length} Cloud Functions`);
    await deleteResources(
      (fn) => cloudFunctions.projects.locations.functions.delete({ name: fn.name }),
      functions,
      'Cloud Function'
    );
  }

  // Cleanup Cloud Run
  if (await isApiEnabled(projectId, 'run.googleapis.com')) {
    const cloudRun = google.run({ version: 'v1', auth: authClient });
    const servicesRes = await cloudRun.projects.locations.services.list({
      parent: `projects/${projectId}/locations/-`,
    });
    const services = servicesRes.data.items || [];
    logger.info(`Found ${services.length} Cloud Run services`);
    await deleteResources(
      (service) => cloudRun.projects.locations.services.delete({ name: service.metadata.name }),
      services,
      'Cloud Run service'
    );
  }

  // Cleanup BigQuery
  if (await isApiEnabled(projectId, 'bigquery.googleapis.com')) {
    const bigquery = google.bigquery({ version: 'v2', auth: authClient });
    const datasetsRes = await bigquery.datasets.list({ projectId });
    const datasets = datasetsRes.data.datasets || [];
    logger.info(`Found ${datasets.length} BigQuery datasets`);
    await deleteResources(
      (dataset) => bigquery.datasets.delete({ projectId, datasetId: dataset.datasetReference.datasetId }),
      datasets,
      'BigQuery dataset'
    );
  }

  // Cleanup IAM Policies (Service Accounts)
  const iam = google.iam({ version: 'v1', auth: authClient });
  const serviceAccountsRes = await iam.projects.serviceAccounts.list({ name: `projects/${projectId}` });
  const serviceAccounts = serviceAccountsRes.data.accounts || [];
  logger.info(`Found ${serviceAccounts.length} service accounts`);
  await deleteResources(
    (account) => iam.projects.serviceAccounts.delete({ name: account.name }),
    serviceAccounts,
    'Service Account'
  );

  // Dataproc Clusters
if (await isApiEnabled(projectId, 'dataproc.googleapis.com')) {
  const dataproc = google.dataproc({ version: 'v1', auth: authClient });
  const clustersRes = await dataproc.projects.regions.clusters.list({
    projectId,
    region: '-',
  });
  const clusters = clustersRes.data.clusters || [];
  logger.info(`Found ${clusters.length} Dataproc clusters`);
  await processInChunks(
    clusters,
    5, // Set your concurrency limit
    async (cluster) => {
      try {
        await dataproc.projects.regions.clusters.delete({
          projectId,
          region: cluster.region,
          clusterName: cluster.clusterName,
        });
        logger.info(`Deleted Dataproc cluster: ${cluster.clusterName}`);
      } catch (error) {
        logger.error(`Error deleting Dataproc cluster: ${cluster.clusterName}`, error.message || error);
      }
    }
  );
}

// Cloud NAT
if (await isApiEnabled(projectId, 'compute.googleapis.com')) {
  const compute = google.compute({ version: 'v1', auth: authClient });
  const natRes = await compute.routers.aggregatedList({ project: projectId });
  const natRouters = Object.values(natRes.data.items || {})
    .flatMap((item) => item.routers || [])
    .filter((router) => router.nats && router.nats.length > 0);

  logger.info(`Found ${natRouters.length} NAT configurations`);
  await processInChunks(
    natRouters,
    5, // Set your concurrency limit
    async (router) => {
      try {
        for (const nat of router.nats) {
          await compute.routers.delete({
            project: projectId,
            region: router.region,
            router: router.name,
          });
          logger.info(`Deleted NAT configuration: ${nat.name}`);
        }
      } catch (error) {
        logger.error(`Error deleting NAT configuration in router: ${router.name}`, error.message || error);
      }
    }
  );
}

// Persistent Disks
if (await isApiEnabled(projectId, 'compute.googleapis.com')) {
  const compute = google.compute({ version: 'v1', auth: authClient });
  const disksRes = await compute.disks.aggregatedList({ project: projectId });
  const disks = Object.values(disksRes.data.items || {})
    .flatMap((item) => item.disks || [])
    .filter((disk) => !disk.users || disk.users.length === 0); // Unattached disks

  logger.info(`Found ${disks.length} unattached disks`);
  await processInChunks(
    disks,
    5, // Set your concurrency limit
    async (disk) => {
      try {
        await compute.disks.delete({
          project: projectId,
          zone: disk.zone.split('/').pop(),
          disk: disk.name,
        });
        logger.info(`Deleted Persistent Disk: ${disk.name}`);
      } catch (error) {
        logger.error(`Error deleting Persistent Disk: ${disk.name}`, error.message || error);
      }
    }
  );
}

// Cloud Interconnect
if (await isApiEnabled(projectId, 'compute.googleapis.com')) {
  const compute = google.compute({ version: 'v1', auth: authClient });
  const interconnectsRes = await compute.interconnects.list({ project: projectId });
  const interconnects = interconnectsRes.data.items || [];
  logger.info(`Found ${interconnects.length} interconnects`);
  await processInChunks(
    interconnects,
    5, // Set your concurrency limit
    async (interconnect) => {
      try {
        await compute.interconnects.delete({
          project: projectId,
          interconnect: interconnect.name,
        });
        logger.info(`Deleted Cloud Interconnect: ${interconnect.name}`);
      } catch (error) {
        logger.error(`Error deleting Cloud Interconnect: ${interconnect.name}`, error.message || error);
      }
    }
  );
}

// Cloud DNS
if (await isApiEnabled(projectId, 'dns.googleapis.com')) {
  const dns = google.dns({ version: 'v1', auth: authClient });
  const managedZonesRes = await dns.managedZones.list({ project: projectId });
  const managedZones = managedZonesRes.data.managedZones || [];
  logger.info(`Found ${managedZones.length} DNS zones`);
  await processInChunks(
    managedZones,
    5, // Set your concurrency limit
    async (zone) => {
      try {
        await dns.managedZones.delete({
          project: projectId,
          managedZone: zone.name,
        });
        logger.info(`Deleted DNS zone: ${zone.name}`);
      } catch (error) {
        logger.error(`Error deleting DNS zone: ${zone.name}`, error.message || error);
      }
    }
  );
}


  // Add other resource-specific cleanup logic as needed (SQL, Storage, etc.)
}

module.exports = {cleanupResources};

