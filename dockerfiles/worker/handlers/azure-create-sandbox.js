const { logger } = require("../plugins/logger");
require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { AuthorizationManagementClient } = require("@azure/arm-authorization");
const { PolicyClient } = require("@azure/arm-policy");
const SandboxUser = require("../models/sandboxuser");
const crypto = require("crypto");

const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TENANT_ID = process.env.TENANT_ID;

const CUSTOM_ROLE_ID =
   "/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/roleDefinitions/57fce75e-14f9-4736-84e6-9c55ba17b975";
const INITIATIVE_ID =
   "/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/policySetDefinitions/22b100af047a471aa11e18a8";

const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
const resourceClient = new ResourceManagementClient(credential, SUBSCRIPTION_ID);
const authClient = new AuthorizationManagementClient(credential, SUBSCRIPTION_ID);
const policyClient = new PolicyClient(credential, SUBSCRIPTION_ID);

// Cheap B-series VMs only — blocks expensive D/E/F/GPU series
const ALLOWED_VM_SIZES = [
   "Standard_B1s", "Standard_B1ms", "Standard_B2s", "Standard_B2ms",
   "Standard_B4ms", "Standard_B1ls",
];

async function assignUserRole(resourceGroupName, userId) {
   try {
      await authClient.roleAssignments.create(
         `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
         crypto.randomUUID(),
         {
            principalId: userId,
            roleDefinitionId: CUSTOM_ROLE_ID,
            scope: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
         }
      );
   } catch (error) {
      logger.error("Error assigning role", { resourceGroupName, error: error.message });
   }
}

async function assignInitiative(resourceGroupName) {
   try {
      await policyClient.policyAssignments.create(
         `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
         crypto.randomUUID(),
         {
            policyDefinitionId: INITIATIVE_ID,
            scope: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
            displayName: "Sandbox Resource Restrictions",
         }
      );
   } catch (error) {
      logger.error("Error assigning initiative", { resourceGroupName, error: error.message });
   }
}

/**
 * Assign Azure Policy to restrict VM sizes to cheap B-series only.
 * This prevents users from spinning up expensive D/E/F/GPU VMs.
 */
async function assignVmSizeRestriction(resourceGroupName) {
   try {
      const scope = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`;
      await policyClient.policyAssignments.create(scope, `vm-restrict-${crypto.randomUUID().slice(0, 8)}`, {
         policyDefinitionId: "/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3", // Built-in: Allowed VM SKUs
         scope,
         displayName: "Restrict to B-series VMs only",
         parameters: {
            listOfAllowedSKUs: { value: ALLOWED_VM_SIZES },
         },
      });
      logger.info(`VM size restriction applied to ${resourceGroupName}: B-series only`);
   } catch (error) {
      logger.error("Error assigning VM size restriction", { resourceGroupName, error: error.message });
   }
}

/**
 * Assign Azure Policy to restrict premium storage, public IPs, etc.
 */
async function assignCostRestrictions(resourceGroupName) {
   try {
      const scope = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`;

      // Restrict storage to Standard only (no Premium SSD)
      await policyClient.policyAssignments.create(scope, `storage-restrict-${crypto.randomUUID().slice(0, 8)}`, {
         policyDefinitionId: "/providers/Microsoft.Authorization/policyDefinitions/7433c107-6db4-4ad1-b57a-a76dce0154a1", // Built-in: Allowed storage account SKUs
         scope,
         displayName: "Restrict to Standard storage only",
         parameters: {
            listOfAllowedSKUs: { value: ["Standard_LRS", "Standard_GRS", "Standard_ZRS", "StandardSSD_LRS"] },
         },
      });
      logger.info(`Storage restriction applied to ${resourceGroupName}`);
   } catch (error) {
      logger.error("Error assigning cost restrictions", { resourceGroupName, error: error.message });
   }
}

/**
 * Create Azure Budget on the resource group to auto-alert and cap spending.
 */
async function createBudget(resourceGroupName, budgetAmountInr = 500) {
   try {
      const axios = require('axios');
      const { getUsdToInr } = require('../functions/exchangeHelper') || {};

      // Convert INR to USD (budgets are in USD)
      let rate = 92;
      try {
         const rateRes = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
         rate = rateRes.data.rates?.INR || 92;
      } catch {}
      const budgetUsd = Math.round(budgetAmountInr / rate);

      const { ConsumptionManagementClient } = require("@azure/arm-consumption");
      const consumptionClient = new ConsumptionManagementClient(credential, SUBSCRIPTION_ID);

      const now = new Date();
      const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const scope = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`;
      await consumptionClient.budgets.createOrUpdate(scope, `budget-${resourceGroupName.slice(0, 20)}`, {
         category: "Cost",
         amount: budgetUsd,
         timeGrain: "Monthly",
         timePeriod: {
            startDate: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
            endDate: endDate.toISOString(),
         },
         notifications: {
            "at80": {
               enabled: true,
               operator: "GreaterThanOrEqualTo",
               threshold: 80,
               contactEmails: [process.env.GMAIL_USER || "admin@getlabs.cloud"],
            },
            "at100": {
               enabled: true,
               operator: "GreaterThanOrEqualTo",
               threshold: 100,
               contactEmails: [process.env.GMAIL_USER || "admin@getlabs.cloud"],
            },
         },
      });
      logger.info(`Budget ₹${budgetAmountInr} (~$${budgetUsd}) created for ${resourceGroupName}`);
   } catch (error) {
      // Budget API may not be available — non-critical
      logger.error("Error creating budget (non-critical)", { resourceGroupName, error: error.message });
   }
}

// Main Handler
const handler = async (job) => {
   const { resourceGroupName, resourceGroupLocation, userId, budgetLimit } = job.data;

   if (!resourceGroupName || !resourceGroupLocation || !userId) {
      logger.error("Missing required parameters for sandbox creation");
      return;
   }

   try {
      // Step 1: Check credits
      const user = await SandboxUser.findOne({ userId });
      if (!user) { logger.error(`User ${userId} not found`); return; }

      const availableCredits = (user.credits.total || 0) - (user.credits.consumed || 0);
      if (availableCredits <= 0) { logger.error(`User ${userId} has no credits`); return; }

      // Step 2: Create Resource Group
      await resourceClient.resourceGroups.createOrUpdate(resourceGroupName, {
         location: resourceGroupLocation,
         tags: {
            "sandbox": "true",
            "user": userId,
            "created": new Date().toISOString(),
            "ttl": String(user.sandboxTtlHours || 4),
         },
      });

      // Step 3: Assign role + policies (parallel for speed)
      await Promise.allSettled([
         assignUserRole(resourceGroupName, userId),
         assignInitiative(resourceGroupName),
         assignVmSizeRestriction(resourceGroupName),
         assignCostRestrictions(resourceGroupName),
         createBudget(resourceGroupName, budgetLimit || 500),
      ]);

      // Step 4: Use configurable TTL from user record
      const ttlHours = user.sandboxTtlHours || 4;

      await SandboxUser.findOneAndUpdate(
         { userId },
         {
            $push: {
               sandbox: {
                  resourceGroupName,
                  location: resourceGroupLocation,
                  createdTime: new Date(),
                  deleteTime: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
                  estimatedCost: 0,
                  status: 'ready',
                  accessUrl: `https://portal.azure.com/#@${TENANT_ID}/resource/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
                  credentials: {
                     username: user.email,
                     password: 'Use your Azure AD credentials',
                  },
                  restrictions: {
                     allowedVmSizes: ALLOWED_VM_SIZES,
                     budgetCap: budgetLimit || 500,
                     blockedServices: ['GPU instances', 'Premium SSD', 'Reserved instances'],
                  },
               }
            },
            $inc: { "credits.consumed": 1 }
         },
         { new: true }
      );

      logger.info(`Sandbox created: ${resourceGroupName} (TTL: ${ttlHours}h, budget: ₹${budgetLimit || 500})`);
   } catch (error) {
      logger.error("Error creating sandbox", { resourceGroupName, error: error.message });
   }
};

module.exports = handler;
