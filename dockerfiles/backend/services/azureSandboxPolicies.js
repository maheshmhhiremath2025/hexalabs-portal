/**
 * Azure Sandbox Policy Definitions
 *
 * Applies a comprehensive set of Azure Policies to a sandbox resource group
 * to enforce cost control and restrict resources to training-safe configurations.
 *
 * Uses Azure built-in policies where available, custom policy rules where not.
 */

const { logger } = require('../plugins/logger');

// All allowed VM SKUs (B-series only for training)
const ALLOWED_VM_SKUS = ['Standard_B1s', 'Standard_B1ms', 'Standard_B2s', 'Standard_B2ms', 'Standard_B4ms'];

// All allowed resource types for default sandbox
const DEFAULT_ALLOWED_RESOURCE_TYPES = [
  'Microsoft.Compute/virtualMachines',
  'Microsoft.Compute/disks',
  'Microsoft.Compute/sshPublicKeys',
  'Microsoft.Compute/availabilitySets',
  'Microsoft.ContainerRegistry/registries',
  'Microsoft.ContainerService/managedClusters', // AKS - Free/Dev tier only
  'Microsoft.Storage/storageAccounts',
  'Microsoft.Sql/servers',
  'Microsoft.Sql/servers/databases',
  'Microsoft.DBforPostgreSQL/servers',
  'Microsoft.DBforPostgreSQL/flexibleServers',
  'Microsoft.DocumentDB/databaseAccounts', // Cosmos DB
  'Microsoft.Web/sites',            // App Service + Functions
  'Microsoft.Web/serverFarms',      // App Service Plans
  'Microsoft.Web/staticSites',      // Static Web Apps
  'Microsoft.ApiManagement/service',
  'Microsoft.EventHub/namespaces',
  'Microsoft.Devices/IotHubs',
  'Microsoft.KeyVault/vaults',
  'Microsoft.Insights/components',  // Application Insights
  'Microsoft.Network/virtualNetworks',
  'Microsoft.Network/networkSecurityGroups',
  'Microsoft.Network/publicIPAddresses',
  'Microsoft.Network/networkInterfaces',
  'Microsoft.Network/loadBalancers',
  'Microsoft.Network/applicationGateways',
  'Microsoft.Network/virtualNetworkGateways',
  'Microsoft.Network/bastionHosts',
  'Microsoft.Network/connections',
  'Microsoft.Network/localNetworkGateways',
  'Microsoft.Authorization/roleAssignments',
];

// Allowed locations
const DEFAULT_ALLOWED_LOCATIONS = ['eastus', 'eastus2', 'westus', 'centralus', 'southindia', 'global'];

/**
 * Apply all sandbox policies to a resource group.
 *
 * @param {PolicyClient} policyClient - Azure Policy client
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} rgName - Resource group name
 * @param {object} template - SandboxTemplate document (optional)
 * @param {string} region - Deployment region
 */
async function applyAllSandboxPolicies(policyClient, subscriptionId, rgName, template, region) {
  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${rgName}`;
  const shortRg = rgName.slice(0, 35);
  let appliedCount = 0;

  // --- 1. Allowed resource types ---
  try {
    const allowedTypes = template?.allowedResourceTypes?.length
      ? template.allowedResourceTypes
      : DEFAULT_ALLOWED_RESOURCE_TYPES;

    await policyClient.policyAssignments.create(scope, `sb-types-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/a08ec900-254a-4555-9bf5-e42af04b5c5c',
      parameters: { listOfResourceTypesAllowed: { value: allowedTypes } },
      displayName: 'Sandbox: Allowed resource types',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] Resource types policy failed: ${e.message}`); }

  // --- 2. Allowed VM sizes (B-series only) ---
  try {
    await policyClient.policyAssignments.create(scope, `sb-vmsizes-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3',
      parameters: { listOfAllowedSKUs: { value: ALLOWED_VM_SKUS } },
      displayName: 'Sandbox: B-series VMs only',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] VM SKU policy failed: ${e.message}`); }

  // --- 3. Allowed locations ---
  try {
    const locations = region ? [region, 'global'] : DEFAULT_ALLOWED_LOCATIONS;
    await policyClient.policyAssignments.create(scope, `sb-region-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c',
      parameters: { listOfAllowedLocations: { value: locations } },
      displayName: `Sandbox: Region lock`,
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] Location policy failed: ${e.message}`); }

  // --- 4. Deny Premium SSD managed disks ---
  try {
    await policyClient.policyAssignments.create(scope, `sb-nodisk-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/06a78e20-9358-41c9-923c-fb736d382a4d',
      parameters: { listOfAllowedSKUs: { value: ['Standard_LRS', 'StandardSSD_LRS', 'StandardSSD_ZRS'] } },
      displayName: 'Sandbox: No Premium SSD',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] Disk policy failed: ${e.message}`); }

  // --- 5. Storage account - Standard performance only ---
  try {
    await policyClient.policyAssignments.create(scope, `sb-storage-${shortRg}`, {
      policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/7433c107-6db4-4ad1-b57a-a76dce0154a1',
      parameters: { listOfAllowedSKUs: { value: ['Standard_LRS', 'Standard_GRS', 'Standard_ZRS', 'Standard_GZRS'] } },
      displayName: 'Sandbox: Standard storage only',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] Storage policy failed: ${e.message}`); }

  // --- 6. Restrict VM image publishers (only Ubuntu, Windows, RHEL, Oracle Linux) ---
  try {
    // Create a custom policy definition at subscription level if it doesn't exist
    const policyDefName = 'sandbox-allowed-vm-images';
    const policyDefId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/${policyDefName}`;

    try {
      await policyClient.policyDefinitions.get(policyDefName);
    } catch {
      // Policy definition doesn't exist — create it
      await policyClient.policyDefinitions.createOrUpdate(policyDefName, {
        policyType: 'Custom',
        mode: 'All',
        displayName: 'Sandbox: Allowed VM image publishers',
        description: 'Only allows Ubuntu, Windows Server, RHEL, and Oracle Linux VM images',
        policyRule: {
          if: {
            allOf: [
              { field: 'type', equals: 'Microsoft.Compute/virtualMachines' },
              {
                not: {
                  anyOf: [
                    { field: 'Microsoft.Compute/virtualMachines/storageProfile.imageReference.publisher', in: ['Canonical', 'MicrosoftWindowsServer', 'RedHat', 'Oracle'] },
                    // Also allow images from image gallery (custom golden images)
                    { field: 'Microsoft.Compute/virtualMachines/storageProfile.imageReference.id', contains: '/images/' },
                  ],
                },
              },
            ],
          },
          then: { effect: 'deny' },
        },
      });
      logger.info('[azure-policy] Custom VM image publisher policy definition created');
    }

    await policyClient.policyAssignments.create(scope, `sb-vmimg-${shortRg}`, {
      policyDefinitionId: policyDefId,
      displayName: 'Sandbox: Ubuntu/Windows/RHEL/Oracle Linux only',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] VM image policy failed: ${e.message}`); }

  // --- 7. Limit total number of VMs per resource group ---
  try {
    const maxVmsPolicyName = 'sandbox-max-vms';
    const maxVmsPolicyId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/${maxVmsPolicyName}`;

    try {
      await policyClient.policyDefinitions.get(maxVmsPolicyName);
    } catch {
      await policyClient.policyDefinitions.createOrUpdate(maxVmsPolicyName, {
        policyType: 'Custom',
        mode: 'All',
        displayName: 'Sandbox: Limit VM count per resource group',
        description: 'Denies VM creation if resource group already has 2 or more VMs',
        parameters: {
          maxVMs: { type: 'Integer', metadata: { displayName: 'Max VMs', description: 'Maximum number of VMs allowed' }, defaultValue: 2 },
        },
        policyRule: {
          if: {
            allOf: [
              { field: 'type', equals: 'Microsoft.Compute/virtualMachines' },
              { count: { type: 'Microsoft.Compute/virtualMachines' }, greater: '[parameters(\'maxVMs\')]' },
            ],
          },
          then: { effect: 'deny' },
        },
      });
      logger.info('[azure-policy] Custom max VMs policy definition created');
    }

    await policyClient.policyAssignments.create(scope, `sb-maxvm-${shortRg}`, {
      policyDefinitionId: maxVmsPolicyId,
      parameters: { maxVMs: { value: 2 } },
      displayName: 'Sandbox: Max 2 VMs',
    });
    appliedCount++;
  } catch (e) { logger.error(`[azure-policy] Max VMs policy failed: ${e.message}`); }

  logger.info(`[azure-policy] Applied ${appliedCount}/7 policies to ${rgName}`);
  return appliedCount;
}

module.exports = { applyAllSandboxPolicies, ALLOWED_VM_SKUS, DEFAULT_ALLOWED_RESOURCE_TYPES, DEFAULT_ALLOWED_LOCATIONS };
