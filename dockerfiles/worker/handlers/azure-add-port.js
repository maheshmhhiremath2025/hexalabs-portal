const {
  openPortsBatch,
  openPort,
  openPortDirection,
  openPortBoth,
} = require('./../functions/vmManagers');
const { logger } = require('./../plugins/logger');

// New payload: { vmName, resourceGroup, ports: string[], direction }
// Legacy payload: { vmName, resourceGroup, port, priority, direction }
const handler = async (job) => {
  const { vmName, resourceGroup, direction = 'inbound' } = job.data;
  const ports = Array.isArray(job.data.ports)
    ? job.data.ports
    : job.data.port !== undefined ? [String(job.data.port)] : [];

  if (!vmName || !resourceGroup || !ports.length) {
    logger.error('azure-add-port: missing vmName/resourceGroup/ports', job.data);
    return;
  }

  try {
    if (job.data.ports) {
      await openPortsBatch(vmName, ports, resourceGroup, direction);
      logger.info(`PORTS opened on ${vmName}: ${ports.join(', ')} (${direction})`);
      return;
    }

    // Legacy single-port path — keep old behaviour for any already-queued jobs.
    const { port, priority } = job.data;
    if (direction === 'both') {
      await openPortBoth(vmName, port, priority, resourceGroup);
    } else if (direction === 'outbound') {
      await openPortDirection(vmName, port, priority, resourceGroup, 'Outbound');
    } else {
      await openPort(vmName, port, priority, resourceGroup);
    }
    logger.info(`PORT ${port} opened for ${direction} on ${vmName}`);
  } catch (error) {
    logger.error(`Error opening ports on ${vmName}: ${error.message}`);
    throw error;
  }
};

module.exports = handler;
