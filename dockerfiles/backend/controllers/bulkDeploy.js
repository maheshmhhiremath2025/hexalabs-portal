const { logger } = require('../plugins/logger');
const SandboxTemplate = require('../models/sandboxTemplate');
const { createAwsSandbox } = require('../services/directSandbox');
const awsUser = require('../models/aws');
const User = require('../models/user');
const { notifySandboxWelcomeEmail } = require('../services/emailNotifications');

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

  const { templateSlug, emails, ttlHours, dailyCapHours = 12, totalCapHours = 0 } = req.body;

  if (!templateSlug) {
    return res.status(400).json({ message: 'templateSlug is required' });
  }
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ message: 'emails array is required and must not be empty' });
  }
  if (!ttlHours || ttlHours < 1) {
    return res.status(400).json({ message: 'ttlHours is required and must be at least 1' });
  }

  const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'aws' });
  if (!template) {
    return res.status(404).json({ message: 'AWS template not found' });
  }

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

      const awsResult = await createAwsSandbox(username, email);

      // Replace the base policies with a compact course-specific policy
      // AWS has a 2048 byte TOTAL limit for all inline policies per user.
      // createAwsSandbox() already attached 2 base policies (~2500 bytes) — remove them
      // and replace with a single compact course policy that includes both allow + deny + restrictions
      try {
        const { IAMClient, PutUserPolicyCommand, DeleteUserPolicyCommand } = require('@aws-sdk/client-iam');
        const client = new IAMClient({
          region: template.sandboxConfig?.region || 'ap-south-1',
          credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
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
        statements.push({
          Sid: 'DenyBadEC2',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: 'arn:aws:ec2:*:*:instance/*',
          Condition: { 'ForAllValues:StringNotEquals': { 'ec2:InstanceType': ['t2.micro', 't3.micro', 't3.small'] } },
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
          duration,
          sandboxTtlHours: ttlHours,
          startDate: now,
          endDate: expiresAt,
          templateId: template._id,
          expiresAt,
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
            duration,
            sandboxTtlHours: ttlHours,
            startDate: now,
            endDate: expiresAt,
            templateId: template._id,
            expiresAt,
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

      // Auto-create portal login
      const existingUser = await User.findOne({ email });
      if (!existingUser) {
        await User.create({ email, name: email, password: 'Welcome1234!', userType: 'sandboxuser', organization: template.name });
      }

      // Send welcome email
      notifySandboxWelcomeEmail({
        email, cloud: 'aws', portalPassword: 'Welcome1234!',
        sandboxUsername: awsResult.username, sandboxPassword: awsResult.password,
        sandboxAccessUrl: awsResult.accessUrl,
        region: template.sandboxConfig?.region || 'ap-south-1',
        expiresAt, templateName: template.name,
        allowedServices: template.allowedServices, blockedServices: template.blockedServices,
      }).catch(e => logger.error(`Welcome email failed for ${email}: ${e.message}`));

      logger.info(`[bulk-deploy] Sandbox created for ${email} (template: ${template.slug})`);
    } catch (err) {
      logger.error(`[bulk-deploy] Failed for ${email}: ${err.message}`);
      errors.push({ email, error: err.message });
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
