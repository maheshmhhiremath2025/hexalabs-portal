require('dotenv').config()
const {logger} = require('./../../plugins/logger')
const { ClientSecretCredential} = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");


const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const DeleteSandbox = async(sandbox) => {
    if (!sandbox) {
        logger.error("Sandbox name is not provided.");
        return;
    }    
    const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const resourceClient = new ResourceManagementClient(credentials, subscriptionId);
    
    try {
        await resourceClient.resourceGroups.beginDeleteAndWait(sandbox);
        logger.info(`Deleted Successfully Sandbox: ${sandbox}`)
    } catch (error) {
        logger.error(`Error in deleting Sandbox ${sandbox}: ${error.message}`);
    }
}

module.exports = {DeleteSandbox}