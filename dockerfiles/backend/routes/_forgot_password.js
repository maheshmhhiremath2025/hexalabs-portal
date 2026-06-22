// Public password-reset routes (no auth). Mounted at /user.
//
// Two paths gated by user.accountSource:
//   self-signup    -> classic email-link reset (token, 30-min TTL)
//   cohort-deploy  -> notify the org admin; learner can't receive email
//
// Anti-enumeration: every response is the generic "if your account exists,
// instructions have been sent". The branch-specific work happens server-side.
//
// Mount in routes/user.js: alongside /login.

const crypto = require('crypto');
const User = require('./../models/user');
const { logger } = require('./../plugins/logger');

let sendPasswordResetLink, notifyAdminOfCohortReset, isLikelyDeliverable;
try {
  ({ sendPasswordResetLink, notifyAdminOfCohortReset, isLikelyDeliverable } = require('./../services/emailNotifications'));
} catch (e) {
  // emailNotifications partially loaded — degrade gracefully
}

const RESET_TTL_MS = 30 * 60 * 1000;
const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.labsoncloud.online';
const GENERIC_OK = { message: 'If an account exists for that email, instructions have been sent.' };

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function attach(router) {
  // ─── Step 1: user submits email ────────────────────────────────────────
  router.post('/forgot-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ message: 'Email is required.' });

      const user = await User.findOne({ email });
      if (!user) {
        // No leak: same response regardless of existence.
        return res.status(200).json(GENERIC_OK);
      }

      const ip = req.ip;
      // cohort-deploy: notify admin, don't email learner
      if (user.accountSource === 'cohort-deploy') {
        if (notifyAdminOfCohortReset) {
          notifyAdminOfCohortReset({
            learnerEmail: user.email,
            organization: user.organization,
            requestIp: ip,
          }).catch(err => logger.error(`cohort reset notify failed for ${user.email}: ${err.message}`));
        }
        logger.info(`forgot-password: cohort-deploy path for ${user.email} (org=${user.organization}) — admin notified`);
        return res.status(200).json(GENERIC_OK);
      }

      // self-signup: email link path
      // Sanity-check the mailbox is actually deliverable; if not, fall back
      // to the cohort-deploy admin path so the user still gets help.
      let deliverable = true;
      if (isLikelyDeliverable) {
        try { deliverable = await isLikelyDeliverable(user.email); } catch { deliverable = false; }
      }

      if (!deliverable) {
        if (notifyAdminOfCohortReset) {
          notifyAdminOfCohortReset({
            learnerEmail: user.email,
            organization: user.organization,
            requestIp: ip,
          }).catch(err => logger.error(`fallback cohort reset notify failed for ${user.email}: ${err.message}`));
        }
        logger.info(`forgot-password: self-signup but undeliverable email ${user.email} — fell back to admin notification`);
        return res.status(200).json(GENERIC_OK);
      }

      const token = makeToken();
      user.resetToken = token;
      user.resetTokenExpiresAt = new Date(Date.now() + RESET_TTL_MS);
      await user.save();

      const resetUrl = `${PORTAL_URL}/reset-password/${token}`;
      if (sendPasswordResetLink) {
        sendPasswordResetLink({ email: user.email, name: user.name, resetUrl })
          .catch(err => logger.error(`reset email send failed for ${user.email}: ${err.message}`));
      }
      logger.info(`forgot-password: self-signup path for ${user.email} — link sent`);
      return res.status(200).json(GENERIC_OK);
    } catch (err) {
      logger.error(`forgot-password handler error: ${err.message}`);
      // Even on internal error, return generic response.
      return res.status(200).json(GENERIC_OK);
    }
  });

  // ─── Step 2: validate token (UI uses this to show the form or 400) ─────
  router.get('/reset-password/check/:token', async (req, res) => {
    const token = String(req.params?.token || '');
    if (!token) return res.status(400).json({ valid: false });
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiresAt: { $gt: new Date() },
    }).select('email');
    if (!user) return res.status(400).json({ valid: false });
    return res.status(200).json({ valid: true, email: user.email });
  });

  // ─── Step 3: complete reset ────────────────────────────────────────────
  router.post('/reset-password', async (req, res) => {
    try {
      const token = String(req.body?.token || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!token || !newPassword) return res.status(400).json({ message: 'Token and new password are required.' });
      if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });

      const user = await User.findOne({
        resetToken: token,
        resetTokenExpiresAt: { $gt: new Date() },
      });
      if (!user) return res.status(400).json({ message: 'This reset link has expired or is invalid. Please request a new one.' });

      user.password = newPassword;             // pre-save hook hashes
      user.resetToken = undefined;
      user.resetTokenExpiresAt = undefined;
      await user.save();
      logger.info(`reset-password: completed for ${user.email}`);
      return res.status(200).json({ message: 'Your password has been updated. Please sign in.' });
    } catch (err) {
      logger.error(`reset-password handler error: ${err.message}`);
      return res.status(500).json({ message: 'Internal error. Please try again.' });
    }
  });
}

module.exports = { attach };
