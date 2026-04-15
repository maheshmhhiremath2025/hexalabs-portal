require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { Client } = require("@microsoft/microsoft-graph-client");
const { logger } = require('../plugins/logger')
const SandboxUser = require('../models/sandboxuser');
const User = require("../models/user");
const queues = require('./../queues');
const { generateEmail } = require("../functions/emails/userCreated");

const TENANT_ID = process.env.IDENTITY_TENANT_ID;
const CLIENT_ID = process.env.IDENTITY_CLIENT_ID;
const CLIENT_SECRET = process.env.IDENTITY_CLIENT_SECRET;
const DOMAIN = process.env.IDENTITY_DOMAIN;

const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
const graphClient = Client.initWithMiddleware({
    authProvider: {
        getAccessToken: async () => {
            const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
            return tokenResponse.token;
        }
    }
});

const generateSecurePassword = () => {
    return Math.random().toString(36).slice(-8) + "A1!"; // Ensures at least 8 characters, uppercase, number, and special character
};

const handler = async (job) => {
    const { username, duration, personalEmail } = job.data;
    const password = generateSecurePassword();

    try {
        const newUser = {
            accountEnabled: true,
            displayName: username,
            mailNickname: username,
            userPrincipalName: `${username}@${DOMAIN}`, // Example: johndoe@yourcompany.com
            passwordProfile: {
                forceChangePasswordNextSignIn: false,
                password: password
            }
        };
        const user = await graphClient.api("/users").post(newUser);
        const { userPrincipalName, id } = user;
        const Data = {
            email: userPrincipalName,
            userId: id,
            duration: duration, //int number of days
            startDate: Date.now(),
            endDate: Date.now() + duration * 24 * 60 * 60 * 1000,
            credits: {
                total: 1,
                consumed: 0
            }
        };
        const Login = {
            organization: "synergificsoftware",
            email: userPrincipalName,
            password: password,
            userType: 'sandboxuser'
        };
        await SandboxUser.create(Data)
        await User.create(Login);
        const users = [{
            email: userPrincipalName,
            password: password
        }];
        const { subject, body } = generateEmail(users);
        if (!subject || !body) {
            logger.error('Failed to generate email content, skipping email queue');
            return;
        }
        const emailData = {
            email: personalEmail,
            subject,
            body,
        };

        await queues['email-queue']
            .add(emailData)
            .then(() => logger.info(`Email queued for ${personalEmail}`))
            .catch((err) => logger.error(`Failed to queue email`, err));

        logger.info(`User ${username} created successfully in Azure AD`, user);
    } catch (error) {
        console.error("Error creating user:", error);
    }

};

module.exports = handler;

