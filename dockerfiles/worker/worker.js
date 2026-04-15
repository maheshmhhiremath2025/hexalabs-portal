const queues = require('./queues');
const { connectMongoDB } = require('./connection')

connectMongoDB('mongodb://mongodb:27017/userdb')

// Import Handlers
const azureCreateVmHandler = require('./handlers/azure-create-vm');
const azureDeleteVmHandler = require('./handlers/azure-delete-vm');
const azureAddPortHandler = require('./handlers/azure-add-port');
const azureRemovePortHandler = require('./handlers/azure-remove-port');
const azureStartVmHandler = require('./handlers/azure-start-vm');
const azureReStartVmHandler = require('./handlers/azure-restart-vm');
const azureStopVmHandler = require('./handlers/azure-stop-vm');
const azureCaptureVmHandler = require('./handlers/azure-vm-capture');
const guacamoleAddHandler = require('./handlers/guacamole-add');
const guacamoleRemoveHandler = require('./handlers/guacamole-remove');
const gcpCreateProjectHandler = require('./handlers/gcp-create-project');
const gcpDeleteProjectHandler = require('./handlers/gcp-delete-project');
const gcpCreateBudgetHandler = require('./handlers/gcp-create-budget');
const gcpDeleteBudgetHandler = require('./handlers/gcp-delete-budget');
const gcpCleanProjectHandler = require('./handlers/gcp-clean-project');
const emailQueueHandler = require('./handlers/email-queue');
const gcpAddBillingHandler = require('./handlers/gcp-add-billing');
const gcpRemoveBillingHandler = require('./handlers/gcp-remove-billing');
const gcpAddUsersHandler = require('./handlers/gcp-add-users');
const azureDeleteSandBoxHandler = require('./handlers/azure-delete-sandbox')
const azureCreateSandBoxHandler = require('./handlers/azure-create-sandbox');
const azureCreateUserHandler = require('./handlers/azure-create-user');
const azureDeleteUserHandler = require('./handlers/azure-delete-user');
const awsCreateUserHandler = require('./handlers/aws-create-user');
const awsDeleteUserHandler = require('./handlers/aws-delete-user');

// Attach Handlers to Queues
queues['azure-create-vm'].process(azureCreateVmHandler);
queues['azure-delete-vm'].process(azureDeleteVmHandler);
queues['azure-add-port'].process(azureAddPortHandler);
queues['azure-remove-port'].process(azureRemovePortHandler);
queues['azure-start-vm'].process(azureStartVmHandler);
queues['azure-restart-vm'].process(azureReStartVmHandler);
queues['azure-stop-vm'].process(azureStopVmHandler);
queues['azure-vm-capture'].process(azureCaptureVmHandler);
queues['guacamole-add'].process(guacamoleAddHandler);
queues['guacamole-remove'].process(guacamoleRemoveHandler);
queues['gcp-create-project'].process(gcpCreateProjectHandler);
queues['gcp-delete-project'].process(gcpDeleteProjectHandler);
queues['gcp-create-budget'].process(gcpCreateBudgetHandler);
queues['gcp-delete-budget'].process(gcpDeleteBudgetHandler);
queues['gcp-clean-project'].process(gcpCleanProjectHandler);
queues['email-queue'].process(emailQueueHandler);
queues['gcp-add-billing'].process(gcpAddBillingHandler);
queues['gcp-remove-billing'].process(gcpRemoveBillingHandler);
queues['gcp-add-users'].process(gcpAddUsersHandler);
queues['azure-delete-sandbox'].process(azureDeleteSandBoxHandler);
queues['azure-create-sandbox'].process(azureCreateSandBoxHandler);
queues['azure-create-user'].process(azureCreateUserHandler);
queues['azure-delete-user'].process(azureDeleteUserHandler);
queues['aws-create-user'].process(awsCreateUserHandler);
queues['aws-delete-user'].process(awsDeleteUserHandler);

console.log('Worker started and listening for jobs...');
