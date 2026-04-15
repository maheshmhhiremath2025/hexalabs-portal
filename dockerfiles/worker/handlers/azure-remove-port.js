const {closePort, closePortDirection, closePortBoth} = require('./../functions/vmManagers')
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  const {vmName, port, resourceGroup, direction = 'inbound'} = job.data;
  
  console.log('🔧 Port closing request:', {
    vmName,
    port, 
    resourceGroup,
    direction
  });

  try {
    // Handle different direction cases
    if (direction === 'both') {
      console.log('🔄 Closing BOTH inbound and outbound ports');
      await closePortBoth(vmName, port, resourceGroup);
      logger.info(`PORT: ${port} closed for BOTH directions for ${vmName}`);
    } else if (direction === 'outbound') {
      console.log('📤 Closing OUTBOUND port only');
      await closePortDirection(vmName, port, resourceGroup, 'Outbound');
      logger.info(`PORT: ${port} closed for OUTBOUND for ${vmName}`);
    } else {
      // Default to inbound (existing behavior)
      console.log('📥 Closing INBOUND port only');
      await closePort(vmName, port, resourceGroup);
      logger.info(`PORT: ${port} closed for INBOUND for ${vmName}`);
    }

  } catch (error) {
    logger.error(`Error closing ${direction} port: ${port} for ${vmName}`, error);
    throw error; // Use throw instead of return new error
  }
};

module.exports = handler;