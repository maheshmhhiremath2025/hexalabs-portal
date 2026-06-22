// Bootstrap order matters here. The 2026-05-23 outage was caused by the
// previous version doing all 25+ handler requires() synchronously BEFORE the
// mongoose connect Promise could resolve — the require-storm starved the
// event loop, mongoose's internal "server selection" timer fired before the
// handshake completed, and the worker bailed with "Refusing to start". Now:
//   1. Connect to Mongo first (event loop is free, handshake finishes in <5s)
//   2. Sanity-check the DB
//   3. Then require handlers + attach to queues
//   4. Then attach failure listeners + heartbeat

const queues = require('./queues');
const { connectMongoDB } = require('./connection');
const { logger } = require('./plugins/logger');
const VM = require('./models/vm');
const { startHeartbeat } = require('./services/heartbeat');
const { startTrainingMonitor } = require('./services/trainingMonitor');

const mongoUri = process.env.MONGO_URI || 'mongodb://mongodb:27017/userdb';

(async () => {
  // 1. Connect to Mongo FIRST. Nothing else has been required yet beyond
  //    queues/logger/VM model/heartbeat — the event loop is wide open, so
  //    the handshake completes quickly.
  try {
    await connectMongoDB(mongoUri);
    const redactedUri = mongoUri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@"); logger.info(`[startup] Mongo connected (${redactedUri})`);
  } catch (e) {
    logger.error(`[startup] Mongo connection failed: ${e.message}. Refusing to start.`);
    process.exit(1);
  }

  // 2. Startup DB sanity. The 2026-04-21 incident was caused by the worker
  //    connecting to a Mongo DB named "cloudportal" (empty) while the
  //    backend wrote to "userdb" (612 VMs). Handlers early-returned on every
  //    job because "VM not found". If the VM collection is empty, something
  //    is wrong — refuse to start so the operator sees restarting containers
  //    instead of a silent failure mode. Override with SKIP_VM_COUNT_CHECK=1.
  try {
    const n = await VM.countDocuments({});
    if (n === 0 && process.env.SKIP_VM_COUNT_CHECK !== '1') {
      logger.error(
        'STARTUP SANITY FAILED: VM collection is empty. This usually means the ' +
        'worker is connected to the wrong Mongo database. Refusing to start. ' +
        'Set SKIP_VM_COUNT_CHECK=1 to bypass (fresh install only).'
      );
      process.exit(1);
    }
    logger.info(`[startup] ${n} VMs visible — Mongo connection looks healthy`);
  } catch (e) {
    logger.error(`[startup] VM.countDocuments failed: ${e.message}`);
  }

  // 3. NOW require handlers + attach to queues. Synchronous requires here
  //    are safe because Mongo is already connected and no async work is in
  //    flight that can be starved.
  const handlerMap = {
    'azure-create-vm':     require('./handlers/azure-create-vm'),
    'aws-create-vm':       require('./handlers/aws-create-vm'),
    'aws-start-vm':        require('./handlers/aws-start-vm'),
    'aws-stop-vm':         require('./handlers/aws-stop-vm'),
    'aws-delete-vm':       require('./handlers/aws-delete-vm'),
    'aws-workshop-build':      require('./handlers/aws-workshop-build'),
    'aws-workshop-resize':     require('./handlers/aws-workshop-resize'),
    'aws-workshop-grow-disk':  require('./handlers/aws-workshop-grow-disk'),
    'aws-workshop-snapshot':   require('./handlers/aws-workshop-snapshot'),
    'azure-delete-vm':     require('./handlers/azure-delete-vm'),
    'azure-add-port':      require('./handlers/azure-add-port'),
    'azure-remove-port':   require('./handlers/azure-remove-port'),
    'azure-start-vm':      require('./handlers/azure-start-vm'),
    'azure-restart-vm':    require('./handlers/azure-restart-vm'),
    'azure-stop-vm':       require('./handlers/azure-stop-vm'),
    'azure-vm-capture':    require('./handlers/azure-vm-capture'),
    'guacamole-add':       require('./handlers/guacamole-add'),
    'guacamole-remove':    require('./handlers/guacamole-remove'),
    'gcp-create-project':  require('./handlers/gcp-create-project'),
    'gcp-delete-project':  require('./handlers/gcp-delete-project'),
    'gcp-create-budget':   require('./handlers/gcp-create-budget'),
    'gcp-delete-budget':   require('./handlers/gcp-delete-budget'),
    'gcp-clean-project':   require('./handlers/gcp-clean-project'),
    'gcp-reset-sandbox':   require('./handlers/gcp-reset-sandbox'),
    'email-queue':         require('./handlers/email-queue'),
    'gcp-add-billing':     require('./handlers/gcp-add-billing'),
    'gcp-remove-billing':  require('./handlers/gcp-remove-billing'),
    'gcp-add-users':       require('./handlers/gcp-add-users'),
    'azure-delete-sandbox':require('./handlers/azure-delete-sandbox'),
    'azure-create-sandbox':require('./handlers/azure-create-sandbox'),
    'azure-create-user':   require('./handlers/azure-create-user'),
    'azure-delete-user':   require('./handlers/azure-delete-user'),
    'aws-create-user':     require('./handlers/aws-create-user'),
    'aws-delete-user':     require('./handlers/aws-delete-user'),
  };

  // Per-queue concurrency. RG/user/project deletions are I/O-bound (they just
  // await Azure/AWS/GCP), so running many in parallel drains cohort-expiry
  // backlogs in minutes instead of hours. Everything else stays serialized (1).
  const QUEUE_CONCURRENCY = {
    'azure-delete-sandbox': 10,
    'azure-delete-user':     5,
    'aws-delete-user':       5,
    'gcp-delete-project':    5,
    'gcp-clean-project':     5,
  };
  for (const [name, handler] of Object.entries(handlerMap)) {
    queues[name].process(QUEUE_CONCURRENCY[name] || 1, handler);
  }

  // 4. Failure visibility — until the 2026-05 fix, a queue job throwing an
  //    error went to Redis's failed list and nowhere else: no DB trace, no
  //    UI surface. The Lab Console stayed at "0%" forever. Now every
  //    terminal failure writes a short summary onto the VM doc and every
  //    success clears it, so the row shows *why* a stop/start didn't
  //    happen. on('stalled') fires when a worker crashes mid-job — Bull
  //    auto-recovers the job, we just log it.
  for (const [name, queue] of Object.entries(queues)) {
    queue.on('failed', async (job, err) => {
      const msg = (err && err.message) || String(err);
      logger.error(`[queue:${name}] job ${job && job.id} FAILED: ${msg}`);
      const vmName = job && job.data && job.data.name;
      if (!vmName) return;
      try {
        await VM.updateOne(
          { name: vmName },
          { $set: {
              lastOpError: msg.slice(0, 500),
              lastOpErrorQueue: name,
              lastOpErrorAt: new Date(),
          }}
        );
      } catch (e) {
        logger.error(`[queue:${name}] could not record lastOpError for ${vmName}: ${e.message}`);
      }
    });

    queue.on('completed', async (job) => {
      const vmName = job && job.data && job.data.name;
      if (!vmName) return;
      try {
        await VM.updateOne(
          { name: vmName },
          { $unset: { lastOpError: 1, lastOpErrorQueue: 1, lastOpErrorAt: 1 } }
        );
      } catch { /* best effort — stale error chip is better than a crash loop */ }
    });

    queue.on('stalled', (jobId) => {
      logger.warn(`[queue:${name}] job ${jobId} STALLED (worker crashed mid-job; Bull will re-queue)`);
    });
  }

  // 5. Heartbeat — tell the backend we're actually listening on this Redis.
  //    If this key ever disappears, the backend refuses to enqueue — the
  //    user sees a 503 instead of a silent "0% progress" limbo.
  startHeartbeat(queues, logger);
  startTrainingMonitor(queues, logger);

  console.log('Worker started and listening for jobs...');
})().catch((e) => {
  logger.error(`[startup] Fatal: ${e.message}`);
  process.exit(1);
});
