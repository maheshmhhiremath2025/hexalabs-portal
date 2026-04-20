// Admin access-control endpoints — manage per-user login restrictions
// (time window, weekdays, hard expiry) from the portal UI instead of
// having to call the bulk-deploy API or edit the DB directly.
//
// Three targeting scopes:
//   - email:        update one specific user by email
//   - organization: update every user in an organization
//   - trainingName: update every user tied to a training batch

const User = require('../models/user');
const { logger } = require('../plugins/logger');

function canManageAccess(req) {
  const t = req.user?.userType;
  return t === 'admin' || t === 'superadmin';
}

function buildFilter(scope, target) {
  const t = String(target || '').trim();
  if (!t) return null;
  if (scope === 'email')        return { email: t.toLowerCase() };
  if (scope === 'organization') return { organization: t };
  if (scope === 'trainingName') return { trainingName: t };
  return null;
}

function validateTime(hhmm) {
  if (hhmm == null || hhmm === '') return true;  // empty = clear
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm);
}

function validateWeekdays(arr) {
  if (arr == null) return true;
  if (!Array.isArray(arr)) return false;
  return arr.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
}

/**
 * PATCH /admin/user-schedule
 * Body: {
 *   scope: 'email'|'organization'|'trainingName',
 *   target: string,
 *   loginStart?: 'HH:mm'|'',      // '' clears
 *   loginStop?:  'HH:mm'|'',
 *   allowedWeekdays?: number[]|null,  // null clears
 *   accessExpiresAt?: ISOString|null,
 *   clearAll?: boolean,            // if true, unset all 4 fields
 * }
 */
async function handleUpdateUserSchedule(req, res) {
  try {
    if (!canManageAccess(req)) return res.status(403).json({ message: 'Admin access required' });

    const { scope, target, loginStart, loginStop, allowedWeekdays, accessExpiresAt, clearAll } = req.body || {};
    const filter = buildFilter(scope, target);
    if (!filter) return res.status(400).json({ message: 'Valid scope (email|organization|trainingName) and target are required.' });

    // Build Mongo update doc — set + unset
    const $set = {};
    const $unset = {};

    if (clearAll) {
      Object.assign($unset, { loginStart: '', loginStop: '', allowedWeekdays: '', accessExpiresAt: '' });
    } else {
      // loginStart/Stop — empty string means clear
      if (loginStart !== undefined) {
        if (!validateTime(loginStart)) return res.status(400).json({ message: 'loginStart must be HH:mm (24-hour) or empty.' });
        if (loginStart === '') $unset.loginStart = ''; else $set.loginStart = loginStart;
      }
      if (loginStop !== undefined) {
        if (!validateTime(loginStop)) return res.status(400).json({ message: 'loginStop must be HH:mm (24-hour) or empty.' });
        if (loginStop === '') $unset.loginStop = ''; else $set.loginStop = loginStop;
      }
      if (allowedWeekdays !== undefined) {
        if (allowedWeekdays === null || (Array.isArray(allowedWeekdays) && allowedWeekdays.length === 0)) {
          $unset.allowedWeekdays = '';
        } else if (validateWeekdays(allowedWeekdays)) {
          $set.allowedWeekdays = allowedWeekdays;
        } else {
          return res.status(400).json({ message: 'allowedWeekdays must be an array of integers 0-6 (0=Sun, 6=Sat).' });
        }
      }
      if (accessExpiresAt !== undefined) {
        if (accessExpiresAt === null || accessExpiresAt === '') {
          $unset.accessExpiresAt = '';
        } else {
          const d = new Date(accessExpiresAt);
          if (isNaN(d.getTime())) return res.status(400).json({ message: 'accessExpiresAt must be a valid ISO date.' });
          $set.accessExpiresAt = d;
        }
      }
    }

    const updateDoc = {};
    if (Object.keys($set).length)   updateDoc.$set = $set;
    if (Object.keys($unset).length) updateDoc.$unset = $unset;
    if (!Object.keys(updateDoc).length) return res.status(400).json({ message: 'No fields to update.' });

    const result = await User.updateMany(filter, updateDoc);
    logger.info(`[access-control] ${req.user.email} updated schedule: scope=${scope} target=${target} matched=${result.matchedCount} modified=${result.modifiedCount}`);

    return res.json({
      matched: result.matchedCount,
      modified: result.modifiedCount,
      message: `${result.modifiedCount} user${result.modifiedCount === 1 ? '' : 's'} updated.`,
    });
  } catch (err) {
    logger.error(`[access-control] update failed: ${err.message}`);
    return res.status(500).json({ message: 'Failed to update schedule.' });
  }
}

/**
 * GET /admin/user-schedule/list
 * Returns all users with ANY of the four schedule fields set — so the
 * admin page can show "currently restricted" at a glance.
 */
async function handleListRestrictedUsers(req, res) {
  try {
    if (!canManageAccess(req)) return res.status(403).json({ message: 'Admin access required' });

    const users = await User.find({
      $or: [
        { loginStart:     { $exists: true, $ne: null, $ne: '' } },
        { loginStop:      { $exists: true, $ne: null, $ne: '' } },
        { allowedWeekdays:{ $exists: true, $ne: null, $not: { $size: 0 } } },
        { accessExpiresAt:{ $exists: true, $ne: null } },
      ],
    })
      .select('email organization trainingName userType loginStart loginStop allowedWeekdays accessExpiresAt')
      .sort({ organization: 1, email: 1 })
      .lean();

    return res.json({
      total: users.length,
      users,
    });
  } catch (err) {
    logger.error(`[access-control] list failed: ${err.message}`);
    return res.status(500).json({ message: 'Failed to fetch restricted users.' });
  }
}

/**
 * GET /admin/user-schedule/suggestions?q=...
 * Tiny helper for the UI: returns autocomplete suggestions for email,
 * organization, and trainingName based on a search string.
 */
async function handleScheduleSuggestions(req, res) {
  try {
    if (!canManageAccess(req)) return res.status(403).json({ message: 'Admin access required' });
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ emails: [], organizations: [], trainings: [] });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const [emails, orgsRaw, trainingsRaw] = await Promise.all([
      User.find({ email: rx }).limit(8).select('email organization').lean(),
      User.distinct('organization', { organization: rx }),
      User.distinct('trainingName', { trainingName: rx }),
    ]);

    return res.json({
      emails: emails.map(u => ({ email: u.email, organization: u.organization })),
      organizations: orgsRaw.filter(Boolean).slice(0, 8),
      trainings: trainingsRaw.filter(Boolean).slice(0, 8),
    });
  } catch (err) {
    logger.error(`[access-control] suggestions failed: ${err.message}`);
    return res.status(500).json({ message: 'Failed to fetch suggestions.' });
  }
}

module.exports = {
  handleUpdateUserSchedule,
  handleListRestrictedUsers,
  handleScheduleSuggestions,
};
