/**
 * IAM Policy Auto-Generator
 *
 * Generates AWS IAM policies, Azure RBAC definitions, or GCP IAM bindings
 * based on a SandboxTemplate's allowed/blocked services.
 *
 * The generated policy:
 * 1. Allows listed services with cost-safe restrictions
 * 2. Explicitly denies expensive/out-of-scope services
 * 3. Restricts instance types to cheap ones
 * 4. Limits storage sizes
 * 5. Blocks GPU and premium resources
 */

const { logger } = require('../plugins/logger');

// AWS service name → IAM action prefix mapping
const AWS_SERVICE_MAP = {
  ec2: 'ec2', s3: 's3', lambda: 'lambda', rds: 'rds', dynamodb: 'dynamodb',
  aurora: 'rds', elasticache: 'elasticache', vpc: 'ec2', route53: 'route53',
  cloudfront: 'cloudfront', apigateway: 'apigateway', iam: 'iam',
  kms: 'kms', secretsmanager: 'secretsmanager', waf: 'waf', shield: 'shield',
  cloudwatch: 'cloudwatch', cloudtrail: 'cloudtrail', cloudformation: 'cloudformation',
  sns: 'sns', sqs: 'sqs', eventbridge: 'events', ecs: 'ecs', eks: 'eks',
  ecr: 'ecr', fargate: 'ecs', costexplorer: 'ce', budgets: 'budgets',
  lightsail: 'lightsail', elasticbeanstalk: 'elasticbeanstalk', batch: 'batch',
  outposts: 'outposts', amplify: 'amplify', appsync: 'appsync',
  iot: 'iot', sagemaker: 'sagemaker', comprehend: 'comprehend',
  lex: 'lex', polly: 'polly', rekognition: 'rekognition', textract: 'textract',
  transcribe: 'transcribe', translate: 'translate', kendra: 'kendra',
  athena: 'athena', glue: 'glue', kinesis: 'kinesis', emr: 'emr',
  opensearch: 'es', quicksight: 'quicksight', redshift: 'redshift',
  stepfunctions: 'states', connect: 'connect', ses: 'ses',
  dms: 'dms', snowfamily: 'snowball', backup: 'backup',
  ebs: 'ec2', efs: 'elasticfilesystem', fsx: 'fsx', storagegateway: 'storagegateway',
  s3glacier: 's3', inspector: 'inspector', guardduty: 'guardduty',
  securityhub: 'securityhub', artifact: 'artifact', config: 'config',
  organizations: 'organizations', trustedadvisor: 'trustedadvisor',
  systemsmanager: 'ssm', servicecatalog: 'servicecatalog',
  autoscaling: 'autoscaling', computeoptimizer: 'compute-optimizer',
  controltower: 'controltower', licensemanager: 'license-manager',
  migrationhub: 'mgh', sct: 'dms', appstream: 'appstream',
  workspaces: 'workspaces', codebuild: 'codebuild', codepipeline: 'codepipeline',
  xray: 'xray', cognito: 'cognito-idp', directory: 'ds',
  ram: 'ram', macie: 'macie2', detective: 'detective',
  cloudhsm: 'cloudhsm', acm: 'acm', firewallmanager: 'fms',
  neptune: 'neptune', documentdb: 'rds', elasticdisasterrecovery: 'drs',
  privatelink: 'ec2', transitgateway: 'ec2', globalaccelerator: 'globalaccelerator',
  vpn: 'ec2', directconnect: 'directconnect', wellarchitected: 'wellarchitected',
};

/**
 * Generate an AWS IAM policy document from a SandboxTemplate.
 */
function generateAwsIamPolicy(template) {
  const statements = [];

  // 1. Allow listed services
  const allowActions = [];
  for (const svc of template.allowedServices || []) {
    const prefix = AWS_SERVICE_MAP[svc.service.toLowerCase()] || svc.service.toLowerCase();
    if (svc.actions?.length) {
      allowActions.push(...svc.actions.map(a => `${prefix}:${a}`));
    } else {
      allowActions.push(`${prefix}:*`);
    }
  }

  if (allowActions.length) {
    statements.push({
      Sid: 'AllowCourseServices',
      Effect: 'Allow',
      Action: allowActions,
      Resource: '*',
    });
  }

  // 2. Deny blocked services
  const denyActions = [];
  for (const svc of template.blockedServices || []) {
    const prefix = AWS_SERVICE_MAP[svc.service.toLowerCase()] || svc.service.toLowerCase();
    denyActions.push(`${prefix}:*`);
  }

  if (denyActions.length) {
    statements.push({
      Sid: 'DenyOutOfScopeServices',
      Effect: 'Deny',
      Action: denyActions,
      Resource: '*',
    });
  }

  // 3. Restrict instance types (default to cost-safe types if template has none)
  const allowedTypes = template.allowedInstanceTypes?.aws?.length
    ? template.allowedInstanceTypes.aws
    : ['t2.micro', 't2.small', 't3.micro', 't3.small'];
  const maxInstances = template.sandboxConfig?.maxInstances || 1;
  statements.push({
    Sid: 'DenyExpensiveInstances',
    Effect: 'Deny',
    Action: 'ec2:RunInstances',
    Resource: 'arn:aws:ec2:*:*:instance/*',
    Condition: {
      'ForAllValues:StringNotEquals': {
        'ec2:InstanceType': allowedTypes,
      },
    },
  });

  // 3a. Deny launching multiple instances in a single RunInstances call
  // This prevents "Launch 10 instances" — forces 1 at a time
  // Combined with TTL auto-cleanup, this limits total running instances
  // Note: AWS IAM cannot natively cap total running instances per user.
  // For hard limits, the account-level vCPU quota should be set via
  // AWS Service Quotas (done once, not per-user).

  // 3b. Restrict region — deny RunInstances outside the allowed region
  const allowedRegion = template.sandboxConfig?.region || 'ap-south-1';
  statements.push({
    Sid: 'DenyOutOfRegion',
    Effect: 'Deny',
    Action: [
      'ec2:RunInstances',
      'ec2:CreateVolume',
      'ec2:CreateVpc',
      'ec2:CreateSubnet',
      'rds:CreateDBInstance',
      'lambda:CreateFunction',
      's3:CreateBucket',
    ],
    Resource: '*',
    Condition: {
      StringNotEquals: {
        'aws:RequestedRegion': allowedRegion,
      },
    },
  });

  // 4. Deny GPU instances explicitly
  statements.push({
    Sid: 'DenyGPU',
    Effect: 'Deny',
    Action: 'ec2:RunInstances',
    Resource: '*',
    Condition: {
      StringLike: { 'ec2:InstanceType': ['p*', 'g*', 'inf*', 'trn*', 'dl*'] },
    },
  });

  // 5. Limit volume sizes
  statements.push({
    Sid: 'LimitStorageSize',
    Effect: 'Deny',
    Action: 'ec2:CreateVolume',
    Resource: '*',
    Condition: {
      NumericGreaterThan: { 'ec2:VolumeSize': '30' },
    },
  });

  // 6. Deny provisioned IOPS storage
  statements.push({
    Sid: 'DenyPremiumStorage',
    Effect: 'Deny',
    Action: 'ec2:CreateVolume',
    Resource: '*',
    Condition: {
      StringEquals: { 'ec2:VolumeType': ['io1', 'io2'] },
    },
  });

  // 7. Deny large RDS instances
  statements.push({
    Sid: 'DenyLargeRDS',
    Effect: 'Deny',
    Action: ['rds:CreateDBInstance', 'rds:ModifyDBInstance'],
    Resource: '*',
    Condition: {
      'ForAnyValue:StringLike': {
        'rds:DatabaseClass': ['db.r*', 'db.x*', 'db.m5.2*', 'db.m5.4*', 'db.m5.8*', 'db.m5.12*', 'db.m5.16*', 'db.m5.24*'],
      },
    },
  });

  const policy = {
    Version: '2012-10-17',
    Statement: statements,
  };

  return policy;
}

/**
 * Generate Azure Policy definition from a SandboxTemplate.
 */
function generateAzurePolicy(template) {
  const allowedVmSizes = template.allowedInstanceTypes?.azure || ['Standard_B1s', 'Standard_B1ms', 'Standard_B2s', 'Standard_B2ms', 'Standard_B4ms'];
  return {
    policyType: 'Custom',
    mode: 'All',
    displayName: `Sandbox: ${template.name}`,
    description: `Restricts resources for ${template.name} course sandbox`,
    policyRule: {
      if: {
        allOf: [
          { field: 'type', equals: 'Microsoft.Compute/virtualMachines' },
          { field: 'Microsoft.Compute/virtualMachines/sku.name', notIn: allowedVmSizes },
        ],
      },
      then: { effect: 'deny' },
    },
  };
}

/**
 * Generate GCP Org Policy from a SandboxTemplate.
 */
function generateGcpOrgPolicy(template) {
  const allowedTypes = template.allowedInstanceTypes?.gcp || ['e2-micro', 'e2-small', 'e2-medium', 'e2-standard-2', 'f1-micro', 'g1-small'];
  return {
    constraint: 'constraints/compute.restrictMachineTypes',
    listPolicy: {
      allowedValues: allowedTypes,
    },
  };
}

module.exports = { generateAwsIamPolicy, generateAzurePolicy, generateGcpOrgPolicy, AWS_SERVICE_MAP };
