const Bull = require('bull');

// Keep these options in lockstep with backend/controllers/newQueues.js —
// mismatched defaults between the two sides cause drift we can't see.
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
  'azure-restart-vm',
  'azure-stop-vm',
  'azure-capture-vm',
  'guacamole-add',
  'guacamole-remove',
  'gcp-create-project',
  'gcp-delete-project',
  'gcp-create-budget',
  'gcp-add-users',
  'gcp-delete-budget',
  'gcp-clean-project',
  'gcp-add-billing',
  'gcp-remove-billing',
  'email-queue',
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
