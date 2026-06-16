// functions/vmdeletion/azure.js
require('dotenv').config();
const { logger } = require('./../../plugins/logger');
const { ClientSecretCredential } = require("@azure/identity");
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require("@azure/arm-network");
const { ResourceManagementClient } = require('@azure/arm-resources');

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const DeleteVMandResources = async (vmName, resourceGroup) => {
    const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const computeClient = new ComputeManagementClient(credentials, subscriptionId);
    const networkClient = new NetworkManagementClient(credentials, subscriptionId);
    const resourceClient = new ResourceManagementClient(credentials, subscriptionId);

    try {
        let vm;
        let osDiskName;
        let dataDiskNames = [];

        // Check if the VM exists
        try {
            vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
            osDiskName = vm.storageProfile.osDisk.name;
            // Capture data-disk names BEFORE the VM is gone — managed disks named
            // by Azure (e.g. `<vmName>_disk1_xxx`) don't match the `<vmName>-` prefix
            // sweep below, so we collect them by reference here instead.
            dataDiskNames = (vm.storageProfile.dataDisks || []).map(d => d.name).filter(Boolean);
            if (dataDiskNames.length) {
                logger.info(`VM '${vmName}' has ${dataDiskNames.length} attached data disk(s): ${dataDiskNames.join(', ')}`);
            }

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

            // Step 2b: Delete attached data disks (captured before VM delete).
            for (const dn of dataDiskNames) {
                try {
                    await computeClient.disks.beginDeleteAndWait(resourceGroup, dn);
                    logger.info(`Deleted Data Disk: ${dn}`);
                } catch (error) {
                    if (error.statusCode === 404) {
                        logger.info(`Data Disk '${dn}' not found. Skipping deletion.`);
                    } else {
                        logger.warn(`Data Disk '${dn}' delete failed (continuing): ${error.message}`);
                    }
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

        // Step 7: Scoped sweep — delete any remaining resource in the RG whose name
        // equals `<vmName>` or starts with `<vmName>-`. Catches data disks with
        // non-standard names, learner-created extras (NICs, NSGs, public IPs,
        // storage accounts), and non-standard-named resources from adopted VMs.
        // The RG itself is intentionally NOT touched (shared across VMs).
        //
        // Prefix uses a trailing dash so `acedev-6` doesn't sweep `acedev-60-*`.
        try {
            const namePrefix = `${vmName}-`;
            const matches = [];
            for await (const r of resourceClient.resources.listByResourceGroup(resourceGroup)) {
                if (r.name === vmName || (r.name && r.name.startsWith(namePrefix))) {
                    matches.push(r);
                }
            }
            logger.info(`[scoped-sweep] ${matches.length} residual resource(s) match '${vmName}' or '${namePrefix}*' in ${resourceGroup}`);

            // Cache latest api-version per resource type so we don't query Providers per resource.
            const apiVersionCache = {};
            const getApiVersion = async (resourceType) => {
                if (apiVersionCache[resourceType]) return apiVersionCache[resourceType];
                const slash = resourceType.indexOf('/');
                const ns = resourceType.slice(0, slash);
                const childType = resourceType.slice(slash + 1);
                try {
                    const provider = await resourceClient.providers.get(ns);
                    const rt = (provider.resourceTypes || []).find(t => (t.resourceType || '').toLowerCase() === childType.toLowerCase());
                    const v = rt && rt.apiVersions && rt.apiVersions.length ? rt.apiVersions[0] : '2024-11-01';
                    apiVersionCache[resourceType] = v;
                    return v;
                } catch {
                    apiVersionCache[resourceType] = '2024-11-01';
                    return '2024-11-01';
                }
            };

            for (const r of matches) {
                try {
                    const apiVersion = await getApiVersion(r.type);
                    await resourceClient.resources.beginDeleteByIdAndWait(r.id, apiVersion);
                    logger.info(`[scoped-sweep] deleted ${r.type} ${r.name}`);
                } catch (error) {
                    if (error.statusCode === 404 || /not found|does not exist/i.test(error.message || '')) {
                        // already gone (steps 1-6 caught it earlier)
                    } else {
                        logger.warn(`[scoped-sweep] failed to delete ${r.type} ${r.name}: ${error.message}`);
                    }
                }
            }
        } catch (sweepErr) {
            logger.warn(`[scoped-sweep] enumeration error (continuing): ${sweepErr.message}`);
        }

        logger.info(`Cleanup completed for VM '${vmName}' and its associated resources.`);
    } catch (error) {
        logger.error("Error in deleting VM and its resources:", error);
    }
};

module.exports = { DeleteVMandResources };
