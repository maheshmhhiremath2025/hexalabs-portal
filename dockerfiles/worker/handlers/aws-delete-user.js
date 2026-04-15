require("dotenv").config();
const { logger } = require('../plugins/logger');
const awsUser = require('./../models/aws');
const {
    IAMClient,
    DeleteUserCommand,
    ListAttachedUserPoliciesCommand,
    DetachUserPolicyCommand,
    ListUserPoliciesCommand,
    DeleteUserPolicyCommand,
    DeleteLoginProfileCommand
} = require("@aws-sdk/client-iam");

const client = new IAMClient({
    region: process.env.AWS_REGION || "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_ACCESS_SECRET
    }
});

// Resource cleanup imports
let cleanupEc2, cleanupEbs, cleanupEips, cleanupSgs, cleanupKeyPairs;
try {
    const { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand, DescribeVolumesCommand, DeleteVolumeCommand, DescribeAddressesCommand, ReleaseAddressCommand, DescribeSecurityGroupsCommand, DeleteSecurityGroupCommand, DescribeKeyPairsCommand, DeleteKeyPairCommand } = require("@aws-sdk/client-ec2");
    const ec2 = new EC2Client({ region: process.env.AWS_REGION || "ap-south-1", credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    cleanupEc2 = async (username) => {
        const res = await ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped', 'pending'] }] }));
        const ids = [];
        for (const r of res.Reservations || []) {
            for (const i of r.Instances || []) {
                const tag = (i.Tags || []).find(t => t.Key === 'CreatedBy' || t.Key === 'Name');
                if (tag?.Value?.includes(username) || i.KeyName?.includes(username)) ids.push(i.InstanceId);
            }
        }
        if (ids.length) { await ec2.send(new TerminateInstancesCommand({ InstanceIds: ids })); logger.info(`Terminated ${ids.length} EC2 instances for ${username}`); }
        return ids.length;
    };

    cleanupEbs = async (username) => {
        try {
            const res = await ec2.send(new DescribeVolumesCommand({ Filters: [{ Name: 'status', Values: ['available'] }] }));
            let n = 0;
            for (const v of res.Volumes || []) {
                const tag = (v.Tags || []).find(t => t.Key === 'CreatedBy');
                if (tag?.Value === username) { await ec2.send(new DeleteVolumeCommand({ VolumeId: v.VolumeId })); n++; }
            }
            if (n) logger.info(`Deleted ${n} EBS volumes for ${username}`);
        } catch {}
    };

    cleanupEips = async (username) => {
        try {
            const res = await ec2.send(new DescribeAddressesCommand({}));
            for (const a of res.Addresses || []) {
                const tag = (a.Tags || []).find(t => t.Key === 'CreatedBy');
                if (tag?.Value === username && !a.AssociationId) { await ec2.send(new ReleaseAddressCommand({ AllocationId: a.AllocationId })); logger.info(`Released EIP for ${username}`); }
            }
        } catch {}
    };

    cleanupSgs = async (username) => {
        try {
            const res = await ec2.send(new DescribeSecurityGroupsCommand({}));
            for (const sg of res.SecurityGroups || []) {
                const tag = (sg.Tags || []).find(t => t.Key === 'CreatedBy');
                if (tag?.Value === username && sg.GroupName !== 'default') { try { await ec2.send(new DeleteSecurityGroupCommand({ GroupId: sg.GroupId })); } catch {} }
            }
        } catch {}
    };

    cleanupKeyPairs = async (username) => {
        try {
            const res = await ec2.send(new DescribeKeyPairsCommand({}));
            for (const kp of res.KeyPairs || []) {
                const tag = (kp.Tags || []).find(t => t.Key === 'CreatedBy');
                if (tag?.Value === username) { await ec2.send(new DeleteKeyPairCommand({ KeyPairId: kp.KeyPairId })); }
            }
        } catch {}
    };
} catch {
    // EC2 SDK not available in worker — skip resource cleanup
}

const handler = async (job) => {
    const { email } = job.data;
    try {
        const user = await awsUser.findOne({ email });
        if (!user) { logger.error(`User with email ${email} not found`); return; }

        const { userId } = user;
        logger.info(`Deleting AWS sandbox user ${userId} — starting full resource cleanup...`);

        // Step 1: Clean up ALL cloud resources created by this user
        if (cleanupEc2) {
            try { await cleanupEc2(userId); } catch (e) { logger.error(`EC2 cleanup: ${e.message}`); }
            try { await cleanupEbs(userId); } catch (e) { logger.error(`EBS cleanup: ${e.message}`); }
            try { await cleanupEips(userId); } catch (e) { logger.error(`EIP cleanup: ${e.message}`); }
            try { await cleanupSgs(userId); } catch (e) { logger.error(`SG cleanup: ${e.message}`); }
            try { await cleanupKeyPairs(userId); } catch (e) { logger.error(`KeyPair cleanup: ${e.message}`); }
        }

        // Step 2: Delete login profile
        try { await client.send(new DeleteLoginProfileCommand({ UserName: userId })); }
        catch (e) { if (e.name !== "NoSuchEntityException") throw e; }

        // Step 3: Detach all managed policies
        try {
            const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: userId }));
            for (const p of AttachedPolicies || []) {
                await client.send(new DetachUserPolicyCommand({ UserName: userId, PolicyArn: p.PolicyArn }));
            }
        } catch {}

        // Step 4: Delete all inline policies
        try {
            const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: userId }));
            for (const name of PolicyNames || []) {
                await client.send(new DeleteUserPolicyCommand({ UserName: userId, PolicyName: name }));
            }
        } catch {}

        // Step 5: Delete IAM user
        await client.send(new DeleteUserCommand({ UserName: userId }));
        logger.info(`AWS IAM user ${userId} deleted`);

        // Step 6: Remove from database
        await awsUser.deleteOne({ email });
        logger.info(`User ${email} removed from DB`);

    } catch (error) {
        logger.error(`Failed to delete AWS user ${email}: ${error.message}`);
    }
};

module.exports = handler;
