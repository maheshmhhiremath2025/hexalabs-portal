require("dotenv").config();
const { logger } = require('../plugins/logger');
const queues = require('./../queues');
const awsUser = require('./../models/aws');
const { generateEmail } = require('./../functions/emails/awscreate');
const { IAMClient, CreateUserCommand, AttachUserPolicyCommand, CreateLoginProfileCommand, PutUserPolicyCommand } = require("@aws-sdk/client-iam");
const fs = require('fs');
const path = require('path');

const client = new IAMClient({
    region: process.env.AWS_REGION || "us-east-1", // Use env variable or default region
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_ACCESS_SECRET
    }
});

const policies = [
    "arn:aws:iam::475184346033:policy/1maiaccessall1",
    "arn:aws:iam::475184346033:policy/sandbox1",
    "arn:aws:iam::475184346033:policy/sandbox2",
    "arn:aws:iam::475184346033:policy/sandbox3",
    "arn:aws:iam::475184346033:policy/sandbox4"
];

const generateSecurePassword = () => {
    return Math.random().toString(36).slice(-8) + "A1!"; // Ensures at least 8 characters, uppercase, number, and special character
};

const handler = async (job) => {
    const { username, duration, personalEmail } = job.data;

    try {
        const password = generateSecurePassword();

        // Step 1: Create IAM User
        const createUserCommand = new CreateUserCommand({ UserName: username });
        await client.send(createUserCommand);
        console.log(`✅ User "${username}" created successfully.`);

        // Step 2: Attach Policies
        for (const policyArn of policies) {
            const attachPolicyCommand = new AttachUserPolicyCommand({
                UserName: username,
                PolicyArn: policyArn
            });
            await client.send(attachPolicyCommand);
            console.log(`🔗 Policy attached: ${policyArn}`);
        }

        // Step 2b: Attach inline cost restriction policy (blocks expensive instances, GPUs, premium storage)
        try {
            const restrictionPolicy = fs.readFileSync(
                path.join(__dirname, '../functions/sandbox-policies/aws-sandbox-policy.json'), 'utf8'
            );
            await client.send(new PutUserPolicyCommand({
                UserName: username,
                PolicyName: 'SandboxCostRestrictions',
                PolicyDocument: restrictionPolicy,
            }));
            logger.info(`Cost restriction policy attached to ${username}`);
        } catch (policyErr) {
            logger.error(`Failed to attach cost restriction policy to ${username}: ${policyErr.message}`);
        }

        // Step 3: Set Password for the IAM User (Create Login Profile)
        const createLoginProfileCommand = new CreateLoginProfileCommand({
            UserName: username,
            Password: password,
            PasswordResetRequired: false // Change to `true` if you want the user to reset password on first login
        });

        await client.send(createLoginProfileCommand);
        console.log(`🔑 Password set for user "${username}".`);

        console.log(`🎉 User "${username}" created and all policies attached successfully.`);

        // Step 4: Store User Details in Database
        const Data = {
            email: personalEmail,
            userId: username,
            password: password,
            duration: duration, // Number of days
            startDate: Date.now(),
            endDate: Date.now() + duration * 24 * 60 * 60 * 1000
        };

        await awsUser.create(Data);

        // Step 5: Send Email with Credentials
        const users = [{
            username: username,
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

        logger.info(`User ${username} created successfully in AWS with password.`);

    } catch (error) {
        logger.error(`Failed to create user ${username} in AWS`, error);
    }
    console.log('AWS Create User Handler');
};

module.exports = handler;
