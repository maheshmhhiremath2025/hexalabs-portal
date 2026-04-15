const {openPort, openPortDirection, openPortBoth} = require('./../functions/vmManagers')
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  const {vmName, port, priority, resourceGroup, direction = 'inbound'} = job.data;
  
  console.log('🔧 Port opening request:', {
    vmName,
    port, 
    priority,
    resourceGroup,
    direction
  });

  try {
    // Handle different direction cases
    if (direction === 'both') {
      console.log('🔄 Opening BOTH inbound and outbound ports');
      await openPortBoth(vmName, port, priority, resourceGroup);
      logger.info(`PORT: ${port} opened for BOTH directions for ${vmName}`);
    } else if (direction === 'outbound') {
      console.log('📤 Opening OUTBOUND port only');
      await openPortDirection(vmName, port, priority, resourceGroup, 'Outbound');
      logger.info(`PORT: ${port} opened for OUTBOUND for ${vmName}`);
    } else {
      // Default to inbound (existing behavior)
      console.log('📥 Opening INBOUND port only');
      await openPort(vmName, port, priority, resourceGroup);
      logger.info(`PORT: ${port} opened for INBOUND for ${vmName}`);
    }

  } catch (error) {
    logger.error(`Error opening ${direction} port: ${port} for ${vmName}`, error);
    throw error; // Fixed: use throw instead of return new error
  }
};

module.exports = handler;