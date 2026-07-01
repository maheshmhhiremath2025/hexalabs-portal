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

const subnetName = 'default';
const adminUsername = 'labuser';
const adminPassword = 'Welcome1234!';

const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);

const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// Original function: Create VM from image (for initial creation using template/imageId)
async function createVirtualMachine(vmName, vmTemplate) {
    const {location, imageId, resourceGroup, vmSize, vnet, licence, official, planPublisher, product, version, securityType, zone, publisher, offer, sku, marketplaceVersion, diskSizeGB} = vmTemplate;
    const nicName = vmName + "-nic";
    const publicIpName = vmName + "-public-IP";
    const publicIpParameters = {
        sku: { name: "Standard" },
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
                    },
                    ...(diskSizeGB > 0 ? { diskSizeGB } : {}),
                },
                imageReference: imageId
                    ? { id: imageId }
                    : (publisher && offer && sku)
                        ? { publisher, offer, sku, version: marketplaceVersion || 'latest' }
                        : null,
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
            },
            ...(zone ? { zones: [zone] } : {}),
        };

        // Apply marketplace plan info whenever provided (needed for gallery images
        // captured from Marketplace-sourced VMs, regardless of official flag)
        if (planPublisher && product) {
            vmParameters.plan = {
                publisher: planPublisher,
                product: product,
                name: version || product  // version holds the plan SKU (e.g. "9-base")
            };
        }

        if (licence !== "none") {
            vmParameters.licenseType = licence;
        }

        // Always add osProfile for generalized images:
        // - non-official gallery images
        // - gallery images (generalized)
        // - marketplace images (always generalized, no imageId)
        if (!official || imageId?.includes('/galleries/') || !imageId) {
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
            },
            // HTTP 80 + 81 — open for guided-lab templates that bake in an
            // nginx side-panel guide (port 80) and code-server browser IDE
            // (port 81). Same closed-TCP-is-fine reasoning as KasmVNC above.
            {
                name: 'allow-80-guide',
                priority: 1003,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '80',
                destinationAddressPrefix: '*'
            },
            {
                name: 'allow-81-codeserver',
                priority: 1004,
                direction: 'Inbound',
                access: 'Allow',
                protocol: 'Tcp',
                sourcePortRange: '*',
                sourceAddressPrefix: '*',
                destinationPortRange: '81',
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

async function createOsDiskFromSnapshot(resourceGroup, diskName, snapshotId, location, osType, tags = {}, zone) {
  const poll = await computeClient.disks.beginCreateOrUpdate(resourceGroup, diskName, {
    location,
    osType,
    sku: { name: 'StandardSSD_LRS' },
    creationData: { createOption: 'Copy', sourceResourceId: snapshotId },
    tags,
    ...(zone ? { zones: [zone] } : {}),
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
    osType,
    tags = {},
    nicName = `${vmName}-nic`,
    zone,
    planPublisher,
    product,
    version,
  } = vmTemplate;
  // 1) Get the NIC we keep for this seat
  const nic = await getExistingNic(resourceGroup, nicName);
  // 2) Find latest seat OS snapshot
  const latestSnap = await getLatestSeatSnapshot(resourceGroup, vmName);

  // Auto-detect osType: prefer explicit template value → snapshot metadata → fallback
  const resolvedOsType = osType || latestSnap.osType || 'Linux';
  logger.info(`[startFromSnapshot] ${vmName}: osType=${resolvedOsType} (source: ${osType ? 'template' : latestSnap.osType ? 'snapshot' : 'default'})`);

  // 3) Create OS disk from that snapshot
  const osDiskName = `${vmName}-os`; // transient; will be deleted on next Stop

  // -------- orphan disk cleanup (2026-06-10) --------
  // Spot eviction with Delete policy detaches but does NOT delete the OS disk.
  // The next Start would hit "Changing property 'sourceResourceId' is not allowed
  // for existing disk" because Azure forbids changing the source on an existing
  // disk. We pre-check and delete the orphan; snapshot has identical state.
  try {
    const existing = await computeClient.disks.get(resourceGroup, osDiskName);
    if (existing.managedBy) {
      // Disk still attached to another VM — refuse to interfere.
      throw new Error(`Disk ${osDiskName} is attached to ${existing.managedBy}; cannot recover ${vmName}`);
    }
    logger.warn(`[startFromSnapshot] ${vmName}: orphan disk ${osDiskName} found (state=${existing.diskState}). Deleting before snapshot restore.`);
    await computeClient.disks.beginDeleteAndWait(resourceGroup, osDiskName);
    logger.info(`[startFromSnapshot] ${vmName}: orphan disk deleted, proceeding with snapshot restore`);
  } catch (e) {
    if (e.statusCode === 404) {
      // No orphan — normal happy path, proceed.
    } else if (String(e.message || '').includes('is attached to')) {
      // Hard fail — surface to the caller.
      throw e;
    } else {
      logger.warn(`[startFromSnapshot] ${vmName}: orphan-disk pre-check soft-fail (${e.statusCode || ''}): ${e.message}`);
      // Continue — the createOsDiskFromSnapshot call below will surface any real issue.
    }
  }
  // --------------------------------------------------

  const osDisk = await createOsDiskFromSnapshot(resourceGroup, osDiskName, latestSnap.id, location, resolvedOsType, tags, zone);
  // 4) Create VM (Spot is fine; eviction policy deallocate)
  // Snapshot carries the source VM's security type — the new VM shell must match,
  // otherwise Azure rejects with "Security type ... not compatible with attached OS Disk".
  const isTL = latestSnap.securityProfile?.securityType === 'TrustedLaunch';
  const vmParams = {
    location,
    tags,
    hardwareProfile: { vmSize },
    storageProfile: {
      osDisk: {
        name: osDisk.name,
        createOption: 'Attach',
        managedDisk: { id: osDisk.id },
        osType: resolvedOsType
      }
    },
    networkProfile: { networkInterfaces: [{ id: nic.id, primary: true }] },
    securityProfile: isTL
      ? { securityType: 'TrustedLaunch', uefiSettings: { secureBootEnabled: true, vTpmEnabled: true } }
      : { secureBootEnabled: true, virtualTpmEnabled: true, integrityMonitoringEnabled: true },
    priority: 'Spot',
    evictionPolicy: 'Deallocate',
    ...(zone ? { zones: [zone] } : {}),
  };
  // Marketplace-sourced snapshots require the original plan block — same rule
  // as createVirtualMachine. Without it Azure returns VMMarketplaceInvalidInput.
  if (planPublisher && product) {
    vmParams.plan = {
      publisher: planPublisher,
      product: product,
      name: version || product,
    };
  }
  const poll = await computeClient.virtualMachines.beginCreateOrUpdate(resourceGroup, vmName, vmParams);
  await poll.pollUntilDone();
  // 5) Return IP for UI (derived from NIC ipConfiguration to support non-standard PIP names)
  const pipIdFromNic = nic.ipConfigurations && nic.ipConfigurations[0] && nic.ipConfigurations[0].publicIPAddress && nic.ipConfigurations[0].publicIPAddress.id;
  const pipName = pipIdFromNic ? pipIdFromNic.split("/").pop() : `${vmName}-public-IP`;
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
