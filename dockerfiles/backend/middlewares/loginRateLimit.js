// Login rate limiter v2 — Redis-backed, per-email only.
//
// Why "per-email only": v1 counted attempts per IP too. In a classroom
// behind NAT (30 students share one public IP), a handful of password
// fumbles tripped the IP bucket for everyone — right-password students
// got locked out alongside the fumblers. That was the wrong trade-off.
//
// v2 tracks only per-email. Student Raj's wrong password doesn't affect
// student Priya. Persisted in Redis so backend reloads don't reset the
// counters (v1 lost state on every pm2 reload).
//
// Admins can POST /admin/login-rate-limit/unlock to clear a specific
// email's counter.
//
// Tunables via env:
//   LOGIN_RATE_MAX    (default 8)    — failed attempts before block
//   LOGIN_RATE_WINDOW (default 900)  — sliding window in seconds (15 min)
//   LOGIN_RATE_BLOCK  (default 600)  — block duration in seconds (10 min)

const Redis = require('ioredis');
const { logger } = require('../plugins/logger');

const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_MAX)    || 8;
const WINDOW_SEC   = Number(process.env.LOGIN_RATE_WINDOW) || 900;
const BLOCK_SEC    = Number(process.env.LOGIN_RATE_BLOCK)  || 600;

const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  // If Redis is unreachable, DON'T block login — fail-open is safer than
  // locking out every user during a Redis outage.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});
redis.on('error', (err) => {
  // Swallow: every request check handles its own try/catch already.
  logger.warn(`[login-rate] redis error: ${err.message}`);
});
redis.connect().catch(() => {});   // best-effort initial connect

function emailKey(email) { return `login:fail:${String(email).toLowerCase().trim()}`; }
function blockKey(email) { return `login:block:${String(email).toLowerCase().trim()}`; }

async function getStatus(email) {
  if (!email) return { blocked: false, count: 0 };
  try {
    const [[, blockedUntil], [, count]] = await redis.multi()
      .get(blockKey(email))
      .get(emailKey(email))
      .exec();
    const now = Date.now();
    if (blockedUntil && Number(blockedUntil) > now) {
      return { blocked: true, retryAfterSec: Math.ceil((Number(blockedUntil) - now) / 1000) };
    }
    return { blocked: false, count: Number(count) || 0 };
  } catch (e) {
    // Redis unreachable — fail-open, don't block.
    return { blocked: false, count: 0 };
  }
}

/**
 * Middleware: 429 if the EMAIL (not IP) is currently blocked.
 */
async function checkLoginRateLimit(req, res, next) {
  const email = req.body?.email;
  if (!email) return next();  // let the handler return "email required"
  const status = await getStatus(email);
  if (status.blocked) {
    const mins = Math.ceil(status.retryAfterSec / 60);
    res.set('Retry-After', String(status.retryAfterSec));
    return res.status(429).json({
      message: `Too many login attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or contact your admin to unlock.`,
      retryAfterSec: status.retryAfterSec,
    });
  }
  next();
}

/** Call from the login handler on a BAD password. */
async function recordLoginFailure(req) {
  const email = req.body?.email;
  if (!email) return;
  try {
    const k = emailKey(email);
    const count = await redis.incr(k);
    // First failure: start the sliding window timer.
    if (count === 1) await redis.expire(k, WINDOW_SEC);
    if (count >= MAX_ATTEMPTS) {
      const until = Date.now() + BLOCK_SEC * 1000;
      await redis.set(blockKey(email), String(until), 'EX', BLOCK_SEC);
      logger.warn(`[login-rate] ${email} locked after ${count} fails`);
    }
  } catch (e) { /* Redis down, fail-open */ }
}

/** Call on successful login — clears the email's counters. */
async function recordLoginSuccess(req) {
  const email = req.body?.email;
  if (!email) return;
  try { await redis.del(emailKey(email), blockKey(email)); } catch {}
}

/** Admin/superadmin-triggered unlock. Idempotent. */
async function unlockEmail(email) {
  if (!email) return { ok: false, reason: 'email required' };
  try {
    const deleted = await redis.del(emailKey(email), blockKey(email));
    logger.info(`[login-rate] manual unlock: ${email} (cleared ${deleted} keys)`);
    return { ok: true, cleared: deleted };
  } catch (e) {
    return { ok: false, reason: 'redis unreachable' };
  }
}

/** Debug helper for the admin unlock endpoint. */
async function getEmailStatus(email) {
  return getStatus(email);
}

module.exports = {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  unlockEmail,
  getEmailStatus,
};
