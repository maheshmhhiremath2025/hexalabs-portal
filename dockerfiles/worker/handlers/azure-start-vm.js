// handlers/azure-start-vm.js
const { logger } = require('./../plugins/logger');
const VM = require('./../models/vm');
const { cascadeRdsSessions } = require('./../functions/rdsCascade');
const vmCreationModule = require('./../functions/vmcreation/azure');
const { createVirtualMachineFromLatestSnapshot } = vmCreationModule;
const { NetworkManagementClient } = require('@azure/arm-network');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { ClientSecretCredential } = require('@azure/identity');
require('dotenv').config();

const subscriptionId = process.env.SUBSCRIPTION_ID;
const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);
const computeClient = new ComputeManagementClient(credentials, subscriptionId);

/**
 * Start VM directly if it exists (for ongoing labs)
 */
async function startExistingVM(vmName, resourceGroup) {
  try {
    logger.info(`Attempting to start existing VM: ${vmName}`);
    
    // Check if VM exists and get its current state
    const vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
    
    // Start the VM
    await computeClient.virtualMachines.beginStartAndWait(resourceGroup, vmName);
    
    // Get public IP address from NIC
    const nicName = `${vmName}-nic`;
    const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
    const ipConfig = nic.ipConfigurations && nic.ipConfigurations[0];
    const publicIPAddress = ipConfig ? ipConfig.publicIPAddress : null;
    
    let publicIp = '';
    if (publicIPAddress && publicIPAddress.id) {
      const publicIpName = publicIPAddress.id.split('/').pop();
      const publicIpResource = await networkClient.publicIPAddresses.get(resourceGroup, publicIpName);
      publicIp = publicIpResource.ipAddress || '';
    }
    
    logger.info(`VM ${vmName} started successfully with IP: ${publicIp}`);

    // Safely get VM properties with fallbacks
    return {
      publicIp,
      adminUsername: (vm.osProfile && vm.osProfile.adminUsername) || 'labuser',
      adminPassword: 'Password not available for running VM',
      vmSize: (vm.hardwareProfile && vm.hardwareProfile.vmSize) || 'Standard_D2s_v3',
      location: vm.location || 'southindia'
    };
  } catch (error) {
    logger.error(`Failed to start existing VM ${vmName}:`, error.message);
    throw error;
  }
}

/**
 * Handler executed when the user clicks the "Start" button.
 * It tries to start existing VM first, if not found, recreates from snapshot.
 */
const handler = async (job) => {
  try {
    const vmName = job.data.name;
    const resourceGroup = job.data.resourceGroup;

    // -----------------------------------------------------------------
    // 1. Verify the VM record exists and is allowed to start
    // -----------------------------------------------------------------
    const vmDoc = await VM.findOne(
      { name: vmName },
      'isRunning isAlive vmTemplate vmSize location -_id'
    );

    if (!vmDoc) {
      return logger.error(`${vmName} not found in DB`);
    }
    if (vmDoc.isRunning) {
      return logger.error(`${vmName} is already running – skipping start`);
    }
    if (!vmDoc.isAlive) {
      return logger.error(`${vmName} has exceeded quota and cannot start`);
    }

    // -----------------------------------------------------------------
    // 2. Get VM size and location from separate fields
    // -----------------------------------------------------------------
    let vmTemplate = vmDoc.vmTemplate || {};

    // Use separate vmSize field (saved during stop operation) > vmTemplate.vmSize > default
    let vmSize = vmDoc.vmSize;
    if (!vmSize && vmTemplate.vmSize) {
      vmSize = vmTemplate.vmSize;
      logger.info(`Using VM size from vmTemplate: ${vmSize}`);
    } else if (vmSize) {
      logger.info(`Using saved VM size: ${vmSize}`);
    } else {
      vmSize = 'Standard_D2s_v3';
      logger.warn(`No VM size found - using default: ${vmSize}`);
    }

    // Use separate location field > vmTemplate.location > NIC location
    let location = vmDoc.location;
    if (!location) {
      location = vmTemplate.location;
    }
    if (!location) {
      const nicName = vmTemplate.nicName || `${vmName}-nic`;
      const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
      location = nic.location;
      if (!location) {
        throw new Error(`Could not determine location for ${vmName} from NIC ${nicName}`);
      }
      logger.warn(`Location missing - using NIC location: ${location}`);
    } else {
      logger.info(`Using saved location: ${location}`);
    }

    let creationResult;

    // -----------------------------------------------------------------
    // 3. Try to start existing VM first (for ongoing labs)
    // -----------------------------------------------------------------
    try {
      creationResult = await startExistingVM(vmName, resourceGroup);
      logger.info(`Started existing VM: ${vmName}`);
    } catch (vmError) {
      if (vmError.statusCode === 404) {
        // VM not found, proceed with snapshot creation
        logger.info(`VM ${vmName} not found, creating from snapshot...`);
        
        // -----------------------------------------------------------------
        // 4. Re-create the VM from the latest snapshot
        // -----------------------------------------------------------------
        creationResult = await createVirtualMachineFromLatestSnapshot(vmName, {
          resourceGroup,
          location,
          vmSize,
          osType: vmTemplate.osType || 'Windows',
          tags: vmTemplate.tags || {},
          nicName: vmTemplate.nicName || `${vmName}-nic`,
        });
        
        logger.info(`Created VM from snapshot: ${vmName}`);
      } else {
        // Other error, re-throw
        throw vmError;
      }
    }

    // -----------------------------------------------------------------
    // 5. Persist the new state & useful info back to Mongo
    // -----------------------------------------------------------------
    // Handle both new (publicIp) and legacy (publicIpAddress) shapes from the
    // creation/start helpers. The VM schema field is `publicIp`; writing
    // `publicIpAddress` would be silently dropped by Mongoose strict mode
    // and leave the portal pointing at a stale/dead IP after stop/start.
    const resolvedIp = creationResult.publicIp || creationResult.publicIpAddress || '';

    const updateData = {
      isRunning: true,
      vmSize: creationResult.vmSize || vmSize,
      location: creationResult.location || location,
    };
    if (resolvedIp) updateData.publicIp = resolvedIp;

    // Only update admin credentials if they're available (not from running VM)
    if (creationResult.adminUsername && creationResult.adminPassword &&
        creationResult.adminPassword !== 'Password not available for running VM') {
      updateData.adminUsername = creationResult.adminUsername;
      updateData.adminPass = creationResult.adminPassword;
    }

    await VM.updateOne(
      { name: vmName },
      {
        $set: updateData,
        $push: {
          logs: { start: new Date() },
        },
      }
    );

    logger.info(`${vmName} successfully started with size ${creationResult.vmSize || vmSize} (IP: ${resolvedIp})`);

    // If this VM is an RDS host, wake any session rows that the stop
    // cascade had paused. Non-RDS VMs match nothing — cheap no-op.
    cascadeRdsSessions(vmName, 'resume').catch(e =>
      logger.error(`[start-vm] ${vmName}: rds cascade failed — ${e.message}`)
    );
  } catch (error) {
    logger.error('Error in azure-start-vm handler:', error);
    throw new Error(error.message || String(error));
  }
};

module.exports = handler;