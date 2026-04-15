// handlers/azure-start-vm.js
const { logger } = require('./../plugins/logger');
const VM = require('./../models/vm');
const vmCreationModule = require('./../functions/vmcreation/azure');
const { createVirtualMachineFromLatestSnapshot } = vmCreationModule; // Only import the snapshot function
const { NetworkManagementClient } = require('@azure/arm-network');
const { ClientSecretCredential } = require('@azure/identity');
require('dotenv').config();

const subscriptionId = process.env.SUBSCRIPTION_ID;
const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// Debug: Log the loaded module to verify
logger.info('Loaded vmCreationModule:', Object.keys(vmCreationModule));

// If not a function, throw early with details
if (typeof createVirtualMachineFromLatestSnapshot !== 'function') {
  throw new Error('createVirtualMachineFromLatestSnapshot is not exported or not a function from ../functions/vmcreation/azure.js');
}

/**
 * Handler executed when the user clicks the "Start" button.
 * It recreates the VM from its latest OS snapshot while keeping the original NIC
 * (so IP, NSG, public-IP stay the same). Assumes snapshot exists (after stop).
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
      'isRunning isAlive vmTemplate -_id'   // we also need the template for recreation
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
    // 2. Prepare vmTemplate – fallback to NIC location + default size if missing
    // -----------------------------------------------------------------
    let vmTemplate = vmDoc.vmTemplate || {};

    // If location missing, get it from existing NIC (preserves original region)
    let location = vmTemplate.location;
    if (!location) {
      const nicName = vmTemplate.nicName || `${vmName}-nic`;
      const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
      location = nic.location;
      if (!location) {
        throw new Error(`Could not determine location for ${vmName} from NIC ${nicName}`);
      }
      logger.warn(`Location missing in vmTemplate for ${vmName} – using NIC location: ${location}`);
    }

    // If vmSize missing, use a default (changed to Standard_B2ms due to capacity issues with B2s in South India; adjust based on region/availability)
    let vmSize = vmTemplate.vmSize;
    if (!vmSize) {
      vmSize = 'Standard_D2s_v3'; // Updated default – 2 vCPU, 8 GiB RAM, more widely available; original deploy size should be stored in DB for consistency
      logger.warn(`vmSize missing in vmTemplate for ${vmName} – using default: ${vmSize}`);
    }

    // -----------------------------------------------------------------
    // 3. Re-create the VM from the latest snapshot (no fallback – assume snapshot exists after stop)
    // -----------------------------------------------------------------
    const creationResult = await createVirtualMachineFromLatestSnapshot(vmName, {
      resourceGroup,
      location,
      vmSize,
      osType: vmTemplate.osType || 'Windows',
      tags: vmTemplate.tags || {},
      nicName: vmTemplate.nicName || `${vmName}-nic`,
    });

    // -----------------------------------------------------------------
    // 4. Persist the new state & useful info back to Mongo
    // -----------------------------------------------------------------
    await VM.updateOne(
      { name: vmName },
      {
        $set: {
          isRunning: true,
          publicIpAddress: creationResult.publicIpAddress,
          adminUsername: creationResult.adminUsername,
          adminPassword: creationResult.adminPassword,
          // Update vmTemplate in DB for future use (if it was incomplete)
          vmTemplate: {
            ...vmTemplate,
            location,
            vmSize,
          },
        },
        $push: {
          logs: { start: new Date() },
        },
      }
    );

    logger.info(`${vmName} successfully recreated from snapshot (IP: ${creationResult.publicIpAddress})`);
  } catch (error) {
    logger.error('Error in azure-start-vm handler:', error);
    throw error; // let the queue retry / fail the job
  }
};

module.exports = handler;
