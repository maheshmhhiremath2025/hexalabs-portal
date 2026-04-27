// Worker heartbeat — the other half of the queue-health guard.
//
// Every 15 seconds, each worker process writes `bull:worker-alive` to Redis
// with a 60-second TTL. The backend reads this key before enqueuing; if the
// key is missing (all workers died, wrong Redis, etc.) the backend returns
// 503 with a clear error instead of silently accepting a job that nothing
// will ever process.
//
// We reuse Bull's ioredis client so we don't open a second connection. A
// single shared key is enough — we don't need per-worker presence; we just
// need to know "at least one worker is reaching this Redis".

const HEARTBEAT_KEY = 'bull:worker-alive';
const INTERVAL_MS = 15000;
const TTL_SEC = 60;

function startHeartbeat(queues, logger) {
  const client = Object.values(queues)[0].client;
  const workerId = `${process.env.HOSTNAME || 'worker'}-${process.pid}`;

  const beat = async () => {
    try {
      await client.set(HEARTBEAT_KEY, workerId, 'EX', TTL_SEC);
    } catch (e) {
      logger.error(`[heartbeat] write failed: ${e.message}`);
    }
  };

  // Fire once immediately so backend doesn't see a cold gap at boot.
  beat();
  const iv = setInterval(beat, INTERVAL_MS);

  // On shutdown we deliberately do NOT DEL the key — we let the 60s TTL
  // expire on its own. Otherwise a rolling restart of all 10 workers
  // would DEL simultaneously and the backend would return spurious 503s
  // for ~30s every deploy. The tradeoff: total-worker-death takes up to
  // 60s to detect instead of being instant. That's fine.
  const onShutdown = () => clearInterval(iv);
  process.once('SIGTERM', onShutdown);
  process.once('SIGINT', onShutdown);

  return onShutdown;
}

module.exports = { startHeartbeat, HEARTBEAT_KEY };
