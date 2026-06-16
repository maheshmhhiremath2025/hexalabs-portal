const { logger } = require('../plugins/logger');
const SandboxTemplate = require('../models/sandboxTemplate');
const { createAwsSandbox } = require('../services/directSandbox');
const awsUser = require('../models/aws');
const User = require('../models/user');
const { notifySandboxWelcomeEmail, notifySandboxBulkSummary, isLikelyDeliverable } = require('../services/emailNotifications');

/**
 * POST /sandbox/bulk-deploy
 *
 * Accepts: { templateSlug, emails: string[], ttlHours: number }
 *
 * For each email, creates an AWS sandbox using the template config,
 * stores the templateId reference, expiresAt, and service permissions
 * on the awsuser record.
 *
 * Returns: { results: [...], errors: [...] }
 */
async function handleBulkDeploy(req, res) {
  const { userType } = req.user || {};
  if (userType !== 'superadmin' && userType !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const {
    templateSlug, emails, ttlHours,
    dailyCapHours = 12, totalCapHours = 0,
    // Schedule restrictions applied to each User record created in this batch.
    // Passing these makes the portal-login gate enforce hours + weekdays +
    // hard expiry automatically — the student hits 403 if they try to log in
    // outside the window.
    loginStart,           // "HH:mm" IST (e.g. "18:45")
    loginStop,            // "HH:mm" IST (e.g. "01:15") — can cross midnight
    allowedWeekdays,      // array of 0-6 (0=Sun, 6=Sat). Example: [1,2,3,4,5] for weekdays
    accessExpiresAt,      // ISO date string — login blocked after this
    skipWelcomeEmails,    // boolean — skip per-student welcome when addresses are dummies
  } = req.body;

  if (!templateSlug) {
    return res.status(400).json({ message: 'templateSlug is required' });
  }
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ message: 'emails array is required and must not be empty' });
  }
  if (req.user?.userType !== 'admin' && req.user?.userType !== 'superadmin') {
    return res.status(403).json({ message: 'Admin/superadmin access required' });
  }
  if (req.user.userType === 'admin' && emails.length > 200) {
    return res.status(400).json({ message: `Batch size of ${emails.length} exceeds the 200-student cap for admin role.` });
  }
  // admin is locked to their own org; superadmin may target any org via body
  const targetOrg = req.user.userType === 'superadmin' && req.body.organization
    ? req.body.organization
    : req.user.organization;
  if (!ttlHours || ttlHours < 1) {
    return res.status(400).json({ message: 'ttlHours is required and must be at least 1' });
  }

  const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'aws' });
  if (!template) {
    return res.status(404).json({ message: 'AWS template not found' });
  }

  // Org-template entitlement: auto-associate for superadmin; clear 403 for admin.
  const { ensureTemplateAssociation } = require('../services/orgTemplateAssociation');
  const _assoc = await ensureTemplateAssociation({ targetOrg, templateSlug, userType: req.user.userType, adminEmail: req.user.email });
  if (!_assoc.ok) return res.status(_assoc.status).json({ message: _assoc.error });

  const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const results = [];
  const errors = [];

  for (const email of emails) {
    try {
      // Generate a unique username from the email and template
      const cleanName = (email || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 15);
      const randSuffix = Math.random().toString(36).slice(2, 6);
      const username = `lab-${template.certificationCode || 'aws'}-${cleanName}-${randSuffix}`
        .replace(/[^a-zA-Z0-9._@+-]/g, '')
        .slice(0, 64);

      // Use Connect-specific US account if template is flagged for it
      const useConnectAccount = template.sandboxConfig?.useConnectAccount === true;
      const awsAccessKey = useConnectAccount ? process.env.AWS_CONNECT_ACCESS_KEY : process.env.AWS_ACCESS_KEY;
      const awsSecretKey = useConnectAccount ? process.env.AWS_CONNECT_ACCESS_SECRET : process.env.AWS_ACCESS_SECRET;
      const awsRegion = useConnectAccount ? (process.env.AWS_CONNECT_REGION || 'us-east-1') : (template.sandboxConfig?.region || 'ap-south-1');

      const awsResult = await createAwsSandbox(username, email, useConnectAccount ? { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } : undefined);

      // Attach CloudOpsSRE-CourseAllow managed policy for the 40h CloudOps + SRE + DevOps template.
      if (template.slug === 'aws-cloudops-sre-devops-lab' && !useConnectAccount) {
        try {
          const { IAMClient: _IAM2, AttachUserPolicyCommand: _AUP2 } = require('@aws-sdk/client-iam');
          const _c2 = new _IAM2({ region: awsRegion, credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } });
          await _c2.send(new _AUP2({ UserName: username, PolicyArn: 'arn:aws:iam::475184346033:policy/CloudOpsSRE-CourseAllow' }));
          logger.info(`Attached CloudOpsSRE-CourseAllow to ${username}`);
        } catch (e) {
          logger.error(`Failed to attach CloudOpsSRE-CourseAllow: ${e.message}`);
        }
      }

      // For Connect templates, attach the managed Connect student policy
      if (useConnectAccount && process.env.AWS_CONNECT_STUDENT_POLICY_ARN) {
        try {
          const { IAMClient: IAM2, AttachUserPolicyCommand } = require('@aws-sdk/client-iam');
          const connectIam = new IAM2({ region: awsRegion, credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey } });
          await connectIam.send(new AttachUserPolicyCommand({ UserName: username, PolicyArn: process.env.AWS_CONNECT_STUDENT_POLICY_ARN }));
          logger.info(`Connect student policy attached to ${username}`);
        } catch (e) { logger.error(`Failed to attach Connect policy: ${e.message}`); }
      }

      // Replace the base policies with a compact course-specific policy
      // AWS has a 2048 byte TOTAL limit for all inline policies per user.
      // createAwsSandbox() already attached 2 base policies (~2500 bytes) — remove them
      // and replace with a single compact course policy that includes both allow + deny + restrictions
      try {
        const { IAMClient, PutUserPolicyCommand, DeleteUserPolicyCommand, AttachUserPolicyCommand } = require('@aws-sdk/client-iam');
        const client = new IAMClient({
          region: awsRegion,
          credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey },
        });

        // Remove the base policies that createAwsSandbox() added
        for (const pn of ['SandboxCostRestrictions', 'InstanceTypeAndRegionLock']) {
          try { await client.send(new DeleteUserPolicyCommand({ UserName: username, PolicyName: pn })); } catch {}
        }

        // Build compact course policy — allow + deny + restrictions in one policy under 2048 bytes
        const AWS_SVC = {
          ec2: 'ec2', s3: 's3', lambda: 'lambda', rds: 'rds', dynamodb: 'dynamodb',
          vpc: 'ec2', iam: 'iam', cloudwatch: 'cloudwatch', cloudtrail: 'cloudtrail',
          cloudfront: 'cloudfront', 'systems manager': 'ssm', 'billing dashboard': 'ce',
          ebs: 'ec2', 'amazon connect': 'connect', 'amazon connect ccp': 'connect',
          sns: 'sns', sqs: 'sqs', cloudformation: 'cloudformation',
          ecs: 'ecs', ecr: 'ecr', codebuild: 'codebuild', codedeploy: 'codedeploy',
          codepipeline: 'codepipeline', codecommit: 'codecommit',
          // Additional services from scope
          'elastic load balancing': 'elasticloadbalancing', 'ec2 auto scaling': 'autoscaling',
          cloudshell: 'cloudshell', efs: 'elasticfilesystem', 's3 glacier': 'glacier',
          athena: 'athena', 'route 53': 'route53', 'api gateway': 'apigateway',
          'step functions': 'states', eventbridge: 'events', ses: 'ses',
          kms: 'kms', 'secrets manager': 'secretsmanager', 'certificate manager': 'acm',
          guardduty: 'guardduty', polly: 'polly', rekognition: 'rekognition',
          'lex v1 & v2': 'lex', translate: 'translate',
          'resource tagging': 'tag', 'health dashboard': 'health',
          'resource groups': 'resource-groups',
          // AWS Mainframe Modernization + related services (added for M2 Managed env deps)
          m2: 'm2',
          appstream: 'appstream',
          workspaces: 'workspaces',
          logs: 'logs',
          elasticloadbalancing: 'elasticloadbalancing',
          elb: 'elasticloadbalancing',
          ssm: 'ssm',
          autoscaling: 'autoscaling',
          applicationautoscaling: 'application-autoscaling',
          'application auto scaling': 'application-autoscaling',
          // Data-lab additions
          emr: 'elasticmapreduce',
          'elastic mapreduce': 'elasticmapreduce',
          'elasticmapreduce': 'elasticmapreduce',
          glue: 'glue',
          'aws glue': 'glue',
          redshift: 'redshift',
          'amazon redshift': 'redshift',
          'redshift data api': 'redshift-data',
          'redshift serverless': 'redshift-serverless',
          'lake formation': 'lakeformation',
          lakeformation: 'lakeformation',
          'ec2 instance connect': 'ec2-instance-connect',
          ec2instanceconnect: 'ec2-instance-connect',
          'ec2-instance-connect': 'ec2-instance-connect',
          'query editor v2': 'sqlworkbench',
          'redshift query editor': 'sqlworkbench',
          'sql workbench': 'sqlworkbench',
          sqlworkbench: 'sqlworkbench',
        };

        // Collect unique action prefixes for allowed services (use prefix:* for compactness)
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
        // Allowed EC2 instance types: template can override the default mini list
        const allowedTypes = (template.allowedInstanceTypes?.aws?.length
          ? template.allowedInstanceTypes.aws
          : ['t2.micro', 't3.micro', 't3.small']);
        statements.push({
          Sid: 'DenyBadEC2',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: 'arn:aws:ec2:*:*:instance/*',
          Condition: { 'ForAllValues:StringNotEquals': { 'ec2:InstanceType': allowedTypes } },
        });
        statements.push({
          Sid: 'RegionLock',
          Effect: 'Deny',
          Action: ['ec2:RunInstances', 'ec2:CreateVolume', 'rds:CreateDBInstance', 's3:CreateBucket'],
          Resource: '*',
          Condition: { StringNotEquals: { 'aws:RequestedRegion': region } },
        });

        const policyDoc = { Version: '2012-10-17', Statement: statements };
        const policySize = JSON.stringify(policyDoc).length;
        logger.info(`[bulk-deploy] Course policy size: ${policySize} bytes for ${email}`);

        await client.send(new PutUserPolicyCommand({
          UserName: username,
          PolicyName: 'CoursePolicy',
          PolicyDocument: JSON.stringify(policyDoc),
        }));
        logger.info(`[bulk-deploy] Applied CoursePolicy for ${email} (${policySize} bytes)`);

        // Attach managed policies declared on the template (e.g. aws-data-lab
        // needs AmazonEC2FullAccess + SSM bundle + EC2InstanceConnect so EMR's
        // post-create flows like SSH-into-master / Session Manager work for
        // learners without us re-explaining inline policy coverage every time).
        const managedArns = (template.managedPolicyArns?.aws || []);
        for (const arn of managedArns) {
          try {
            await client.send(new AttachUserPolicyCommand({ UserName: username, PolicyArn: arn }));
            logger.info(`[bulk-deploy] Attached managed policy ${arn.split('/').pop()} to ${email}`);
          } catch (attachErr) {
            logger.warn(`[bulk-deploy] Failed to attach ${arn.split('/').pop()} to ${email}: ${attachErr.message}`);
          }
        }
      } catch (e) {
        logger.error(`[bulk-deploy] Failed to apply course policy for ${email}: ${e.message}`);
      }

      // Store the user record with template reference
      const duration = Math.ceil(ttlHours / 24) || 1;
      const now = new Date();
      try {
        await awsUser.create({
          email,
          userId: username,
          password: awsResult.password,
          accessUrl: awsResult.accessUrl,
          region: awsResult.region,
          duration,
          sandboxTtlHours: ttlHours,
          startDate: now,
          endDate: expiresAt,
          templateId: template._id,
          expiresAt,
          batchExpiresAt: req.body.batchExpiresAt ? new Date(req.body.batchExpiresAt) : null,
          organization: targetOrg,
          dailyCapHours,
          totalCapHours,
          usageSessions: [{ startedAt: now, ttlHours, templateSlug }],
          allowedServices: (template.allowedServices || []).map(s => ({
            service: s.service,
            category: s.category,
            actions: s.actions,
            restrictions: s.restrictions,
          })),
          blockedServices: (template.blockedServices || []).map(s => ({
            service: s.service,
            reason: s.reason,
          })),
        });
      } catch (dbErr) {
        // Duplicate email — update instead
        if (dbErr.code === 11000) {
          logger.warn(`[bulk-deploy] Duplicate email ${email}, updating existing record`);
          await awsUser.updateOne({ email }, {
            userId: username,
            password: awsResult.password,
            accessUrl: awsResult.accessUrl,
            region: awsResult.region,
            duration,
            sandboxTtlHours: ttlHours,
            startDate: now,
            endDate: expiresAt,
            templateId: template._id,
            expiresAt,
            batchExpiresAt: req.body.batchExpiresAt ? new Date(req.body.batchExpiresAt) : null,
            organization: targetOrg,
            dailyCapHours,
            totalCapHours,
            $push: { usageSessions: { startedAt: now, ttlHours, templateSlug } },
            allowedServices: (template.allowedServices || []).map(s => ({
              service: s.service,
              category: s.category,
              actions: s.actions,
              restrictions: s.restrictions,
            })),
            blockedServices: (template.blockedServices || []).map(s => ({
              service: s.service,
              reason: s.reason,
            })),
          });
        } else {
          logger.error(`[bulk-deploy] DB error for ${email}: ${dbErr.message}`);
        }
      }

      results.push({
        email,
        username: awsResult.username,
        password: awsResult.password,
        accessUrl: awsResult.accessUrl,
        region: template.sandboxConfig?.region || 'ap-south-1',
        expiresAt: expiresAt.toISOString(),
      });

      // Auto-create portal login — now applies batch-level schedule fields
      // (loginStart/loginStop/allowedWeekdays/accessExpiresAt) if caller
      // provided them. Existing users get upgraded to match this batch too,
      // so re-deploying a batch refreshes the schedule on the User record.
      const scheduleFields = {};
      if (loginStart)               scheduleFields.loginStart = loginStart;
      if (loginStop)                scheduleFields.loginStop = loginStop;
      if (Array.isArray(allowedWeekdays) && allowedWeekdays.length) {
        scheduleFields.allowedWeekdays = allowedWeekdays;
      }
      if (accessExpiresAt)          scheduleFields.accessExpiresAt = new Date(accessExpiresAt);

      const existingUser = await User.findOne({ email });
      if (!existingUser) {
        await User.create({
          email, name: email, password: 'Welcome1234!',
          userType: 'sandboxuser', organization: targetOrg,
          ...scheduleFields,
        });
      } else if (Object.keys(scheduleFields).length) {
        // Refresh schedule on the existing user so batch changes apply.
        Object.assign(existingUser, scheduleFields);
        await existingUser.save();
      }

      // Per-student welcome email: skipped entirely if the caller explicitly
      // set skipWelcomeEmails=true (the dummy-email batch case). Otherwise
      // check MX deliverability like before.
      if (skipWelcomeEmails) {
        logger.info(`[bulk-deploy] skipWelcomeEmails=true — skipping individual email to ${email}`);
      } else {
        isLikelyDeliverable(email).then(deliverable => {
          if (!deliverable) {
            logger.info(`[bulk-deploy] skipping welcome email to ${email} (not deliverable)`);
            return;
          }
          return notifySandboxWelcomeEmail({
            email, cloud: 'aws', portalPassword: 'Welcome1234!',
            sandboxUsername: awsResult.username, sandboxPassword: awsResult.password,
            sandboxAccessUrl: awsResult.accessUrl,
            region: template.sandboxConfig?.region || 'ap-south-1',
            expiresAt, templateName: template.name,
            allowedServices: template.allowedServices, blockedServices: template.blockedServices,
          });
        }).catch(e => logger.error(`Welcome email failed for ${email}: ${e.message}`));
      }

      logger.info(`[bulk-deploy] Sandbox created for ${email} (template: ${template.slug})`);
    } catch (err) {
      logger.error(`[bulk-deploy] Failed for ${email}: ${err.message}`);
      errors.push({ email, error: err.message });
    }
  }

  // Consolidated roster email — TO: org admin(s), CC: deployer + internal.
  // This is the "one table to rule them all" so the admin can distribute
  // creds regardless of whether individual addresses were deliverable.
  if (results.length > 0) {
    // P2-15: await so a slow Mailgun call can't race the JSON response and
    // leave the caller without a confirmation. Also use the in-scope
    // `targetOrg` instead of the never-set `result.organization`.
    try {
      await notifySandboxBulkSummary({
        opsEmail: req.user?.email,
        trainingName: template.name,
        organization: targetOrg || template.name,
        templateName: template.name,
        cloud: 'aws',
        sandboxes: results.map(r => ({
          email: r.email,
          username: r.username,
          password: r.password,
          accessUrl: r.accessUrl,
          region: r.region,
          expiresAt: r.expiresAt,
        })),
      });
    } catch (e) {
      logger.error(`[bulk-deploy] Roster email failed: ${e.message}`);
    }
  }

  return res.json({
    templateSlug: template.slug,
    templateName: template.name,
    ttlHours,
    expiresAt: expiresAt.toISOString(),
    total: emails.length,
    succeeded: results.length,
    failed: errors.length,
    results,
    errors,
  });
}

module.exports = { handleBulkDeploy };
