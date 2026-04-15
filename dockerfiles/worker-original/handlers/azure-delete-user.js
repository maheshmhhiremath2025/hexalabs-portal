require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { Client } = require("@microsoft/microsoft-graph-client");
const { logger } = require('../plugins/logger');
const SandboxUser = require('../models/sandboxuser');
const User = require("../models/user");

const TENANT_ID = process.env.IDENTITY_TENANT_ID;
const CLIENT_ID = process.env.IDENTITY_CLIENT_ID;
const CLIENT_SECRET = process.env.IDENTITY_CLIENT_SECRET;

const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
const graphClient = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
            return tokenResponse.token;
        }
    }
});

const handler = async (job) => {
    const { email } = job.data;
    try {
        const user = await graphClient.api(`/users/${email}`).get();
        if (!user || !user.id) {
            logger.warn(`User ${email} not found in Entra ID.`);
            return;
        }
        await graphClient.api(`/users/${user.id}`).delete();

        await SandboxUser.deleteOne({ email });
        await User.deleteOne({ email });

        logger.info(`User ${email} deleted successfully from local database.`);
    }
    catch (error) {
        logger.error(`Error deleting user ${email}:`, error.message);
    }

};

module.exports = handler;

