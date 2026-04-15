const {restartAzureVM} = require('./../functions/vmManagers')
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  try {
    await restartAzureVM(job.data.resourceGroup, job.data.vmName)
    logger.info(`VM Restarted: ${job.data.vmName}`)
  } catch (error) {
    logger.error(`VM Restart Error:${job.data.vmName}`)
    return new error
  }
  };
  
  module.exports = handler;
  
  