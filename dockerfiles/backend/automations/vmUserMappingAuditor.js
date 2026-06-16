/**
 * Daily auditor: detects + auto-heals vmUserMapping drift across all active
 * Trainings. Idempotent. Logs any healing done. Catches future regressions in
 * the deploy path before customer demos break.
 *
 * Added 2026-06-16 alongside the aws-create-vm vmUserMapping regression fix.
 * Pattern: same as backfill_vmusermapping.js but runs daily, logs metrics.
 */

const { logger } = require('../plugins/logger');

async function vmUserMappingAuditor() {
  if (process.env.VM_USER_MAPPING_AUDITOR_ENABLED === 'false') return;   // opt-out kill switch

  const mongoose = require('mongoose');
  const db = mongoose.connection.db;
  if (!db) { logger.warn('[vmum-audit] Mongo not connected — skipping'); return; }

  const trainings = await db.collection('trainings').find({ status: { $ne: 'deleted' } }).toArray();

  let totalAdded = 0, trainingsTouched = 0;
  const drifts = [];

  for (const t of trainings) {
    const vms = await db.collection('vms')
      .find({ trainingName: t.name, email: { $exists: true, $ne: null, $ne: '' } })
      .project({ name: 1, email: 1 })
      .toArray();
    if (!vms.length) continue;

    const existing = new Set((t.vmUserMapping || []).map(m => `${m.vmName}|${m.userEmail}`));
    const toAdd = vms
      .filter(v => !existing.has(`${v.name}|${v.email}`))
      .map(v => ({ vmName: v.name, userEmail: v.email }));
    if (!toAdd.length) continue;

    await db.collection('trainings').updateOne(
      { _id: t._id },
      { $push: { vmUserMapping: { $each: toAdd } } }
    );
    drifts.push({ training: t.name, org: t.organization, added: toAdd.length });
    totalAdded += toAdd.length;
    trainingsTouched++;
  }

  if (totalAdded > 0) {
    logger.warn(`[vmum-audit] DRIFT DETECTED + healed: ${totalAdded} mappings across ${trainingsTouched} Trainings`);
    drifts.forEach(d => logger.warn(`[vmum-audit]   ${d.training} (${d.org}): +${d.added}`));
  } else {
    logger.info(`[vmum-audit] OK — scanned ${trainings.length} Trainings, 0 drift`);
  }
}

module.exports = { vmUserMappingAuditor };
