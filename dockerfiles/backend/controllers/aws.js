const { logger } = require('./../plugins/logger');
const queues = require('./newQueues')
const awsUser = require('./../models/aws')

async function handleGetSandboxUser(req, res) {
    const { userType } = req.user;
    try {
        if (userType !== 'superadmin') {
            return res.status(403).send('Unauthorized access')
        }
        const users = await awsUser.find().lean();

        return res.status(200).send(users)
    } catch (error) {
        logger.error("Error in getting sandbox users", error)
        return res.status(500).send('Internal server error')
    }
}

async function handleCreateSandboxUser(req, res) {
    const { username, duration, personalEmail } = req.body
    const { userType } = req.user;

    try {
        if (userType !== 'superadmin') {
            return res.status(403).send('Unauthorized access')
        }
        if (!username || !duration || !personalEmail) {
            return res.status(400).send('Invalid request please share username and duration')
        }
        const data = {
            username,
            duration,
            personalEmail
        }
        await queues['aws-create-user'].add(data);
        return res.status(200).send('User created successfully')
    } catch (error) {
        logger.error('Error in creating aws sandbox user', error)
        return res.status(500).send('Internal server error')
    }


}

async function handleDeleteSandboxUser(req, res) {
    const { email } = req.body
    const { userType } = req.user;

    try {
        if (userType !== 'superadmin') {
            return res.status(403).send('Unauthorized access')
        }
        if (!email) {
            return res.status(400).send('Invalid request please share email')
        }

        // 1. Mark as deleting before starting cleanup
        const userDoc = await awsUser.findOne({ email });
        if (!userDoc) {
            return res.status(404).send('User not found');
        }
        const iamUsername = userDoc.userId;
        userDoc.deletionStatus = 'deleting';
        await userDoc.save();

        // 2. Respond immediately so frontend can poll
        res.status(200).send('User deletion started');

        // 3. Delete IAM user directly from AWS (don't rely on queue/worker)
        try {
            if (iamUsername) {
                const { IAMClient, DeleteLoginProfileCommand, ListUserPoliciesCommand,
                    DeleteUserPolicyCommand, ListAttachedUserPoliciesCommand,
                    DetachUserPolicyCommand, ListAccessKeysCommand,
                    DeleteAccessKeyCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
                const client = new IAMClient({
                    region: 'ap-south-1',
                    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
                });

                // Delete login profile
                try { await client.send(new DeleteLoginProfileCommand({ UserName: iamUsername })); } catch {}

                // Delete inline policies
                try {
                    const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: iamUsername }));
                    for (const pn of (PolicyNames || [])) {
                        await client.send(new DeleteUserPolicyCommand({ UserName: iamUsername, PolicyName: pn }));
                    }
                } catch {}

                // Detach managed policies
                try {
                    const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: iamUsername }));
                    for (const ap of (AttachedPolicies || [])) {
                        await client.send(new DetachUserPolicyCommand({ UserName: iamUsername, PolicyArn: ap.PolicyArn }));
                    }
                } catch {}

                // Delete access keys
                try {
                    const { AccessKeyMetadata } = await client.send(new ListAccessKeysCommand({ UserName: iamUsername }));
                    for (const ak of (AccessKeyMetadata || [])) {
                        await client.send(new DeleteAccessKeyCommand({ UserName: iamUsername, AccessKeyId: ak.AccessKeyId }));
                    }
                } catch {}

                // Delete the IAM user
                await client.send(new DeleteUserCommand({ UserName: iamUsername }));
                logger.info(`AWS IAM user ${iamUsername} deleted successfully`);
            }

            // 4. Also try queue (as backup for production with workers)
            try {
                await queues['aws-delete-user'].add({ email });
            } catch {}

            // 5. On success: delete the DB record
            await awsUser.deleteOne({ email });
            logger.info(`AWS sandbox user ${email} deleted from DB`);
        } catch (cleanupErr) {
            // On failure: mark as failed, keep the record
            logger.error(`AWS sandbox user ${email} cleanup failed: ${cleanupErr.message}`);
            await awsUser.updateOne({ email }, { $set: { deletionStatus: 'failed' } });
        }
    } catch (error) {
        logger.error('Error in deleting sandbox user', error)
        if (!res.headersSent) {
            return res.status(500).send('Internal server error')
        }
    }
}

module.exports = {
    handleCreateSandboxUser,
    handleDeleteSandboxUser,
    handleGetSandboxUser
}