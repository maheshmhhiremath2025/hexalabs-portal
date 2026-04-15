const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/user');
const Plan = require('../models/plan');
const Subscription = require('../models/subscription');
const Container = require('../models/container');
const { createContainer } = require('../services/containerService');
const { notifyInstanceReady } = require('../services/emailNotifications');
const { setUser } = require('../services/auth');
const { logger } = require('../plugins/logger');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_ID,
  key_secret: process.env.RAZORPAY_KEY,
});

/**
 * GET /selfservice/plans
 * Public — list available plans.
 */
async function handleGetPlans(req, res) {
  const plans = await Plan.find({ isActive: true }).sort({ priceMonthly: 1 });
  res.json(plans);
}

/**
 * POST /selfservice/signup
 * Public — create account + select plan + get Razorpay order.
 */
async function handleSignup(req, res) {
  try {
    const { email, password, name, planId } = req.body;
    if (!email || !password || !planId) return res.status(400).json({ message: 'email, password, and planId required' });

    // Check existing user
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Account already exists. Please login.' });

    // Get plan
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    // Create user
    const user = new User({
      email,
      password,
      name: name || email,
      organization: `self-${email.split('@')[0]}`,
      userType: 'selfservice',
    });
    await user.save();

    // Free plan — skip Razorpay, activate immediately
    if (plan.priceMonthly === 0) {
      const sub = await Subscription.create({
        userId: user._id, email, planId: plan._id, planName: plan.name, planTier: plan.tier,
        status: 'active',
        containerHoursTotal: plan.containerHours || 0, maxContainers: plan.maxContainers || 0,
        sandboxCredits: {
          azure: { total: plan.sandboxCredits?.azure || 0, used: 0 },
          aws: { total: plan.sandboxCredits?.aws || 0, used: 0 },
          gcp: { total: plan.sandboxCredits?.gcp || 0, used: 0 },
        },
        sandboxTtlHours: plan.sandboxTtlHours || 2,
        sandboxBudgetInr: plan.sandboxBudgetInr || 200,
        vmHoursTotal: plan.vmHours || 0, maxVms: plan.maxVms || 0,
        guidedLabLimit: plan.guidedLabLimit || 0,
        amountPaid: 0,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const token = setUser(user);
      return res.json({
        message: 'Free trial activated',
        uid: token, email: user.email, organization: user.organization, userType: 'selfservice',
        subscription: { id: sub._id, plan: sub.planName },
        isFree: true,
      });
    }

    // Paid plan — create Razorpay order
    const order = await razorpay.orders.create({
      amount: plan.priceMonthly * 100,
      currency: 'INR',
      receipt: `sub_${user._id}_${Date.now()}`,
      notes: { userId: user._id.toString(), planId: plan._id.toString(), email },
    });

    // Create pending subscription with all plan features
    const sub = await Subscription.create({
      userId: user._id,
      email,
      planId: plan._id,
      planName: plan.name,
      planTier: plan.tier,
      status: 'pending',
      containerHoursTotal: plan.containerHours || 0,
      maxContainers: plan.maxContainers || 0,
      sandboxCredits: {
        azure: { total: plan.sandboxCredits?.azure || 0, used: 0 },
        aws: { total: plan.sandboxCredits?.aws || 0, used: 0 },
        gcp: { total: plan.sandboxCredits?.gcp || 0, used: 0 },
      },
      sandboxTtlHours: plan.sandboxTtlHours || 2,
      sandboxBudgetInr: plan.sandboxBudgetInr || 200,
      vmHoursTotal: plan.vmHours || 0,
      maxVms: plan.maxVms || 0,
      guidedLabLimit: plan.guidedLabLimit || 0,
      amountPaid: plan.priceMonthly,
      razorpayOrderId: order.id,
    });

    res.json({
      orderId: order.id,
      amount: plan.priceMonthly,
      currency: 'INR',
      subscriptionId: sub._id,
      razorpayKeyId: process.env.RAZORPAY_ID,
      user: { email, name: user.name },
    });
  } catch (err) {
    logger.error(`Signup error: ${err.message}`);
    res.status(500).json({ message: 'Signup failed' });
  }
}

/**
 * POST /selfservice/verify-payment
 * Public — verify Razorpay payment and activate subscription.
 */
async function handleVerifyPayment(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, subscriptionId } = req.body;

    // Verify signature
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    // Activate subscription
    const sub = await Subscription.findById(subscriptionId);
    if (!sub) return res.status(404).json({ message: 'Subscription not found' });

    sub.status = 'active';
    sub.razorpayPaymentId = razorpay_payment_id;
    sub.startsAt = new Date();
    sub.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await sub.save();

    // Generate login token
    const user = await User.findById(sub.userId);
    const token = setUser(user);

    res.json({
      message: 'Payment verified. Subscription active.',
      uid: token,
      email: user.email,
      organization: user.organization,
      userType: 'selfservice',
      subscription: {
        id: sub._id,
        plan: sub.planName,
        hoursTotal: sub.hoursTotal,
        maxInstances: sub.maxInstances,
        expiresAt: sub.expiresAt,
      },
    });
  } catch (err) {
    logger.error(`Payment verify error: ${err.message}`);
    res.status(500).json({ message: 'Payment verification failed' });
  }
}

/**
 * GET /selfservice/dashboard
 * Auth — get self-service user's subscription and instances.
 */
async function handleDashboard(req, res) {
  try {
    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });
    if (!sub) return res.json({ subscription: null, instances: [] });

    const instances = await Container.find({ email: req.user.email, isAlive: true });

    // Update container hours used
    let totalHours = 0;
    instances.forEach(c => { totalHours += (c.duration || 0) / 3600; });
    sub.containerHoursUsed = Math.round(totalHours * 100) / 100;
    sub.activeContainers = instances.filter(c => c.isRunning).length;
    await sub.save();

    res.json({
      subscription: {
        id: sub._id,
        plan: sub.planName,
        tier: sub.planTier,
        status: sub.status,
        // Container quota
        containerHours: { total: sub.containerHoursTotal, used: sub.containerHoursUsed, remaining: Math.max(0, sub.containerHoursTotal - sub.containerHoursUsed) },
        maxContainers: sub.maxContainers,
        activeContainers: sub.activeContainers,
        // Sandbox credits
        sandboxCredits: {
          azure: { total: sub.sandboxCredits?.azure?.total || 0, used: sub.sandboxCredits?.azure?.used || 0, remaining: Math.max(0, (sub.sandboxCredits?.azure?.total || 0) - (sub.sandboxCredits?.azure?.used || 0)) },
          aws: { total: sub.sandboxCredits?.aws?.total || 0, used: sub.sandboxCredits?.aws?.used || 0, remaining: Math.max(0, (sub.sandboxCredits?.aws?.total || 0) - (sub.sandboxCredits?.aws?.used || 0)) },
          gcp: { total: sub.sandboxCredits?.gcp?.total || 0, used: sub.sandboxCredits?.gcp?.used || 0, remaining: Math.max(0, (sub.sandboxCredits?.gcp?.total || 0) - (sub.sandboxCredits?.gcp?.used || 0)) },
        },
        sandboxTtlHours: sub.sandboxTtlHours,
        // VM quota
        vmHours: { total: sub.vmHoursTotal, used: sub.vmHoursUsed, remaining: Math.max(0, sub.vmHoursTotal - sub.vmHoursUsed) },
        maxVms: sub.maxVms,
        // Meta
        expiresAt: sub.expiresAt,
        daysRemaining: Math.max(0, Math.ceil((new Date(sub.expiresAt) - new Date()) / (24 * 60 * 60 * 1000))),
      },
      instances: instances.map(c => ({
        _id: c._id,
        name: c.name,
        image: c.image,
        os: c.os,
        cpus: c.cpus,
        memory: c.memory,
        isRunning: c.isRunning,
        accessUrl: `${c.accessProtocol || 'http'}://${c.hostIp}:${c.vncPort}`,
        password: c.password,
        containerId: c.containerId,
        runtimeHours: Math.round((c.duration || 0) / 3600 * 10) / 10,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) {
    logger.error(`Self-service dashboard error: ${err.message}`);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
}

/**
 * POST /selfservice/sandbox
 * Auth — create a cloud sandbox within subscription limits.
 */
async function handleSelfSandbox(req, res) {
  try {
    const { cloud = 'azure', name, googleEmail } = req.body; // cloud: azure, aws, gcp
    if (!name) return res.status(400).json({ message: 'Sandbox name required' });

    // GCP requires a Google account (Gmail or Google Workspace) for console access.
    // The portal email won't work — GCP IAM needs a real Google identity.
    if (cloud === 'gcp' && !googleEmail) {
      return res.status(400).json({
        message: 'GCP sandboxes require your Google email (Gmail or Google Workspace). Your portal email cannot be used to sign into GCP Console.',
        field: 'googleEmail',
      });
    }

    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });
    if (!sub) return res.status(403).json({ message: 'No active subscription' });

    // Check sandbox credits
    const credits = sub.sandboxCredits?.[cloud];
    if (!credits || credits.used >= credits.total) {
      return res.status(403).json({ message: `No ${cloud.toUpperCase()} sandbox credits remaining (${credits?.used || 0}/${credits?.total || 0})` });
    }

    const { createAzureSandbox, createAwsSandbox, createGcpSandbox } = require('../services/directSandbox');
    const trainingName = `self-${req.user.email.split('@')[0]}`;
    const resourceGroupName = `${trainingName}-${name}-sandbox`;
    const ttlHours = sub.sandboxTtlHours || 2;
    const budgetCap = sub.sandboxBudgetInr || 200;
    let sandboxResult = {};

    if (cloud === 'azure') {
      const SandboxUser = require('../models/sandboxuser');
      let sbUser = await SandboxUser.findOne({ email: req.user.email });
      if (!sbUser) {
        sbUser = await SandboxUser.create({
          email: req.user.email, userId: String(req.user._id), duration: 30,
          credits: { total: credits.total, consumed: 0 },
          sandboxTtlHours: ttlHours, startDate: new Date(), endDate: sub.expiresAt,
        });
      }

      const azResult = await createAzureSandbox(resourceGroupName, 'southindia', sbUser.userId, req.user.email);

      const now = new Date();
      sbUser.sandbox.push({
        resourceGroupName, location: 'southindia',
        createdTime: now, deleteTime: new Date(now.getTime() + ttlHours * 60 * 60 * 1000),
        status: 'ready', accessUrl: azResult.accessUrl,
        credentials: { username: azResult.username || req.user.email, password: azResult.password || 'Contact admin' },
        restrictions: { allowedVmSizes: ['B1s', 'B1ms', 'B2s', 'B2ms', 'B4ms'], budgetCap, blockedServices: ['GPU', 'Premium SSD', 'D/E/F-series'] },
      });
      sbUser.credits.consumed = (sbUser.credits.consumed || 0) + 1;
      await sbUser.save();

      sandboxResult = { credentials: { username: azResult.username || req.user.email, password: azResult.password || 'Contact admin' }, accessUrl: azResult.accessUrl };
    } else if (cloud === 'aws') {
      const awsUsername = `${trainingName}${name}`.replace(/[^a-zA-Z0-9._@+-]/g, '').slice(0, 30);
      const awsResult = await createAwsSandbox(awsUsername, req.user.email);

      const awsUserModel = require('../models/aws');
      const awsDeleteTime = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
      await awsUserModel.findOneAndUpdate({ email: req.user.email },
        { email: req.user.email, userId: awsResult.username, password: awsResult.password,
          duration: ttlHours / 24, sandboxTtlHours: ttlHours,
          startDate: new Date(), endDate: awsDeleteTime },
        { upsert: true, new: true });

      sandboxResult = { credentials: { username: awsResult.username, password: awsResult.password }, accessUrl: awsResult.accessUrl };
    } else if (cloud === 'gcp') {
      const { getOrCreateSharedProject, addUserToSharedProject } = require('../services/gcpSharedProject');
      const org = req.user.organization || 'getlabs';

      // Find or create a shared project (1 project per 5 users)
      const { projectId, isNew } = await getOrCreateSharedProject(org, ttlHours, budgetCap);

      // If new project, create it on GCP
      if (isNew) {
        await createGcpSandbox(projectId, googleEmail, budgetCap);
      }

      // Add user as Editor to the shared project (using their Google email)
      await addUserToSharedProject(projectId, googleEmail, isNew);

      // Save to DB
      const GcpSandboxUser = require('../models/gcpSandboxUser');
      let gcpUser = await GcpSandboxUser.findOne({ email: req.user.email });
      const sandboxEntry = {
        projectId, projectName: name,
        createdTime: new Date(), deleteTime: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
        isShared: true, sharedUsers: [req.user.email], maxUsers: 5,
      };

      if (!gcpUser) {
        gcpUser = await GcpSandboxUser.create({
          email: req.user.email, googleEmail: req.user.email,
          duration: Math.ceil((sub.expiresAt - new Date()) / (24 * 60 * 60 * 1000)),
          sandboxTtlHours: ttlHours, credits: { total: credits.total, consumed: 1 },
          budgetLimit: budgetCap, startDate: new Date(), endDate: sub.expiresAt,
          sandbox: [sandboxEntry],
        });
      } else {
        gcpUser.sandbox.push(sandboxEntry);
        gcpUser.credits.consumed = (gcpUser.credits.consumed || 0) + 1;
        await gcpUser.save();
      }

      // Also track the user in the shared project's sharedUsers list (across all users)
      await GcpSandboxUser.updateOne(
        { 'sandbox.projectId': projectId },
        { $addToSet: { 'sandbox.$.sharedUsers': req.user.email } }
      );

      sandboxResult = {
        credentials: { username: req.user.email, password: 'Use Google account' },
        accessUrl: `https://console.cloud.google.com/home/dashboard?project=${projectId}`,
        projectId,
        sharedWith: isNew ? '1/5 users' : 'Shared project',
      };
    }

    // Increment used credits
    sub.sandboxCredits[cloud].used += 1;
    await sub.save();

    const accessMap = {
      azure: {
        status: '✅ Azure sandbox created!',
        accessUrl: sandboxResult.accessUrl || 'https://portal.azure.com',
        credentials: sandboxResult.credentials || { username: req.user.email, password: 'Use Azure AD login' },
        region: 'South India (southindia)',
        resourceGroup: resourceGroupName,
        allowed: {
          vmSizes: ['Standard_B1s (1 vCPU, 1 GB)', 'Standard_B1ms (1 vCPU, 2 GB)', 'Standard_B2s (2 vCPU, 4 GB)', 'Standard_B2ms (2 vCPU, 8 GB)', 'Standard_B4ms (4 vCPU, 16 GB)'],
          storage: ['Standard HDD', 'Standard SSD'],
          services: ['Virtual Machines', 'Storage Accounts', 'Virtual Networks', 'NSGs', 'Public IPs', 'Azure Functions', 'App Service (Basic tier)'],
        },
        blocked: {
          vmSizes: ['D-series', 'E-series', 'F-series', 'GPU (NC/ND/NV)', 'M-series (memory)'],
          storage: ['Premium SSD', 'Ultra Disk'],
          services: ['Azure Kubernetes Service', 'Azure SQL (Premium)', 'Cosmos DB', 'Azure Databricks', 'HDInsight'],
        },
        budgetCap,
      },
      aws: {
        status: '✅ AWS sandbox created!',
        accessUrl: sandboxResult.accessUrl || 'https://475184346033.signin.aws.amazon.com/console',
        credentials: sandboxResult.credentials || { username: 'pending', password: 'pending' },
        region: 'Asia Pacific - Mumbai (ap-south-1)',
        allowed: {
          vmSizes: ['t2.micro (1 vCPU, 1 GB)', 't2.small (1 vCPU, 2 GB)', 't2.medium (2 vCPU, 4 GB)', 't3.micro (2 vCPU, 1 GB)', 't3.small (2 vCPU, 2 GB)', 't3.medium (2 vCPU, 4 GB)'],
          storage: ['gp2/gp3 (max 50 GB per volume)', 'Standard S3'],
          services: ['EC2', 'S3', 'Lambda', 'IAM', 'VPC', 'CloudWatch', 'SNS', 'SQS', 'DynamoDB'],
        },
        blocked: {
          vmSizes: ['m-series', 'c-series', 'r-series', 'p-series (GPU)', 'g-series (GPU)', 'inf/trn (AI)'],
          storage: ['io1/io2 (provisioned IOPS)', 'Volumes > 50 GB'],
          services: ['Redshift', 'ElastiCache', 'EMR', 'SageMaker', 'EKS', 'RDS (large instances)'],
        },
        budgetCap,
      },
      gcp: {
        status: '✅ GCP sandbox created!',
        accessUrl: sandboxResult.accessUrl || 'https://console.cloud.google.com',
        credentials: sandboxResult.credentials || { username: req.user.email, password: 'Use Google account' },
        region: 'Asia South - Mumbai (asia-south1)',
        allowed: {
          vmSizes: ['e2-micro (0.25 vCPU, 1 GB)', 'e2-small (0.5 vCPU, 2 GB)', 'e2-medium (1 vCPU, 4 GB)', 'e2-standard-2 (2 vCPU, 8 GB)', 'f1-micro (free tier)'],
          storage: ['Standard persistent disk', 'Cloud Storage (Standard)'],
          services: ['Compute Engine', 'Cloud Storage', 'Cloud Functions', 'BigQuery (free tier)', 'VPC', 'IAM', 'Cloud Shell'],
        },
        blocked: {
          vmSizes: ['n2/n2d series', 'c2 series', 'a2 (GPU)', 'g2 (GPU)', 'm1/m2 (memory)'],
          storage: ['SSD persistent disk (premium)', 'Local SSD'],
          services: ['GKE', 'BigTable', 'Spanner', 'Dataproc', 'Vertex AI'],
        },
        budgetCap,
      },
    };

    res.json({
      message: `${cloud.toUpperCase()} sandbox created!`,
      cloud,
      name: resourceGroupName,
      ttlHours,
      creditsRemaining: credits.total - credits.used - 1,
      access: accessMap[cloud],
    });
  } catch (err) {
    logger.error(`Self-service sandbox error: ${err.message}`);
    res.status(500).json({ message: 'Sandbox creation failed' });
  }
}

/**
 * GET /selfservice/sandboxes
 * Auth — get user's active sandboxes with access details.
 */
async function handleGetSandboxes(req, res) {
  try {
    const SandboxUser = require('../models/sandboxuser');
    const awsUser = require('../models/aws');
    const GcpSandboxUser = require('../models/gcpSandboxUser');

    const sandboxes = [];
    const subscriptionId = process.env.SUBSCRIPTION_ID;
    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });
    const planBudget = sub?.sandboxBudgetInr || 100;

    function formatTtl(deleteTime) {
      if (!deleteTime) return null;
      const mins = Math.max(0, Math.round((new Date(deleteTime) - new Date()) / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return { minutes: mins, display: `${h}h ${m}m` };
    }

    // Azure sandboxes
    const azUser = await SandboxUser.findOne({ email: req.user.email });
    if (azUser?.sandbox?.length) {
      for (const sb of azUser.sandbox) {
        const ttl = formatTtl(sb.deleteTime);
        sandboxes.push({
          cloud: 'azure',
          name: sb.resourceGroupName,
          status: sb.status || 'provisioning',
          // Complete access details
          loginUrl: 'https://portal.azure.com',
          resourceUrl: sb.accessUrl || `https://portal.azure.com/#@${process.env.TENANT_ID}/resource/subscriptions/${subscriptionId}/resourceGroups/${sb.resourceGroupName}`,
          resourceGroup: sb.resourceGroupName,
          region: sb.location || 'South India (southindia)',
          subscriptionId: subscriptionId,
          // Credentials
          credentials: sb.credentials || {},
          // Restrictions
          allowed: { vmSizes: ['Standard_B1s (1 vCPU, 1 GB)', 'Standard_B1ms (1 vCPU, 2 GB)', 'Standard_B2s (2 vCPU, 4 GB)', 'Standard_B2ms (2 vCPU, 8 GB)', 'Standard_B4ms (4 vCPU, 16 GB)'], storage: ['Standard HDD', 'Standard SSD'], services: ['Virtual Machines', 'Storage Accounts', 'Virtual Networks', 'NSGs', 'Public IPs', 'Azure Functions', 'App Service (Basic)'] },
          blocked: { vmSizes: ['D-series', 'E-series', 'F-series', 'GPU (NC/ND/NV)', 'M-series'], storage: ['Premium SSD', 'Ultra Disk'], services: ['AKS', 'Azure SQL Premium', 'Cosmos DB', 'Databricks'] },
          budgetCap: sb.restrictions?.budgetCap || 200,
          // Time
          createdTime: sb.createdTime,
          deleteTime: sb.deleteTime,
          ttl: ttl,
        });
      }
    }

    // AWS sandboxes
    const awUser = await awsUser.findOne({ email: req.user.email });
    if (awUser) {
      const ttl = formatTtl(awUser.endDate);
      sandboxes.push({
        cloud: 'aws',
        name: awUser.userId,
        status: 'ready',
        loginUrl: 'https://475184346033.signin.aws.amazon.com/console',
        accountId: '475184346033',
        region: 'Asia Pacific - Mumbai (ap-south-1)',
        credentials: { username: awUser.userId, password: awUser.password },
        allowed: { vmSizes: ['t2.micro (1 vCPU, 1 GB)', 't2.small (1 vCPU, 2 GB)', 't2.medium (2 vCPU, 4 GB)', 't3.micro', 't3.small', 't3.medium'], storage: ['gp2/gp3 (max 50 GB)', 'S3 Standard'], services: ['EC2', 'S3', 'Lambda', 'IAM', 'VPC', 'CloudWatch', 'SNS', 'SQS', 'DynamoDB'] },
        blocked: { vmSizes: ['m-series', 'c-series', 'r-series', 'p-series (GPU)', 'g-series (GPU)'], storage: ['io1/io2', 'Volumes > 50 GB'], services: ['Redshift', 'ElastiCache', 'EMR', 'SageMaker', 'EKS'] },
        budgetCap: sub?.sandboxBudgetInr || 100,
        createdTime: awUser.startDate,
        deleteTime: awUser.endDate,
        ttl: ttl,
      });
    }

    // GCP sandboxes
    const gcpUser = await GcpSandboxUser.findOne({ email: req.user.email });
    if (gcpUser?.sandbox?.length) {
      for (const sb of gcpUser.sandbox) {
        const ttl = formatTtl(sb.deleteTime);
        sandboxes.push({
          cloud: 'gcp',
          name: sb.projectId,
          status: 'ready',
          loginUrl: 'https://console.cloud.google.com',
          projectUrl: `https://console.cloud.google.com/home/dashboard?project=${sb.projectId}`,
          projectId: sb.projectId,
          region: 'Asia South - Mumbai (asia-south1)',
          credentials: { username: gcpUser.googleEmail || req.user.email, password: 'Use Google account login' },
          allowed: { vmSizes: ['e2-micro (0.25 vCPU, 1 GB)', 'e2-small (0.5 vCPU, 2 GB)', 'e2-medium (1 vCPU, 4 GB)', 'f1-micro (free tier)'], storage: ['Standard persistent disk', 'Cloud Storage Standard'], services: ['Compute Engine', 'Cloud Storage', 'Cloud Functions', 'BigQuery (free tier)', 'VPC', 'IAM', 'Cloud Shell'] },
          blocked: { vmSizes: ['n2/n2d', 'c2', 'a2 (GPU)', 'g2 (GPU)', 'm1/m2 (memory)'], storage: ['SSD persistent disk', 'Local SSD'], services: ['GKE', 'BigTable', 'Spanner', 'Dataproc', 'Vertex AI'] },
          budgetCap: gcpUser.budgetLimit || 500,
          createdTime: sb.createdTime,
          deleteTime: sb.deleteTime,
          ttl: ttl,
        });
      }
    }

    // Mark expired, separate active vs expired
    for (const sb of sandboxes) {
      if (sb.ttl && sb.ttl.minutes <= 0) {
        sb.status = 'expired';
      }
    }

    const active = sandboxes.filter(sb => sb.status !== 'expired');
    const expired = sandboxes.filter(sb => sb.status === 'expired');

    res.json({ active, expired, total: sandboxes.length });
  } catch (err) {
    logger.error(`Get sandboxes error: ${err.message}`);
    res.status(500).json({ message: 'Failed to load sandboxes' });
  }
}

/**
 * POST /selfservice/deploy
 * Auth — deploy a container within subscription limits.
 */
async function handleSelfDeploy(req, res) {
  try {
    const { imageKey = 'ubuntu-xfce' } = req.body;
    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });

    if (!sub) return res.status(403).json({ message: 'No active subscription. Please purchase a plan.' });
    if (new Date(sub.expiresAt) < new Date()) {
      sub.status = 'expired';
      await sub.save();
      return res.status(403).json({ message: 'Subscription expired. Please renew.' });
    }

    const totalHours = sub.containerHoursTotal || sub.hoursTotal || 0;
    const usedHours = sub.containerHoursUsed || sub.hoursUsed || 0;
    if (usedHours >= totalHours) return res.status(403).json({ message: 'Container hours exhausted. Please upgrade your plan.' });

    const maxContainers = sub.maxContainers || sub.maxInstances || 1;
    const activeCount = await Container.countDocuments({ email: req.user.email, isAlive: true, isRunning: true });
    if (activeCount >= maxContainers) return res.status(403).json({ message: `Maximum ${maxContainers} simultaneous containers allowed on your plan.` });

    const trainingName = `self-${req.user.email.split('@')[0]}`;
    const existingCount = await Container.countDocuments({ email: req.user.email });
    const name = `${trainingName}-${existingCount + 1}`;

    const result = await createContainer({
      name,
      trainingName,
      organization: req.user.organization,
      email: req.user.email,
      imageKey,
      cpus: 2,
      memory: 4096,
      allocatedHours: totalHours - usedHours,
      rate: 0, // self-service — prepaid via subscription
      azureEquivalentRate: 25,
      password: 'Welcome1234!',
    });

    // Send email
    notifyInstanceReady({
      email: req.user.email,
      name,
      type: 'container',
      accessUrl: result.accessUrl,
      password: result.password,
      organization: req.user.organization,
      trainingName,
    }).catch(() => {});

    res.json(result);
  } catch (err) {
    logger.error(`Self-deploy error: ${err.message}`);
    res.status(500).json({ message: 'Deployment failed' });
  }
}

/**
 * POST /selfservice/stop
 * Auth — stop own container.
 */
async function handleSelfStop(req, res) {
  try {
    const { containerId } = req.body;
    const container = await Container.findOne({ containerId, email: req.user.email });
    if (!container) return res.status(404).json({ message: 'Container not found' });

    const { stopContainer } = require('../services/containerService');
    await stopContainer(containerId);
    res.json({ message: 'Container stopped' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to stop' });
  }
}

/**
 * POST /selfservice/start
 * Auth — start own container.
 */
async function handleSelfStart(req, res) {
  try {
    const { containerId } = req.body;
    const container = await Container.findOne({ containerId, email: req.user.email });
    if (!container) return res.status(404).json({ message: 'Container not found' });

    const sub = await Subscription.findOne({ email: req.user.email, status: 'active' });
    if (!sub || sub.hoursUsed >= sub.hoursTotal) return res.status(403).json({ message: 'Quota exhausted' });

    const { startContainer } = require('../services/containerService');
    await startContainer(containerId);
    res.json({ message: 'Container started' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to start' });
  }
}

/**
 * DELETE /selfservice/instance
 * Auth — delete own container.
 */
async function handleSelfDelete(req, res) {
  try {
    const { containerId } = req.body;
    const container = await Container.findOne({ containerId, email: req.user.email });
    if (!container) return res.status(404).json({ message: 'Container not found' });

    const { deleteContainer } = require('../services/containerService');
    await deleteContainer(containerId);
    res.json({ message: 'Container deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete' });
  }
}

module.exports = {
  handleGetPlans, handleSignup, handleVerifyPayment,
  handleDashboard, handleGetSandboxes, handleSelfDeploy, handleSelfSandbox,
  handleSelfStop, handleSelfStart, handleSelfDelete,
};
