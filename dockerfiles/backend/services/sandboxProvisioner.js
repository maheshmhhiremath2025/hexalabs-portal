/**
 * Sandbox Provisioner — per-student cloud sandbox creation for guided lab deploys.
 * Extracts the core provisioning logic from bulk deploy controllers (sandbox.js, bulkDeploy.js, gcpSandbox.js)
 * into a reusable function that deployGuidedLab() can call.
 */
const { logger } = require('../plugins/logger');
const SandboxTemplate = require('../models/sandboxTemplate');
const SandboxUser = require('../models/sandboxuser');
const awsUser = require('../models/aws');
const GcpSandboxUser = require('../models/gcpSandboxUser');
const User = require('../models/user');

/**
 * Provision a cloud sandbox for a single student.
 *
 * @param {Object} opts
 * @param {Object} opts.template       — SandboxTemplate document (already loaded)
 * @param {string} opts.email          — student email
 * @param {number} opts.ttlHours       — sandbox TTL in hours (default: template.sandboxConfig.ttlHours)
 * @param {string} opts.region         — cloud region override (default: template.sandboxConfig.region)
 * @param {number} opts.dailyCapHours  — max hours/day (default: 12)
 * @param {number} opts.totalCapHours  — max total hours (default: 0 = unlimited)
 * @param {Date}   opts.expiresAt      — hard expiry (default: now + ttlHours)
 * @param {boolean} opts.skipWelcomeEmail — skip sending welcome email (default: false)
 * @param {boolean} opts.deferActivation — provision infrastructure but don't start the timer (default: false)
 * @returns {Object} { success, cloud, email, credentials, error? }
 */
async function provisionSandboxForStudent(opts) {
  const {
    template,
    email: rawEmail,
    ttlHours: ttlOverride,
    region: regionOverride,
    dailyCapHours = 12,
    totalCapHours = 0,
    expiresAt: expiresAtOverride,
    skipWelcomeEmail = false,
    deferActivation = false,
  } = opts;

  const email = rawEmail.trim().toLowerCase();
  const cloud = template.cloud;
  const ttlHours = ttlOverride || template.sandboxConfig?.ttlHours || 4;
  const expiresAt = deferActivation
    ? null
    : (expiresAtOverride ? new Date(expiresAtOverride) : new Date(Date.now() + ttlHours * 60 * 60 * 1000));

  try {
    let result;
    if (cloud === 'azure') {
      result = await _provisionAzure({ template, email, ttlHours, region: regionOverride, dailyCapHours, totalCapHours, expiresAt, deferActivation });
    } else if (cloud === 'aws') {
      result = await _provisionAws({ template, email, ttlHours, region: regionOverride, dailyCapHours, totalCapHours, expiresAt, deferActivation });
    } else if (cloud === 'gcp') {
      result = await _provisionGcp({ template, email, ttlHours, dailyCapHours, totalCapHours, expiresAt, deferActivation });
    } else {
      throw new Error(`Unsupported sandbox cloud: ${cloud}`);
    }

    // Auto-create portal login if user doesn't exist
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      await User.create({ email, name: email, password: 'Welcome1234!', userType: 'sandboxuser', organization: template.name });
      logger.info(`[sandbox-provisioner] Portal user created: ${email}`);
    }

    // Send welcome email (optional)
    if (!skipWelcomeEmail) {
      try {
        const { notifySandboxWelcomeEmail } = require('./emailNotifications');
        await notifySandboxWelcomeEmail({
          email, cloud, portalPassword: 'Welcome1234!',
          sandboxUsername: result.credentials.username,
          sandboxPassword: result.credentials.password,
          sandboxAccessUrl: result.credentials.accessUrl,
          region: result.credentials.region,
          expiresAt, templateName: template.name,
          allowedServices: template.allowedServices,
          blockedServices: template.blockedServices,
          ...(cloud === 'azure' && { resourceGroupName: result.resourceId }),
          ...(cloud === 'gcp' && { projectId: result.resourceId }),
        });
      } catch (emailErr) {
        logger.error(`[sandbox-provisioner] Welcome email failed for ${email}: ${emailErr.message}`);
      }
    }

    logger.info(`[sandbox-provisioner] ${cloud} sandbox provisioned for ${email} (${result.resourceId})`);
    return { success: true, cloud, email, credentials: result.credentials, resourceId: result.resourceId };
  } catch (err) {
    logger.error(`[sandbox-provisioner] Failed ${cloud} sandbox for ${email}: ${err.message}`);
    return { success: false, cloud, email, error: err.message };
  }
}

// ─── Azure provisioning ────────────────────────────────────────────────────
async function _provisionAzure({ template, email, ttlHours, region: regionOverride, dailyCapHours, totalCapHours, expiresAt, deferActivation }) {
  const { createAzureSandbox } = require('./directSandbox');
  const azRegion = regionOverride || template.sandboxConfig?.region || 'southindia';

  // Generate unique resource group name (same pattern as sandbox.js bulk deploy)
  const cleanName = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const rgName = `tpl-${(template.certificationCode || template.slug).slice(0, 10)}-${cleanName}-${randSuffix}-sbx`.toLowerCase().slice(0, 60);

  const azResult = await createAzureSandbox(rgName, azRegion, null, email, template.customRoleId);

  // Apply Azure Policies (initiative or individual)
  try {
    const { ClientSecretCredential } = require('@azure/identity');
    const { PolicyClient } = require('@azure/arm-policy');
    const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
    const policyClient = new PolicyClient(credential, process.env.SUBSCRIPTION_ID);
    const scope = `/subscriptions/${process.env.SUBSCRIPTION_ID}/resourceGroups/${rgName}`;

    if (template.policyInitiativeId) {
      await policyClient.policyAssignments.create(scope, `sb-init-${rgName.slice(0, 38)}`, {
        policyDefinitionId: template.policyInitiativeId,
        displayName: `Sandbox: ${template.name}`,
      });
      logger.info(`[sandbox-provisioner] Azure policy initiative applied to ${rgName}`);
    } else {
      const { applyAllSandboxPolicies } = require('./azureSandboxPolicies');
      await applyAllSandboxPolicies(policyClient, process.env.SUBSCRIPTION_ID, rgName, template, azRegion);
    }
  } catch (policyErr) {
    logger.error(`[sandbox-provisioner] Azure policy failed for ${rgName}: ${policyErr.message}`);
  }

  // Create/update SandboxUser record
  let sandboxUser = await SandboxUser.findOne({ email });
  if (!sandboxUser) {
    sandboxUser = new SandboxUser({
      email,
      userId: `tpl-${cleanName}-${randSuffix}`,
      duration: Math.ceil(ttlHours / 24) || 1,
      credits: { total: 1, consumed: 0 },
      startDate: new Date(),
      ...(expiresAt && { endDate: expiresAt }),
    });
  }

  sandboxUser.sandbox.push({
    resourceGroupName: rgName,
    location: azRegion,
    createdTime: new Date(),
    ...(expiresAt && { deleteTime: expiresAt, expiresAt }),
    status: deferActivation ? 'provisioned' : 'ready',
    accessUrl: azResult.accessUrl,
    credentials: { username: azResult.username, password: azResult.password },
    templateId: template._id,
    allowedServices: (template.allowedServices || []).map(s => ({
      service: s.service, category: s.category, restrictions: s.restrictions,
    })),
    blockedServices: (template.blockedServices || []).map(s => ({
      service: s.service, reason: s.reason,
    })),
  });
  sandboxUser.dailyCapHours = dailyCapHours;
  sandboxUser.totalCapHours = totalCapHours;
  sandboxUser.sandboxTtlHours = ttlHours;
  if (!deferActivation) {
    sandboxUser.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug: template.slug });
  }
  await sandboxUser.save();

  return {
    resourceId: rgName,
    credentials: {
      username: azResult.username,
      password: azResult.password,
      accessUrl: azResult.accessUrl,
      region: azRegion,
    },
  };
}

// ─── AWS provisioning ──────────────────────────────────────────────────────
async function _provisionAws({ template, email, ttlHours, region: regionOverride, dailyCapHours, totalCapHours, expiresAt, deferActivation }) {
  const { createAwsSandbox } = require('./directSandbox');

  const useConnectAccount = template.sandboxConfig?.useConnectAccount === true;
  const awsAccessKey = useConnectAccount ? process.env.AWS_CONNECT_ACCESS_KEY : process.env.AWS_ACCESS_KEY;
  const awsSecretKey = useConnectAccount ? process.env.AWS_CONNECT_ACCESS_SECRET : process.env.AWS_ACCESS_SECRET;
  const awsRegion = regionOverride || (useConnectAccount ? (process.env.AWS_CONNECT_REGION || 'us-east-1') : (template.sandboxConfig?.region || 'ap-south-1'));

  // Generate unique username
  const cleanName = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 15);
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const username = `lab-${template.certificationCode || 'aws'}-${cleanName}-${randSuffix}`
    .replace(/[^a-zA-Z0-9._@+-]/g, '').slice(0, 64);

  const awsResult = await createAwsSandbox(username, email, useConnectAccount ? { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } : undefined);

  // Attach Connect-specific policy if applicable
  if (useConnectAccount && process.env.AWS_CONNECT_STUDENT_POLICY_ARN) {
    try {
      const { IAMClient, AttachUserPolicyCommand } = require('@aws-sdk/client-iam');
      const connectIam = new IAMClient({ region: awsRegion, credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } });
      await connectIam.send(new AttachUserPolicyCommand({ UserName: username, PolicyArn: process.env.AWS_CONNECT_STUDENT_POLICY_ARN }));
    } catch (e) { logger.error(`[sandbox-provisioner] Connect policy attach failed: ${e.message}`); }
  }

  // Replace base policies with compact CoursePolicy (same as bulkDeploy.js)
  try {
    const { IAMClient, PutUserPolicyCommand, DeleteUserPolicyCommand } = require('@aws-sdk/client-iam');
    const client = new IAMClient({ region: awsRegion, credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } });

    // Remove base policies added by createAwsSandbox
    for (const pn of ['SandboxCostRestrictions', 'InstanceTypeAndRegionLock']) {
      try { await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: pn })); } catch {}
    }

    // Build compact CoursePolicy
    const AWS_SVC = {
      ec2: 'ec2', s3: 's3', lambda: 'lambda', rds: 'rds', dynamodb: 'dynamodb',
      vpc: 'ec2', iam: 'iam', cloudwatch: 'cloudwatch', cloudtrail: 'cloudtrail',
      cloudfront: 'cloudfront', 'systems manager': 'ssm', 'billing dashboard': 'ce',
      ebs: 'ec2', 'amazon connect': 'connect', 'amazon connect ccp': 'connect',
      sns: 'sns', sqs: 'sqs', cloudformation: 'cloudformation',
      ecs: 'ecs', ecr: 'ecr', codebuild: 'codebuild', codedeploy: 'codedeploy',
      codepipeline: 'codepipeline', codecommit: 'codecommit',
      'elastic load balancing': 'elasticloadbalancing', 'ec2 auto scaling': 'autoscaling',
      cloudshell: 'cloudshell', efs: 'elasticfilesystem', 's3 glacier': 'glacier',
      athena: 'athena', 'route 53': 'route53', 'api gateway': 'apigateway',
      'step functions': 'states', eventbridge: 'events', ses: 'ses',
      kms: 'kms', 'secrets manager': 'secretsmanager', 'certificate manager': 'acm',
      guardduty: 'guardduty', polly: 'polly', rekognition: 'rekognition',
      'lex v1 & v2': 'lex', translate: 'translate',
      'resource tagging': 'tag', 'health dashboard': 'health',
      'resource groups': 'resource-groups',
      m2: 'm2', appstream: 'appstream', workspaces: 'workspaces', logs: 'logs',
      elasticloadbalancing: 'elasticloadbalancing', elb: 'elasticloadbalancing',
      ssm: 'ssm', autoscaling: 'autoscaling', applicationautoscaling: 'application-autoscaling',
    };

    const allowPrefixes = new Set();
    for (const svc of template.allowedServices || []) {
      const prefix = AWS_SVC[svc.service.toLowerCase()] || svc.service.toLowerCase().replace(/[^a-z0-9]/g, '');
      allowPrefixes.add(prefix + ':*');
    }
    const denyPrefixes = [];
    for (const svc of template.blockedServices || []) {
      const prefix = AWS_SVC[svc.service.toLowerCase()] || svc.service.toLowerCase().replace(/[^a-z0-9]/g, '');
      denyPrefixes.push(prefix + ':*');
    }

    const region = template.sandboxConfig?.region || 'ap-south-1';
    const statements = [
      { Sid: 'Allow', Effect: 'Allow', Action: [...allowPrefixes], Resource: '*' },
    ];
    if (denyPrefixes.length) {
      statements.push({ Sid: 'Deny', Effect: 'Deny', Action: denyPrefixes, Resource: '*' });
    }
    statements.push({
      Sid: 'DenyBadEC2', Effect: 'Deny', Action: 'ec2:RunInstances',
      Resource: 'arn:aws:ec2:*:*:instance/*',
      Condition: { 'ForAllValues:StringNotEquals': { 'ec2:InstanceType': ['t2.micro', 't3.micro', 't3.small'] } },
    });
    statements.push({
      Sid: 'RegionLock', Effect: 'Deny',
      Action: ['ec2:RunInstances', 'ec2:CreateVolume', 'rds:CreateDBInstance', 's3:CreateBucket'],
      Resource: '*',
      Condition: { StringNotEquals: { 'aws:RequestedRegion': region } },
    });

    await client.send(new PutUserPolicyCommand({
      UserName: username, PolicyName: 'CoursePolicy',
      PolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: statements }),
    }));
    logger.info(`[sandbox-provisioner] AWS CoursePolicy applied for ${email}`);
  } catch (e) {
    logger.error(`[sandbox-provisioner] AWS CoursePolicy failed for ${email}: ${e.message}`);
  }

  // Create/update awsUser record
  const now = new Date();
  const awsFields = {
    email, userId: username, password: awsResult.password,
    accessUrl: awsResult.accessUrl, region: awsResult.region,
    duration: Math.ceil(ttlHours / 24) || 1,
    sandboxTtlHours: ttlHours,
    startDate: now,
    ...(expiresAt && { endDate: expiresAt, expiresAt }),
    templateId: template._id,
    templateSlug: template.slug,
    dailyCapHours, totalCapHours,
    ...(deferActivation ? {} : { usageSessions: [{ startedAt: now, ttlHours, templateSlug: template.slug }] }),
    allowedServices: (template.allowedServices || []).map(s => ({
      service: s.service, category: s.category, actions: s.actions, restrictions: s.restrictions,
    })),
    blockedServices: (template.blockedServices || []).map(s => ({
      service: s.service, reason: s.reason,
    })),
  };
  try {
    await awsUser.create(awsFields);
  } catch (dbErr) {
    if (dbErr.code === 11000) {
      const { email: _e, ...updateFields } = awsFields;
      if (!deferActivation) {
        updateFields.$push = { usageSessions: { startedAt: now, ttlHours, templateSlug: template.slug } };
        delete updateFields.usageSessions;
      }
      await awsUser.updateOne({ email }, updateFields);
    } else {
      throw dbErr;
    }
  }

  return {
    resourceId: username,
    credentials: {
      username: awsResult.username,
      password: awsResult.password,
      accessUrl: awsResult.accessUrl,
      region: awsResult.region,
    },
  };
}

// ─── GCP provisioning ──────────────────────────────────────────────────────
async function _provisionGcp({ template, email, ttlHours, dailyCapHours, totalCapHours, expiresAt, deferActivation }) {
  const { createGcpSandbox } = require('./directSandbox');

  // Generate unique project ID
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const certCode = (template.certificationCode || 'gcp').toLowerCase();
  const projectId = `lab-${certCode}-${randSuffix}-${Date.now().toString(36)}`.slice(0, 30);

  const gcpResult = await createGcpSandbox(projectId, email, template.sandboxConfig?.budgetInr || 500);

  // Create/update GcpSandboxUser record
  let user = await GcpSandboxUser.findOne({ email });
  if (!user) {
    user = await GcpSandboxUser.create({
      email,
      googleEmail: email,
      duration: Math.ceil(ttlHours / 24) || 1,
      sandboxTtlHours: ttlHours,
      credits: { total: 99, consumed: 0 },
      budgetLimit: template.sandboxConfig?.budgetInr || 500,
      startDate: new Date(),
      endDate: expiresAt,
    });
  }

  user.sandbox.push({
    projectId,
    projectName: `${template.name} sandbox`,
    createdTime: new Date(),
    ...(expiresAt && { deleteTime: expiresAt, expiresAt }),
    templateId: String(template._id),
    allowedServices: (template.allowedServices || []).map(s => ({
      service: s.service, category: s.category, restrictions: s.restrictions,
    })),
    blockedServices: (template.blockedServices || []).map(s => ({
      service: s.service, reason: s.reason,
    })),
  });
  user.credits.consumed = (user.credits.consumed || 0) + 1;
  user.dailyCapHours = dailyCapHours;
  user.totalCapHours = totalCapHours;
  if (!deferActivation) {
    user.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug: template.slug });
  }
  await user.save();

  return {
    resourceId: projectId,
    credentials: {
      username: email,
      password: 'Use your Google account',
      accessUrl: gcpResult.accessUrl,
      region: template.sandboxConfig?.region || 'asia-south1',
    },
  };
}

/**
 * Load and validate a sandbox template by slug.
 * @param {string} slug — sandboxTemplateSlug from the guided lab
 * @returns {Object|null} — the template document or null
 */
async function loadSandboxTemplate(slug) {
  if (!slug) return null;
  return SandboxTemplate.findOne({ slug, isActive: true });
}

module.exports = { provisionSandboxForStudent, loadSandboxTemplate };
