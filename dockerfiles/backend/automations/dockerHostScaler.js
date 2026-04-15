const { logger } = require('../plugins/logger');
const { checkAndScaleDown, HOST_MODE } = require('../services/dockerHostManager');

async function dockerHostScaler() {
  if (HOST_MODE === 'local') return; // No auto-scaling in local mode

  try {
    await checkAndScaleDown();
  } catch (err) {
    logger.error(`[docker-host-scaler] Error: ${err.message}`);
  }
}

module.exports = { dockerHostScaler };
