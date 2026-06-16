// worker/handlers/gcp-reset-sandbox.js
//
// Bull job handler for the Path-3 GCP project resource recycler.
// Delegates the heavy lifting to services/gcpProjectReset.js which writes
// step-by-step progress to gcpsandboxuser.sandbox[i].reset so the frontend
// can show a live progress bar.
//
// Job payload:
//   { email, projectId, googleEmail, budgetInr, billingAccountId, requiredApis }

const { logger } = require('./../plugins/logger');
const { resetProject } = require('./../services/gcpProjectReset');

const handler = async (job) => {
  const { email, projectId, googleEmail, budgetInr, billingAccountId, requiredApis } = job.data || {};
  if (!email || !projectId) {
    throw new Error('gcp-reset-sandbox: email and projectId are required');
  }

  logger.info(`[gcp-reset-sandbox] start email=${email} project=${projectId}`);

  const result = await resetProject({
    email,
    projectId,
    googleEmail,
    budgetInr: budgetInr || 0,
    billingAccountId: billingAccountId || null,
    requiredApis: requiredApis || [],
  });

  if (!result.ok) {
    // Throw so Bull marks the job failed; the reset service has already
    // written reset.status='failed' + lastError onto Mongo for UI surface.
    throw new Error(result.error || 'reset failed');
  }
  logger.info(`[gcp-reset-sandbox] done email=${email} project=${projectId}`);
  return { ok: true, projectId };
};

module.exports = handler;
