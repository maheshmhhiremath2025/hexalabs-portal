// functions/vmcreation/azure.js
require('dotenv').config();
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { logger } = require('../../plugins/logger'); // Corrected path assuming structure: app/functions/vmcreation, app/plugins

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const subnetName = 'default2';
const adminUsername = 'labuser';
const adminPassword = 'Welcome1234!';

const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);

const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// Original function: Create VM from image (for initial creation using template/imageId)
async function createVirtualMachine(vmName, vmTemplate) {
    const {location, imageId, resourceGroup, vmSize, vnet, licence, official, planPublisher, product, version, securityType} = vmTemplate;
    const nicName = vmName + "-nic";
    const publicIpName = vmName + "-public-IP";
    const publicIpParameters = {
        location: location,
        publicIPAllocationMethod: "Static"
    };
    
    try {
        // Creating and storing public IP
        const PublicIpResponse = await networkClient.publicIPAddresses.beginCreateOrUpdate(resourceGroup, publicIpName, publicIpParameters);
        const publicIp = await PublicIpResponse.pollUntilDone();

        // Get vnet and subnet
        const virtualNetwork = await networkClient.virtualNetworks.get(resourceGroup, vnet);
        const subnet = virtualNetwork.subnets.find(subnet => subnet.name === subnetName);

        // Create and store NIC
        const nicParameters = {
            location: location,
            ipConfigurations: [{
                name: 'ipConfig1',
                privateIPAllocationMethod: "Dynamic",
                subnet: {
                    id: subnet.id
                },
                publicIpAddress: {
                    id: publicIp.id
                }
            }]
        }
        const nicResponse = await networkClient.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nicParameters);
        const nic = await nicResponse.pollUntilDone();

        // Create NSG and associate it with NIC
        await createNSGAndAssociate(vmName, resourceGroup, location, nicName, publicIp, subnet);

        // Initialize VM parameters
        let vmParameters = {
            location: location,
            hardwareProfile: {
                vmSize: vmSize,
            },
            storageProfile: {
                osDisk: {
                    createOption: 'FromImage',
                    managedDisk: {
                        storageAccountType: 'StandardSSD_LRS'
                    }
                },
                imageReference: official ? null : { // Only set imageReference if not using a custom captured image
                    id: imageId,
                }
            },
            networkProfile: {
                networkInterfaces: [
                    {
                        id: nic.id,
                    },
                ],
            },
            securityProfile: securityType === 'TrustedLaunch'
                ? { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } }
                : { secureBootEnabled: true, virtualTpmEnabled: true, integrityMonitoringEnabled: true },
            priority: 'Spot',
            evictionPolicy: 'Deallocate',
            billingProfile: {
                maxPrice: -1
            }
        };

        if (official) {
            // If using a captured custom image, set the imageId directly and avoid plan details
            vmParameters.storageProfile.imageReference = { id: imageId };

           

            // Plan details are only necessary if the image is a marketplace image, not a captured one
            if (planPublisher && product) {
                vmParameters.plan = {
                    publisher: planPublisher,
                    product: product,
                    name: product
                };
            }
        }

        if (licence !== "none") {
            vmParameters.licenseType = licence;
        }

        // Always add osProfile for generalized gallery images
        // (required by Azure — generalized images lose their user accounts)
        if (!official || imageId?.includes('/galleries/')) {
            vmParameters.osProfile = {
                computerName: vmName.slice(0, 15),
                adminUsername: adminUsername,
                adminPassword: adminPassword,
            };
        }

        // Create the VM. Gallery images come in two flavours:
        //   - Generalized: REQUIRES osProfile (username/password on deploy)
        //   - Specialized: REJECTS osProfile (users baked into the image)
        // We can't tell from imageId alone, so attempt with osProfile first
        // and, if Azure rejects it for a specialized image, retry without.
        let vmResult;
        try {
            const vmResponse = await computeClient.virtualMachines.beginCreateOrUpdate(resourceGroup, vmName, vmParameters);
            vmResult = await vmResponse.pollUntilDone();
        } catch (err) {
            const msg = String(err?.message || err?.details?.message || '');
            if (vmParameters.osProfile && /specialized image/i.test(msg)) {
                console.log(`[vmcreate] ${vmName}: image is specialized, retrying without osProfile`);
                delete vmParameters.osProfile;
                const retryResponse = await computeClient.virtualMachines.beginCreateOrUpdate(resourceGroup, vmName, vmParameters);
                vmResult = await retryResponse.pollUntilDone();
            } else {
                throw err;
            }
        }

        // Fetch the public IP address
        const vmPublicIpAddress = await getPublicIpAddress(resourceGroup, publicIpName);

        // Return VM details
        const vmInformation = {
            vmName: vmName,
            publicIpAddress: vmPublicIpAddress,
            resourceGroup: resourceGroup, 
            adminUsername: adminUsername,
            adminPassword: adminPassword
        };
        return vmInformation;
        
    } catch (error) {
        console.log(`Error creating VM: ${vmName}`, error);
        return null;
    }
}

async function getPublicIpAddress(resourceGroup, publicIpName) {
    const publicIp = await networkClient.publicIPAddresses.get(resourceGroup, publicIpName);
    return publicIp.ipAddress;
}

async function createNSGAndAssociate (vmName, resourceGroup, location, nicName, publicIp, subnet){
    const nsgName = `${vmName}-nsg`;

    const nsgParameters = {
        location: location,
        securityRules: [
            {
                name: 'allow-22',
                priority: 1000,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '22',
                destinationAddressPrefix: '*'
            },
            {
                name: 'allow-3389',
                priority: 1001,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '3389',
                destinationAddressPrefix: '*'
            },
            // KasmVNC HTTPS — always open so templates with KasmVNC baked
            // in (e.g. ubuntu-22-kasm-root) work out of the box. Harmless
            // when nothing is listening; closed-TCP is not a security issue.
            {
                name: 'allow-6901-kasm',
                priority: 1002,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '6901',
                destinationAddressPrefix: '*'
            }
        ]
    };
    const nsgResponse = await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroup, nsgName, nsgParameters);
    const nsg = await nsgResponse.pollUntilDone();
    const ipConfiguration = {
        name: 'ipConfig1',
        privateIPAllocationMethod: 'Dynamic',
        subnet: {
            id: subnet.id
        },
        publicIPAddress: {
            id: publicIp.id
        }
    };

    const nicUpdateParameters = {
        location: location,
        ipConfigurations: [ipConfiguration],
        networkSecurityGroup: {
            id: nsg.id
        }
    };

    const nicUpdateResponse = await networkClient.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nicUpdateParameters);
    await nicUpdateResponse.pollUntilDone();
}

// New functions for snapshot-based recreation (for Start button after stop/snapshot)
async function getExistingNic(resourceGroup, nicName) {
  return networkClient.networkInterfaces.get(resourceGroup, nicName);
}

async function getLatestSeatSnapshot(resourceGroup, vmName) {
  const prefix = `${vmName}-os-snap-`; // Matches your snapshot name pattern
  const snaps = [];
  for await (const s of computeClient.snapshots.listByResourceGroup(resourceGroup)) {
    if (s.name?.startsWith(prefix)) snaps.push(s);
  }
  if (!snaps.length) {
    // Debug: Log all snapshot names in the resource group if none found
    const allSnaps = [];
    for await (const s of computeClient.snapshots.listByResourceGroup(resourceGroup)) {
      allSnaps.push(s.name);
    }
    logger.info(`No snapshots found with prefix '${prefix}' in ${resourceGroup}. All snapshots: ${allSnaps.join(', ') || 'none'}`);
    throw new Error(`No OS snapshots found for seat ${vmName} in ${resourceGroup}`);
  }
  snaps.sort((a, b) => new Date(b.timeCreated) - new Date(a.timeCreated));
  return snaps[0];
}

async function createOsDiskFromSnapshot(resourceGroup, diskName, snapshotId, location, osType = 'Windows', tags = {}) {
  const poll = await computeClient.disks.beginCreateOrUpdate(resourceGroup, diskName, {
    location,
    osType,
    sku: { name: 'StandardSSD_LRS' }, // Changed to StandardSSD_LRS as requested
    creationData: { createOption: 'Copy', sourceResourceId: snapshotId },
    tags
  });
  return poll.pollUntilDone();
}

/**
 * Recreate VM from latest OS snapshot. Re-attach existing NIC so IP/NSG remain the same.
 * vmTemplate must include: { resourceGroup, location, vmSize, osType?, tags?, nicName? }
 * If nicName is omitted, we infer `<vmName>-nic` and `<vmName>-nsg` / `<vmName>-public-IP`.
 * This is used for 'Start' button after the first deployment (uses snapshot instead of imageId/template).
 */
async function createVirtualMachineFromLatestSnapshot(vmName, vmTemplate) {
  const {
    resourceGroup,
    location,
    vmSize,
    osType = 'Windows',
    tags = {},
    nicName = `${vmName}-nic`
  } = vmTemplate;
  // 1) Get the NIC we keep for this seat
  const nic = await getExistingNic(resourceGroup, nicName);
  // 2) Find latest seat OS snapshot
  const latestSnap = await getLatestSeatSnapshot(resourceGroup, vmName);
  // 3) Create OS disk from that snapshot
  const osDiskName = `${vmName}-os`; // transient; will be deleted on next Stop
  const osDisk = await createOsDiskFromSnapshot(resourceGroup, osDiskName, latestSnap.id, location, osType, tags);
  // 4) Create VM (Spot is fine; eviction policy deallocate)
  const vmParams = {
    location,
    tags,
    hardwareProfile: { vmSize },
    storageProfile: {
      osDisk: {
        name: osDisk.name,
        createOption: 'Attach',
        managedDisk: { id: osDisk.id },
        osType
      }
    },
    networkProfile: { networkInterfaces: [{ id: nic.id, primary: true }] },
    securityProfile: { secureBootEnabled: true, virtualTpmEnabled: true, integrityMonitoringEnabled: true },
    priority: 'Spot',
    evictionPolicy: 'Deallocate'
  };
  const poll = await computeClient.virtualMachines.beginCreateOrUpdate(resourceGroup, vmName, vmParams);
  await poll.pollUntilDone();
  // 5) Return IP for UI (taken from the kept Public IP object)
  const pipName = `${vmName}-public-IP`;
  const pip = await networkClient.publicIPAddresses.get(resourceGroup, pipName);
  return {
    vmName,
    resourceGroup,
    publicIpAddress: pip?.ipAddress,
    adminUsername: adminUsername,
    adminPassword: adminPassword
  };
}

module.exports = {
  createVirtualMachine,
  createVirtualMachineFromLatestSnapshot,
  adminUsername,
  adminPassword
};
