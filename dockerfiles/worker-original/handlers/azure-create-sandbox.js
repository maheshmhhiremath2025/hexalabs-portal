const { logger } = require("../plugins/logger");
require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { AuthorizationManagementClient } = require("@azure/arm-authorization");
const { PolicyClient } = require("@azure/arm-policy");
const SandboxUser = require("../models/sandboxuser");
const crypto = require("crypto");

// Load environment variables
const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TENANT_ID = process.env.TENANT_ID;

// Constants for Role & Initiative
const CUSTOM_ROLE_ID =
   "/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/roleDefinitions/57fce75e-14f9-4736-84e6-9c55ba17b975";
const INITIATIVE_ID =
   "/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/policySetDefinitions/22b100af047a471aa11e18a8";

// Authenticate using ClientSecretCredential
const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
const resourceClient = new ResourceManagementClient(credential, SUBSCRIPTION_ID);
const authClient = new AuthorizationManagementClient(credential, SUBSCRIPTION_ID);
const policyClient = new PolicyClient(credential, SUBSCRIPTION_ID);


// Function to Assign a User to a Role
async function assignUserRole(resourceGroupName, userId) {
   try {
      const roleAssignmentParams = {
         principalId: userId,
         roleDefinitionId: CUSTOM_ROLE_ID,
         scope: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
      };

      const roleAssignmentId = crypto.randomUUID(); // Generate a unique Role Assignment ID

      await authClient.roleAssignments.create(
         roleAssignmentParams.scope,
         roleAssignmentId,
         roleAssignmentParams
      );

   } catch (error) {
      logger.error("Error assigning role", { resourceGroupName, userId, error: error.message });
   }
}

// Function to Assign an Initiative (Policy)
async function assignInitiative(resourceGroupName) {
   try {
      const policyAssignmentParams = {
         policyDefinitionId: INITIATIVE_ID,
         scope: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroupName}`,
         displayName: "Resource Group Initiative Assignment",
      };

      const policyAssignmentId = crypto.randomUUID(); // Generate a unique Policy Assignment ID

      const policyResult = await policyClient.policyAssignments.create(
         policyAssignmentParams.scope,
         policyAssignmentId,
         policyAssignmentParams
      );

   } catch (error) {
      logger.error("Error assigning initiative", { resourceGroupName, error: error.message });
   }
}

// **Main Handler Function**
const handler = async (job) => {
   const { resourceGroupName, resourceGroupLocation, userId } = job.data;

   if (!resourceGroupName || !resourceGroupLocation || !userId) {
      logger.error("❌ Missing required parameters.");
      return;
   }

   try {
      // ✅ Step 1: Check User's Available Credits
      const user = await SandboxUser.findOne({ userId });
      if (!user) {
         logger.error(`❌ User with ID ${userId} not found.`);
         return;
      }

      const availableCredits = (user.credits.total || 0) - (user.credits.consumed || 0);

      if (availableCredits <= 0) {
         logger.error(`❌ User ${userId} does not have enough credits to create a sandbox.`);
         return;
      }

      // ✅ Step 2: Create Resource Group
      const result = await resourceClient.resourceGroups.createOrUpdate(resourceGroupName, {
         location: resourceGroupLocation,
      });

      // ✅ Step 3: Assign User Role
      await assignUserRole(resourceGroupName, userId);

      // ✅ Step 4: Assign Initiative (Policy)
      await assignInitiative(resourceGroupName);

      // ✅ Step 5: Deduct 1 Credit from User Account (Assuming 1 credit per sandbox)
      await SandboxUser.findOneAndUpdate(
         { userId },
         {
            $push: {
               sandbox: {
                  resourceGroupName,
                  createdTime: new Date(), // ✅ Store current timestamp
                  deleteTime: new Date(Date.now() + 4 * 60 * 60 * 1000) // ✅ Add 4 hours (converted to ms)
               }
            },
            $inc: { "credits.consumed": 1 } // ✅ Increment consumed credits by 1
         },
         { new: true, upsert: false }
      );


      logger.info("✅ Resource Group created successfully", {
         name: resourceGroupName,
         location: resourceGroupLocation,
         userId,
      });
   } catch (error) {
      logger.error("Error creating resource group", { resourceGroupName, error: error.message });
   }
};

module.exports = handler;
