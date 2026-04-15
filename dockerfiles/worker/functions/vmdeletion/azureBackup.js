require('dotenv').config()
const {logger} = require('./../../plugins/logger')
const { ClientSecretCredential} = require("@azure/identity");
const { ComputeManagementClient} = require('@azure/arm-compute');
const { NetworkManagementClient } = require("@azure/arm-network");

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const DeleteVMandResources = async (vmName, resourceGroup) => {
    const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const computeClient = new ComputeManagementClient(credentials, subscriptionId);
    const networkClient = new NetworkManagementClient(credentials, subscriptionId);

    try {
        const vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
        if (vm) {
            const osDiskName = vm.storageProfile.osDisk.name;

            // Step 1: Delete VM
            logger.info(`Deleting VM: ${vmName}...`);
            await computeClient.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);

            // Step 2: Delete OS Disk
            await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
        }

        // Check and delete NIC
        const nicName = `${vmName}-nic`;
        const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
        if (nic) {
            await networkClient.networkInterfaces.beginDeleteAndWait(resourceGroup, nicName);
        }

        // Check and delete NSG
        const nsgName = `${vmName}-nsg`;
        const nsg = await networkClient.networkSecurityGroups.get(resourceGroup, nsgName);
        if (nsg) {
            await networkClient.networkSecurityGroups.beginDeleteAndWait(resourceGroup, nsgName);
        }

        // Check and delete Public IP
        const publicIPName = `${vmName}-public-IP`;
        const publicIP = await networkClient.publicIPAddresses.get(resourceGroup, publicIPName);
        if (publicIP) {
            await networkClient.publicIPAddresses.beginDeleteAndWait(resourceGroup, publicIPName);
        }

        logger.info(`Deleted Successfully VM: ${vmName}`)
    } catch (error) {
        logger.error("Error in deleting VM and its resources:", error);
    }
};

module.exports = {DeleteVMandResources}