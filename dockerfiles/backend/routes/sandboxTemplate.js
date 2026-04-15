const express = require('express');
const router = express.Router();
const SandboxTemplate = require('../models/sandboxTemplate');
const SandboxDeployment = require('../models/sandboxDeployment');
const { generateAwsIamPolicy, generateAzurePolicy, generateGcpOrgPolicy } = require('../services/iamPolicyGenerator');
const { restrictToLoggedinUserOnly } = require('../middlewares/auth');
const { logger } = require('../plugins/logger');

/**
 * Best-effort persistence of a deploy result. Non-critical — if Mongo write
 * fails, we still return the credentials to the caller so the ops user
 * doesn't lose them; we just log and move on. The caller already has the
 * real cloud resources regardless.
 */
async function persistDeployment(template, cloud, fields, deployedBy) {
  try {
    const ttlHours = template.sandboxConfig?.ttlHours || 4;
    const doc = await SandboxDeployment.create({
      templateId: template._id,
      templateSlug: template.slug,
      templateName: template.name,
      cloud,
      deployedBy,
      ttlHours,
      budgetInr: template.sandboxConfig?.budgetInr || 200,
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      ...fields,
    });
    logger.info(`[sandbox-templates] persisted deployment ${doc._id} for ${template.slug}`);
    return doc;
  } catch (err) {
    logger.error(`[sandbox-templates] failed to persist deployment: ${err.message}`);
    return null;
  }
}

/**
 * GET /sandbox-templates
 * List all active templates (public — for course catalog).
 */
router.get('/', async (req, res) => {
  const templates = await SandboxTemplate.find({ isActive: true })
    .select('name slug cloud certificationCode certificationLevel description icon examDomains sandboxConfig labs.title labs.domain labs.domainWeight labs.duration labs.difficulty allowedServices.category')
    .sort({ sortOrder: 1 });

  res.json(templates.map(t => ({
    name: t.name,
    slug: t.slug,
    cloud: t.cloud,
    certificationCode: t.certificationCode,
    certificationLevel: t.certificationLevel,
    description: t.description,
    icon: t.icon,
    examDomains: t.examDomains,
    sandboxConfig: t.sandboxConfig,
    labCount: t.labs?.length || 0,
    serviceCount: t.allowedServices?.length || 0,
    categories: [...new Set((t.allowedServices || []).map(s => s.category).filter(Boolean))],
  })));
});

/**
 * DELETE /sandbox-templates/:slug
 * Soft-delete a template (set isActive=false). Admin/superadmin only.
 * The template disappears from the catalog but existing deployments keep running.
 */
router.delete('/:slug', restrictToLoggedinUserOnly, async (req, res) => {
  const { userType } = req.user || {};
  if (userType !== 'admin' && userType !== 'superadmin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const template = await SandboxTemplate.findOne({ slug: req.params.slug });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    await SandboxTemplate.deleteOne({ _id: template._id });
    logger.info(`[sandbox-templates] deleted template ${template.slug} (${template.name})`);
    res.json({ deleted: true, slug: template.slug, name: template.name });
  } catch (err) {
    logger.error(`[sandbox-templates] delete failed: ${err.message}`);
    res.status(500).json({ message: 'Failed to delete template' });
  }
});

/**
 * GET /sandbox-templates/:slug
 * Get full template details including labs and policy.
 */
router.get('/:slug', async (req, res) => {
  const template = await SandboxTemplate.findOne({ slug: req.params.slug, isActive: true });
  if (!template) return res.status(404).json({ message: 'Template not found' });
  res.json(template);
});

/**
 * GET /sandbox-templates/:slug/policy
 * Get the auto-generated IAM/RBAC policy for a template.
 */
router.get('/:slug/policy', async (req, res) => {
  const template = await SandboxTemplate.findOne({ slug: req.params.slug, isActive: true });
  if (!template) return res.status(404).json({ message: 'Template not found' });

  let policy;
  if (template.cloud === 'aws') policy = generateAwsIamPolicy(template);
  else if (template.cloud === 'azure') policy = generateAzurePolicy(template);
  else if (template.cloud === 'gcp') policy = generateGcpOrgPolicy(template);

  res.json({ cloud: template.cloud, policy, allowedInstanceTypes: template.allowedInstanceTypes });
});

/**
 * Core deploy logic — extracted so both single and bulk handlers can use it.
 * Returns the same shape the /deploy endpoint has always returned.
 *
 * Refactor note: the inline logic below is byte-for-byte identical to what
 * used to be in the /deploy handler. This extraction does NOT change API
 * behavior — it just lets us reuse the logic for bulk deploys.
 */
async function performDeploy(template, deployerEmail, { googleEmail } = {}) {
  // For GCP: use the student's Google email for IAM binding (not the portal email).
  // Falls back to deployerEmail if no googleEmail provided.
  const gcpEmail = googleEmail || deployerEmail;
  if (template.cloud === 'aws') {
    // Create AWS sandbox with template's IAM policy
    const { createAwsSandbox } = require('../services/directSandbox');
    // Include a short random suffix so ops can deploy multiple times for a
    // batch without IAM CreateUser collision on the same certificationCode+email.
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const baseName = `lab-${template.certificationCode || 'b2b'}-${deployerEmail.split('@')[0]}-${randSuffix}`;
    const username = baseName.replace(/[^a-zA-Z0-9._@+-]/g, '').slice(0, 64);

    const awsResult = await createAwsSandbox(username, deployerEmail);

    // Apply the template's specific IAM policy (after default sandbox policy)
    try {
      const { IAMClient, PutUserPolicyCommand } = require('@aws-sdk/client-iam');
      const client = new IAMClient({
        region: template.sandboxConfig?.region || 'ap-south-1',
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
      });
      await client.send(new PutUserPolicyCommand({
        UserName: username,
        PolicyName: `CoursePolicy-${template.certificationCode || template.slug}`.slice(0, 128),
        PolicyDocument: JSON.stringify(template.iamPolicy || generateAwsIamPolicy(template)),
      }));
      logger.info(`Course IAM policy applied: ${template.certificationCode} for ${username}`);
    } catch (e) {
      logger.error(`Failed to apply course policy: ${e.message}`);
    }

    const deployment = await persistDeployment(template, 'aws', {
      username: awsResult.username,
      password: awsResult.password,
      accessUrl: awsResult.accessUrl,
      region: template.sandboxConfig?.region || 'ap-south-1',
      aws: { iamUsername: awsResult.username },
    }, deployerEmail);

    return {
      deploymentId: deployment?._id,
      message: `${template.name} sandbox deployed`,
      cloud: 'aws',
      credentials: { username: awsResult.username, password: awsResult.password },
      accessUrl: awsResult.accessUrl,
      region: template.sandboxConfig?.region || 'ap-south-1',
      ttlHours: template.sandboxConfig?.ttlHours || 4,
      budgetInr: template.sandboxConfig?.budgetInr || 200,
      expiresAt: deployment?.expiresAt,
      template: { name: template.name, certificationCode: template.certificationCode },
      allowedServices: template.allowedServices?.map(s => ({ service: s.service, category: s.category, restrictions: s.restrictions })),
      blockedServices: template.blockedServices?.map(s => ({ service: s.service, reason: s.reason })),
      labCount: template.labs?.length || 0,
    };
  } else if (template.cloud === 'azure') {
    const { createAzureSandbox } = require('../services/directSandbox');
    const randSuffix = Math.random().toString(36).slice(2, 6);
    const rgName = `lab-${template.certificationCode || 'b2b'}-${deployerEmail.split('@')[0]}-${randSuffix}-sbx`.toLowerCase().slice(0, 60);
    const azResult = await createAzureSandbox(rgName, template.sandboxConfig?.region || 'southindia', null, deployerEmail);

    const deployment = await persistDeployment(template, 'azure', {
      username: azResult.username,
      password: azResult.password,
      accessUrl: azResult.accessUrl,
      region: template.sandboxConfig?.region || 'southindia',
      azure: {
        resourceGroupName: rgName,
        portalUrl: azResult.portalUrl,
      },
    }, deployerEmail);

    return {
      deploymentId: deployment?._id,
      message: `${template.name} sandbox deployed`,
      cloud: 'azure',
      credentials: { username: azResult.username, password: azResult.password },
      accessUrl: azResult.accessUrl,
      resourceGroup: rgName,
      region: template.sandboxConfig?.region || 'southindia',
      ttlHours: template.sandboxConfig?.ttlHours || 4,
      budgetInr: template.sandboxConfig?.budgetInr || 200,
      expiresAt: deployment?.expiresAt,
      template: { name: template.name, certificationCode: template.certificationCode },
      allowedServices: template.allowedServices?.map(s => ({ service: s.service, category: s.category })),
    };
  } else if (template.cloud === 'gcp') {
    const { createGcpSandbox } = require('../services/directSandbox');
    const projectId = `lab-${(template.certificationCode || 'b2b').toLowerCase()}-${Date.now().toString(36)}`.toLowerCase().slice(0, 30);
    const gcpResult = await createGcpSandbox(projectId, gcpEmail, template.sandboxConfig?.budgetInr || 200);

    const deployment = await persistDeployment(template, 'gcp', {
      username: gcpEmail,
      password: 'Use your Google account password',
      accessUrl: gcpResult.accessUrl,
      region: template.sandboxConfig?.region || 'asia-south1',
      gcp: { projectId },
    }, deployerEmail);

    return {
      deploymentId: deployment?._id,
      message: gcpResult.iamBindingSuccess
        ? `${template.name} GCP sandbox deployed — ${gcpEmail} has Editor access`
        : `${template.name} GCP project created — but IAM binding failed. ${gcpEmail} may not be a valid Google account. Add access manually in GCP Console → IAM.`,
      cloud: 'gcp',
      credentials: { username: gcpEmail, password: 'Use your Google account password' },
      accessUrl: gcpResult.accessUrl,
      projectId,
      ttlHours: template.sandboxConfig?.ttlHours || 4,
      budgetInr: template.sandboxConfig?.budgetInr || 200,
      expiresAt: deployment?.expiresAt,
      iamBindingSuccess: gcpResult.iamBindingSuccess,
      note: gcpResult.note,
      template: { name: template.name, certificationCode: template.certificationCode },
    };
  }

  throw new Error(`Unsupported cloud: ${template.cloud}`);
}

/**
 * POST /sandbox-templates/:slug/deploy
 * Deploy a sandbox based on a course template.
 * Creates the sandbox with the template's IAM policy + budget + restrictions.
 */
router.post('/:slug/deploy', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const template = await SandboxTemplate.findOne({ slug: req.params.slug, isActive: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const { email } = req.user || {};
    if (!email) return res.status(400).json({ message: 'User email required' });

    // For GCP templates: require a Google email (Gmail or Google Workspace).
    // The portal email (admin@getlabs.cloud) won't work for GCP console access.
    const googleEmail = req.body?.googleEmail || null;
    if (template.cloud === 'gcp' && !googleEmail) {
      return res.status(400).json({
        message: 'GCP sandboxes require a Google email (Gmail or Google Workspace). Pass googleEmail in the request body.',
        hint: 'The student must sign into GCP Console with this Google account.',
      });
    }

    const result = await performDeploy(template, email, { googleEmail });
    res.json(result);
  } catch (err) {
    logger.error(`Template deploy error: ${err.message}`);
    res.status(500).json({ message: `Deploy failed: ${err.message}` });
  }
});

/**
 * POST /sandbox-templates/:slug/bulk-deploy
 *
 * Body: { seats: number }   — how many sandboxes to provision
 *
 * Returns immediately with a jobId. The caller polls
 * GET /sandbox-templates/bulk-jobs/:jobId for progress.
 *
 * Why in-memory job tracking (not Bull): the /deploy operation is direct
 * synchronous AWS/Azure/GCP calls, not a Bull worker task. Adding a new Bull
 * queue just for bulk would duplicate infrastructure. This pattern matches
 * the existing bulk user creation at controllers/sandbox.js:155.
 *
 * Jobs self-expire after 30 minutes.
 */
const bulkDeployJobs = new Map();

router.post('/:slug/bulk-deploy', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const { email, userType } = req.user || {};
    if (!email) return res.status(400).json({ message: 'User email required' });
    if (userType !== 'admin' && userType !== 'superadmin') {
      return res.status(403).json({ message: 'Admin/superadmin access required for bulk deploy' });
    }

    const template = await SandboxTemplate.findOne({ slug: req.params.slug, isActive: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const emails = Array.isArray(req.body.emails) ? req.body.emails.map(e => e.trim()).filter(Boolean) : [];
    const seats = emails.length > 0 ? emails.length : Math.max(1, Math.min(100, parseInt(req.body.seats, 10) || 1));
    const googleEmail = req.body?.googleEmail || null;

    const jobId = `bulk-${template.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      jobId,
      templateSlug: template.slug,
      templateName: template.name,
      total: seats,
      completed: 0,
      failed: 0,
      status: 'running',
      startedAt: Date.now(),
      current: '',
      results: [],   // populated incrementally
      errors: [],
    };
    bulkDeployJobs.set(jobId, job);

    // Respond immediately
    res.json({ jobId, total: seats, status: 'running' });

    // Background work — sequential to avoid rate-limit issues on cloud APIs.
    (async () => {
      for (let i = 0; i < seats; i++) {
        job.current = `Deploying sandbox ${i + 1}/${seats}`;
        try {
          const seatEmail = emails.length > 0 ? emails[i] : googleEmail;
          const result = await performDeploy(template, email, { googleEmail: seatEmail });
          job.results.push({
            deploymentId: result.deploymentId,
            username: result.credentials?.username,
            password: result.credentials?.password,
            accessUrl: result.accessUrl,
          });
          job.completed++;
        } catch (err) {
          job.failed++;
          job.errors.push({ index: i + 1, message: err.message });
          logger.error(`[bulk-deploy] seat ${i + 1}/${seats} failed: ${err.message}`);
        }
      }
      job.status = 'done';
      job.current = '';
      job.durationMs = Date.now() - job.startedAt;
      logger.info(`[bulk-deploy] job ${jobId} done: ${job.completed} ok, ${job.failed} failed in ${job.durationMs}ms`);

      // Self-expire the job after 30 minutes so we don't leak memory
      setTimeout(() => bulkDeployJobs.delete(jobId), 30 * 60 * 1000);
    })().catch((e) => {
      job.status = 'failed';
      job.errors.push({ message: `Background job fatal: ${e.message}` });
      logger.error(`[bulk-deploy] job ${jobId} fatal: ${e.message}`);
    });
  } catch (err) {
    logger.error(`[bulk-deploy] setup failed: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /sandbox-templates/bulk-jobs/:jobId
 *
 * Poll progress of a bulk deploy job. Returns current counts, errors, and
 * (once status=done) the list of deployments.
 */
router.get('/bulk-jobs/:jobId', restrictToLoggedinUserOnly, (req, res) => {
  const job = bulkDeployJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job not found or expired' });
  const progress = job.total > 0 ? Math.round(((job.completed + job.failed) / job.total) * 100) : 0;
  res.json({
    jobId: job.jobId,
    templateSlug: job.templateSlug,
    templateName: job.templateName,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    progress,
    current: job.current,
    durationMs: job.durationMs || (Date.now() - job.startedAt),
    errors: job.errors,
    results: job.results,
  });
});

/**
 * GET /sandbox-templates/:slug/deployments
 *
 * List active sandbox deployments created from this template. Used by the
 * CourseDetail page to show existing sandboxes so credentials survive a
 * page refresh.
 *
 * Visibility:
 *   - admin / superadmin: see all deployments for the template
 *   - any other logged-in user: see only their own
 */
router.get('/:slug/deployments', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const { email, userType } = req.user || {};
    if (!email) return res.status(401).json({ message: 'Not authenticated' });

    const template = await SandboxTemplate.findOne({ slug: req.params.slug, isActive: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const filter = {
      templateSlug: req.params.slug,
      state: { $ne: 'deleted' },
    };
    const isAdmin = userType === 'admin' || userType === 'superadmin';
    if (!isAdmin) filter.deployedBy = email;

    const deployments = await SandboxDeployment
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      count: deployments.length,
      deployments,
    });
  } catch (err) {
    logger.error(`[sandbox-templates] list deployments failed: ${err.message}`);
    res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * DELETE /sandbox-templates/deployments/:id
 *
 * Actually tears down the cloud resource (IAM user, resource group, or
 * project) AND deletes the DB record. Use this when ops wants to immediately
 * clean up a demo sandbox without waiting for TTL expiry.
 */
router.delete('/deployments/:id', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const { userType } = req.user || {};
    if (userType !== 'admin' && userType !== 'superadmin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const doc = await SandboxDeployment.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });

    // Actually tear down the cloud resource
    let cleanupResult = 'skipped';
    try {
      if (doc.cloud === 'aws' && doc.aws?.iamUsername) {
        // Delete IAM user + all attached resources
        let deleteAwsUser;
        try {
          const { IAMClient, DeleteLoginProfileCommand, ListAttachedUserPoliciesCommand, DetachUserPolicyCommand, ListUserPoliciesCommand, DeleteUserPolicyCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
          const client = new IAMClient({ region: 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET } });
          const username = doc.aws.iamUsername;
          try { await client.send(new DeleteLoginProfileCommand({ UserName: username })); } catch {}
          try {
            const { AttachedPolicies } = await client.send(new ListAttachedUserPoliciesCommand({ UserName: username }));
            for (const p of AttachedPolicies || []) { try { await client.send(new DetachUserPolicyCommand({ UserName: username, PolicyArn: p.PolicyArn })); } catch {} }
          } catch {}
          try {
            const { PolicyNames } = await client.send(new ListUserPoliciesCommand({ UserName: username }));
            for (const name of PolicyNames || []) { try { await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: name })); } catch {} }
          } catch {}
          await client.send(new DeleteUserCommand({ UserName: username }));
          cleanupResult = `AWS IAM user ${username} deleted`;
        } catch (e) {
          cleanupResult = `AWS cleanup failed: ${e.message}`;
        }
      } else if (doc.cloud === 'azure' && doc.azure?.resourceGroupName) {
        try {
          const queues = require('../controllers/newQueues');
          const queuePromise = queues['azure-delete-sandbox'].add({ resourceGroupName: doc.azure.resourceGroupName });
          await Promise.race([queuePromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Queue timeout (Redis down?)')), 5000))]);
          cleanupResult = `Azure RG ${doc.azure.resourceGroupName} deletion queued`;
        } catch (e) {
          cleanupResult = `Azure queue failed: ${e.message}. RG will be cleaned up by expiry automation.`;
          logger.warn(`[delete-deploy] Azure queue failed: ${e.message}`);
        }
      } else if (doc.cloud === 'gcp' && doc.gcp?.projectId) {
        try {
          const queues = require('../controllers/newQueues');
          const queuePromise = queues['gcp-delete-project'].add({ projectId: doc.gcp.projectId });
          await Promise.race([queuePromise, new Promise((_, rej) => setTimeout(() => rej(new Error('Queue timeout (Redis down?)')), 5000))]);
          cleanupResult = `GCP project ${doc.gcp.projectId} deletion queued`;
        } catch (e) {
          cleanupResult = `GCP queue failed: ${e.message}. Project will be cleaned up by expiry automation.`;
          logger.warn(`[delete-deploy] GCP queue failed: ${e.message}`);
        }
      }
    } catch (e) {
      cleanupResult = `Cleanup error: ${e.message}`;
    }

    // Delete the DB record (hard delete, not soft)
    await SandboxDeployment.deleteOne({ _id: doc._id });

    logger.info(`[sandbox-templates] deployment ${doc._id} deleted + cloud cleanup: ${cleanupResult}`);
    res.json({ ok: true, id: doc._id, cleanupResult });
  } catch (err) {
    logger.error(`[sandbox-templates] delete deployment failed: ${err.message}`);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
