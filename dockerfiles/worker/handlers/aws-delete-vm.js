const { EC2Client, TerminateInstancesCommand } = require('@aws-sdk/client-ec2');
const VM = require('./../models/vm');
const { logger } = require('./../plugins/logger');

const REGION = process.env.AWS_REGION || 'ap-south-1';
const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET };
const ec2 = new EC2Client({ region: REGION, credentials });

const handler = async (job) => {
  const { vmName } = job.data;
  logger.info('[aws-delete-vm] ' + vmName);
  try {
    const vmDoc = await VM.findOne({ name: vmName }).lean();
    if (!vmDoc) {
      logger.warn('[aws-delete-vm] ' + vmName + ' not in Mongo — nothing to delete');
      return;
    }
    const instanceId = vmDoc.cloudInstanceId || vmDoc.resourceGroup;
    if (instanceId && instanceId.startsWith('i-')) {
      try {
        await ec2.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
        logger.info('[aws-delete-vm] ' + vmName + ' EC2 ' + instanceId + ' terminate requested');
      } catch (e) {
        logger.warn('[aws-delete-vm] ' + vmName + ' terminate error (ignoring): ' + e.message);
      }
    }
    await VM.updateOne({ name: vmName }, { $set: {
      isRunning: false, isAlive: false, dcvPort: null, remarks: 'Terminated', stoppingUntil: null,
    }});
    logger.info('[aws-delete-vm] ' + vmName + ' marked terminated');
  } catch (err) {
    logger.error('[aws-delete-vm] ' + vmName + ': ' + err.message);
    throw err;
  }
};

module.exports = handler;
