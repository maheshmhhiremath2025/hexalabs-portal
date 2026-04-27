// functions/vmManagers.js
require('dotenv').config();
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require("@azure/arm-network");
const {logger} = require('./../plugins/logger');

const subscriptionId = process.env.SUBSCRIPTION_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;

const credentials = new ClientSecretCredential(tenantId, clientId, clientSecret);
const computeClient = new ComputeManagementClient(credentials, subscriptionId);
const networkClient = new NetworkManagementClient(credentials, subscriptionId);

// start an Azure VM (throws if not found)
async function startAzureVM(resourceGroup, vmName) {
  try {
    await computeClient.virtualMachines.beginStartAndWait(resourceGroup, vmName);
    return true;
  } catch (e) {
    if (e.statusCode === 404) {
      const err = new Error('NOT_FOUND');
      err.code = 404;
      throw err;
    }
    throw e;
  }
}

// deallocate (classic Stop)
async function stopAzureVM(resourceGroup, vmName) {
  await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);
  return true;
}

// Port management functions
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

// Add these new functions to your existing vmManagers.js

// Open port for specific direction (Inbound/Outbound)
async function openPortDirection(vmName, port, priority, resourceGroupName, direction = 'Inbound') {
  try {
    const nsgName = `${vmName}-nsg`;
    const ruleName = `allow-${port}-${direction.toLowerCase()}`;

    // Get existing NSG
    const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);

    // Check if the rule already exists
    const existingRule = nsg.securityRules.find(rule => rule.name === ruleName);
    if (existingRule) {
      return;
    }

    // Add security rule for specified direction
    const ruleParameters = {
      protocol: 'Tcp',
      sourcePortRange: '*',
      sourceAddressPrefix: '*',
      destinationPortRange: port.toString(),
      destinationAddressPrefix: '*',
      direction: direction,
      access: 'Allow',
      priority: priority,
    };

    nsg.securityRules.push({
      name: ruleName,
      ...ruleParameters,
    });

    // Update NSG with the new rule
    await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);
    
    logger.info(`Port ${port} opened for ${direction} traffic`);

  } catch (error) {
    logger.error(`Error opening ${direction} port:`, error.message);
    throw error;
  }
}

// Open both inbound and outbound ports
async function openPortBoth(vmName, port, priority, resourceGroupName) {
  try {
    // Open inbound port
    await openPortDirection(vmName, port, priority, resourceGroupName, 'Inbound');
    
    // Open outbound port with different priority (usually +1)
    await openPortDirection(vmName, port, priority + 1, resourceGroupName, 'Outbound');
    
    logger.info(`Port ${port} opened for both inbound and outbound traffic`);
  } catch (error) {
    logger.error('Error opening ports for both directions:', error.message);
    throw error;
  }
}

// Close port for specific direction
// Close port for specific direction
async function closePortDirection(vmName, port, resourceGroupName, direction = 'Inbound') {
  try {
    const nsgName = `${vmName}-nsg`;
    const ruleName = `allow-${port}-${direction.toLowerCase()}`;

    console.log('🔍 closePortDirection - Looking for rule:', {
      vmName,
      port,
      direction,
      ruleName,
      nsgName,
      resourceGroupName
    });

    // Get existing NSG
    const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);

    // Debug: List all existing rules
    console.log('🔍 Available rules in NSG:');
    nsg.securityRules.forEach(rule => {
      console.log(`   - ${rule.name} (direction: ${rule.direction})`);
    });

    // Find the index of the rule to be removed
    const ruleIndex = nsg.securityRules.findIndex(rule => rule.name === ruleName);

    console.log('🔍 Rule index found:', ruleIndex);

    // Check if the rule exists
    if (ruleIndex === -1) {
      logger.error(`Rule ${ruleName} does not exist.`);
      console.log('❌ Rule not found. Available rules:', nsg.securityRules.map(r => r.name));
      return;
    }

    // Remove the rule from the array
    nsg.securityRules.splice(ruleIndex, 1);

    // Update NSG without the removed rule
    await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);
    
    console.log('✅ Successfully deleted rule:', ruleName);
    logger.info(`Port ${port} closed for ${direction} traffic`);
      
  } catch (error) {
    logger.error(`Error closing ${direction} port:`, error.message);
    console.error('❌ Error in closePortDirection:', error);
    throw error;
  }
}

// Close both inbound and outbound ports
async function closePortBoth(vmName, port, resourceGroupName) {
  try {
    // Close inbound port
    await closePortDirection(vmName, port, resourceGroupName, 'Inbound');
    
    // Close outbound port
    await closePortDirection(vmName, port, resourceGroupName, 'Outbound');
    
    logger.info(`Port ${port} closed for both inbound and outbound traffic`);
  } catch (error) {
    logger.error('Error closing ports for both directions:', error.message);
    throw error;
  }
}

// Batched NSG rule management ───────────────────────────────────────────────
// The controller passes a list of ports like ["80", "443", "4000-5000"].
// We update the NSG once per VM (instead of once per port) and allocate
// priorities dynamically by scanning existing rules — this fixes the old
// `existingPorts.length + 1001` collision bug when a port is closed and
// re-opened.

// Normalize a port spec for use in a rule name.
// "80" → "80",  "4000-5000" → "4000to5000"
function portRuleSlug(port) {
  return String(port).replace('-', 'to');
}

// All rule names we consider "ours" for a given port spec. The list covers
// both the legacy (`allow-80`) and directional (`allow-80-inbound`) naming,
// so we can still clean up rules created before this refactor.
function candidateRuleNames(port) {
  const slug = portRuleSlug(port);
  return [
    `allow-${slug}`,
    `allow-${slug}-inbound`,
    `allow-${slug}-outbound`,
    // Also recognise legacy literal hyphen form for ranges
    `allow-${port}`,
    `allow-${port}-inbound`,
    `allow-${port}-outbound`,
  ];
}

function nextFreePriority(usedPriorities, start = 1000) {
  const used = new Set(usedPriorities);
  let p = start;
  while (used.has(p)) p++;
  used.add(p);
  return { priority: p, used };
}

function makeRule(port, priority, direction) {
  return {
    name: `allow-${portRuleSlug(port)}-${direction.toLowerCase()}`,
    protocol: 'Tcp',
    sourcePortRange: '*',
    sourceAddressPrefix: '*',
    destinationPortRange: String(port), // Azure accepts "80" or "4000-5000"
    destinationAddressPrefix: '*',
    direction,                           // 'Inbound' | 'Outbound'
    access: 'Allow',
    priority,
  };
}

async function openPortsBatch(vmName, ports, resourceGroupName, direction = 'inbound') {
  const nsgName = `${vmName}-nsg`;
  const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);
  nsg.securityRules = nsg.securityRules || [];

  const usedPriorities = nsg.securityRules.map(r => r.priority).filter(Number.isFinite);
  let usedSet = new Set(usedPriorities);

  const directions = direction === 'both' ? ['Inbound', 'Outbound'] : [direction[0].toUpperCase() + direction.slice(1).toLowerCase()];

  let added = 0;
  for (const port of ports) {
    for (const dir of directions) {
      const ruleName = `allow-${portRuleSlug(port)}-${dir.toLowerCase()}`;
      if (nsg.securityRules.some(r => r.name === ruleName)) continue; // already open
      const { priority, used } = nextFreePriority([...usedSet]);
      usedSet = used;
      nsg.securityRules.push(makeRule(port, priority, dir));
      added++;
    }
  }

  if (!added) {
    logger.info(`All requested ports already open on ${vmName}, no NSG update needed`);
    return;
  }

  await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);
  logger.info(`Opened ${added} rule(s) on ${nsgName} (${direction})`);
}

async function closePortsBatch(vmName, ports, resourceGroupName, direction = 'inbound') {
  const nsgName = `${vmName}-nsg`;
  const nsg = await networkClient.networkSecurityGroups.get(resourceGroupName, nsgName);
  nsg.securityRules = nsg.securityRules || [];

  // Build the name set we want to strip. When direction=both, drop every direction;
  // otherwise only drop rules matching the requested direction (plus legacy/no-direction names).
  const targetNames = new Set();
  for (const port of ports) {
    const slug = portRuleSlug(port);
    if (direction === 'both') {
      candidateRuleNames(port).forEach(n => targetNames.add(n));
    } else {
      targetNames.add(`allow-${slug}-${direction.toLowerCase()}`);
      targetNames.add(`allow-${port}-${direction.toLowerCase()}`);
      // legacy rules without a direction suffix were inbound-only
      if (direction === 'inbound') {
        targetNames.add(`allow-${slug}`);
        targetNames.add(`allow-${port}`);
      }
    }
  }

  const before = nsg.securityRules.length;
  nsg.securityRules = nsg.securityRules.filter(r => !targetNames.has(r.name));
  const removed = before - nsg.securityRules.length;

  if (!removed) {
    logger.info(`No matching rules to close on ${nsgName} for ports ${ports.join(',')}`);
    return;
  }

  await networkClient.networkSecurityGroups.beginCreateOrUpdate(resourceGroupName, nsgName, nsg);
  logger.info(`Closed ${removed} rule(s) on ${nsgName} (${direction})`);
}

module.exports = {
  startAzureVM,
  stopAzureVM,
  openPort,           // Legacy - inbound only
  closePort,          // Legacy - inbound only
  openPortDirection,  // Legacy - specific direction
  openPortBoth,       // Legacy - both directions
  closePortDirection, // Legacy - specific direction
  closePortBoth,      // Legacy - both directions
  openPortsBatch,     // Current - list of ports, single NSG update
  closePortsBatch,    // Current - list of ports, single NSG update
};