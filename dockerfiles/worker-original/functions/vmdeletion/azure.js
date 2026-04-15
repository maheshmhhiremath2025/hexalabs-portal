require('dotenv').config();
const { logger } = require('./../../plugins/logger');
const { ClientSecretCredential } = require("@azure/identity");
const { ComputeManagementClient } = require('@azure/arm-compute');
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
        // Check if the VM exists
        let vm;
        try {
            vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`VM '${vmName}' not found in resource group '${resourceGroup}'. Skipping deletion.`);
                return;
            } else {
                throw error;
            }
        }

        const osDiskName = vm.storageProfile.osDisk.name;

        // Step 1: Delete VM
        logger.info(`Deleting VM: ${vmName}...`);
        await computeClient.virtualMachines.beginDeleteAndWait(resourceGroup, vmName);
        logger.info(`VM '${vmName}' deleted successfully.`);

        // Step 2: Delete OS Disk
        try {
            await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
            logger.info(`Deleted OS Disk: ${osDiskName}`);
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`OS Disk '${osDiskName}' not found. Skipping deletion.`);
            } else {
                throw error;
            }
        }

        // Step 3: Delete Network Interface (NIC)
        const nicName = `${vmName}-nic`;
        try {
            await networkClient.networkInterfaces.beginDeleteAndWait(resourceGroup, nicName);
            logger.info(`Deleted Network Interface: ${nicName}`);
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`Network Interface '${nicName}' not found. Skipping deletion.`);
            } else {
                throw error;
            }
        }

        // Step 4: Delete Network Security Group (NSG)
        const nsgName = `${vmName}-nsg`;
        try {
            await networkClient.networkSecurityGroups.beginDeleteAndWait(resourceGroup, nsgName);
            logger.info(`Deleted Network Security Group: ${nsgName}`);
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`Network Security Group '${nsgName}' not found. Skipping deletion.`);
            } else {
                throw error;
            }
        }

        // Step 5: Delete Public IP
        const publicIPName = `${vmName}-public-IP`;
        try {
            await networkClient.publicIPAddresses.beginDeleteAndWait(resourceGroup, publicIPName);
            logger.info(`Deleted Public IP: ${publicIPName}`);
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`Public IP '${publicIPName}' not found. Skipping deletion.`);
            } else {
                throw error;
            }
        }

        logger.info(`Successfully deleted VM '${vmName}' and its associated resources.`);
    } catch (error) {
        logger.error("Error in deleting VM and its resources:", error);
    }
};

module.exports = { DeleteVMandResources };
