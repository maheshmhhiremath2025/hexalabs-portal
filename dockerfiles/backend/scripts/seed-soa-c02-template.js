// Seed the AWS Certified SysOps Administrator - Associate (SOA-C02) sandbox template.
// Same shape as the existing aws-clf-c02 template — services scoped to the
// SOA-C02 exam blueprint, IAM policy auto-generated from allowedServices.
require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');
const { generateAwsIamPolicy } = require('../services/iamPolicyGenerator');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  const template = {
    name: 'AWS SysOps Administrator - Associate (SOA-C02)',
    slug: 'aws-soa-c02',
    cloud: 'aws',
    certificationCode: 'SOA-C02',
    certificationLevel: 'associate',
    description: 'Hands-on sandbox for AWS Certified SysOps Administrator - Associate (SOA-C02). Covers monitoring, logging, reliability, deployment automation, security, networking, and cost optimization.',
    icon: '🛠️',

    examDomains: [
      { name: 'Monitoring, Logging, and Remediation',  weight: 20 },
      { name: 'Reliability and Business Continuity',   weight: 16 },
      { name: 'Deployment, Provisioning, and Automation', weight: 18 },
      { name: 'Security and Compliance',                weight: 16 },
      { name: 'Networking and Content Delivery',        weight: 18 },
      { name: 'Cost and Performance Optimization',      weight: 12 },
    ],

    sandboxConfig: {
      region: 'ap-south-1',
      useConnectAccount: false,
    },

    allowedServices: [
      // === Domain 1 — Monitoring, Logging, Remediation ===
      { service: 'cloudwatch',     category: 'Monitoring',  restrictions: 'Metrics, alarms, dashboards' },
      { service: 'logs',           category: 'Monitoring',  restrictions: 'CloudWatch Logs' },
      { service: 'cloudtrail',     category: 'Monitoring' },
      { service: 'xray',           category: 'Monitoring' },
      { service: 'config',         category: 'Monitoring' },
      { service: 'eventbridge',    category: 'Application Integration' },
      { service: 'ssm',            category: 'Management',  restrictions: 'Systems Manager: SSM, Session Manager, Parameter Store' },
      { service: 'trustedadvisor', category: 'Management' },

      // === Domain 2 — Reliability + BC ===
      { service: 'autoscaling',          category: 'Compute' },
      { service: 'applicationautoscaling', category: 'Compute' },
      { service: 'elasticloadbalancing', category: 'Networking' },
      { service: 'route53',              category: 'Networking',  restrictions: 'Hosted zones, health checks, failover' },
      { service: 'backup',               category: 'Storage' },
      { service: 'rds',                  category: 'Database',   restrictions: 'db.t3.micro/small only' },
      { service: 'dynamodb',             category: 'Database' },

      // === Domain 3 — Deployment + Automation ===
      { service: 'cloudformation',  category: 'Management' },
      { service: 'elasticbeanstalk', category: 'Compute' },
      { service: 'servicecatalog',  category: 'Management' },

      // === Domain 4 — Security + Compliance ===
      { service: 'iam',             category: 'Security' },
      { service: 'kms',             category: 'Security' },
      { service: 'secretsmanager',  category: 'Security' },
      { service: 'inspector',       category: 'Security' },
      { service: 'guardduty',       category: 'Security' },
      { service: 'waf',             category: 'Security' },
      { service: 'shield',          category: 'Security',   restrictions: 'Shield Standard only (free tier)' },
      { service: 'acm',             category: 'Security' },

      // === Domain 5 — Networking + CDN ===
      { service: 'ec2',             category: 'Compute',    restrictions: 't2/t3 micro/small/medium only — covers VPC, subnets, route tables, SGs, NACLs, ENIs' },
      { service: 'cloudfront',      category: 'Networking' },
      { service: 'vpn',             category: 'Networking' },
      { service: 'transitgateway',  category: 'Networking' },
      { service: 'globalaccelerator', category: 'Networking' },

      // === Domain 6 — Cost + Performance ===
      { service: 'costexplorer',    category: 'Cost Management' },
      { service: 'budgets',         category: 'Cost Management' },
      { service: 'computeoptimizer', category: 'Cost Management' },

      // === Storage primitives (cross-domain) ===
      { service: 's3',              category: 'Storage',    restrictions: 'max 50GB per bucket; covers versioning + lifecycle' },
      { service: 'ebs',             category: 'Storage',    restrictions: 'gp2/gp3 only, max 50GB' },
      { service: 'efs',             category: 'Storage' },

      // === Application Integration helpers ===
      { service: 'sns',             category: 'Application Integration' },
      { service: 'sqs',             category: 'Application Integration' },
      { service: 'ses',             category: 'Business Applications' },

      // === Compute helpers students often need to wire alarms etc. ===
      { service: 'lambda',          category: 'Compute',    restrictions: 'default concurrency cap' },
    ],

    blockedServices: [
      { service: 'sagemaker',       reason: 'GPU/ML out of scope and expensive' },
      { service: 'redshift',        reason: 'expensive, requires manual review' },
      { service: 'neptune',         reason: 'expensive, out of scope' },
      { service: 'directconnect',   reason: 'physical circuit, not for sandbox' },
      { service: 'outposts',        reason: 'on-prem hardware, not for sandbox' },
    ],

    allowedInstanceTypes: {
      aws: ['t2.micro', 't2.small', 't2.medium', 't3.micro', 't3.small', 't3.medium'],
    },

    isActive: true,
    createdBy: 'admin-seed',
    sortOrder: 30,
  };

  template.iamPolicy = generateAwsIamPolicy(template);

  const result = await SandboxTemplate.findOneAndUpdate(
    { slug: template.slug },
    template,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Seeded template: ${result.name}`);
  console.log(`  slug:               ${result.slug}`);
  console.log(`  id:                 ${result._id}`);
  console.log(`  cloud:              ${result.cloud}`);
  console.log(`  region:             ${result.sandboxConfig.region}`);
  console.log(`  TTL:                ${result.sandboxConfig.ttlHours}h`);
  console.log(`  allowedServices:    ${result.allowedServices.length}`);
  console.log(`  blockedServices:    ${result.blockedServices.length}`);
  console.log(`  IAM policy stmts:   ${template.iamPolicy.Statement.length}`);
  console.log(`  IAM Sids:           ${template.iamPolicy.Statement.map(s => s.Sid).join(', ')}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
