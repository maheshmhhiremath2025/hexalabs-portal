const Bull = require('bull');

// Centralized Redis Configuration
const redisConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'redis', // Redis container name
    port: process.env.REDIS_PORT || 6379,
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
];

// Dynamically Create Queues
const queues = {};
queueNames.forEach((name) => {
  queues[name] = new Bull(name, redisConfig);
});

module.exports = queues;
