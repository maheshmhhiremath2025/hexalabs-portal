// functions/vmdeletion/azure.js
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
        let vm;
        let osDiskName;

        // Check if the VM exists
        try {
            vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
            osDiskName = vm.storageProfile.osDisk.name;
            
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
        } catch (error) {
            if (error.statusCode === 404) {
                logger.info(`VM '${vmName}' not found in resource group '${resourceGroup}'. Checking for related resources...`);
            } else {
                throw error;
            }
        }

        // Step 3: Delete Network Interface (NIC) - Check even if VM not found
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

        // Step 4: Delete Network Security Group (NSG) - Check even if VM not found
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

        // Step 5: Delete Public IP - Check even if VM not found
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

        // Step 6: Delete Snapshots for this VM - Check even if VM not found
        try {
            const snapshots = [];
            for await (const snapshot of computeClient.snapshots.listByResourceGroup(resourceGroup)) {
                if (snapshot.name.includes(vmName)) {
                    snapshots.push(snapshot);
                }
            }

            for (const snapshot of snapshots) {
                try {
                    await computeClient.snapshots.beginDeleteAndWait(resourceGroup, snapshot.name);
                    logger.info(`Deleted Snapshot: ${snapshot.name}`);
                } catch (error) {
                    if (error.statusCode === 404) {
                        logger.info(`Snapshot '${snapshot.name}' not found. Skipping deletion.`);
                    } else {
                        throw error;
                    }
                }
            }
            
            if (snapshots.length === 0) {
                logger.info(`No snapshots found for VM '${vmName}'.`);
            } else {
                logger.info(`Deleted ${snapshots.length} snapshots for VM '${vmName}'.`);
            }
        } catch (error) {
            logger.info(`Error listing snapshots for VM '${vmName}': ${error.message}`);
        }

        logger.info(`Cleanup completed for VM '${vmName}' and its associated resources.`);
    } catch (error) {
        logger.error("Error in deleting VM and its resources:", error);
    }
};

module.exports = { DeleteVMandResources };
