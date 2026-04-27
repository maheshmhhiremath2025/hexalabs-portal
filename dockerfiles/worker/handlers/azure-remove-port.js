const {
  closePortsBatch,
  closePort,
  closePortDirection,
  closePortBoth,
} = require('./../functions/vmManagers');
const { logger } = require('./../plugins/logger');

// New payload: { vmName, resourceGroup, ports: string[], direction }
// Legacy payload: { vmName, resourceGroup, port, direction }
const handler = async (job) => {
  const { vmName, resourceGroup, direction = 'inbound' } = job.data;
  const ports = Array.isArray(job.data.ports)
    ? job.data.ports
    : job.data.port !== undefined ? [String(job.data.port)] : [];

  if (!vmName || !resourceGroup || !ports.length) {
    logger.error('azure-remove-port: missing vmName/resourceGroup/ports', job.data);
    return;
  }

  try {
    if (job.data.ports) {
      await closePortsBatch(vmName, ports, resourceGroup, direction);
      logger.info(`PORTS closed on ${vmName}: ${ports.join(', ')} (${direction})`);
      return;
    }

    const { port } = job.data;
    if (direction === 'both') {
      await closePortBoth(vmName, port, resourceGroup);
    } else if (direction === 'outbound') {
      await closePortDirection(vmName, port, resourceGroup, 'Outbound');
    } else {
      await closePort(vmName, port, resourceGroup);
    }
    logger.info(`PORT ${port} closed for ${direction} on ${vmName}`);
  } catch (error) {
    logger.error(`Error closing ports on ${vmName}: ${error.message}`);
    throw error;
  }
};

module.exports = handler;
