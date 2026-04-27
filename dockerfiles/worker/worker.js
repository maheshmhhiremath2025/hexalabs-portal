const queues = require('./queues');
const { connectMongoDB } = require('./connection');
const { logger } = require('./plugins/logger');
const VM = require('./models/vm');
const { startHeartbeat } = require('./services/heartbeat');

// Use MONGO_URI from env if set, falling back to the docker-compose default.
// The hardcoded path was how we ended up pointing at the wrong DB for
// months — keeping the env-override makes drift visible (worker refuses to
// start with a loud error if the DB is empty; see sanity check below).
const mongoUri = process.env.MONGO_URI || 'mongodb://mongodb:27017/userdb';
const mongoReady = connectMongoDB(mongoUri);

// Import Handlers
const azureCreateVmHandler = require('./handlers/azure-create-vm');
const azureDeleteVmHandler = require('./handlers/azure-delete-vm');
const azureAddPortHandler = require('./handlers/azure-add-port');
const azureRemovePortHandler = require('./handlers/azure-remove-port');
const azureStartVmHandler = require('./handlers/azure-start-vm');
const azureReStartVmHandler = require('./handlers/azure-restart-vm');
const azureStopVmHandler = require('./handlers/azure-stop-vm');
const azureCaptureVmHandler = require('./handlers/azure-vm-capture');
const guacamoleAddHandler = require('./handlers/guacamole-add');
const guacamoleRemoveHandler = require('./handlers/guacamole-remove');
const gcpCreateProjectHandler = require('./handlers/gcp-create-project');
const gcpDeleteProjectHandler = require('./handlers/gcp-delete-project');
const gcpCreateBudgetHandler = require('./handlers/gcp-create-budget');
const gcpDeleteBudgetHandler = require('./handlers/gcp-delete-budget');
const gcpCleanProjectHandler = require('./handlers/gcp-clean-project');
const emailQueueHandler = require('./handlers/email-queue');
const gcpAddBillingHandler = require('./handlers/gcp-add-billing');
const gcpRemoveBillingHandler = require('./handlers/gcp-remove-billing');
const gcpAddUsersHandler = require('./handlers/gcp-add-users');
const azureDeleteSandBoxHandler = require('./handlers/azure-delete-sandbox');
const azureCreateSandBoxHandler = require('./handlers/azure-create-sandbox');
const azureCreateUserHandler = require('./handlers/azure-create-user');
const azureDeleteUserHandler = require('./handlers/azure-delete-user');
const awsCreateUserHandler = require('./handlers/aws-create-user');
const awsDeleteUserHandler = require('./handlers/aws-delete-user');
const meshcentralSetupHandler = require('./handlers/meshcentral-setup');

// Attach Handlers to Queues
queues['azure-create-vm'].process(azureCreateVmHandler);
queues['azure-delete-vm'].process(azureDeleteVmHandler);
queues['azure-add-port'].process(azureAddPortHandler);
queues['azure-remove-port'].process(azureRemovePortHandler);
queues['azure-start-vm'].process(azureStartVmHandler);
queues['azure-restart-vm'].process(azureReStartVmHandler);
queues['azure-stop-vm'].process(azureStopVmHandler);
queues['azure-vm-capture'].process(azureCaptureVmHandler);
queues['guacamole-add'].process(guacamoleAddHandler);
queues['guacamole-remove'].process(guacamoleRemoveHandler);
queues['gcp-create-project'].process(gcpCreateProjectHandler);
queues['gcp-delete-project'].process(gcpDeleteProjectHandler);
queues['gcp-create-budget'].process(gcpCreateBudgetHandler);
queues['gcp-delete-budget'].process(gcpDeleteBudgetHandler);
queues['gcp-clean-project'].process(gcpCleanProjectHandler);
queues['email-queue'].process(emailQueueHandler);
queues['gcp-add-billing'].process(gcpAddBillingHandler);
queues['gcp-remove-billing'].process(gcpRemoveBillingHandler);
queues['gcp-add-users'].process(gcpAddUsersHandler);
queues['azure-delete-sandbox'].process(azureDeleteSandBoxHandler);
queues['azure-create-sandbox'].process(azureCreateSandBoxHandler);
queues['azure-create-user'].process(azureCreateUserHandler);
queues['azure-delete-user'].process(azureDeleteUserHandler);
queues['aws-create-user'].process(awsCreateUserHandler);
queues['aws-delete-user'].process(awsDeleteUserHandler);
queues['meshcentral-setup'].process(meshcentralSetupHandler);

// ─── Failure visibility (Layer 3 of the permanent fix) ────────────────────
// Until today, a queue job throwing an error went to Redis's failed list and
// nowhere else — no DB trace, no UI surface. The Lab Console stayed at "0%"
// forever. Now every terminal failure writes a short summary onto the VM
// doc, and every success clears it, so the row shows *why* a stop/start
// didn't happen. `on('stalled')` fires when a worker crashes mid-job —
// Bull auto-recovers the job, we just log it.
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

// ─── Heartbeat (Layer 1 of the permanent fix) ─────────────────────────────
// Tell the backend we're actually listening on this Redis. If this key ever
// disappears, the backend refuses to enqueue — the user sees a 503 instead
// of a silent "0% progress" limbo.
startHeartbeat(queues, logger);

// ─── Startup DB sanity (Layer 2) ─────────────────────────────────────────
// The 2026-04-21 incident was caused by the worker connecting to a Mongo
// DB named "cloudportal" (empty) while the backend wrote to "userdb" (612
// VMs). Handlers early-returned on every job because "VM not found". If the
// VM collection is empty, something's wrong — refuse to start so the
// operator sees restarting containers instead of a silent failure mode.
// Override with SKIP_VM_COUNT_CHECK=1 for fresh installs.
mongoReady
  .then(async () => {
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
      logger.info(`[startup] ${n} VMs visible — Mongo connection looks healthy (${mongoUri})`);
    } catch (e) {
      logger.error(`[startup] VM.countDocuments failed: ${e.message}`);
    }
  })
  .catch((e) => {
    logger.error(`[startup] Mongo connection failed: ${e.message}. Refusing to start.`);
    process.exit(1);
  });

console.log('Worker started and listening for jobs...');
