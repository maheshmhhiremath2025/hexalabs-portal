const {closePort} = require('./../functions/vmManagers')
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  const {vmName, port, resourceGroup} = job.data
 try {
  await closePort(vmName, port, resourceGroup);
  logger.info(`PORT: ${port} closed for ${vmName}`)

 } catch (error) {
  logger.error(`Error closing port: ${port} for ${vmName}`)
  return new error
 }
};

module.exports = handler;

