const express = require('express');
const router = express.Router();
const {
    handleFetchOrganization,
    handleDeleteOrganization,
    handleCreateOrganization,
    handleFetchUsers,
    handleAssignTemplate,
    handleGetTemplate,
    handleCreateTemplate,
    handleGetAssignTemplate,
    handleCreateUser,
    handleDeleteLogs,
    handleDeleteUser,
    handleDeleteTemplate,
    handleDeleteAssignTemplate,
    handleGetAccounts, // ✅ CORRECT NAME - NO DUPLICATE "handle"
    handleCreateOrder,
    handlePaymentVerify,
    handleGetLedger,
    handleAddTransaction,
    handleCaptureVm,
    // ADD THESE NEW CONTROLLERS
    handleDeleteTransaction,
    handleUpdateTransaction,
    // ✅ ADDED: controller to generate/download invoice PDF
    handleGetInvoicePdf
} = require('./../controllers/admin');
const { handleDashboardFunction } = require("../controllers/Dashboard/handleDashboardFunction");
const { handleGetQuota, handleIncreaseQuota } = require('../controllers/quota');
const { handleGetMyUser } = require('../controllers/myuser');
const { handleAnalyticsOverview, handleCustomerAnalytics, handleIdleAnalytics, handleStudentAnalytics } = require('../controllers/analytics');
const { handleScanOrphans, handleDeleteOrphan, handleRightSizing } = require('../controllers/costOptimization');
const { handleAdminListFeedback, handleAdminFeedbackSummary } = require('../controllers/feedback');
const {
    handleGetCostSummary,
    handleGetLabCosts,
    handleGetOrgLabs,
    handleSyncCosts,
    handleSyncLabCost,
    handleGetCostOverview,
} = require('../controllers/costAnalytics');

// Branding — update for caller's organization
router.put('/branding', async (req, res) => {
  try {
    const userOrg = req.user?.organization;
    const userType = req.user?.userType;
    if (!userOrg) return res.status(400).json({ message: 'Organization not found on user' });
    if (userType !== 'admin' && userType !== 'superadmin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const Organization = require('../models/organization');
    const allowedFields = ['logoUrl', 'primaryColor', 'accentColor', 'companyName', 'faviconUrl', 'loginBanner', 'supportEmail', 'supportPhone'];
    const update = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) update[`branding.${key}`] = req.body[key];
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No branding fields provided' });
    const org = await Organization.findOneAndUpdate(
      { organization: userOrg },
      { $set: update },
      { new: true, collation: { locale: 'en', strength: 2 } }
    );
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    res.json({ branding: org.branding });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Branding — get for a specific organization (authenticated)
router.get('/branding/:organization', async (req, res) => {
  try {
    const Organization = require('../models/organization');
    const org = await Organization.findOne(
      { organization: req.params.organization },
      { branding: 1, organization: 1 }
    ).collation({ locale: 'en', strength: 2 });
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    res.json({ branding: org.branding || {}, organization: org.organization });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/organization', handleFetchOrganization);
router.delete('/organization', handleDeleteOrganization);
router.post('/organization', handleCreateOrganization);
router.get('/users', handleFetchUsers);
router.post('/users', handleCreateUser);
router.delete('/users', handleDeleteUser);
router.post('/assignTemplate', handleAssignTemplate);
router.delete('/assignTemplate', handleDeleteAssignTemplate);
router.get('/assignTemplate', handleGetAssignTemplate);
router.get('/template', handleGetTemplate);
router.post('/template', handleCreateTemplate);
router.delete('/template', handleDeleteTemplate);
router.delete('/logs', handleDeleteLogs);
router.get("/dashboard", handleDashboardFunction);

// ✅ FIXED: no duplicate "handle"
router.get("/ledger/accounts", handleGetAccounts);

router.get("/ledger", handleGetLedger);
router.post("/ledger/addTransaction", handleAddTransaction);

// ✅ ADDED: invoice PDF download route (matches frontend `/admin/ledger/invoice/pdf/:id`)
router.get("/ledger/invoice/pdf/:id", handleGetInvoicePdf);

// Transaction management
router.delete("/ledger/transactions/:transactionId", handleDeleteTransaction);
router.put("/ledger/transactions/:transactionId", handleUpdateTransaction);

router.post("/ledger/order", handleCreateOrder);
router.post("/ledger/paymentVerify", handlePaymentVerify);
router.get("/quota", handleGetQuota);
router.post("/quota", handleIncreaseQuota);
router.get("/myuser", handleGetMyUser);
router.post("/capture", handleCaptureVm);

// Lab Feedback (admin)
router.get("/feedback/summary", handleAdminFeedbackSummary);
router.get("/feedback", handleAdminListFeedback);

// Usage Analytics (superadmin only)
router.get("/analytics/overview", handleAnalyticsOverview);
router.get("/analytics/customers", handleCustomerAnalytics);
router.get("/analytics/idle", handleIdleAnalytics);
router.get("/analytics/students", handleStudentAnalytics);

// Live Azure pricing (superadmin only)
router.get("/pricing/live", async (req, res) => {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });
    const { getAllPricesInr } = require('../services/azurePricing');
    const region = req.query.region || 'southindia';
    const prices = await getAllPricesInr(region);
    res.json(prices);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch pricing' });
  }
});

// Cost Optimization (superadmin only)
router.get("/optimize/orphans", handleScanOrphans);
router.delete("/optimize/orphan", handleDeleteOrphan);
router.get("/optimize/rightsizing", handleRightSizing);

// Cost Analytics (superadmin only - enforced in controller)
router.get("/costs/overview", handleGetCostOverview);
router.get("/costs/summary", handleGetCostSummary);
router.get("/costs/lab", handleGetLabCosts);
router.get("/costs/labs", handleGetOrgLabs);
router.post("/costs/sync", handleSyncCosts);
router.post("/costs/sync-lab", handleSyncLabCost);

// Unified Profit Dashboard (superadmin only)
router.get("/costs/unified", async (req, res) => {
  if (req.user?.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });
  try {
    const { getUnifiedProfitOverview } = require('../services/unifiedCostService');
    res.json(await getUnifiedProfitOverview());
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/costs/unified/breakdown", async (req, res) => {
  if (req.user?.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });
  try {
    const { getTrainingCostBreakdown } = require('../services/unifiedCostService');
    res.json(await getTrainingCostBreakdown(req.query.organization));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/costs/aws", async (req, res) => {
  if (req.user?.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });
  try {
    const { getAwsCostByUser, getAwsCostByService } = require('../services/awsCostService');
    const [byUser, byService] = await Promise.all([getAwsCostByUser(parseInt(req.query.days) || 30), getAwsCostByService(parseInt(req.query.days) || 30)]);
    res.json({ byUser, byService });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/costs/gcp", async (req, res) => {
  if (req.user?.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });
  try {
    const { getGcpCostByProject } = require('../services/gcpCostService');
    res.json(await getGcpCostByProject(parseInt(req.query.days) || 30));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.get("/costs/containers", async (req, res) => {
  if (req.user?.userType !== 'superadmin') return res.status(403).json({ message: 'Superadmin only' });
  try {
    const { getContainerCostOverview, getContainerCostSummary } = require('../services/containerCostService');
    const [overview, byTraining] = await Promise.all([getContainerCostOverview(), getContainerCostSummary()]);
    res.json({ overview, byTraining });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Custom Image Builder — AI-generated Dockerfile → build → register
const imageBuildJobs = new Map();

router.post("/build-image", async (req, res) => {
  if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { software = [], courseName = 'Custom Lab', imageKey } = req.body;
    if (!software.length) return res.status(400).json({ message: 'software array required' });

    const key = imageKey || `custom-${courseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${Date.now().toString(36)}`;
    const imageName = `getlabs/${key}`;
    const jobId = `build-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const job = {
      jobId, imageKey: key, imageName,
      status: 'generating', phase: 'Generating Dockerfile with AI...',
      software, courseName,
      startedAt: Date.now(),
      logs: [],
    };
    imageBuildJobs.set(jobId, job);
    res.json({ jobId, imageKey: key, status: 'generating' });

    // Background: generate → build → register
    (async () => {
      try {
        const { generateDockerfile, buildImage, registerInCatalog } = require('../services/dockerfileGenerator');

        // Step 1: Generate Dockerfile
        job.phase = 'AI generating Dockerfile...';
        const dockerfile = await generateDockerfile(software, { courseName });
        job.dockerfile = dockerfile;
        job.phase = 'Dockerfile generated. Starting build...';
        job.status = 'building';
        job.logs.push('Dockerfile generated successfully');

        // Step 2: Build
        job.phase = 'Building Docker image (this takes 3-10 minutes)...';
        await buildImage(dockerfile, imageName, '1.0', (log) => {
          job.logs.push(log);
          if (log.includes('Step ')) job.phase = log;
        });
        job.logs.push('Build completed');

        // Step 3: Register
        job.phase = 'Registering in catalog...';
        const label = `${courseName} Lab — ${software.slice(0, 3).join(', ')}${software.length > 3 ? '...' : ''}`;
        registerInCatalog(key, {
          image: `${imageName}:1.0`,
          label,
          software,
        });

        job.status = 'done';
        job.phase = 'Image built and registered in catalog';
        job.finishedAt = Date.now();
        job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);
        job.logs.push(`Registered as ${key} in catalog`);

      } catch (err) {
        job.status = 'failed';
        job.phase = `Failed: ${err.message}`;
        job.logs.push(`Error: ${err.message}`);
        require('../plugins/logger').logger.error(`[build-image] ${err.message}`);
      }
      setTimeout(() => imageBuildJobs.delete(jobId), 30 * 60 * 1000);
    })();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/build-image/:jobId", async (req, res) => {
  const job = imageBuildJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.json({
    ...job,
    logs: job.logs.slice(-20), // last 20 log lines
    duration: job.duration || Math.round((Date.now() - job.startedAt) / 1000),
  });
});

// Shadow / Screen Share — trainer views a student's live VM session
router.post("/shadow/:vmName", async (req, res) => {
  if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { createShadowSession } = require('../services/guacamoleService');
    const readOnly = req.body?.readOnly === true;
    const result = await createShadowSession(req.params.vmName, readOnly);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// B2B Usage Report (PDF — detailed cost/utilization report for customers)
router.get("/usage-report", async (req, res) => {
  if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { trainingName, organization } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName is required' });

    const { generateUsageReport } = require('../services/labReportService');
    const pdf = await generateUsageReport(trainingName, organization);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="usage-report-${trainingName}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Lab Activity Report + Certificates (on-demand PDF)
router.get("/report/:trainingName", async (req, res) => {
  if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { generateReportPDF } = require('../services/labReportService');
    const pdf = await generateReportPDF(req.params.trainingName, req.query.organization);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lab-report-${req.params.trainingName}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Lab Activity data (JSON — for the UI to show a preview before downloading)
router.get("/report/:trainingName/data", async (req, res) => {
  if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  try {
    const { getTrainingActivity } = require('../services/labReportService');
    const data = await getTrainingActivity(req.params.trainingName, req.query.organization);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Docker Host Pool Management
router.get('/docker-hosts', async (req, res) => {
  try {
    const DockerHost = require('../models/dockerHost');
    const hosts = await DockerHost.find({ status: { $ne: 'terminated' } }).sort({ createdAt: -1 }).lean();
    res.json(hosts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/docker-hosts/provision', async (req, res) => {
  try {
    const { provisionNewHost } = require('../services/dockerHostManager');
    res.json({ message: 'Provisioning started' });
    provisionNewHost().catch(e => require('../plugins/logger').logger.error(`Manual provision failed: ${e.message}`));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/docker-hosts/:id', async (req, res) => {
  try {
    const { terminateHost } = require('../services/dockerHostManager');
    await terminateHost(req.params.id);
    res.json({ message: 'Host terminated' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
