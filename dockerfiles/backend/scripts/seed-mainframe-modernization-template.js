require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');
const { generateAwsIamPolicy } = require('../services/iamPolicyGenerator');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  const template = {
    name: 'AWS Mainframe Modernization (M2 + Blu Age)',
    slug: 'aws-mainframe-modernization',
    cloud: 'aws',
    description: 'Hands-on lab for mainframe modernization on AWS. Day 3: Replatform with Micro Focus (M2). Day 4: Automated refactor with AWS Blu Age using the PlanetsDemo sample application.',
    icon: '🖥️',

    examDomains: [
      { name: 'Replatform (Micro Focus)', weight: 50 },
      { name: 'Refactor (AWS Blu Age)', weight: 50 },
    ],

    sandboxConfig: {
      ttlHours: 8,
      region: 'ap-south-1',
      dailyCapHours: 12,
      maxInstances: 2,
      useConnectAccount: false,
      enforceOwnerTag: true,
    },

    allowedServices: [
      { service: 'm2',                   category: 'Compute',    restrictions: 'Bills continuously until deleted; CreatedBy tag enforced' },
      { service: 'appstream',            category: 'Compute',    restrictions: 'Small fleet sizes; CreatedBy tag enforced' },
      { service: 'ec2',                  category: 'Compute',    restrictions: 't2/t3 micro/small/medium only' },
      { service: 'vpc',                  category: 'Networking' },
      { service: 'elasticloadbalancing', category: 'Networking', restrictions: 'ALB used by M2 Managed envs' },
      { service: 's3',                   category: 'Storage',    restrictions: 'Source + deploy artifacts' },
      { service: 'ebs',                  category: 'Storage',    restrictions: 'gp2/gp3, max 30GB' },
      { service: 'efs',                  category: 'Storage',    restrictions: 'EFS mount used by M2 Managed envs' },
      { service: 'rds',                  category: 'Database',   restrictions: 'Aurora backs M2 Managed metadata store' },
      { service: 'cloudwatch',           category: 'Management' },
      { service: 'logs',                 category: 'Management', restrictions: 'M2 runtime + app logs' },
      { service: 'cloudformation',       category: 'Management' },
      { service: 'kms',                  category: 'Security' },
      { service: 'secretsmanager',       category: 'Security' },
      { service: 'ssm',                  category: 'Management', restrictions: 'Parameter Store — M2 CF stack uses for config values' },
      { service: 'autoscaling',          category: 'Compute',    restrictions: 'EC2 Auto Scaling — M2 Managed compute' },
      { service: 'applicationautoscaling', category: 'Compute',  restrictions: 'Target tracking policies — M2 Managed' },
      { service: 'iam',                  category: 'Security',   restrictions: 'Broad — needed for PassRole + CreateServiceLinkedRole for M2' },
    ],

    allowedInstanceTypes: {
      aws: ['t2.micro', 't2.small', 't2.medium', 't3.micro', 't3.small', 't3.medium'],
    },

    isActive: true,
    createdBy: 'admin-seed',
    sortOrder: 100,
  };

  template.iamPolicy = generateAwsIamPolicy(template);

  const result = await SandboxTemplate.findOneAndUpdate(
    { slug: template.slug },
    template,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Seeded template: ${result.name}`);
  console.log(`  slug: ${result.slug}`);
  console.log(`  id:   ${result._id}`);
  console.log(`  enforceOwnerTag: ${result.sandboxConfig?.enforceOwnerTag}`);
  console.log(`  allowedServices: ${result.allowedServices.length}`);
  console.log(`  IAM policy statements: ${template.iamPolicy.Statement.length}`);
  console.log(`  IAM Sids: ${template.iamPolicy.Statement.map(s => s.Sid).join(', ')}`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
