const express = require('express');
const {handleUserLogin, handleUserLogout} = require('./../controllers/user')
const { restrictToLoggedinUserOnly } = require('./../middlewares/auth');
const awsUser = require('./../models/aws');
const SandboxUser = require('./../models/sandboxuser');
const GcpSandboxUser = require('./../models/gcpSandboxUser');
const OciSandboxUser = require('./../models/ociSandboxUser');
const SandboxDeployment = require('./../models/sandboxDeployment');
const SandboxTemplate = require('./../models/sandboxTemplate');
const { createAwsSandbox, createAzureSandbox, createGcpSandbox } = require('./../services/directSandbox');

const router = express.Router();

router.post('/login', handleUserLogin);
router.post('/logout', handleUserLogout);

/**
 * GET /user/my-sandboxes
 *
 * Returns all active sandboxes for the logged-in user across AWS, Azure, GCP.
 * Queries both legacy per-cloud user models and the SandboxDeployment collection.
 * Strips budget/cost fields — students should never see those.
 */
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
      sandboxes.push({
        cloud: 'aws',
        username: awsDoc.userId,
        password: awsDoc.password,
        accessUrl: awsDoc.accessUrl || `https://${process.env.AWS_ACCOUNT_ID || '475184346033'}.signin.aws.amazon.com/console`,
        region: awsDoc.region || 'ap-south-1',
        expiresAt: expiry,
        status: isExpired ? 'expired' : 'active',
        templateName: awsDoc.templateName,
        templateSlug: awsDoc.templateSlug,
        allowedServices: awsDoc.allowedServices || [],
        blockedServices: awsDoc.blockedServices || [],
        hoursUsedToday: calcUsageToday(awsDoc.usageSessions),
        dailyCapHours: awsDoc.dailyCapHours || 12,
      });
    }

    // --- Legacy Azure sandboxes (sandboxuser collection) ---
    const azureDoc = await SandboxUser.findOne({ email }).lean();
    if (azureDoc && azureDoc.sandbox?.length) {
      for (const sb of azureDoc.sandbox) {
        if (sb.status === 'failed') continue;
        const expiry = sb.expiresAt || sb.deleteTime || azureDoc.endDate || null;
        const isExpired = sb.status === 'expired' || (expiry && new Date(expiry) < now);
        sandboxes.push({
          cloud: 'azure',
          username: sb.credentials?.username || azureDoc.userId,
          password: sb.credentials?.password || '',
          accessUrl: sb.accessUrl || 'https://portal.azure.com',
          region: sb.location || 'southindia',
          expiresAt: expiry,
          status: isExpired ? 'expired' : (sb.status || 'active'),
          allowedServices: sb.allowedServices || [],
          blockedServices: sb.blockedServices || [],
          templateSlug: sb.templateId || null,
          hoursUsedToday: calcUsageToday(azureDoc.usageSessions),
          dailyCapHours: azureDoc.dailyCapHours || 12,
        });
      }
    }

    // --- Legacy GCP sandboxes (gcpsandboxuser collection) ---
    const gcpDoc = await GcpSandboxUser.findOne({ email }).lean();
    if (gcpDoc && gcpDoc.sandbox?.length) {
      for (const sb of gcpDoc.sandbox) {
        const expiry = sb.expiresAt || sb.deleteTime || gcpDoc.endDate || null;
        const isExpired = expiry && new Date(expiry) < now;
        sandboxes.push({
          cloud: 'gcp',
          username: gcpDoc.googleEmail || gcpDoc.email,
          password: 'Use your Google account',
          accessUrl: `https://console.cloud.google.com/home/dashboard?project=${sb.projectId}`,
          region: sb.region || 'asia-south1',
          expiresAt: expiry,
          status: isExpired ? 'expired' : 'active',
          projectId: sb.projectId,
          allowedServices: sb.allowedServices || [],
          blockedServices: sb.blockedServices || [],
          templateSlug: sb.templateId || null,
          hoursUsedToday: calcUsageToday(gcpDoc.usageSessions),
          dailyCapHours: gcpDoc.dailyCapHours || 12,
        });
      }
    }

    // --- OCI sandboxes (ocisandboxuser collection) ---
    const ociDoc = await OciSandboxUser.findOne({ email, status: { $ne: 'deleted' } }).lean();
    if (ociDoc) {
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
        templateSlug: ociDoc.templateId ? String(ociDoc.templateId) : null,
        hoursUsedToday: calcUsageToday(ociDoc.usageSessions),
        dailyCapHours: ociDoc.dailyCapHours || 12,
      });
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
router.post('/relaunch-sandbox', restrictToLoggedinUserOnly, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json({ message: 'Not authenticated' });

    const { cloud, templateSlug, email: gcpGoogleEmail } = req.body;
    if (!cloud || !templateSlug) {
      return res.status(400).json({ message: 'cloud and templateSlug are required' });
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

    if (!userDoc) return res.status(404).json({ message: 'No sandbox record found for your account' });

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
      result = await createAzureSandbox(rgName, 'southindia', userDoc.userId, userEmail);

      userDoc.sandbox.push({
        resourceGroupName: result.resourceGroupName,
        location: result.location,
        createdTime: now,
        deleteTime: expiresAt,
        expiresAt,
        status: 'ready',
        accessUrl: result.portalUrl || result.accessUrl,
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
      const projectId = `sb-${userEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${Date.now().toString(36).slice(-5)}`;
      result = await createGcpSandbox(projectId, googleEmail, userDoc.budgetLimit || 500);

      userDoc.sandbox.push({
        projectId: result.projectId,
        createdTime: now,
        deleteTime: expiresAt,
        expiresAt,
        templateId: template._id.toString(),
        allowedServices: template.allowedServices || [],
        blockedServices: template.blockedServices || [],
      });
      userDoc.usageSessions.push({ startedAt: now, ttlHours, templateSlug });
      await userDoc.save();

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
  }
});

module.exports = router