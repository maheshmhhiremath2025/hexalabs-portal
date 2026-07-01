// services/trainingMonitor.js
//
// Monitors always-on training VMs every 30 seconds.
// If a Spot VM gets evicted (deallocated), it queues an azure-start-vm job
// to bring it back automatically.

const { ComputeManagementClient } = require('@azure/arm-compute');
const { ClientSecretCredential } = require('@azure/identity');
const VM = require('../models/vm');

const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);
const computeClient = new ComputeManagementClient(credential, process.env.SUBSCRIPTION_ID);

// Training names that must run 24/7 — add more as needed
const ALWAYS_ON_TRAININGS = ['trnrocky'];

const INTERVAL_MS = 30 * 1000;
const API_TIMEOUT_MS = 15 * 1000; // 15s timeout per Azure API call

let isChecking = false;

/** Wraps a promise with a timeout so it never hangs forever */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function checkAndRestart(queues, logger) {
  if (isChecking) return;
  isChecking = true;

  try {
    const vms = await VM.find(
      { trainingName: { $in: ALWAYS_ON_TRAININGS }, isAlive: true },
      'name resourceGroup isRunning stoppingUntil'
    ).lean();

    if (!vms.length) return;

    logger.info(`[trainingMonitor] Checking ${vms.length} VMs...`);

    for (const vm of vms) {
      try {
        // Skip if a stop cooldown is still active
        if (vm.stoppingUntil && new Date(vm.stoppingUntil) > new Date()) continue;

        // Get Azure power state (with timeout to prevent hangs)
        const azVm = await withTimeout(
          computeClient.virtualMachines.get(vm.resourceGroup, vm.name, { expand: 'instanceView' }),
          API_TIMEOUT_MS,
          `get ${vm.name}`
        );
        const statuses = azVm.instanceView?.statuses || [];
        const ps = statuses.find(s => s.code?.startsWith('PowerState/'));
        const powerState = ps?.code?.replace('PowerState/', '') || 'unknown';

        if (powerState === 'deallocated' || powerState === 'stopped') {
          logger.info(`[trainingMonitor] ${vm.name} is ${powerState} — queuing restart`);

          // Mark as not running so the start handler doesn't skip it
          await VM.updateOne({ name: vm.name }, { $set: { isRunning: false } });

          // Avoid duplicate queuing
          const startQueue = queues['azure-start-vm'];
          const waiting = await startQueue.getWaiting();
          const active  = await startQueue.getActive();
          const alreadyQueued = [...waiting, ...active].some(j => j.data.name === vm.name);

          if (!alreadyQueued) {
            await startQueue.add({ name: vm.name, resourceGroup: vm.resourceGroup });
            logger.info(`[trainingMonitor] ${vm.name} restart queued`);
          } else {
            logger.info(`[trainingMonitor] ${vm.name} already in queue — skipping`);
          }
        }
      } catch (vmErr) {
        if (vmErr.statusCode === 404) {
          logger.warn(`[trainingMonitor] ${vm.name} not found in Azure (deleted?) — skipping`);
        } else {
          logger.error(`[trainingMonitor] ${vm.name}: ${vmErr.message}`);
        }
      }
    }

    logger.info(`[trainingMonitor] Check complete`);
  } catch (err) {
    logger.error(`[trainingMonitor] check error: ${err.message}`);
  } finally {
    isChecking = false;
  }
}

function startTrainingMonitor(queues, logger) {
  logger.info(`[trainingMonitor] Started — watching: ${ALWAYS_ON_TRAININGS.join(', ')} (every ${INTERVAL_MS / 1000}s)`);
  setInterval(() => checkAndRestart(queues, logger), INTERVAL_MS);
}

module.exports = { startTrainingMonitor };
