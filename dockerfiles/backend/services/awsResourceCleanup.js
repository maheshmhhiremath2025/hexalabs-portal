/**
 * AWS Resource Cleanup Service
 *
 * When an AWS sandbox user expires, we need to delete ALL resources they created.
 * AWS doesn't have a "resource group" concept like Azure, so we must find and delete
 * each resource type individually.
 *
 * Strategy: Tag-based cleanup + brute-force scan
 * - All sandbox users get a deny policy on CreateTags (they can't remove tags we add)
 * - The sandbox creation policy forces a CreatedBy tag on EC2 instances
 * - For resources without tags, we scan by creation time window
 */

const { logger } = require('../plugins/logger');

let ec2, s3, elbv2;
try {
  const { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand, DescribeVolumesCommand, DeleteVolumeCommand, DescribeSecurityGroupsCommand, DeleteSecurityGroupCommand, DescribeKeyPairsCommand, DeleteKeyPairCommand, ReleaseAddressCommand, DescribeAddressesCommand } = require('@aws-sdk/client-ec2');
  const { S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');

  const creds = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
  ec2 = new EC2Client({ region: 'ap-south-1', credentials: creds });
  s3 = new S3Client({ region: 'ap-south-1', credentials: creds });
} catch {}

/**
 * Delete all EC2 instances in the account that were created by a specific IAM user.
 * Uses CloudTrail-style approach: filter by tag CreatedBy or owner.
 */
async function cleanupEc2Instances(username) {
  if (!ec2) return;
  const { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
  try {
    // Find instances tagged with this user
    const res = await ec2.send(new DescribeInstancesCommand({
      Filters: [
        { Name: 'instance-state-name', Values: ['running', 'stopped', 'pending'] },
      ],
    }));

    const toTerminate = [];
    for (const r of res.Reservations || []) {
      for (const inst of r.Instances || []) {
        // Check by CreatedBy tag OR by key pair name matching username
        const createdByTag = (inst.Tags || []).find(t => t.Key === 'CreatedBy');
        const nameTag = (inst.Tags || []).find(t => t.Key === 'Name');
        const matchesUser = createdByTag?.Value === username
          || inst.KeyName?.includes(username)
          || nameTag?.Value?.includes(username);
        if (matchesUser) {
          toTerminate.push(inst.InstanceId);
        }
      }
    }

    if (toTerminate.length > 0) {
      await ec2.send(new TerminateInstancesCommand({ InstanceIds: toTerminate }));
      logger.info(`Terminated ${toTerminate.length} EC2 instances for ${username}: ${toTerminate.join(', ')}`);
    }
    return toTerminate.length;
  } catch (e) {
    logger.error(`EC2 cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete EBS volumes that are unattached (leftover from terminated instances).
 */
async function cleanupEbsVolumes(username) {
  if (!ec2) return;
  const { DescribeVolumesCommand, DeleteVolumeCommand } = require('@aws-sdk/client-ec2');
  try {
    const res = await ec2.send(new DescribeVolumesCommand({
      Filters: [
        { Name: 'status', Values: ['available'] }, // unattached
        { Name: 'tag:CreatedBy', Values: [username] },
      ],
    }));

    let count = 0;
    for (const vol of res.Volumes || []) {
      await ec2.send(new DeleteVolumeCommand({ VolumeId: vol.VolumeId }));
      count++;
    }
    if (count) logger.info(`Deleted ${count} EBS volumes for ${username}`);
    return count;
  } catch (e) {
    logger.error(`EBS cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Release Elastic IPs allocated by the user.
 */
async function cleanupElasticIps(username) {
  if (!ec2) return;
  const { DescribeAddressesCommand, ReleaseAddressCommand } = require('@aws-sdk/client-ec2');
  try {
    const res = await ec2.send(new DescribeAddressesCommand({
      Filters: [{ Name: 'tag:CreatedBy', Values: [username] }],
    }));

    let count = 0;
    for (const addr of res.Addresses || []) {
      if (!addr.AssociationId) { // only release unassociated
        await ec2.send(new ReleaseAddressCommand({ AllocationId: addr.AllocationId }));
        count++;
      }
    }
    if (count) logger.info(`Released ${count} Elastic IPs for ${username}`);
    return count;
  } catch (e) {
    logger.error(`EIP cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete security groups created by the user (non-default).
 */
async function cleanupSecurityGroups(username) {
  if (!ec2) return;
  const { DescribeSecurityGroupsCommand, DeleteSecurityGroupCommand } = require('@aws-sdk/client-ec2');
  try {
    const res = await ec2.send(new DescribeSecurityGroupsCommand({
      Filters: [{ Name: 'tag:CreatedBy', Values: [username] }],
    }));

    let count = 0;
    for (const sg of res.SecurityGroups || []) {
      if (sg.GroupName !== 'default') {
        try {
          await ec2.send(new DeleteSecurityGroupCommand({ GroupId: sg.GroupId }));
          count++;
        } catch {} // may fail if still in use — will be cleaned on next pass
      }
    }
    if (count) logger.info(`Deleted ${count} security groups for ${username}`);
    return count;
  } catch (e) {
    logger.error(`SG cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete key pairs created by the user.
 */
async function cleanupKeyPairs(username) {
  if (!ec2) return;
  const { DescribeKeyPairsCommand, DeleteKeyPairCommand } = require('@aws-sdk/client-ec2');
  try {
    const res = await ec2.send(new DescribeKeyPairsCommand({
      Filters: [{ Name: 'tag:CreatedBy', Values: [username] }],
    }));

    let count = 0;
    for (const kp of res.KeyPairs || []) {
      await ec2.send(new DeleteKeyPairCommand({ KeyPairId: kp.KeyPairId }));
      count++;
    }
    if (count) logger.info(`Deleted ${count} key pairs for ${username}`);
    return count;
  } catch (e) {
    logger.error(`KeyPair cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete S3 buckets created by the user. Empties each bucket first (required
 * before deletion). Matches by tag or by bucket name containing the username.
 */
async function cleanupS3Buckets(username) {
  try {
    const { S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand, GetBucketTaggingCommand } = require('@aws-sdk/client-s3');
    const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    const { Buckets } = await s3Client.send(new ListBucketsCommand({}));
    let count = 0;

    for (const bucket of Buckets || []) {
      // Match by name pattern (lab-username-*) or by tag
      let isUserBucket = bucket.Name.includes(username.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (!isUserBucket) {
        try {
          const tags = await s3Client.send(new GetBucketTaggingCommand({ Bucket: bucket.Name }));
          isUserBucket = (tags.TagSet || []).some(t => t.Key === 'CreatedBy' && t.Value === username);
        } catch {} // no tags = not ours
      }

      if (isUserBucket) {
        // Empty the bucket first
        try {
          let truncated = true;
          while (truncated) {
            const objects = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket.Name, MaxKeys: 1000 }));
            if (objects.Contents?.length) {
              await s3Client.send(new DeleteObjectsCommand({
                Bucket: bucket.Name,
                Delete: { Objects: objects.Contents.map(o => ({ Key: o.Key })) },
              }));
            }
            truncated = objects.IsTruncated;
          }
        } catch (e) { logger.error(`S3 empty ${bucket.Name}: ${e.message}`); }

        try {
          await s3Client.send(new DeleteBucketCommand({ Bucket: bucket.Name }));
          count++;
        } catch (e) { logger.error(`S3 delete ${bucket.Name}: ${e.message}`); }
      }
    }
    if (count) logger.info(`Deleted ${count} S3 buckets for ${username}`);
    return count;
  } catch (e) {
    logger.error(`S3 cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete RDS instances created by the user (tagged with CreatedBy).
 * Skips final snapshot to speed up deletion.
 */
async function cleanupRdsInstances(username) {
  try {
    const { RDSClient, DescribeDBInstancesCommand, DeleteDBInstanceCommand } = require('@aws-sdk/client-rds');
    const rds = new RDSClient({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({}));
    let count = 0;

    for (const db of DBInstances || []) {
      const tags = db.TagList || [];
      if (tags.some(t => t.Key === 'CreatedBy' && t.Value === username)) {
        try {
          await rds.send(new DeleteDBInstanceCommand({
            DBInstanceIdentifier: db.DBInstanceIdentifier,
            SkipFinalSnapshot: true,
            DeleteAutomatedBackups: true,
          }));
          count++;
          logger.info(`Deleting RDS instance ${db.DBInstanceIdentifier} for ${username}`);
        } catch (e) { logger.error(`RDS delete ${db.DBInstanceIdentifier}: ${e.message}`); }
      }
    }
    if (count) logger.info(`Deleted ${count} RDS instances for ${username}`);
    return count;
  } catch (e) {
    logger.error(`RDS cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete Lambda functions created by the user.
 */
async function cleanupLambdaFunctions(username) {
  try {
    const { LambdaClient, ListFunctionsCommand, DeleteFunctionCommand, ListTagsCommand } = require('@aws-sdk/client-lambda');
    const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    const { Functions } = await lambda.send(new ListFunctionsCommand({}));
    let count = 0;

    for (const fn of Functions || []) {
      try {
        const { Tags } = await lambda.send(new ListTagsCommand({ Resource: fn.FunctionArn }));
        if (Tags?.CreatedBy === username) {
          await lambda.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }));
          count++;
        }
      } catch {}
    }
    if (count) logger.info(`Deleted ${count} Lambda functions for ${username}`);
    return count;
  } catch (e) {
    logger.error(`Lambda cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete DynamoDB tables created by the user.
 */
async function cleanupDynamoDbTables(username) {
  try {
    const { DynamoDBClient, ListTablesCommand, DescribeTableCommand, DeleteTableCommand, ListTagsOfResourceCommand } = require('@aws-sdk/client-dynamodb');
    const ddb = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    const { TableNames } = await ddb.send(new ListTablesCommand({}));
    let count = 0;

    for (const tableName of TableNames || []) {
      try {
        const { Table } = await ddb.send(new DescribeTableCommand({ TableName: tableName }));
        const { Tags } = await ddb.send(new ListTagsOfResourceCommand({ ResourceArn: Table.TableArn }));
        if ((Tags || []).some(t => t.Key === 'CreatedBy' && t.Value === username)) {
          await ddb.send(new DeleteTableCommand({ TableName: tableName }));
          count++;
        }
      } catch {}
    }
    if (count) logger.info(`Deleted ${count} DynamoDB tables for ${username}`);
    return count;
  } catch (e) {
    logger.error(`DynamoDB cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete M2 (Mainframe Modernization) environments + applications tagged
 * with CreatedBy={username}. Applications must be stopped/deleted before
 * their underlying environments. Gracefully no-ops if the SDK isn't installed.
 */
async function cleanupM2Resources(username) {
  try {
    const { M2Client, ListEnvironmentsCommand, ListApplicationsCommand, ListTagsForResourceCommand, DeleteEnvironmentCommand, DeleteApplicationCommand, StopApplicationCommand } = require('@aws-sdk/client-m2');
    const m2 = new M2Client({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    let count = 0;

    const apps = await m2.send(new ListApplicationsCommand({}));
    for (const app of apps.applications || []) {
      try {
        const { tags } = await m2.send(new ListTagsForResourceCommand({ resourceArn: app.applicationArn }));
        if (tags?.CreatedBy === username) {
          try { await m2.send(new StopApplicationCommand({ applicationId: app.applicationId, forceStop: true })); } catch {}
          await m2.send(new DeleteApplicationCommand({ applicationId: app.applicationId }));
          count++;
          logger.info(`Deleted M2 application ${app.applicationId} for ${username}`);
        }
      } catch (e) { logger.error(`M2 app ${app.applicationId}: ${e.message}`); }
    }

    const envs = await m2.send(new ListEnvironmentsCommand({}));
    for (const env of envs.environments || []) {
      try {
        const { tags } = await m2.send(new ListTagsForResourceCommand({ resourceArn: env.environmentArn }));
        if (tags?.CreatedBy === username) {
          await m2.send(new DeleteEnvironmentCommand({ environmentId: env.environmentId }));
          count++;
          logger.info(`Deleted M2 environment ${env.environmentId} for ${username}`);
        }
      } catch (e) { logger.error(`M2 env ${env.environmentId}: ${e.message}`); }
    }

    if (count) logger.info(`Deleted ${count} M2 resources for ${username}`);
    return count;
  } catch (e) {
    logger.error(`M2 cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Delete AppStream 2.0 fleets + image builders tagged with CreatedBy={username}.
 * Stops them first if running — AppStream requires STOPPED state before delete.
 * Gracefully no-ops if the SDK isn't installed.
 */
async function cleanupAppStreamResources(username) {
  try {
    const { AppStreamClient, DescribeFleetsCommand, DescribeImageBuildersCommand, ListTagsForResourceCommand, StopFleetCommand, DeleteFleetCommand, StopImageBuilderCommand, DeleteImageBuilderCommand } = require('@aws-sdk/client-appstream');
    const as = new AppStreamClient({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });

    let count = 0;

    const { Fleets } = await as.send(new DescribeFleetsCommand({}));
    for (const fleet of Fleets || []) {
      try {
        const { Tags } = await as.send(new ListTagsForResourceCommand({ ResourceArn: fleet.Arn }));
        if (Tags?.CreatedBy === username) {
          if (fleet.State === 'RUNNING') {
            try { await as.send(new StopFleetCommand({ Name: fleet.Name })); } catch {}
          }
          try { await as.send(new DeleteFleetCommand({ Name: fleet.Name })); count++; logger.info(`Deleted AppStream fleet ${fleet.Name} for ${username}`); } catch (e) { logger.error(`AppStream fleet delete ${fleet.Name}: ${e.message}`); }
        }
      } catch (e) { logger.error(`AppStream fleet lookup ${fleet.Name}: ${e.message}`); }
    }

    const { ImageBuilders } = await as.send(new DescribeImageBuildersCommand({}));
    for (const ib of ImageBuilders || []) {
      try {
        const { Tags } = await as.send(new ListTagsForResourceCommand({ ResourceArn: ib.Arn }));
        if (Tags?.CreatedBy === username) {
          if (ib.State === 'RUNNING') {
            try { await as.send(new StopImageBuilderCommand({ Name: ib.Name })); } catch {}
          }
          try { await as.send(new DeleteImageBuilderCommand({ Name: ib.Name })); count++; logger.info(`Deleted AppStream image builder ${ib.Name} for ${username}`); } catch (e) { logger.error(`AppStream IB delete ${ib.Name}: ${e.message}`); }
        }
      } catch (e) { logger.error(`AppStream IB lookup ${ib.Name}: ${e.message}`); }
    }

    if (count) logger.info(`Deleted ${count} AppStream resources for ${username}`);
    return count;
  } catch (e) {
    logger.error(`AppStream cleanup for ${username}: ${e.message}`);
    return 0;
  }
}

/**
 * Full cleanup of all AWS resources for a sandbox user.
 * Call this BEFORE deleting the IAM user.
 */
async function fullAwsCleanup(username) {
  logger.info(`Starting full AWS resource cleanup for ${username}...`);

  const results = {
    ec2: await cleanupEc2Instances(username),
    volumes: await cleanupEbsVolumes(username),
    eips: await cleanupElasticIps(username),
    securityGroups: await cleanupSecurityGroups(username),
    keyPairs: await cleanupKeyPairs(username),
    s3Buckets: await cleanupS3Buckets(username),
    rdsInstances: await cleanupRdsInstances(username),
    lambdaFunctions: await cleanupLambdaFunctions(username),
    dynamoDbTables: await cleanupDynamoDbTables(username),
    m2Resources: await cleanupM2Resources(username),
    appStream: await cleanupAppStreamResources(username),
  };

  const total = Object.values(results).reduce((s, v) => s + (v || 0), 0);
  logger.info(`AWS cleanup for ${username} complete: ${total} resources deleted (${JSON.stringify(results)})`);
  return results;
}

module.exports = { fullAwsCleanup, cleanupEc2Instances, cleanupEbsVolumes, cleanupElasticIps, cleanupSecurityGroups, cleanupKeyPairs, cleanupM2Resources, cleanupAppStreamResources };
