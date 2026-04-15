require('dotenv').config()
const { ClientSecretCredential} = require("@azure/identity");
const { ComputeManagementClient } = require("@azure/arm-compute");
const { NetworkManagementClient } = require("@azure/arm-network");
const {logger} = require('./../plugins/logger');


const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;
let credentials = null;


  credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);


const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);




    async function startAzureVM(resourceGroupName, vmName) {
        try {
            const result = await computeClient.virtualMachines.beginStartAndWait(resourceGroupName, vmName);
        } catch (err) {
            logger.error(`Error starting VM: ${err}`);
        }
      }
    async function stopAzureVM(resourceGroupName, vmName) {
        try {
            const result = await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroupName, vmName);
        } catch (err) {
            logger.error(`Error Stoping VM: ${err}`);
        }
      }
    async function restartAzureVM(resourceGroupName, vmName) {
        try {
            const result = await computeClient.virtualMachines.beginRestartAndWait(resourceGroupName, vmName);
        } catch (err) {
            logger.error(`Error Restarting VM: ${err}`);
        }
      }
      
      async function openPort(vmName, port, priority, resourceGroupName) {
        try {
          const nsgName = `${vmName}-nsg`;
          const ruleName = `allow-${port}`;
      
          // Get existing NSG
          const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);
      
          // Check if the rule already exists
          const existingRule = nsg.securityRules.find(rule => rule.name === ruleName);
          if (existingRule) {
            return;
          }
      
          // Add inbound security rule to allow traffic on the specified port
          const ruleParameters = {
            protocol: 'Tcp',
            sourcePortRange: '*',
            sourceAddressPrefix: '*',
            destinationPortRange: port.toString(),
            destinationAddressPrefix: '*',
            direction: 'Inbound',
            access: 'Allow',
            priority: priority, // Adjust priority as needed
          };
      
          nsg.securityRules.push({
            name: ruleName,
            ...ruleParameters,
          });
      
          // Update NSG with the new rule
          await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);
      
        } catch (error) {
          logger.error('Error opening port:', error.message);
          throw error;
        }
      }
      async function closePort(vmName, port, resourceGroupName) {
        try {
          const nsgName = `${vmName}-nsg`;
          const ruleName = `allow-${port}`;
      
          // Get existing NSG
          const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);
      
          // Find the index of the rule to be removed
          const ruleIndex = nsg.securityRules.findIndex(rule => rule.name === ruleName);
      
          // Check if the rule exists
          if (ruleIndex === -1) {
            logger.error(`Rule ${ruleName} does not exist.`);
            return;
          }
      
          // Remove the rule from the array
          nsg.securityRules.splice(ruleIndex, 1);
      
          // Update NSG without the removed rule
          await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);      
        } catch (error) {
          logger.error('Error closing port:', error.message);
          throw error;
        }
      }
      
  

  module.exports = {
    startAzureVM,
    stopAzureVM,
    restartAzureVM,
    openPort,
    closePort,
}