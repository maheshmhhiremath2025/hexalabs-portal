const Bull = require('bull');

// Centralized Redis + Bull config. Both backend and worker import the same
// shape so defaults don't drift. The retry + removeOnFail settings close a
// long-standing "silent failure" class — transient Azure 429/5xx will be
// retried automatically, and completed/failed history is capped so Redis
// memory doesn't creep. Bumping these here affects both enqueue (backend)
// and dequeue (worker) because Bull re-reads them per call.
const queueOpts = {
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 15000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
};

// Queue Names
const queueNames = [
  'azure-create-vm',
  'azure-delete-vm',
  'azure-add-port',
  'azure-remove-port',
  'azure-start-vm',
  'azure-stop-vm',
  'azure-capture-vm',
  'guacamole-add',
  'guacamole-remove',
  'gcp-create-project',
  'gcp-delete-project',
  'gcp-clean-project',
  'email-queue',
  'azure-restart-vm',
  'gcp-create-budget',
  'gcp-add-users',
  'gcp-delete-budget',
  'gcp-add-billing',
  'gcp-remove-billing',
  'azure-create-sandbox',
  'azure-delete-sandbox',
  'azure-create-user',
  'azure-delete-user',
  'azure-vm-capture',
  'aws-create-user',
  'aws-delete-user',
  'meshcentral-setup',
];

// Dynamically Create Queues
const queues = {};
queueNames.forEach((name) => {
  queues[name] = new Bull(name, queueOpts);
});

module.exports = queues;
