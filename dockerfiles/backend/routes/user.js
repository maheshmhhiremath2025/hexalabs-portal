const express = require('express');
const { logger } = require('./../plugins/logger');
const {handleUserLogin, handleUserLogout} = require('./../controllers/user')
const { restrictToLoggedinUserOnly } = require('./../middlewares/auth');
const { checkLoginRateLimit } = require('./../middlewares/loginRateLimit');
const awsUser = require('./../models/aws');
const SandboxUser = require('./../models/sandboxuser');
const GcpSandboxUser = require('./../models/gcpSandboxUser');
const OciSandboxUser = require('./../models/ociSandboxUser');
const SandboxDeployment = require('./../models/sandboxDeployment');
const SandboxTemplate = require('./../models/sandboxTemplate');
const { createAwsSandbox, createAzureSandbox, createGcpSandbox } = require('./../services/directSandbox');
const { createOciSandbox } = require('./../services/ociSandbox');

// Grant the OAC ServiceAdministrator app role on the analytics instance to a
// freshly-created IDCS domain user. createOciSandbox provisions the user but
// does not assign any OAC role, so without this the user can authenticate but
// gets a permissions wall inside Oracle Analytics.
async function grantOacServiceAdminByUsername(username) {
  const idcsUrl = (process.env.OCI_IDCS_URL || '').replace(/\/+$/, '');
  const clientId = process.env.OCI_IDCS_CLIENT_ID;
  const clientSecret = process.env.OCI_IDCS_CLIENT_SECRET;
  if (!idcsUrl || !clientId || !clientSecret) {
    throw new Error('OCI_IDCS_URL/CLIENT_ID/CLIENT_SECRET not configured');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(`${idcsUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=urn:opc:idm:__myscopes__',
  });
  if (!tokenRes.ok) throw new Error(`IDCS token: ${tokenRes.status} ${await tokenRes.text()}`);
  const token = (await tokenRes.json()).access_token;
  const auth = { 'Authorization': `Bearer ${token}` };

  const userQ = await fetch(`${idcsUrl}/admin/v1/Users?filter=${encodeURIComponent(`userName eq "${username}"`)}&attributes=id`, { headers: auth });
  const userJson = await userQ.json();
  const userId = userJson.Resources?.[0]?.id;
  if (!userId) throw new Error(`IDCS user not found: ${username}`);

  const appQ = await fetch(`${idcsUrl}/admin/v1/Apps?filter=${encodeURIComponent('serviceTypeURN eq "ANALYTICSINST" and isAliasApp eq false')}&attributes=id,name`, { headers: auth });
  const appJson = await appQ.json();
  const oacApp = (appJson.Resources || []).find(a => /APPID$/.test(a.name) && !/SERVICE_INSTANCE_ADMIN_APPID/.test(a.name));
  if (!oacApp) throw new Error('OAC analytics instance app not found in IDCS');

  const roleQ = await fetch(`${idcsUrl}/admin/v1/AppRoles?filter=${encodeURIComponent(`app.value eq "${oacApp.id}" and displayName eq "ServiceAdministrator"`)}&attributes=id`, { headers: auth });
  const roleJson = await roleQ.json();
  const roleId = roleJson.Resources?.[0]?.id;
  if (!roleId) throw new Error('ServiceAdministrator role not found on OAC app');

  const grantRes = await fetch(`${idcsUrl}/admin/v1/Grants`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/scim+json' },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:oracle:idcs:Grant'],
      grantee: { value: userId, type: 'User' },
      app: { value: oacApp.id },
      entitlement: { attributeName: 'appRoles', attributeValue: roleId },
      grantMechanism: 'ADMINISTRATOR_TO_USER',
    }),
  });
  if (!grantRes.ok) throw new Error(`grant: ${grantRes.status} ${await grantRes.text()}`);
}

const router = express.Router();

// Per-user mutex for /relaunch-sandbox. Rapid double-clicks were creating
// orphan Azure RGs and Mongoose VersionErrors (2026-05-06 incident).
const relaunchInFlight = new Set();

router.post('/login', checkLoginRateLimit, handleUserLogin);
// Public password-reset routes (no auth) — see ./_forgot_password.js
require('./_forgot_password').attach(router);

router.post('/logout', handleUserLogout);

/**
 * GET /user/my-sandboxes
 *
 * Returns all active sandboxes for the logged-in user across AWS, Azure, GCP.
 * Queries both legacy per-cloud user models and the SandboxDeployment collection.
 * Strips budget/cost fields — students should never see those.
 */
router.get('/has-lab-resources', restrictToLoggedinUserOnly, async (req, res) => {
  // Lightweight count: does the caller own at least one VM or Container?
  // Used by the sidebar to hide Lab Console for pure-sandbox learners.
  try {
    const email = req.user.email;
    const VM = require('./../models/vm');
    const Container = require('./../models/container');
    const vmCount = await VM.countDocuments({ email, isAlive: { $ne: false } });
    if (vmCount > 0) return res.json({ hasResources: true });
    const containerCount = await Container.countDocuments({ email, isAlive: { $ne: false } });
    return res.json({ hasResources: containerCount > 0 });
  } catch (err) {
    // On error, fail open (show Lab Console) — safer than hiding a real lab.
    return res.json({ hasResources: true, error: 'count-failed' });
  }
});

router.get('/my-sandboxes', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ message: 'Not authenticated' });

    const now = new Date();
    const sandboxes = [];

    // Helper: compute hours used today (IST midnight to midnight)
    const getISTMidnight = () => {
      const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      nowIST.setHours(0, 0, 0, 0);
      // Convert back to UTC
      const offsetMs = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
      return new Date(nowIST.getTime() + offsetMs);
    };
    const todayMidnightIST = getISTMidnight();

    const calcUsageToday = (sessions, templateSlug) => {
      if (!sessions?.length) return 0;
      return sessions
        .filter(s => s.startedAt >= todayMidnightIST && (!templateSlug || s.templateSlug === templateSlug))
        .reduce((sum, s) => sum + (s.ttlHours || 0), 0);
    };

    // --- AWS sandboxes (awsuser collection) ---
    const awsDocs = await awsUser.find({ email }).lean();
    for (const awsDoc of awsDocs) {
      const expiry = awsDoc.expiresAt || awsDoc.endDate || null;
      const isExpired = expiry && new Date(expiry) < now;

      // Resolve templateId (ObjectId) -> slug. The awsuser schema only stores
      // templateId; relaunch needs the slug. Older docs may be missing
      // templateId entirely — fall back to org's first AWS template.
      let awsTpl = awsDoc.templateId
        ? await SandboxTemplate.findById(awsDoc.templateId).select('slug').lean()
        : null;
      if (!awsTpl) {
        try {
          const Organization = require('../models/organization');
          const User = require('../models/user');
          const portalUserDoc = await User.findOne({ email }).lean();
          const orgDoc = portalUserDoc?.organization
            ? await Organization.findOne({ organization: { $regex: `^${portalUserDoc.organization}$`, $options: 'i' } }).lean()
            : null;
          if (orgDoc?.templates?.length) {
            awsTpl = await SandboxTemplate.findOne({ slug: { $in: orgDoc.templates }, cloud: 'aws', isActive: true }).select('slug').lean();
          }
        } catch (e) { /* best-effort fallback */ }
      }

      // Detect retention state: cleanup ran (no active sandbox subdocs and
      // expiresAt cleared) or all sandbox subdocs are deleted. In that case
      // surface the card as 'expired' so users see a Relaunch button instead
      // of stale credentials that 401 against AWS Console.
      const subSandboxes = awsDoc.sandbox || [];
      const allSubDeleted = subSandboxes.length > 0 && subSandboxes.every(s => s.status === 'deleted');
      const cleanupRanNoSession = subSandboxes.length === 0 && awsDoc.expiresAt == null;
      const inRetention = allSubDeleted || cleanupRanNoSession;

      sandboxes.push({
        cloud: 'aws',
        username: awsDoc.userId,
        password: awsDoc.password,
        accessUrl: awsDoc.accessUrl || `https://${process.env.AWS_ACCOUNT_ID || '475184346033'}.signin.aws.amazon.com/console`,
        region: awsDoc.region || 'ap-south-1',
        expiresAt: expiry,
        status: (isExpired || inRetention) ? 'expired' : 'active',
        templateName: awsDoc.templateName,
        templateSlug: awsTpl?.slug || null,
        allowedServices: awsDoc.allowedServices || [],
        blockedServices: awsDoc.blockedServices || [],
        hoursUsedToday: calcUsageToday(awsDoc.usageSessions),
        dailyCapHours: awsDoc.dailyCapHours || 12,
        accessKeyId: awsDoc.accessKeyId || null,
        secretAccessKey: awsDoc.secretAccessKey || null,
      });
    }

    // --- Legacy Azure sandboxes (sandboxuser collection) ---
    const azureDoc = await SandboxUser.findOne({ email }).lean();
    let azureHasActiveCard = false;
    if (azureDoc && azureDoc.sandbox?.length) {
      for (const sb of azureDoc.sandbox) {
        if (sb.status === 'failed' || sb.status === 'deleted') continue;
        const expiry = sb.expiresAt || sb.deleteTime || azureDoc.endDate || null;
        const isExpired = sb.status === 'expired' || (expiry && new Date(expiry) < now);
        // Resolve templateId (ObjectId) -> slug so the frontend's
        // POST /user/relaunch-sandbox lookup (slug+cloud) succeeds.
        const azureTpl = sb.templateId
          ? await SandboxTemplate.findById(sb.templateId).select('slug').lean()
          : null;
        sandboxes.push({
          cloud: 'azure',
          resourceGroupName: sb.resourceGroupName || null,
          username: sb.credentials?.username || azureDoc.userId,
          password: sb.credentials?.password || '',
          accessUrl: sb.accessUrl || 'https://portal.azure.com',
          region: sb.location || 'southindia',
          expiresAt: expiry,
          status: isExpired ? 'expired' : (sb.status === 'failed' ? 'failed' : 'active'),
          allowedServices: sb.allowedServices || [],
          blockedServices: sb.blockedServices || [],
          templateSlug: azureTpl?.slug || null,
          hoursUsedToday: calcUsageToday(azureDoc.usageSessions),
          dailyCapHours: azureDoc.dailyCapHours || 12,
        });
        azureHasActiveCard = true;
      }
    }
    // Azure retention card: same pattern as GCP — surface a relaunchable
    // placeholder when the user has Azure access but no active sandbox.
    if (azureDoc && !azureHasActiveCard && (!azureDoc.endDate || new Date(azureDoc.endDate) > now)) {
      const Organization = require('../models/organization');
      const User = require('../models/user');
      const portalUserDoc = await User.findOne({ email }).lean();
      const orgDoc = portalUserDoc?.organization
        ? await Organization.findOne({ organization: { $regex: `^${portalUserDoc.organization}$`, $options: 'i' } }).lean()
        : null;
      if (orgDoc?.templates?.length) {
        const azureTemplate = await SandboxTemplate.findOne({ slug: { $in: orgDoc.templates }, cloud: 'azure', isActive: true }).lean();
        if (azureTemplate) {
          sandboxes.push({
            cloud: 'azure',
            username: azureDoc.userId || email,
            password: '',
            accessUrl: 'https://portal.azure.com',
            region: azureTemplate.sandboxConfig?.region || 'southindia',
            expiresAt: null,
            status: 'expired',
            templateSlug: azureTemplate.slug,
            templateName: azureTemplate.name,
            allowedServices: [],
            blockedServices: [],
            hoursUsedToday: calcUsageToday(azureDoc.usageSessions),
            dailyCapHours: azureDoc.dailyCapHours || 12,
          });
        }
      }
    }

    // --- Legacy GCP sandboxes (gcpsandboxuser collection) ---
    const gcpDoc = await GcpSandboxUser.findOne({ email }).lean();
    let gcpHasActiveCard = false;
    if (gcpDoc && gcpDoc.sandbox?.length) {
      for (const sb of gcpDoc.sandbox) {
        if (sb.status === 'failed' || sb.status === 'deleted') continue;
        const expiry = sb.expiresAt || sb.deleteTime || gcpDoc.endDate || null;
        const isExpired = expiry && new Date(expiry) < now;
        // Resolve real slug + name from templateId (was returning the raw ObjectId hex,
        // which then broke relaunch with Template not found). Patched 2026-06-01.
        let gcpTpl = null;
        if (sb.templateId) {
          try { gcpTpl = await SandboxTemplate.findById(sb.templateId).lean(); } catch {}
        }
        sandboxes.push({
          cloud: 'gcp',
          username: gcpDoc.googleEmail || gcpDoc.email,
          password: 'Use your Google account',
          accessUrl: `https://console.cloud.google.com/home/dashboard?project=${sb.projectId}`,
          region: sb.region || 'us-central1',
          expiresAt: expiry,
          status: isExpired ? 'expired' : 'active',
          projectId: sb.projectId,
          allowedServices: sb.allowedServices || [],
          blockedServices: sb.blockedServices || [],
          templateSlug: gcpTpl?.slug || null,
          templateName: gcpTpl?.name || null,
          hoursUsedToday: calcUsageToday(gcpDoc.usageSessions),
          dailyCapHours: gcpDoc.dailyCapHours || 12,
        });
        gcpHasActiveCard = true;
      }
    }
    // GCP retention card: if the user previously had GCP access (doc exists) but
    // no active sandbox right now (post-cleanup) AND endDate is still in the
    // future, surface a relaunchable placeholder so the UI shows a Relaunch
    // button. Without this the user's GCP access becomes invisible.
    if (gcpDoc && !gcpHasActiveCard && (!gcpDoc.endDate || new Date(gcpDoc.endDate) > now)) {
      const Organization = require('../models/organization');
      const User = require('../models/user');
      const portalUserDoc = await User.findOne({ email }).lean();
      const orgDoc = portalUserDoc?.organization
        ? await Organization.findOne({ organization: { $regex: `^${portalUserDoc.organization}$`, $options: 'i' } }).lean()
        : null;
      if (orgDoc?.templates?.length) {
        const gcpTemplate = await SandboxTemplate.findOne({ slug: { $in: orgDoc.templates }, cloud: 'gcp', isActive: true }).lean();
        if (gcpTemplate) {
          sandboxes.push({
            cloud: 'gcp',
            username: gcpDoc.googleEmail || gcpDoc.email,
            password: 'Use your Google account',
            accessUrl: 'https://console.cloud.google.com/',
            region: gcpTemplate.sandboxConfig?.region || 'us-central1',
            expiresAt: null,
            status: 'expired',
            projectId: null,
            templateSlug: gcpTemplate.slug,
            templateName: gcpTemplate.name,
            allowedServices: [],
            blockedServices: [],
            hoursUsedToday: calcUsageToday(gcpDoc.usageSessions),
            dailyCapHours: gcpDoc.dailyCapHours || 12,
          });
        }
      }
    }

    // --- OCI sandboxes (ocisandboxuser collection) ---
    // Don't filter on status: { $ne: 'deleted' } here — we still want to
    // surface a retention card for users whose OCI sandbox was cleaned up
    // but who still have OCI access in their org.
    const ociDoc = await OciSandboxUser.findOne({ email }).lean();
    let ociHasActiveCard = false;
    if (ociDoc && ociDoc.status !== 'deleted') {
      const ociTemplate = ociDoc.templateId
        ? await SandboxTemplate.findById(ociDoc.templateId).select('slug').lean()
        : null;
      sandboxes.push({
        cloud: 'oci',
        username: ociDoc.username,
        password: ociDoc.password,
        accessUrl: ociDoc.accessUrl,
        region: ociDoc.region || 'ap-mumbai-1',
        expiresAt: ociDoc.expiresAt || ociDoc.endDate || null,
        status: ociDoc.status === 'expired' || (ociDoc.expiresAt && new Date(ociDoc.expiresAt) < now) ? 'expired' : 'active',
        compartmentId: ociDoc.compartmentId,
        compartmentName: ociDoc.compartmentName,
        allowedServices: ociDoc.allowedServices || [],
        blockedServices: ociDoc.blockedServices || [],
        source: 'admin',
        templateSlug: ociTemplate?.slug || null,
        hoursUsedToday: calcUsageToday(ociDoc.usageSessions),
        dailyCapHours: ociDoc.dailyCapHours || 12,
      });
      ociHasActiveCard = true;
    }
    // OCI retention card: if the user previously had OCI access (doc exists,
    // possibly status='deleted') but no active card was pushed AND endDate is
    // still in the future, surface a relaunchable placeholder. Mirrors the
    // GCP/Azure retention-card pattern.
    if (ociDoc && !ociHasActiveCard && (!ociDoc.endDate || new Date(ociDoc.endDate) > now)) {
      const Organization = require('../models/organization');
      const User = require('../models/user');
      const portalUserDoc = await User.findOne({ email }).lean();
      const orgDoc = portalUserDoc?.organization
        ? await Organization.findOne({ organization: { $regex: `^${portalUserDoc.organization}$`, $options: 'i' } }).lean()
        : null;
      if (orgDoc?.templates?.length) {
        const ociTemplate = await SandboxTemplate.findOne({ slug: { $in: orgDoc.templates }, cloud: 'oci', isActive: true }).lean();
        if (ociTemplate) {
          sandboxes.push({
            cloud: 'oci',
            username: ociDoc.username || email,
            password: '',
            accessUrl: ociDoc.accessUrl || 'https://cloud.oracle.com/',
            region: ociTemplate.sandboxConfig?.region || 'ap-mumbai-1',
            expiresAt: null,
            status: 'expired',
            compartmentId: null,
            compartmentName: null,
            templateSlug: ociTemplate.slug,
            templateName: ociTemplate.name,
            allowedServices: [],
            blockedServices: [],
            source: 'admin',
            hoursUsedToday: calcUsageToday(ociDoc.usageSessions),
            dailyCapHours: ociDoc.dailyCapHours || 12,
          });
        }
      }
    }

    // --- Template-based deployments (SandboxDeployment collection) ---
    const deployments = await SandboxDeployment.find({
      deployedBy: email,
      state: { $in: ['active'] },
    }).lean();

    // Collect unique template IDs to fetch allowed/blocked services
    const templateIds = [...new Set(deployments.map(d => d.templateId?.toString()).filter(Boolean))];
    const templates = templateIds.length
      ? await SandboxTemplate.find({ _id: { $in: templateIds } }).lean()
      : [];
    const templateMap = {};
    for (const t of templates) templateMap[t._id.toString()] = t;

    for (const dep of deployments) {
      const tmpl = dep.templateId ? templateMap[dep.templateId.toString()] : null;
      sandboxes.push({
        cloud: dep.cloud,
        username: dep.username,
        password: dep.password,
        accessUrl: dep.accessUrl,
        region: dep.region,
        expiresAt: dep.expiresAt,
        status: dep.state,
        templateName: dep.templateName,
        templateSlug: tmpl?.slug || null,
        certificationCode: tmpl?.certificationCode || '',
        allowedServices: (tmpl?.allowedServices || []).map(s => ({
          service: s.service,
          category: s.category,
          restrictions: s.restrictions,
        })),
        blockedServices: (tmpl?.blockedServices || []).map(s => ({
          service: s.service,
          reason: s.reason,
        })),
        source: 'template',
        hoursUsedToday: 0,
        dailyCapHours: tmpl?.sandboxConfig?.dailyCapHours || 12,
      });
    }

    res.json({ sandboxes });
  } catch (err) {
    console.error('Error in /user/my-sandboxes:', err.message);
    res.status(500).json({ message: 'Failed to fetch sandboxes' });
  }
});

/**
 * POST /user/relaunch-sandbox
 *
 * Re-launches an expired sandbox for a student, enforcing daily and total caps.
 * Body: { cloud: 'aws'|'azure'|'gcp', templateSlug: string, email?: string (GCP google email) }
 */
// GET /user/sandbox-reset-progress?cloud=gcp&projectId=...
// Polled by the frontend to show live reset progress.
router.get('/sandbox-reset-progress', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    const { cloud, projectId } = req.query || {};
    if (!userEmail) return res.status(401).json({ message: 'Not authenticated' });
    if (cloud !== 'gcp') return res.status(400).json({ message: 'Only gcp supported for now' });
    if (!projectId) return res.status(400).json({ message: 'projectId required' });
    const doc = await GcpSandboxUser.findOne({ email: userEmail }, 'sandbox persistentProjectId').lean();
    if (!doc) return res.status(404).json({ message: 'Sandbox user not found' });
    const entry = (doc.sandbox || []).find(s => s.projectId === projectId);
    if (!entry) return res.status(404).json({ message: 'Sandbox entry not found' });
    const r = entry.reset || {};
    return res.json({
      projectId,
      status:       r.status || 'idle',
      currentPhase: r.currentPhase || '',
      currentStep:  r.currentStep || '',
      percent:      r.percent || 0,
      completed:    r.completed || 0,
      total:        r.total || 0,
      startedAt:    r.startedAt || null,
      finishedAt:   r.finishedAt || null,
      lastError:    r.lastError || null,
      log:          (r.log || []).slice(-15),
    });
  } catch (err) {
    console.error('[sandbox-reset-progress]', err.message);
    res.status(500).json({ message: 'Failed to fetch reset progress' });
  }
});

router.post('/relaunch-sandbox', restrictToLoggedinUserOnly, async (req, res) => {
  const userEmail = req.user?.email;
  if (!userEmail) return res.status(401).json({ message: 'Not authenticated' });
  if (relaunchInFlight.has(userEmail)) {
    return res.status(429).json({ message: 'A relaunch is already in progress for your account. Please wait a few seconds.' });
  }
  relaunchInFlight.add(userEmail);
  try {

    const { cloud, templateSlug, email: gcpGoogleEmail } = req.body;
    if (!cloud || !templateSlug) {
      return res.status(400).json({ message: 'cloud and templateSlug are required' });
    }

    // ── Login window + weekday gate (mirrors controllers/user.js login route) ──
    // Prevents a learner who got a session token during their window from
    // relaunching once their daily window has closed.
    try {
      const moment = require('moment-timezone');
      const User = require('../models/user');
      const portalUser = await User.findOne({ email: userEmail }).lean();
      if (portalUser) {
        const nowIst = moment().tz('Asia/Kolkata');
        const cur = nowIst.format('HH:mm');
        let effectiveDay = nowIst.day();
        if (portalUser.loginStart && portalUser.loginStop) {
          const start = portalUser.loginStart, stop = portalUser.loginStop;
          let inWindow = false;
          if (start <= stop) inWindow = cur >= start && cur <= stop;
          else if (cur >= start) inWindow = true;
          else if (cur <= stop) { inWindow = true; effectiveDay = nowIst.clone().subtract(1, 'day').day(); }
          if (!inWindow) {
            logger.warn(`${userEmail} attempted to relaunch outside allowed hours (${start}-${stop} IST)`);
            return res.status(403).json({ message: `Sandbox launches are only allowed between ${start} and ${stop} IST.` });
          }
        }
        if (Array.isArray(portalUser.allowedWeekdays) && portalUser.allowedWeekdays.length > 0) {
          if (!portalUser.allowedWeekdays.includes(effectiveDay)) {
            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const allowed = portalUser.allowedWeekdays.map(d => dayNames[d]).join(', ');
            logger.warn(`${userEmail} attempted to relaunch on ${dayNames[effectiveDay]} (allowed: ${allowed})`);
            return res.status(403).json({ message: `Sandbox launches are only allowed on: ${allowed}.` });
          }
        }
        if (portalUser.accessExpiresAt && new Date(portalUser.accessExpiresAt) < new Date()) {
          return res.status(403).json({ message: 'Your lab access has expired.' });
        }
      }
    } catch (winErr) {
      logger.error(`Login window check failed for ${userEmail}: ${winErr.message}`);
      // Fall through — don't fail relaunch if the helper itself errors
    }

    // 1. Find template
    const template = await SandboxTemplate.findOne({ slug: templateSlug, cloud }).lean();
    if (!template) return res.status(404).json({ message: 'Template not found' });

    const ttlHours = template.sandboxConfig?.ttlHours || 4;
    const dailyCapHours = template.sandboxConfig?.dailyCapHours || 12;
    const totalCapHours = template.sandboxConfig?.totalCapHours || 0;

    // 2. Get user doc and find expired sandbox
    let userDoc;
    if (cloud === 'aws') userDoc = await awsUser.findOne({ email: userEmail });
    else if (cloud === 'azure') userDoc = await SandboxUser.findOne({ email: userEmail });
    else if (cloud === 'gcp') userDoc = await GcpSandboxUser.findOne({ email: userEmail });
    else if (cloud === 'oci') userDoc = await OciSandboxUser.findOne({ email: userEmail });

    if (!userDoc) return res.status(404).json({ message: 'No sandbox record found for your account' });

    // 2b. Tear down any prior active sandbox(es) so re-launch doesn't leak
    // cloud resources (P1-8). If teardown fails we still proceed — the next
    // cleanup-cron pass will retry — better than blocking the learner.
    try {
      if (cloud === 'aws') {
        // awsuser doc is keyed per learner; the IAM user is the resource at risk.
        // The model only stores ONE userId; if non-deleted, terminate then mark.
        for (const sb of (userDoc.sandbox || [])) {
          if (sb.status === 'deleted') continue;
          try {
            const { fullAwsCleanup } = require('../services/awsResourceCleanup');
            if (fullAwsCleanup && userDoc.userId) await fullAwsCleanup(userDoc.userId);
          } catch (e) { logger.warn(`[relaunch-aws] resource cleanup failed for ${userDoc.userId}: ${e.message}`); }
          sb.status = 'deleted';
        }
      } else if (cloud === 'azure') {
        for (const sb of (userDoc.sandbox || [])) {
          if (sb.status === 'deleted') continue;
          try {
            const { ClientSecretCredential } = require('@azure/identity');
            const { ResourceManagementClient } = require('@azure/arm-resources');
            const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
            const rmc = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);
            if (sb.resourceGroupName) {
              await rmc.resourceGroups.beginDeleteAndWait(sb.resourceGroupName);
              logger.info(`[relaunch-azure] prior RG ${sb.resourceGroupName} deleted`);
            }
          } catch (e) { logger.warn(`[relaunch-azure] prior RG cleanup failed for ${sb.resourceGroupName}: ${e.message}`); }
          sb.status = 'deleted';
        }
      } else if (cloud === 'gcp') {
        // Path 3: if persistentProjectId is set, KEEP the project. The worker
        // will reset its resources via gcp-reset-sandbox. Otherwise delete.
        const keepProject = !!userDoc.persistentProjectId;
        for (const sb of (userDoc.sandbox || [])) {
          if (sb.status === 'deleted') continue;
          if (keepProject && sb.projectId === userDoc.persistentProjectId) {
            sb.status = 'resetting';
            continue;
          }
          try {
            const { google } = require('googleapis');
            const auth = new google.auth.GoogleAuth({ keyFile: process.env.KEYFILENAME, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
            const crm = google.cloudresourcemanager({ version: 'v3', auth });
            if (sb.projectId) {
              await crm.projects.delete({ name: `projects/${sb.projectId}` });
              logger.info(`[relaunch-gcp] prior project ${sb.projectId} deleted`);
            }
          } catch (e) { logger.warn(`[relaunch-gcp] prior project cleanup failed for ${sb.projectId}: ${e.message}`); }
          sb.status = 'deleted';
        }
      } else if (cloud === 'oci') {
        // OCI model is flat (no sandbox[]); the per-user fields hold a single live sandbox.
        if (userDoc.compartmentId || userDoc.userId || userDoc.policyId) {
          try {
            const { deleteOciSandbox } = require('../services/ociSandbox');
            await deleteOciSandbox(userDoc.compartmentId, userDoc.userId, userDoc.policyId);
            logger.info(`[relaunch-oci] prior compartment/user cleaned for ${userEmail}`);
          } catch (e) { logger.warn(`[relaunch-oci] prior cleanup failed for ${userEmail}: ${e.message}`); }
        }
      }
    } catch (priorErr) {
      logger.warn(`[relaunch] prior-sandbox teardown errored (non-fatal): ${priorErr.message}`);
    }

    // 3. Calculate usage — IST midnight to midnight
    const now = new Date();
    const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    nowIST.setHours(0, 0, 0, 0);
    const offsetMs = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getTime();
    const todayMidnightIST = new Date(nowIST.getTime() + offsetMs);

    const sessions = userDoc.usageSessions || [];
    const hoursUsedToday = sessions
      .filter(s => new Date(s.startedAt) >= todayMidnightIST && s.templateSlug === templateSlug)
      .reduce((sum, s) => sum + (s.ttlHours || 0), 0);

    const totalHoursUsed = sessions
      .filter(s => s.templateSlug === templateSlug)
      .reduce((sum, s) => sum + (s.ttlHours || 0), 0);

    // 4. Validate daily cap
    if (hoursUsedToday + ttlHours > dailyCapHours) {
      const tomorrowMidnightIST = new Date(todayMidnightIST.getTime() + 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: 'Daily limit reached',
        hoursUsedToday,
        dailyCapHours,
        nextAvailableAt: tomorrowMidnightIST,
      });
    }

    // 5. Validate total cap
    if (totalCapHours > 0 && totalHoursUsed + ttlHours > totalCapHours) {
      return res.status(429).json({
        error: 'Total engagement hours exhausted',
        totalHoursUsed,
        totalCapHours,
      });
    }

    // 6. Create new sandbox
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    let result;

    if (cloud === 'aws') {
      const username = `sb-${userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12)}-${Date.now().toString(36).slice(-4)}`;
      result = await createAwsSandbox(username, userEmail);

      // Add new sandbox entry and push usage session
      userDoc.sandbox.push({
        name: username,
        region: result.region || 'ap-south-1',
        createdTime: now,
        deleteTime: expiresAt,
      });
      userDoc.templateId = template._id;
      userDoc.expiresAt = expiresAt;
      userDoc.allowedServices = template.allowedServices || [];
      userDoc.blockedServices = template.blockedServices || [];
      userDoc.userId = result.username;
      userDoc.password = result.password;
      userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
      await userDoc.save();

      result.expiresAt = expiresAt;

    } else if (cloud === 'azure') {
      const cleanName = userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12);
      const rgName = `sb-${cleanName}-${Date.now().toString(36).slice(-5)}`;
      // Persistent Entra user: reuse the AD user stored at the sandboxuser level
      // so the same identity survives sandbox delete/relaunch cycles. Fall back to
      // the last sandbox entry's credentials for backwards compatibility.
      const storedAd = userDoc.azureAdUser;
      const priorSb = [...(userDoc.sandbox || [])].reverse().find(s => s.credentials && s.credentials.username);
      const reuseUser = storedAd?.upn
        ? { upn: storedAd.upn, password: storedAd.password }
        : priorSb ? { upn: priorSb.credentials.username, password: priorSb.credentials.password } : undefined;
      result = await createAzureSandbox(rgName, 'southindia', userDoc.userId, userEmail, { allowedVmSkus: template.allowedInstanceTypes?.azure, reuseUser });

      // Persist the AD credentials on the user doc so they survive sandbox deletes.
      // Because relaunch ROTATES the password on the same Entra identity, also
      // refresh the stored password on every prior sandbox entry for this same
      // user, so the portal always shows the current password — never a stale
      // one from an earlier relaunch cycle.
      if (result.objectId && result.username) {
        userDoc.azureAdUser = { upn: result.username, password: result.password, objectId: result.objectId };
        (userDoc.sandbox || []).forEach(s => {
          if (s.credentials && s.credentials.username === result.username) {
            s.credentials.password = result.password;
          }
        });
        userDoc.markModified('sandbox');
      }

      // If the template defines a customRoleId, replace the default sandbox
      // role with the custom one (mirrors controllers/sandbox.js bulk-deploy).
      if (template.customRoleId && result.objectId) {
        try {
          const { ClientSecretCredential } = require('@azure/identity');
          const { AuthorizationManagementClient } = require('@azure/arm-authorization');
          const cryptoMod = require('crypto');
          const subId = process.env.SUBSCRIPTION_ID;
          const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
          const authClient = new AuthorizationManagementClient(credential, subId);
          const scope = `/subscriptions/${subId}/resourceGroups/${rgName}`;
          await authClient.roleAssignments.create(scope, cryptoMod.randomUUID(), {
            principalId: result.objectId,
            roleDefinitionId: template.customRoleId,
            scope,
          });
          const DEFAULT_SANDBOX_ROLE_SUFFIX = 'bfb6d235-8a98-4c0c-bc06-edea5dc83954';
          const existing = [];
          for await (const ra of authClient.roleAssignments.listForScope(scope)) existing.push(ra);
          const defaultRA = existing.find(ra =>
            ra.roleDefinitionId && ra.roleDefinitionId.includes(DEFAULT_SANDBOX_ROLE_SUFFIX) &&
            ra.principalId === result.objectId && ra.scope === scope
          );
          if (defaultRA) await authClient.roleAssignments.deleteById(defaultRA.id);
        } catch (e) {
          console.error(`[relaunch-azure] customRoleId swap failed for ${rgName}: ${e.message}`);
        }
      }

      // Assign the policy initiative (sandboxmh / databricks-mh) to restrict
      // services inside the resource group — mirrors worker/azure-create-sandbox.js.
      try {
        const { PolicyClient } = require('@azure/arm-policy');
        const { ClientSecretCredential: PSCred } = require('@azure/identity');
        const cryptoP = require('crypto');
        const subId = process.env.SUBSCRIPTION_ID;
        const pCred = new PSCred(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
        const policyClient = new PolicyClient(pCred, subId);
        const scope = `/subscriptions/${subId}/resourceGroups/${rgName}`;
        const initiativeId = template.policyInitiativeId
          || `/subscriptions/${subId}/providers/Microsoft.Authorization/policySetDefinitions/22b100af047a471aa11e18a8`;
        await policyClient.policyAssignments.create(scope, `sandbox-init-${cryptoP.randomUUID().slice(0, 8)}`, {
          policyDefinitionId: initiativeId,
          scope,
          displayName: 'Sandbox Resource Restrictions',
        });
        console.log(`[relaunch-azure] Initiative assigned to ${rgName}`);
      } catch (e) {
        console.error(`[relaunch-azure] Initiative assignment failed for ${rgName}: ${e.message}`);
      }

      userDoc.sandbox.push({
        resourceGroupName: result.resourceGroupName,
        location: result.location,
        createdTime: now,
        deleteTime: expiresAt,
        expiresAt,
        status: 'ready',
        accessUrl: result.accessUrl || result.portalUrl,
        credentials: { username: result.username, password: result.password },
        templateId: template._id,
        allowedServices: template.allowedServices || [],
        blockedServices: template.blockedServices || [],
      });
      userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
      await userDoc.save();

      result.expiresAt = expiresAt;

    } else if (cloud === 'gcp') {
      const googleEmail = gcpGoogleEmail || userDoc.googleEmail || userEmail;

      // Path 3: if user has a persistent project, enqueue reset instead of
      // create. This keeps GCP project quota at 1-per-user.
      if (userDoc.persistentProjectId) {
        const projectId = userDoc.persistentProjectId;
        // Mark or insert sandbox entry for this project + queue reset
        let entry = (userDoc.sandbox || []).find(s => s.projectId === projectId);
        if (!entry) {
          userDoc.sandbox.push({
            projectId, createdTime: now, deleteTime: expiresAt, expiresAt,
            templateId: template._id.toString(),
            allowedServices: template.allowedServices || [],
            blockedServices: template.blockedServices || [],
          });
          entry = userDoc.sandbox[userDoc.sandbox.length - 1];
        } else {
          entry.expiresAt = expiresAt;
          entry.deleteTime = expiresAt;
        }
        // Reset progress placeholder
        entry.reset = { status: 'queued', currentPhase: '', currentStep: '', completed: 0, total: 0, percent: 0, startedAt: new Date(), log: [] };
        userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
        await userDoc.save();

        // Enqueue the reset job
        try {
          const queues = require('../controllers/newQueues');
          await queues['gcp-reset-sandbox'].add({
            email: userEmail,
            projectId,
            googleEmail,
            budgetInr: userDoc.budgetLimit || 0,
            billingAccountId: process.env.GCP_BILLING_ACCOUNT || null,
            requiredApis: [
              'compute.googleapis.com','container.googleapis.com','cloudfunctions.googleapis.com',
              'run.googleapis.com','sqladmin.googleapis.com','bigquery.googleapis.com',
              'storage.googleapis.com','pubsub.googleapis.com','aiplatform.googleapis.com',
              'notebooks.googleapis.com','generativelanguage.googleapis.com','iam.googleapis.com',
              'cloudresourcemanager.googleapis.com','cloudbilling.googleapis.com',
            ],
          });
          logger.info(`[relaunch-gcp] enqueued gcp-reset-sandbox for ${projectId}`);
        } catch (qe) { logger.error(`[relaunch-gcp] enqueue failed: ${qe.message}`); }

        result = {
          projectId, accessUrl: `https://console.cloud.google.com/home/dashboard?project=${projectId}`,
          state: 'resetting', message: 'Sandbox reset queued — track progress in /my-sandboxes',
          expiresAt,
        };
      } else {
        // First-ever GCP launch for this user — create the persistent project
        const projectId = `sb-${userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${Date.now().toString(36).slice(-5)}`;
        result = await createGcpSandbox(projectId, googleEmail, userDoc.budgetLimit || 500);
        userDoc.persistentProjectId = result.projectId;
        userDoc.sandbox.push({
          projectId: result.projectId,
          createdTime: now, deleteTime: expiresAt, expiresAt,
          templateId: template._id.toString(),
          allowedServices: template.allowedServices || [],
          blockedServices: template.blockedServices || [],
        });
        userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
        await userDoc.save();
        result.expiresAt = expiresAt;
      }
    } else if (cloud === 'oci') {
      const certCode = (template.certificationCode || 'oac').toLowerCase();
      const randSuffix = Math.random().toString(36).slice(2, 6);
      const compartmentName = `lab-${certCode}-${randSuffix}-${Date.now().toString(36)}`.slice(0, 30);
      const region = template.sandboxConfig?.region || process.env.OCI_REGION || 'ap-hyderabad-1';

      result = await createOciSandbox(compartmentName, region, userEmail);

      // Grant OAC ServiceAdministrator so the user actually has data access
      // inside Oracle Analytics — createOciSandbox provisions the IDCS user
      // but doesn't assign any OAC app role.
      try {
        await grantOacServiceAdminByUsername(result.username);
      } catch (e) {
        console.error(`[oci-relaunch] OAC role grant failed for ${result.username}: ${e.message}`);
      }

      userDoc.compartmentId = result.compartmentId;
      userDoc.compartmentName = compartmentName;
      userDoc.userId = result.userId;
      userDoc.username = result.username;
      userDoc.password = result.password;
      userDoc.policyId = result.policyId;
      userDoc.region = region;
      userDoc.accessUrl = result.accessUrl;
      userDoc.startDate = now;
      userDoc.endDate = expiresAt;
      userDoc.expiresAt = expiresAt;
      userDoc.status = 'active';
      userDoc.deletionStatus = undefined;
      userDoc.templateId = template._id;
      userDoc.allowedServices = (template.allowedServices || []).map(s => ({
        service: s.service, category: s.category, restrictions: s.restrictions,
      }));
      userDoc.blockedServices = (template.blockedServices || []).map(s => ({
        service: s.service, reason: s.reason,
      }));
      userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
      await userDoc.save();

      result.region = region;
      result.expiresAt = expiresAt;
    }

    res.json({
      message: 'Sandbox re-launched successfully',
      sandbox: {
        cloud,
        username: result.username,
        password: result.password,
        accessUrl: result.accessUrl,
        region: result.region,
        expiresAt: result.expiresAt,
        templateSlug,
        hoursUsedToday: hoursUsedToday + ttlHours,
        dailyCapHours,
      },
    });
  } catch (err) {
    console.error('Error in /user/relaunch-sandbox:', err.message);
    res.status(500).json({ message: 'Failed to re-launch sandbox', error: err.message });
  } finally {
    relaunchInFlight.delete(userEmail);
  }
});



/**
 * GET /user/available-sandbox-templates
 * Returns sandbox templates the logged-in user can deploy from
 * (intersection of Organization.templates and SandboxTemplate slugs).
 *
 * Used by MySandboxes.jsx empty-state to render "Deploy first sandbox" button(s)
 * — for new sandbox-cohort learners with no SandboxUser.sandbox[] entries yet.
 */
router.get('/available-sandbox-templates', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    const orgName = req.user?.organization;
    if (!orgName) return res.json({ templates: [] });
    const Organization = require('../models/organization');
    const orgDoc = await Organization.findOne({ organization: { $regex: `^${orgName}$`, $options: 'i' } }).lean();
    if (!orgDoc || !Array.isArray(orgDoc.templates) || orgDoc.templates.length === 0) {
      return res.json({ templates: [] });
    }
    const templates = await SandboxTemplate.find({
      slug: { $in: orgDoc.templates },
      isActive: true,
    }).select('slug name cloud certificationCode sandboxConfig.ttlHours sandboxConfig.region').lean();
    res.json({ templates });
  } catch (err) {
    logger.error(`/user/available-sandbox-templates error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch templates' });
  }
});

module.exports = router