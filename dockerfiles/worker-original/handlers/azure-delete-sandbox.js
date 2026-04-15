require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { logger } = require("../plugins/logger");
const SandboxUser = require("../models/sandboxuser");

const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TENANT_ID = process.env.TENANT_ID;

const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
const resourceClient = new ResourceManagementClient(credential, SUBSCRIPTION_ID);

const handler = async (job) => {
    const { resourceGroupName } = job.data;

    if (!resourceGroupName) {
        logger.error("❌ Resource Group Name is required.");
        return;
    }

    let resourceGroupExists = true;

    try {
        await resourceClient.resourceGroups.get(resourceGroupName);
    } catch (error) {
        if (error.statusCode === 404) {
            logger.warn(`⚠️ Resource Group '${resourceGroupName}' does not exist. Skipping deletion.`);
            resourceGroupExists = false;
        } else {
            logger.error("❌ Error checking Resource Group existence", { resourceGroupName, error: error.message });
            return;
        }
    }

    // ✅ Remove the resource group if it exists
    if (resourceGroupExists) {
        try {
            await resourceClient.resourceGroups.beginDeleteAndWait(resourceGroupName);
            logger.info(`✅ Resource Group '${resourceGroupName}' deleted successfully.`);
        } catch (error) {
            logger.error("❌ Error deleting Resource Group", { resourceGroupName, error: error.message });
        }
    }

    // ✅ Clean up the database in both cases (whether deleted or already absent)
    try {
        const user = await SandboxUser.findOne({ "sandbox.resourceGroupName": resourceGroupName });

        if (!user) {
            logger.warn(`⚠️ No user found with Resource Group '${resourceGroupName}'. Skipping database update.`);
            return;
        }

        // ✅ Remove sandbox entry from user's data & increase available credits
        const updatedUser = await SandboxUser.findOneAndUpdate(
            { userId: user.userId },
            {
                $pull: { sandbox: { resourceGroupName } }, // Remove resource group from sandbox array
                $inc: { "credits.consumed": -1 }, // Decrease consumed credits
            },
            { new: true }
        );

        if (updatedUser) {
            logger.info(`✅ Removed '${resourceGroupName}' from user '${updatedUser.email}' sandbox list.`);
            logger.info(`✅ Restored 1 credit for user '${updatedUser.email}'. New consumed credits: ${Math.max(updatedUser.credits.consumed, 0)}`);
        } else {
            logger.warn(`⚠️ Failed to update credits for user '${user.email}'.`);
        }

    } catch (error) {
        logger.error("❌ Error updating user credits", { resourceGroupName, error: error.message });
    }
};

module.exports = handler;
