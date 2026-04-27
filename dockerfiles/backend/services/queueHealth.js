// Queue-health guard — makes silent queue failure impossible.
//
// Problem we're solving: backend enqueues Bull jobs into Redis. If no worker
// is listening on that Redis (stale docker-compose pointing at the wrong
// redis, worker process crashed, Redis split-brain — we've seen all three),
// the job just sits in the queue forever and the UI shows "0/1 started"
// with no error. That was the core reason Start/Stop "kept breaking" for
// months.
//
// Fix: workers write `bull:worker-alive` to Redis every 15s with a 60s TTL.
// The backend reads it *before* enqueuing — no heartbeat means no worker,
// so we return 503 with a clear message instead of dropping the job into
// the void.

const queues = require('../controllers/newQueues');
const { logger } = require('../plugins/logger');

const HEARTBEAT_KEY = 'bull:worker-alive';
const CACHE_TTL_MS = 5000; // cache Redis read for 5s to avoid per-request hit

let cachedAlive = null;
let cachedAt = 0;

async function redisClient() {
  // Reuse Bull's ioredis connection so we don't open a second one.
  const q = Object.values(queues)[0];
  if (!q) throw new Error('no queues configured');
  return q.client;
}

async function isWorkerAlive() {
  const now = Date.now();
  if (cachedAlive !== null && now - cachedAt < CACHE_TTL_MS) return cachedAlive;
  try {
    const client = await redisClient();
    const v = await client.get(HEARTBEAT_KEY);
    cachedAlive = !!v;
    cachedAt = now;
    return cachedAlive;
  } catch (e) {
    logger.error(`[queueHealth] redis check failed: ${e.message}`);
    // Treat Redis-unreachable as "not alive" — refusing the enqueue is
    // safer than accepting it when we can't even verify the plumbing.
    cachedAlive = false;
    cachedAt = now;
    return false;
  }
}

// Express middleware. Attach to every route that enqueues into Bull.
function requireWorker(req, res, next) {
  isWorkerAlive().then((alive) => {
    if (alive) return next();
    res.status(503).json({
      error:
        'Queue workers are not processing jobs right now. ' +
        'Your request was NOT queued. Please contact ops ' +
        '(itops@synergificsoftware.com) or try again in a minute.',
    });
  }).catch(next);
}

module.exports = { isWorkerAlive, requireWorker, HEARTBEAT_KEY };
