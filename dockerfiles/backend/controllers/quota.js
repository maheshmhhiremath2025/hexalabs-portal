require('dotenv').config()
const { logger } = require('./../plugins/logger')
const Training = require('./../models/training')
const VM = require('./../models/vm')
const QuotaHistory = require('./../models/quotaHistory')

/* ─── Tenant-scoping helpers (mirrors controllers/admin.js) ─── */
function orgScope(req) {
  return req.user?.userType === 'superadmin' ? null : (req.user?.organization || null);
}
function isAdmin(req) {
  const t = req.user?.userType;
  return t === 'admin' || t === 'superadmin';
}
function isSuperadmin(req) { return req.user?.userType === 'superadmin'; }

/* ─── Unit truth ─────────────────────────────────────────────────
 * VM.quota.total    is stored in MINUTES.
 * VM.quota.consumed is stored in HOURS (decimal) per the
 * `unit-normalize-2026-05-27` comment in azure-stop-vm.js. The frontend
 * passes `deltaHours` in HOURS; we convert to minutes for `total`. */
const HOURS_TO_MIN = (h) => Math.round(Number(h) * 60);
const MIN_TO_HOURS = (m) => Math.round((Number(m) / 60) * 100) / 100;

/* ─── GET /admin/quota?trainingName=X ─── training-level summary */
const handleGetQuota = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'Training name is required.' });

    const scopeOrg = orgScope(req);
    if (scopeOrg) {
      const t = await Training.findOne({ name: trainingName }, 'organization').lean();
      if (!t || t.organization !== scopeOrg) {
        return res.status(403).json({ message: 'Cannot view quota for a training outside your organization' });
      }
    }

    const data = await VM.find({ trainingName, isAlive: { $ne: false } }, { quota: 1, _id: 0 }).lean();
    if (!data.length) return res.status(404).json({ message: 'No VMs found for the given training name.' });

    // total/consumed stored as min/hours respectively — sum directly, frontend converts.
    const totalMin = data.reduce((s, v) => s + (v.quota?.total || 0), 0);
    const consumedH = data.reduce((s, v) => s + (v.quota?.consumed || 0), 0);
    const perVmMin = data[0].quota?.total || 0;
    res.json({ totalMin, consumedH, perVmMin, vmCount: data.length });
  } catch (error) {
    logger.error('Error fetching quota:', error);
    res.status(500).json({ message: 'Failed to fetch quota due to a server error.' });
  }
};

/* ─── GET /admin/quota/vms?trainingName=X ─── per-VM rows for the table */
const handleGetQuotaVms = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'Training name is required.' });

    const scopeOrg = orgScope(req);
    if (scopeOrg) {
      const t = await Training.findOne({ name: trainingName }, 'organization').lean();
      if (!t || t.organization !== scopeOrg) return res.status(403).json({ message: 'Cannot view quota for a training outside your organization' });
    }

    const data = await VM.find({ trainingName, isAlive: { $ne: false } },
      { name: 1, email: 1, isRunning: 1, vmSize: 1, quota: 1, duration: 1, _id: 0 }).lean();
    res.json({ vms: data });
  } catch (error) {
    logger.error('Error fetching per-VM quota:', error);
    res.status(500).json({ message: 'Failed to fetch per-VM quota.' });
  }
};

/* ─── GET /admin/quota/history?trainingName=X&limit=N ─── audit log */
const handleGetQuotaHistory = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });
    const { trainingName, limit = 25 } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'Training name is required.' });

    const scopeOrg = orgScope(req);
    if (scopeOrg) {
      const t = await Training.findOne({ name: trainingName }, 'organization').lean();
      if (!t || t.organization !== scopeOrg) return res.status(403).json({ message: 'Cannot view history outside your organization' });
    }

    const rows = await QuotaHistory.find({ trainingName })
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 25, 200))
      .lean();
    res.json({ history: rows });
  } catch (error) {
    logger.error('Error fetching quota history:', error);
    res.status(500).json({ message: 'Failed to fetch quota history.' });
  }
};

/* ─── POST /admin/quota ─── inc / dec / set, per-VM or training-wide
 *
 * Body (one of):
 *   { trainingName, vmName?, mode: 'inc'|'dec'|'set', deltaHours, reason? }
 *
 * Backwards-compat: { trainingName, increaseBy } (minutes) still works
 * — treated as `mode=inc, deltaHours=increaseBy/60` against all VMs.
 * Used by Quota.jsx's older callers until they're swapped to the new body. */
const handleQuotaAction = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ message: 'Admin access required' });

    const body = req.body || {};
    const { trainingName, vmName, reason } = body;
    if (!trainingName) return res.status(400).json({ message: 'Training name is required.' });

    // Back-compat path — old Quota.jsx body shape `{ trainingName, increaseBy: <minutes> }`.
    let mode = body.mode;
    let deltaHours = body.deltaHours;
    if (mode == null && body.increaseBy != null) {
      mode = 'inc';
      deltaHours = MIN_TO_HOURS(body.increaseBy);
    }

    if (!['inc', 'dec', 'set'].includes(mode)) {
      return res.status(400).json({ message: "mode must be 'inc', 'dec', or 'set'" });
    }
    if (deltaHours == null || isNaN(deltaHours) || Number(deltaHours) < 0) {
      return res.status(400).json({ message: 'deltaHours must be a non-negative number.' });
    }
    if (mode === 'dec' && !isSuperadmin(req)) {
      return res.status(403).json({ message: 'Only superadmins can decrement quota.' });
    }

    const training = await Training.findOne({ name: trainingName });
    if (!training) return res.status(404).json({ message: 'Training not found.' });

    const scopeOrg = orgScope(req);
    if (scopeOrg && training.organization !== scopeOrg) {
      return res.status(403).json({ message: 'Cannot modify quota for a training outside your organization' });
    }
    if (training.status === 'deleted') {
      return res.status(400).json({ message: 'The training is deleted. Quota cannot be modified.' });
    }

    const deltaMin = HOURS_TO_MIN(deltaHours);
    const filter = vmName ? { name: vmName, trainingName, isAlive: { $ne: false } }
                          : { trainingName, isAlive: { $ne: false } };

    const vms = await VM.find(filter, { name: 1, quota: 1, duration: 1, _id: 1 }).lean();
    if (!vms.length) return res.status(404).json({ message: vmName ? `VM ${vmName} not found.` : 'No VMs found for the given training name.' });

    // For 'dec' and 'set', validate that the new cap won't fall below current usage
    // (duration is in MINUTES — same unit as quota.total). Reject early so the
    // bulk loop is all-or-nothing per request.
    const failures = [];
    for (const v of vms) {
      const usedMin = Math.ceil(v.duration || 0); // already minutes
      let newTotalMin;
      if (mode === 'inc') newTotalMin = (v.quota?.total || 0) + deltaMin;
      else if (mode === 'dec') newTotalMin = Math.max(0, (v.quota?.total || 0) - deltaMin);
      else /* set */ newTotalMin = deltaMin;
      if (newTotalMin < usedMin) failures.push({ vm: v.name, usedMin, attemptedTotalMin: newTotalMin });
    }
    if (failures.length) {
      return res.status(400).json({
        message: 'Refused: new cap is below current usage for some VM(s). Quota cannot reclaim hours already consumed.',
        failures,
      });
    }

    // Apply + log
    const ops = vms.map((v) => {
      const prev = v.quota?.total || 0;
      let next;
      if (mode === 'inc') next = prev + deltaMin;
      else if (mode === 'dec') next = Math.max(0, prev - deltaMin);
      else next = deltaMin;
      return { vm: v, prev, next };
    });

    await Promise.all(ops.map(({ vm, next }) =>
      VM.updateOne({ _id: vm._id }, { $set: { 'quota.total': next, isAlive: true, remarks: `Quota ${mode}` } })
    ));

    await QuotaHistory.create({
      trainingName,
      vmName: vmName || null,
      organization: training.organization || null,
      mode,
      prevTotalMin: ops[0]?.prev || 0,
      newTotalMin: ops[0]?.next || 0,
      deltaHours: Number(deltaHours),
      scope: vmName ? 'single' : 'bulk',
      affectedVms: ops.length,
      byEmail: req.user?.email || null,
      byUserType: req.user?.userType || null,
      reason: (reason || '').slice(0, 240),
    });

    res.json({
      message: vmName
        ? `Quota ${mode} applied to ${vmName} (${deltaHours}h).`
        : `Quota ${mode} applied to ${ops.length} VM(s) (${deltaHours}h each).`,
      affectedVms: ops.length,
    });
  } catch (error) {
    logger.error('Error in quota action:', error);
    res.status(500).json({ message: 'Failed to update quota due to a server error.' });
  }
};

module.exports = {
  handleGetQuota,
  handleGetQuotaVms,
  handleGetQuotaHistory,
  handleQuotaAction,
  // Back-compat alias so the old route export name still works.
  handleIncreaseQuota: handleQuotaAction,
};
