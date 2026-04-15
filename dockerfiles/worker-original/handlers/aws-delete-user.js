require("dotenv").config();
const { logger } = require('../plugins/logger');
const awsUser = require('./../models/aws');
const {
    IAMClient,
    DeleteUserCommand,
    ListAttachedUserPoliciesCommand,
    DetachUserPolicyCommand,
    DeleteLoginProfileCommand
} = require("@aws-sdk/client-iam");

const client = new IAMClient({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_ACCESS_SECRET
    }
});

const handler = async (job) => {
    const { email } = job.data;
    try {
        // Fetch user from DB
        const user = await awsUser.findOne({ email });
        if (!user) {
            throw new Error(`User with email ${email} not found`);
        }

        const { userId } = user; // IAM username

        // Step 1: Delete IAM Login Profile
        try {
            const deleteLoginProfileCommand = new DeleteLoginProfileCommand({ UserName: userId });
            await client.send(deleteLoginProfileCommand);
            logger.info(`Deleted login profile for user ${userId}`);
        } catch (error) {
            if (error.name === "NoSuchEntityException") {
                logger.warn(`No login profile found for user ${userId}, skipping deletion.`);
            } else {
                throw error;
            }
        }

        // Step 2: Detach all policies before deleting the IAM user
        const listPoliciesCommand = new ListAttachedUserPoliciesCommand({ UserName: userId });
        const policiesResponse = await client.send(listPoliciesCommand);

        if (policiesResponse.AttachedPolicies) {
            for (const policy of policiesResponse.AttachedPolicies) {
                const detachPolicyCommand = new DetachUserPolicyCommand({
                    UserName: userId,
                    PolicyArn: policy.PolicyArn
                });
                await client.send(detachPolicyCommand);
                logger.info(`Detached policy: ${policy.PolicyArn} from user ${userId}`);
            }
        }

        // Step 3: Delete the IAM user
        const deleteUserCommand = new DeleteUserCommand({ UserName: userId });
        await client.send(deleteUserCommand);
        logger.info(`AWS IAM user ${userId} deleted successfully`);

        // Step 4: Remove user from database
        await awsUser.deleteOne({ email });
        logger.info(`User ${email} deleted from database`);

    } catch (error) {
        logger.error(`Failed to delete AWS user associated with ${email}`, error);
    }
};

module.exports = handler;
