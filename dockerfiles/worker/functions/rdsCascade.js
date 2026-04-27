// Worker-side mirror of backend/services/rdsCascade.js. Cascades RDS host
// stop/delete events to the host's per-user session records so the Lab
// Console doesn't keep showing them as "Running" pointing at a dead IP.
// See the backend copy for the full rationale.

const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function cascadeRdsSessions(parentVmName, mode) {
  if (!parentVmName) return 0;

  const baseFilter = {
    name: { $regex: `^${escapeRegex(parentVmName)}-` },
    os: /RDS Session/,
  };

  let filter, update;
  if (mode === 'delete') {
    filter = { ...baseFilter, isAlive: true };
    update = { isAlive: false, isRunning: false, remarks: 'RDS host deleted — session orphaned' };
  } else if (mode === 'stop') {
    filter = { ...baseFilter, isRunning: true };
    update = { isRunning: false, remarks: 'RDS host stopped — session paused' };
  } else if (mode === 'resume') {
    filter = { ...baseFilter, isAlive: true, isRunning: false };
    update = { isRunning: true, remarks: 'RDS session' };
  } else {
    throw new Error(`cascadeRdsSessions: unknown mode '${mode}'`);
  }

  const r = await VM.updateMany(filter, { $set: update });
  if (r.modifiedCount > 0) {
    logger.info(`[rds-cascade] ${parentVmName}: ${mode} → ${r.modifiedCount} session(s)`);
  }
  return r.modifiedCount;
}

module.exports = { cascadeRdsSessions };
