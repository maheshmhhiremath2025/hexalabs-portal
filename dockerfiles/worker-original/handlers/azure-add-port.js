const {openPort} = require('./../functions/vmManagers')
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  const {vmName, port, priority, resourceGroup} = job.data
 try {
  await openPort(vmName, port, priority, resourceGroup);
  logger.info(`PORT: ${port} opened for ${vmName}`)

 } catch (error) {
  logger.error(`Error opening port: ${port} for ${vmName}`)
  return new error
 }
};

module.exports = handler;

