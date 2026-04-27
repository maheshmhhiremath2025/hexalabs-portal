// Cascade RDS host state changes to its session records.
//
// Why this exists: an RDS "host" is a real Azure VM running Windows RDS,
// while the per-user "sessions" are logical DB rows (same publicIp, just
// different username/password) — they have no Azure resource of their own.
// vmStateReconciler intentionally skips records whose os matches /RDS
// Session/ to avoid 404'ing them on every poll. The downside is that when
// the parent host stops or gets deleted, nothing updates the session rows,
// so the Lab Console keeps showing them as "Running" and Guacamole tries
// to RDP into a dead IP — that's the "network to guacamole server is
// unstable" error users keep seeing.
//
// Note: there's no `rdsServer` field on the schema — the original cascades
// in labExpiry.js / routes/azure.js matched on it and silently did nothing.
// We identify sessions instead by the canonical naming convention
// (`<host>-<username>`) plus the os tag, both of which are guaranteed by
// rdsService.js when a session record is created.

const VM = require('../models/vm');
const { logger } = require('../plugins/logger');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} parentVmName  Name of the RDS host VM
 * @param {'stop'|'delete'} mode 'stop' → mark sessions paused (host can recover)
 *                               'delete' → mark sessions terminated forever
 * @returns {Promise<number>} count of session records modified
 */
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
    // Host came back from snapshot — wake the session rows so Lab Console
    // shows them Running again. Only resumes still-alive sessions.
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
