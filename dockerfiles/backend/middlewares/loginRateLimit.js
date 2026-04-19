// Login rate limiter — defends against brute-force credential-stuffing.
//
// Strategy: sliding window per (IP) AND per (email). If either identifier
// trips, the request is rejected with 429. Successful login clears the
// counter for the identifier used.
//
// In-memory only — single-process. If you scale to multiple backend nodes,
// replace the Map with a Redis INCR/EXPIRE pattern.
//
// Tunables via env:
//   LOGIN_RATE_MAX    (default 5)    — max failed attempts per window
//   LOGIN_RATE_WINDOW (default 900)  — sliding window in seconds (15 min)
//   LOGIN_RATE_BLOCK  (default 600)  — block duration in seconds (10 min)

const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_MAX)    || 5;
const WINDOW_MS    = (Number(process.env.LOGIN_RATE_WINDOW) || 900) * 1000;
const BLOCK_MS     = (Number(process.env.LOGIN_RATE_BLOCK)  || 600) * 1000;

// key → { count, firstAttempt, blockedUntil }
const attempts = new Map();

// Evict entries once an hour — cheap, keeps memory bounded under attack.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts.entries()) {
    const expired =
      (v.blockedUntil && v.blockedUntil < now) ||
      (!v.blockedUntil && now - v.firstAttempt > WINDOW_MS);
    if (expired) attempts.delete(k);
  }
}, 60 * 60 * 1000).unref();

function keyFromReq(req) {
  // `trust proxy` is already set in index.js so req.ip respects X-Forwarded-For
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = String(req.body?.email || '').toLowerCase().trim();
  return { ipKey: `ip:${ip}`, emailKey: email ? `email:${email}` : null };
}

function statusOf(key) {
  const rec = attempts.get(key);
  if (!rec) return { blocked: false, count: 0 };
  const now = Date.now();
  if (rec.blockedUntil && rec.blockedUntil > now) {
    return { blocked: true, retryAfterSec: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  // Sliding window: reset if first attempt older than window
  if (now - rec.firstAttempt > WINDOW_MS) {
    attempts.delete(key);
    return { blocked: false, count: 0 };
  }
  return { blocked: false, count: rec.count };
}

/**
 * Middleware: rejects with 429 if EITHER the IP or the email is currently
 * blocked. Runs before the login handler.
 */
function checkLoginRateLimit(req, res, next) {
  const { ipKey, emailKey } = keyFromReq(req);
  const ipStatus = statusOf(ipKey);
  const emailStatus = emailKey ? statusOf(emailKey) : { blocked: false };

  const blocked = ipStatus.blocked ? ipStatus : emailStatus.blocked ? emailStatus : null;
  if (blocked) {
    const mins = Math.ceil(blocked.retryAfterSec / 60);
    res.set('Retry-After', String(blocked.retryAfterSec));
    return res.status(429).json({
      message: `Too many login attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
      retryAfterSec: blocked.retryAfterSec,
    });
  }
  next();
}

/** Call from the login handler after a BAD password / invalid user. */
function recordLoginFailure(req) {
  const now = Date.now();
  const { ipKey, emailKey } = keyFromReq(req);
  for (const key of [ipKey, emailKey].filter(Boolean)) {
    const rec = attempts.get(key) || { count: 0, firstAttempt: now };
    // Reset if outside the window
    if (now - rec.firstAttempt > WINDOW_MS) { rec.count = 0; rec.firstAttempt = now; rec.blockedUntil = null; }
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) rec.blockedUntil = now + BLOCK_MS;
    attempts.set(key, rec);
  }
}

/** Call from the login handler on a successful login — clears BOTH counters. */
function recordLoginSuccess(req) {
  const { ipKey, emailKey } = keyFromReq(req);
  attempts.delete(ipKey);
  if (emailKey) attempts.delete(emailKey);
}

module.exports = { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess };
