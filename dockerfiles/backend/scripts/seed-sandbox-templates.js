require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');
const { generateAwsIamPolicy } = require('../services/iamPolicyGenerator');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  await SandboxTemplate.deleteMany({});

  // =============================================
  // AWS Cloud Practitioner (CLF-C02)
  // =============================================
  const clfTemplate = {
    name: 'AWS Cloud Practitioner (CLF-C02)',
    slug: 'aws-clf-c02',
    cloud: 'aws',
    certificationCode: 'CLF-C02',
    certificationLevel: 'foundational',
    description: 'Hands-on sandbox for AWS Certified Cloud Practitioner exam preparation. Covers all 4 exam domains with guided labs for core AWS services.',
    icon: '☁️',

    examDomains: [
      { name: 'Cloud Concepts', weight: 24 },
      { name: 'Security and Compliance', weight: 30 },
      { name: 'Cloud Technology and Services', weight: 34 },
      { name: 'Billing, Pricing, and Support', weight: 12 },
    ],

    sandboxConfig: {
      ttlHours: 4,
      budgetInr: 200,
      region: 'ap-south-1',
    },

    // In-scope services from the CLF-C02 exam guide
    allowedServices: [
      // Analytics
      { service: 'athena', category: 'Analytics' },
      { service: 'emr', category: 'Analytics', restrictions: 'Small clusters only' },
      { service: 'glue', category: 'Analytics' },
      { service: 'kinesis', category: 'Analytics' },
      { service: 'opensearch', category: 'Analytics' },
      { service: 'quicksight', category: 'Analytics' },
      { service: 'redshift', category: 'Analytics', restrictions: 'dc2.large single node only' },
      // Application Integration
      { service: 'eventbridge', category: 'Application Integration' },
      { service: 'sns', category: 'Application Integration' },
      { service: 'sqs', category: 'Application Integration' },
      { service: 'stepfunctions', category: 'Application Integration' },
      // Business Applications
      { service: 'connect', category: 'Business Applications' },
      { service: 'ses', category: 'Business Applications' },
      // Cloud Financial Management
      { service: 'budgets', category: 'Cloud Financial Management' },
      { service: 'costexplorer', category: 'Cloud Financial Management' },
      // Compute
      { service: 'batch', category: 'Compute' },
      { service: 'ec2', category: 'Compute', restrictions: 't2/t3 micro/small/medium only' },
      { service: 'elasticbeanstalk', category: 'Compute' },
      { service: 'lightsail', category: 'Compute' },
      { service: 'lambda', category: 'Compute' },
      // Containers
      { service: 'ecr', category: 'Containers' },
      { service: 'ecs', category: 'Containers' },
      { service: 'eks', category: 'Containers', restrictions: 'Managed node group, t3.small' },
      { service: 'fargate', category: 'Containers' },
      // Database
      { service: 'aurora', category: 'Database', restrictions: 'db.t3.small only' },
      { service: 'documentdb', category: 'Database' },
      { service: 'dynamodb', category: 'Database' },
      { service: 'elasticache', category: 'Database', restrictions: 'cache.t3.micro only' },
      { service: 'neptune', category: 'Database' },
      { service: 'rds', category: 'Database', restrictions: 'db.t3.micro/small only' },
      // Developer Tools
      { service: 'codebuild', category: 'Developer Tools' },
      { service: 'codepipeline', category: 'Developer Tools' },
      { service: 'xray', category: 'Developer Tools' },
      // Frontend Web and Mobile
      { service: 'amplify', category: 'Frontend Web and Mobile' },
      { service: 'appsync', category: 'Frontend Web and Mobile' },
      // IoT
      { service: 'iot', category: 'IoT' },
      // Machine Learning
      { service: 'comprehend', category: 'Machine Learning' },
      { service: 'kendra', category: 'Machine Learning' },
      { service: 'lex', category: 'Machine Learning' },
      { service: 'polly', category: 'Machine Learning' },
      { service: 'rekognition', category: 'Machine Learning' },
      { service: 'textract', category: 'Machine Learning' },
      { service: 'transcribe', category: 'Machine Learning' },
      { service: 'translate', category: 'Machine Learning' },
      // Management and Governance
      { service: 'autoscaling', category: 'Management and Governance' },
      { service: 'cloudformation', category: 'Management and Governance' },
      { service: 'cloudtrail', category: 'Management and Governance' },
      { service: 'cloudwatch', category: 'Management and Governance' },
      { service: 'config', category: 'Management and Governance' },
      { service: 'systemsmanager', category: 'Management and Governance' },
      { service: 'trustedadvisor', category: 'Management and Governance' },
      // Migration and Transfer
      { service: 'dms', category: 'Migration and Transfer' },
      // Networking
      { service: 'apigateway', category: 'Networking' },
      { service: 'cloudfront', category: 'Networking' },
      { service: 'route53', category: 'Networking' },
      { service: 'vpc', category: 'Networking' },
      { service: 'vpn', category: 'Networking' },
      // Security
      { service: 'iam', category: 'Security' },
      { service: 'kms', category: 'Security' },
      { service: 'secretsmanager', category: 'Security' },
      { service: 'waf', category: 'Security' },
      { service: 'shield', category: 'Security' },
      { service: 'guardduty', category: 'Security' },
      { service: 'inspector', category: 'Security' },
      { service: 'cognito', category: 'Security' },
      { service: 'acm', category: 'Security' },
      { service: 'macie', category: 'Security' },
      // Storage
      { service: 's3', category: 'Storage' },
      { service: 'ebs', category: 'Storage', restrictions: 'gp2/gp3, max 50GB' },
      { service: 'efs', category: 'Storage' },
      { service: 'fsx', category: 'Storage' },
      { service: 's3glacier', category: 'Storage' },
      { service: 'storagegateway', category: 'Storage' },
      { service: 'backup', category: 'Storage' },
    ],

    blockedServices: [
      // Out-of-scope per exam guide
      { service: 'gamelift', reason: 'Out of scope (Game Tech)' },
      { service: 'robomaker', reason: 'Out of scope (Robotics)' },
      { service: 'iot-greengrass', reason: 'Out of scope (IoT advanced)' },
      { service: 'sagemaker', reason: 'Expensive — use Comprehend/Rekognition instead' },
      { service: 'personalize', reason: 'Out of scope (ML advanced)' },
      { service: 'fraud-detector', reason: 'Out of scope (ML advanced)' },
      { service: 'panorama', reason: 'Out of scope' },
      { service: 'monitron', reason: 'Out of scope' },
      { service: 'msk', reason: 'Out of scope (Analytics advanced)' },
      { service: 'appflow', reason: 'Out of scope' },
      { service: 'clean-rooms', reason: 'Out of scope' },
      { service: 'data-exchange', reason: 'Out of scope' },
      { service: 'datazone', reason: 'Out of scope' },
      { service: 'wavelength', reason: 'Out of scope (Compute advanced)' },
      { service: 'app-runner', reason: 'Out of scope' },
    ],

    allowedInstanceTypes: {
      aws: ['t2.micro', 't2.small', 't2.medium', 't3.micro', 't3.small', 't3.medium'],
    },

    // Guided labs mapped to exam domains
    labs: [
      // Domain 1: Cloud Concepts (24%)
      {
        title: 'Explore AWS Global Infrastructure',
        domain: 'Cloud Concepts',
        domainWeight: 24,
        duration: 20,
        difficulty: 'beginner',
        description: 'Understand AWS Regions, Availability Zones, and Edge Locations by exploring the AWS Console.',
        steps: [
          { order: 1, title: 'Open AWS Console', description: 'Sign in and navigate to the AWS Management Console.', service: 'console' },
          { order: 2, title: 'Explore Regions', description: 'Click the Region dropdown (top right). Note the available regions. Switch to US East (N. Virginia) and then to Asia Pacific (Mumbai).', service: 'console' },
          { order: 3, title: 'View EC2 Dashboard', description: 'Navigate to EC2. Observe the Availability Zones listed for the selected region.', service: 'ec2' },
          { order: 4, title: 'Explore CloudFront', description: 'Navigate to CloudFront. Understand how Edge Locations differ from Regions.', service: 'cloudfront' },
        ],
      },
      {
        title: 'Launch Your First EC2 Instance',
        domain: 'Cloud Concepts',
        domainWeight: 24,
        duration: 30,
        difficulty: 'beginner',
        description: 'Launch a t2.micro EC2 instance, connect to it, and understand on-demand vs reserved pricing.',
        steps: [
          { order: 1, title: 'Navigate to EC2', description: 'Go to EC2 > Instances > Launch Instances.', service: 'ec2' },
          { order: 2, title: 'Configure Instance', description: 'Name: my-first-instance. AMI: Amazon Linux 2023. Instance type: t2.micro (Free Tier eligible). Create a new key pair.', service: 'ec2', hint: 'Only t2/t3 micro/small/medium are allowed in this sandbox' },
          { order: 3, title: 'Launch and Connect', description: 'Launch the instance. Wait for it to reach Running state. Use EC2 Instance Connect to open a terminal.', service: 'ec2' },
          { order: 4, title: 'Explore Pricing', description: 'Go to EC2 > Reserved Instances. Understand the difference between On-Demand, Reserved, and Spot pricing.', service: 'ec2' },
          { order: 5, title: 'Terminate', description: 'Select your instance > Instance State > Terminate. Confirm termination.', service: 'ec2' },
        ],
      },

      // Domain 2: Security and Compliance (30%)
      {
        title: 'IAM Users, Groups, and Policies',
        domain: 'Security and Compliance',
        domainWeight: 30,
        duration: 35,
        difficulty: 'beginner',
        description: 'Create IAM users, groups, and attach policies following the principle of least privilege.',
        steps: [
          { order: 1, title: 'Navigate to IAM', description: 'Go to IAM Dashboard. Note the security recommendations.', service: 'iam' },
          { order: 2, title: 'Create a Group', description: 'Create a group called "developers". Attach the "AmazonS3ReadOnlyAccess" managed policy.', service: 'iam' },
          { order: 3, title: 'Create a User', description: 'Create a user "dev-user1" with AWS Console access. Add to the "developers" group.', service: 'iam' },
          { order: 4, title: 'Test Permissions', description: 'Sign in as dev-user1 in an incognito window. Try to read S3 (should work) and create EC2 (should fail).', service: 'iam', hint: 'This demonstrates the principle of least privilege' },
          { order: 5, title: 'Create Custom Policy', description: 'Create a custom JSON policy that allows EC2 describe but denies RunInstances. Attach to the group.', service: 'iam' },
          { order: 6, title: 'Enable MFA', description: 'Go to your root account > Security credentials > Activate MFA. Understand why MFA is important.', service: 'iam' },
        ],
      },
      {
        title: 'Encryption and Key Management',
        domain: 'Security and Compliance',
        domainWeight: 30,
        duration: 25,
        difficulty: 'beginner',
        description: 'Explore encryption at rest and in transit using KMS and S3.',
        steps: [
          { order: 1, title: 'Create a KMS Key', description: 'Go to KMS > Create key. Choose symmetric key. Give it an alias "my-lab-key".', service: 'kms' },
          { order: 2, title: 'Create Encrypted S3 Bucket', description: 'Create an S3 bucket with server-side encryption enabled using your KMS key.', service: 's3' },
          { order: 3, title: 'Upload Encrypted Object', description: 'Upload a file to the bucket. Verify the encryption status in the object properties.', service: 's3' },
          { order: 4, title: 'Explore CloudTrail', description: 'Go to CloudTrail > Event History. Find the KMS and S3 API calls you just made.', service: 'cloudtrail' },
        ],
      },

      // Domain 3: Cloud Technology and Services (34%)
      {
        title: 'S3 Storage Classes and Lifecycle',
        domain: 'Cloud Technology and Services',
        domainWeight: 34,
        duration: 25,
        difficulty: 'beginner',
        description: 'Create S3 buckets, upload objects, explore storage classes, and set lifecycle rules.',
        steps: [
          { order: 1, title: 'Create S3 Bucket', description: 'Go to S3 > Create Bucket. Choose a unique name and ap-south-1 region.', service: 's3' },
          { order: 2, title: 'Upload Objects', description: 'Upload 2-3 files. Try changing the storage class to S3-IA (Infrequent Access).', service: 's3' },
          { order: 3, title: 'Enable Versioning', description: 'Go to bucket Properties > Versioning > Enable. Upload the same file again and see versions.', service: 's3' },
          { order: 4, title: 'Create Lifecycle Rule', description: 'Go to Management > Create lifecycle rule. Move objects to Glacier after 30 days, delete after 365 days.', service: 's3' },
          { order: 5, title: 'Explore Pricing', description: 'Compare S3 Standard vs S3-IA vs Glacier pricing in the AWS Pricing Calculator.', service: 's3' },
        ],
      },
      {
        title: 'VPC Networking Fundamentals',
        domain: 'Cloud Technology and Services',
        domainWeight: 34,
        duration: 40,
        difficulty: 'intermediate',
        description: 'Create a VPC with public/private subnets, security groups, and NACLs.',
        steps: [
          { order: 1, title: 'Create a VPC', description: 'Go to VPC > Create VPC. CIDR: 10.0.0.0/16. Create 2 subnets: public (10.0.1.0/24) and private (10.0.2.0/24).', service: 'vpc' },
          { order: 2, title: 'Create Internet Gateway', description: 'Create an IGW and attach to your VPC. Update the public subnet route table to point 0.0.0.0/0 to the IGW.', service: 'vpc' },
          { order: 3, title: 'Create Security Group', description: 'Create a SG allowing SSH (22) and HTTP (80) inbound. Understand stateful vs stateless.', service: 'vpc' },
          { order: 4, title: 'Create NACL', description: 'Create a Network ACL for the private subnet. Add rules to allow only internal traffic. Understand how NACLs differ from SGs.', service: 'vpc', hint: 'NACLs are stateless, SGs are stateful' },
          { order: 5, title: 'Launch EC2 in VPC', description: 'Launch a t2.micro in the public subnet with the SG attached. Verify connectivity.', service: 'ec2' },
        ],
      },
      {
        title: 'DynamoDB and Lambda Serverless',
        domain: 'Cloud Technology and Services',
        domainWeight: 34,
        duration: 30,
        difficulty: 'beginner',
        description: 'Create a DynamoDB table and a Lambda function that reads from it.',
        steps: [
          { order: 1, title: 'Create DynamoDB Table', description: 'Go to DynamoDB > Create table. Table name: "users". Partition key: "userId" (String). Use default settings.', service: 'dynamodb' },
          { order: 2, title: 'Add Items', description: 'Click the table > Actions > Create item. Add 3 users with userId, name, and email attributes.', service: 'dynamodb' },
          { order: 3, title: 'Create Lambda Function', description: 'Go to Lambda > Create function. Runtime: Python 3.12. Write code to scan the DynamoDB table.', service: 'lambda' },
          { order: 4, title: 'Test Lambda', description: 'Create a test event and run the function. Verify it returns the DynamoDB items.', service: 'lambda' },
          { order: 5, title: 'Add API Gateway', description: 'Create an HTTP API Gateway trigger for the Lambda. Test the public URL in your browser.', service: 'apigateway' },
        ],
      },
      {
        title: 'RDS Database Setup',
        domain: 'Cloud Technology and Services',
        domainWeight: 34,
        duration: 30,
        difficulty: 'beginner',
        description: 'Create an RDS MySQL database, connect to it, and explore Multi-AZ and Read Replicas.',
        steps: [
          { order: 1, title: 'Create RDS Instance', description: 'Go to RDS > Create database. Engine: MySQL. Template: Free tier. Instance: db.t3.micro. Storage: 20 GB gp2.', service: 'rds', hint: 'Only db.t3.micro/small allowed in this sandbox' },
          { order: 2, title: 'Configure Security', description: 'Set a master password. Choose your VPC and create a new security group allowing MySQL port 3306.', service: 'rds' },
          { order: 3, title: 'Connect to Database', description: 'Use EC2 Instance Connect or Cloud9 to connect: mysql -h <endpoint> -u admin -p', service: 'rds' },
          { order: 4, title: 'Explore Multi-AZ', description: 'Go to the RDS instance details. Understand Multi-AZ deployment vs Read Replicas.', service: 'rds' },
        ],
      },

      // Domain 4: Billing, Pricing, and Support (12%)
      {
        title: 'Cost Management and Billing',
        domain: 'Billing, Pricing, and Support',
        domainWeight: 12,
        duration: 20,
        difficulty: 'beginner',
        description: 'Explore AWS Cost Explorer, Budgets, and the Pricing Calculator.',
        steps: [
          { order: 1, title: 'AWS Cost Explorer', description: 'Go to Billing > Cost Explorer. View costs by service, region, and time period.', service: 'costexplorer' },
          { order: 2, title: 'Create a Budget', description: 'Go to Budgets > Create budget. Set a monthly budget of $10. Configure email alerts at 80% and 100%.', service: 'budgets' },
          { order: 3, title: 'Pricing Calculator', description: 'Open the AWS Pricing Calculator. Estimate the cost of running a t3.micro EC2 24/7 for a month. Compare On-Demand vs Reserved.', service: 'console' },
          { order: 4, title: 'Trusted Advisor', description: 'Go to Trusted Advisor. Review the cost optimization, security, and performance recommendations.', service: 'trustedadvisor' },
        ],
      },
    ],
  };

  // =============================================
  // AWS Solutions Architect - Associate (SAA-C03)
  // =============================================
  const saaTemplate = {
    name: 'AWS Solutions Architect - Associate (SAA-C03)',
    slug: 'aws-saa-c03',
    cloud: 'aws',
    certificationCode: 'SAA-C03',
    certificationLevel: 'associate',
    description: 'Design secure, resilient, high-performing, and cost-optimized architectures on AWS. Covers all 4 SAA-C03 exam domains with hands-on labs across VPC, EC2, RDS, Lambda, S3, and more.',
    icon: '🏗️',
    sortOrder: 2,

    examDomains: [
      { name: 'Design Secure Architectures', weight: 30 },
      { name: 'Design Resilient Architectures', weight: 26 },
      { name: 'Design High-Performing Architectures', weight: 24 },
      { name: 'Design Cost-Optimized Architectures', weight: 20 },
    ],

    sandboxConfig: {
      ttlHours: 6,
      budgetInr: 400,
      region: 'ap-south-1',
    },

    // In-scope services from the SAA-C03 exam guide
    allowedServices: [
      // Analytics
      { service: 'athena', category: 'Analytics' },
      { service: 'data-firehose', category: 'Analytics' },
      { service: 'emr', category: 'Analytics', restrictions: 'm5.xlarge max, 3 nodes' },
      { service: 'glue', category: 'Analytics' },
      { service: 'kinesis', category: 'Analytics' },
      { service: 'lakeformation', category: 'Analytics' },
      { service: 'msk', category: 'Analytics', restrictions: 'kafka.t3.small only' },
      { service: 'opensearch', category: 'Analytics', restrictions: 't3.small.search only' },
      { service: 'quicksight', category: 'Analytics' },
      { service: 'redshift', category: 'Analytics', restrictions: 'dc2.large single node only' },
      // Application Integration
      { service: 'appflow', category: 'Application Integration' },
      { service: 'appsync', category: 'Application Integration' },
      { service: 'eventbridge', category: 'Application Integration' },
      { service: 'mq', category: 'Application Integration', restrictions: 'mq.t3.micro only' },
      { service: 'sns', category: 'Application Integration' },
      { service: 'sqs', category: 'Application Integration' },
      { service: 'stepfunctions', category: 'Application Integration' },
      // Cost Management
      { service: 'budgets', category: 'Cloud Financial Management' },
      { service: 'costexplorer', category: 'Cloud Financial Management' },
      // Compute
      { service: 'batch', category: 'Compute' },
      { service: 'ec2', category: 'Compute', restrictions: 't2/t3 micro/small/medium only' },
      { service: 'autoscaling', category: 'Compute' },
      { service: 'elasticbeanstalk', category: 'Compute' },
      { service: 'lambda', category: 'Compute' },
      { service: 'outposts', category: 'Compute' },
      // Containers
      { service: 'ecr', category: 'Containers' },
      { service: 'ecs', category: 'Containers' },
      { service: 'eks', category: 'Containers', restrictions: 'Managed node group, t3.small' },
      { service: 'fargate', category: 'Containers' },
      // Database
      { service: 'aurora', category: 'Database', restrictions: 'db.t3.small only' },
      { service: 'documentdb', category: 'Database' },
      { service: 'dynamodb', category: 'Database' },
      { service: 'elasticache', category: 'Database', restrictions: 'cache.t3.micro only' },
      { service: 'keyspaces', category: 'Database' },
      { service: 'neptune', category: 'Database' },
      { service: 'rds', category: 'Database', restrictions: 'db.t3.micro/small only' },
      // Developer Tools
      { service: 'xray', category: 'Developer Tools' },
      // Frontend
      { service: 'amplify', category: 'Frontend Web and Mobile' },
      { service: 'apigateway', category: 'Frontend Web and Mobile' },
      // Machine Learning
      { service: 'comprehend', category: 'Machine Learning' },
      { service: 'kendra', category: 'Machine Learning' },
      { service: 'lex', category: 'Machine Learning' },
      { service: 'polly', category: 'Machine Learning' },
      { service: 'rekognition', category: 'Machine Learning' },
      { service: 'textract', category: 'Machine Learning' },
      { service: 'transcribe', category: 'Machine Learning' },
      { service: 'translate', category: 'Machine Learning' },
      // Management and Governance
      { service: 'cloudformation', category: 'Management and Governance' },
      { service: 'cloudtrail', category: 'Management and Governance' },
      { service: 'cloudwatch', category: 'Management and Governance' },
      { service: 'computeoptimizer', category: 'Management and Governance' },
      { service: 'config', category: 'Management and Governance' },
      { service: 'controltower', category: 'Management and Governance' },
      { service: 'licensemanager', category: 'Management and Governance' },
      { service: 'organizations', category: 'Management and Governance' },
      { service: 'servicecatalog', category: 'Management and Governance' },
      { service: 'systemsmanager', category: 'Management and Governance' },
      { service: 'trustedadvisor', category: 'Management and Governance' },
      { service: 'wellarchitected', category: 'Management and Governance' },
      // Migration and Transfer
      { service: 'applicationmigration', category: 'Migration and Transfer' },
      { service: 'datasync', category: 'Migration and Transfer' },
      { service: 'dms', category: 'Migration and Transfer' },
      { service: 'snowfamily', category: 'Migration and Transfer' },
      { service: 'transferfamily', category: 'Migration and Transfer' },
      // Networking
      { service: 'cloudfront', category: 'Networking' },
      { service: 'directconnect', category: 'Networking' },
      { service: 'elb', category: 'Networking' },
      { service: 'globalaccelerator', category: 'Networking' },
      { service: 'privatelink', category: 'Networking' },
      { service: 'route53', category: 'Networking' },
      { service: 'transitgateway', category: 'Networking' },
      { service: 'vpc', category: 'Networking' },
      { service: 'vpn', category: 'Networking' },
      // Security
      { service: 'acm', category: 'Security' },
      { service: 'artifact', category: 'Security' },
      { service: 'auditmanager', category: 'Security' },
      { service: 'cloudhsm', category: 'Security' },
      { service: 'cognito', category: 'Security' },
      { service: 'detective', category: 'Security' },
      { service: 'directory', category: 'Security' },
      { service: 'firewallmanager', category: 'Security' },
      { service: 'guardduty', category: 'Security' },
      { service: 'iam', category: 'Security' },
      { service: 'inspector', category: 'Security' },
      { service: 'kms', category: 'Security' },
      { service: 'macie', category: 'Security' },
      { service: 'networkfirewall', category: 'Security' },
      { service: 'ram', category: 'Security' },
      { service: 'secretsmanager', category: 'Security' },
      { service: 'securityhub', category: 'Security' },
      { service: 'shield', category: 'Security' },
      { service: 'waf', category: 'Security' },
      // Storage
      { service: 'backup', category: 'Storage' },
      { service: 'ebs', category: 'Storage', restrictions: 'gp2/gp3, max 100GB' },
      { service: 'efs', category: 'Storage' },
      { service: 'fsx', category: 'Storage' },
      { service: 's3', category: 'Storage' },
      { service: 's3glacier', category: 'Storage' },
      { service: 'storagegateway', category: 'Storage' },
    ],

    blockedServices: [
      // Out-of-scope per exam guide
      { service: 'gamelift', reason: 'Out of scope (Game Tech)' },
      { service: 'sumerian', reason: 'Out of scope (AR/VR)' },
      { service: 'managedblockchain', reason: 'Out of scope (Blockchain)' },
      { service: 'lightsail', reason: 'Out of scope (Compute)' },
      { service: 'location', reason: 'Out of scope (Front-End)' },
      { service: 'sagemaker-canvas', reason: 'Out of scope (ML)' },
      { service: 'sagemaker', reason: 'Expensive — use Comprehend/Rekognition' },
      { service: 'personalize', reason: 'Out of scope (ML)' },
      { service: 'deepcomposer', reason: 'Out of scope (ML)' },
      { service: 'devopsguru', reason: 'Out of scope (ML)' },
      { service: 'braket', reason: 'Out of scope (Quantum)' },
      { service: 'groundstation', reason: 'Out of scope (Satellite)' },
      { service: 'mwaa', reason: 'Out of scope (Application Integration)' },
      { service: 'cloudmap', reason: 'Out of scope (Networking)' },
      { service: 'iot-core', reason: 'Out of scope (IoT)' },
    ],

    allowedInstanceTypes: {
      aws: ['t2.micro', 't2.small', 't2.medium', 't3.micro', 't3.small', 't3.medium'],
    },

    labs: [
      // Domain 1: Design Secure Architectures (30%)
      {
        title: 'IAM Roles and Cross-Account Access',
        domain: 'Design Secure Architectures',
        domainWeight: 30,
        duration: 40,
        difficulty: 'intermediate',
        description: 'Design role-based access using IAM roles, AssumeRole, and resource-based policies.',
        steps: [
          { order: 1, title: 'Create IAM Role', description: 'Create a role "EC2-S3-ReadOnly" trusted by the EC2 service. Attach AmazonS3ReadOnlyAccess.', service: 'iam' },
          { order: 2, title: 'Attach to EC2', description: 'Launch a t3.micro and attach the role via instance profile. SSH in and run aws s3 ls — no keys needed.', service: 'ec2', hint: 'Instance profiles inject temporary credentials via the metadata service' },
          { order: 3, title: 'Create S3 Resource Policy', description: 'Create a bucket with a bucket policy allowing the IAM role ARN only — demonstrates resource-based auth.', service: 's3' },
          { order: 4, title: 'Simulate Cross-Account', description: 'Create a second role with an external account principal and sts:AssumeRole trust. Understand the STS flow.', service: 'iam' },
        ],
      },
      {
        title: 'VPC Security: Security Groups vs NACLs',
        domain: 'Design Secure Architectures',
        domainWeight: 30,
        duration: 35,
        difficulty: 'intermediate',
        description: 'Design a multi-tier VPC with public/private subnets, bastion host, and NAT gateway.',
        steps: [
          { order: 1, title: 'Create VPC with Subnets', description: 'VPC 10.0.0.0/16 with public (10.0.1.0/24) and private (10.0.2.0/24) across 2 AZs.', service: 'vpc' },
          { order: 2, title: 'Add NAT Gateway', description: 'Create a NAT Gateway in a public subnet. Update the private route table to route 0.0.0.0/0 through it.', service: 'vpc', hint: 'NAT Gateways are AZ-specific — for HA you need one per AZ' },
          { order: 3, title: 'Launch Bastion Host', description: 'Launch a t3.micro in the public subnet. SG: allow SSH from your IP only.', service: 'ec2' },
          { order: 4, title: 'Launch Private Instance', description: 'Launch a t3.micro in private subnet. SG: allow SSH only from the bastion SG.', service: 'ec2' },
          { order: 5, title: 'Compare with NACL', description: 'Create a restrictive NACL on the private subnet. Understand stateless rules and ephemeral ports.', service: 'vpc' },
        ],
      },
      {
        title: 'Encrypting Data at Rest with KMS',
        domain: 'Design Secure Architectures',
        domainWeight: 30,
        duration: 25,
        difficulty: 'beginner',
        description: 'Encrypt S3, EBS, and RDS using customer-managed KMS keys with key rotation.',
        steps: [
          { order: 1, title: 'Create CMK', description: 'KMS > Create key > Symmetric > Customer managed. Enable automatic annual rotation.', service: 'kms' },
          { order: 2, title: 'Encrypt S3 Bucket', description: 'Create a bucket with SSE-KMS using your CMK as the default encryption key.', service: 's3' },
          { order: 3, title: 'Encrypt EBS Volume', description: 'Create a new gp3 volume with encryption enabled using your CMK.', service: 'ebs' },
          { order: 4, title: 'Encrypt RDS', description: 'Create a db.t3.micro RDS with storage encryption. Understand that encryption cannot be added to an existing unencrypted instance.', service: 'rds', hint: 'To encrypt an existing RDS you must snapshot, copy with encryption, and restore' },
        ],
      },

      // Domain 2: Design Resilient Architectures (26%)
      {
        title: 'Multi-AZ ALB + Auto Scaling Group',
        domain: 'Design Resilient Architectures',
        domainWeight: 26,
        duration: 45,
        difficulty: 'intermediate',
        description: 'Build a highly available web tier with an Application Load Balancer and an EC2 Auto Scaling Group across 2 AZs.',
        steps: [
          { order: 1, title: 'Create Launch Template', description: 'Launch template with user data that installs httpd and writes the instance ID to index.html.', service: 'ec2' },
          { order: 2, title: 'Create Target Group', description: 'Target group type: instances, port 80, health check path /.', service: 'elb' },
          { order: 3, title: 'Create ALB', description: 'Internet-facing ALB in 2 public subnets. Listener on port 80 forwarding to the target group.', service: 'elb' },
          { order: 4, title: 'Create ASG', description: 'ASG: min 2, desired 2, max 4. Attach to target group. Enable CPU-based scaling policy at 70%.', service: 'autoscaling' },
          { order: 5, title: 'Test Failover', description: 'Terminate one instance manually. Verify the ASG launches a replacement and the ALB keeps serving traffic.', service: 'autoscaling' },
        ],
      },
      {
        title: 'Event-Driven Decoupling with SQS and Lambda',
        domain: 'Design Resilient Architectures',
        domainWeight: 26,
        duration: 35,
        difficulty: 'intermediate',
        description: 'Decouple a producer and consumer using SQS with a dead-letter queue.',
        steps: [
          { order: 1, title: 'Create SQS Queues', description: 'Create a standard queue "orders" and a DLQ "orders-dlq". Set maxReceiveCount = 3 on the redrive policy.', service: 'sqs' },
          { order: 2, title: 'Create Lambda Consumer', description: 'Lambda (Python 3.12) that processes SQS messages. Intentionally fail on messages containing "FAIL".', service: 'lambda' },
          { order: 3, title: 'Add SQS Trigger', description: 'Add the queue as a Lambda event source. Batch size 5.', service: 'lambda' },
          { order: 4, title: 'Observe DLQ Behavior', description: 'Send 10 messages (one with "FAIL"). Watch the failing message move to the DLQ after 3 retries.', service: 'sqs' },
        ],
      },
      {
        title: 'RDS Multi-AZ and Read Replicas',
        domain: 'Design Resilient Architectures',
        domainWeight: 26,
        duration: 30,
        difficulty: 'intermediate',
        description: 'Configure RDS for HA (Multi-AZ) and read scaling (read replicas).',
        steps: [
          { order: 1, title: 'Create Multi-AZ RDS', description: 'Create a db.t3.micro MySQL with Multi-AZ enabled. Note the synchronous replication to a standby in another AZ.', service: 'rds', hint: 'Multi-AZ is for HA/failover, not read scaling' },
          { order: 2, title: 'Create Read Replica', description: 'Create a read replica in the same region. Note the asynchronous replication.', service: 'rds' },
          { order: 3, title: 'Force Failover', description: 'RDS Actions > Reboot with failover. Watch the endpoint switch to the standby.', service: 'rds' },
          { order: 4, title: 'Compare Strategies', description: 'Document the difference: Multi-AZ = HA, Read Replica = scale reads, Aurora = both.', service: 'rds' },
        ],
      },

      // Domain 3: Design High-Performing Architectures (24%)
      {
        title: 'CloudFront + S3 Static Website',
        domain: 'Design High-Performing Architectures',
        domainWeight: 24,
        duration: 25,
        difficulty: 'beginner',
        description: 'Serve a static site globally via CloudFront with an S3 origin and OAC.',
        steps: [
          { order: 1, title: 'Create S3 Bucket', description: 'Create a bucket, upload index.html. Keep Block Public Access ON.', service: 's3' },
          { order: 2, title: 'Create CloudFront Distribution', description: 'Origin: your S3 bucket. Use Origin Access Control (OAC) to lock the bucket to CloudFront only.', service: 'cloudfront' },
          { order: 3, title: 'Test Latency', description: 'Hit the CloudFront URL. Use curl -w to measure TTFB from different regions.', service: 'cloudfront' },
          { order: 4, title: 'Invalidate Cache', description: 'Update index.html in S3, create an invalidation /* on CloudFront, verify the change propagates.', service: 'cloudfront' },
        ],
      },
      {
        title: 'ElastiCache Redis Caching Layer',
        domain: 'Design High-Performing Architectures',
        domainWeight: 24,
        duration: 35,
        difficulty: 'intermediate',
        description: 'Add a Redis cache in front of RDS to reduce read latency.',
        steps: [
          { order: 1, title: 'Create Redis Cluster', description: 'ElastiCache > Redis > cache.t3.micro, 1 node. Place in the same VPC as your RDS.', service: 'elasticache' },
          { order: 2, title: 'Deploy Lambda Client', description: 'Lambda that checks Redis first, falls back to RDS on miss, then caches the result (cache-aside pattern).', service: 'lambda' },
          { order: 3, title: 'Measure Performance', description: 'Invoke Lambda twice — first call ~200ms (RDS), second ~5ms (Redis).', service: 'lambda' },
          { order: 4, title: 'Understand TTL', description: 'Set a 60s TTL on cached keys. Update RDS data and watch the cache expire.', service: 'elasticache' },
        ],
      },

      // Domain 4: Design Cost-Optimized Architectures (20%)
      {
        title: 'S3 Lifecycle and Storage Classes',
        domain: 'Design Cost-Optimized Architectures',
        domainWeight: 20,
        duration: 25,
        difficulty: 'beginner',
        description: 'Optimize S3 costs using Intelligent-Tiering, lifecycle transitions, and Glacier.',
        steps: [
          { order: 1, title: 'Create Lifecycle Rule', description: 'S3 > Management > Lifecycle rule: transition to S3-IA after 30 days, Glacier Flexible after 90, Glacier Deep Archive after 180, expire at 365.', service: 's3' },
          { order: 2, title: 'Enable Intelligent-Tiering', description: 'Upload a file with storage class INTELLIGENT_TIERING. S3 auto-moves it based on access patterns.', service: 's3' },
          { order: 3, title: 'Compare Costs', description: 'Open AWS Pricing Calculator. Compare 1TB stored for 1 year across Standard / IA / Glacier Deep.', service: 's3' },
          { order: 4, title: 'Use Storage Lens', description: 'Enable S3 Storage Lens to identify cold data and cost-saving opportunities.', service: 's3' },
        ],
      },
      {
        title: 'Spot, Reserved, and Savings Plans',
        domain: 'Design Cost-Optimized Architectures',
        domainWeight: 20,
        duration: 30,
        difficulty: 'beginner',
        description: 'Choose the right pricing model for different workload classes.',
        steps: [
          { order: 1, title: 'Launch Spot Instance', description: 'Launch a t3.micro with purchasing option = Spot. Note up to 90% savings vs on-demand.', service: 'ec2', hint: 'Spot can be interrupted with 2 min notice — suitable for stateless/batch workloads' },
          { order: 2, title: 'Explore Savings Plans', description: 'Billing > Savings Plans > Recommendations. Understand Compute SP vs EC2 Instance SP.', service: 'costexplorer' },
          { order: 3, title: 'Cost Explorer', description: 'Open Cost Explorer. Group by service and usage type to find the top spenders.', service: 'costexplorer' },
          { order: 4, title: 'Set a Budget', description: 'Create a $20 monthly budget with 80% and 100% email alerts.', service: 'budgets' },
        ],
      },
    ],
  };

  // =============================================
  // AWS Solutions Architect - Professional (SAP-C02)
  // =============================================
  const sapTemplate = {
    name: 'AWS Solutions Architect - Professional (SAP-C02)',
    slug: 'aws-sap-c02',
    cloud: 'aws',
    certificationCode: 'SAP-C02',
    certificationLevel: 'professional',
    description: 'Advanced, multi-account architectures across the AWS Well-Architected Framework. Covers organizational complexity, new solutions, continuous improvement, and migration/modernization.',
    icon: '🎯',
    sortOrder: 3,

    examDomains: [
      { name: 'Design Solutions for Organizational Complexity', weight: 26 },
      { name: 'Design for New Solutions', weight: 29 },
      { name: 'Continuous Improvement for Existing Solutions', weight: 25 },
      { name: 'Accelerate Workload Migration and Modernization', weight: 20 },
    ],

    sandboxConfig: {
      ttlHours: 8,
      budgetInr: 800,
      region: 'ap-south-1',
    },

    // In-scope services from the SAP-C02 exam guide
    allowedServices: [
      // Analytics
      { service: 'athena', category: 'Analytics' },
      { service: 'data-exchange', category: 'Analytics' },
      { service: 'data-firehose', category: 'Analytics' },
      { service: 'emr', category: 'Analytics', restrictions: 'm5.xlarge max, 3 nodes' },
      { service: 'glue', category: 'Analytics' },
      { service: 'kinesis', category: 'Analytics' },
      { service: 'lakeformation', category: 'Analytics' },
      { service: 'managed-flink', category: 'Analytics' },
      { service: 'msk', category: 'Analytics', restrictions: 'kafka.t3.small only' },
      { service: 'opensearch', category: 'Analytics', restrictions: 't3.small.search only' },
      { service: 'quicksight', category: 'Analytics' },
      // Application Integration
      { service: 'appflow', category: 'Application Integration' },
      { service: 'appsync', category: 'Application Integration' },
      { service: 'eventbridge', category: 'Application Integration' },
      { service: 'mq', category: 'Application Integration', restrictions: 'mq.t3.micro only' },
      { service: 'sns', category: 'Application Integration' },
      { service: 'sqs', category: 'Application Integration' },
      { service: 'stepfunctions', category: 'Application Integration' },
      // Blockchain
      { service: 'managedblockchain', category: 'Blockchain' },
      // Business Applications
      { service: 'ses', category: 'Business Applications' },
      // Cost Management
      { service: 'budgets', category: 'Cloud Financial Management' },
      { service: 'costexplorer', category: 'Cloud Financial Management' },
      { service: 'costandusagereport', category: 'Cloud Financial Management' },
      // Compute
      { service: 'apprunner', category: 'Compute' },
      { service: 'autoscaling', category: 'Compute' },
      { service: 'batch', category: 'Compute' },
      { service: 'elasticbeanstalk', category: 'Compute' },
      { service: 'ec2', category: 'Compute', restrictions: 't2/t3 only' },
      { service: 'fargate', category: 'Compute' },
      { service: 'lambda', category: 'Compute' },
      { service: 'lightsail', category: 'Compute' },
      { service: 'outposts', category: 'Compute' },
      { service: 'wavelength', category: 'Compute' },
      // Containers
      { service: 'ecr', category: 'Containers' },
      { service: 'ecs', category: 'Containers' },
      { service: 'eks', category: 'Containers', restrictions: 'Managed node group, t3.small' },
      // Database
      { service: 'aurora', category: 'Database', restrictions: 'db.t3.small only' },
      { service: 'documentdb', category: 'Database' },
      { service: 'dynamodb', category: 'Database' },
      { service: 'elasticache', category: 'Database', restrictions: 'cache.t3.micro only' },
      { service: 'keyspaces', category: 'Database' },
      { service: 'neptune', category: 'Database' },
      { service: 'rds', category: 'Database', restrictions: 'db.t3.micro/small only' },
      { service: 'redshift', category: 'Database', restrictions: 'dc2.large single node only' },
      { service: 'timestream', category: 'Database' },
      // Developer Tools
      { service: 'codeartifact', category: 'Developer Tools' },
      { service: 'codebuild', category: 'Developer Tools' },
      { service: 'codedeploy', category: 'Developer Tools' },
      { service: 'codepipeline', category: 'Developer Tools' },
      { service: 'xray', category: 'Developer Tools' },
      // End User Computing
      { service: 'appstream', category: 'End User Computing' },
      { service: 'workspaces', category: 'End User Computing' },
      // Frontend
      { service: 'amplify', category: 'Frontend Web and Mobile' },
      { service: 'apigateway', category: 'Frontend Web and Mobile' },
      // IoT
      { service: 'iot', category: 'IoT' },
      // Machine Learning
      { service: 'comprehend', category: 'Machine Learning' },
      { service: 'kendra', category: 'Machine Learning' },
      { service: 'lex', category: 'Machine Learning' },
      { service: 'polly', category: 'Machine Learning' },
      { service: 'rekognition', category: 'Machine Learning' },
      { service: 'textract', category: 'Machine Learning' },
      { service: 'transcribe', category: 'Machine Learning' },
      { service: 'translate', category: 'Machine Learning' },
      // Management and Governance
      { service: 'cloudformation', category: 'Management and Governance' },
      { service: 'cloudtrail', category: 'Management and Governance' },
      { service: 'cloudwatch', category: 'Management and Governance' },
      { service: 'computeoptimizer', category: 'Management and Governance' },
      { service: 'config', category: 'Management and Governance' },
      { service: 'controltower', category: 'Management and Governance' },
      { service: 'licensemanager', category: 'Management and Governance' },
      { service: 'organizations', category: 'Management and Governance' },
      { service: 'proton', category: 'Management and Governance' },
      { service: 'servicecatalog', category: 'Management and Governance' },
      { service: 'systemsmanager', category: 'Management and Governance' },
      { service: 'trustedadvisor', category: 'Management and Governance' },
      { service: 'wellarchitected', category: 'Management and Governance' },
      // Migration
      { service: 'applicationdiscovery', category: 'Migration and Transfer' },
      { service: 'applicationmigration', category: 'Migration and Transfer' },
      { service: 'datasync', category: 'Migration and Transfer' },
      { service: 'dms', category: 'Migration and Transfer' },
      { service: 'migrationhub', category: 'Migration and Transfer' },
      { service: 'sct', category: 'Migration and Transfer' },
      { service: 'snowfamily', category: 'Migration and Transfer' },
      { service: 'transferfamily', category: 'Migration and Transfer' },
      // Networking
      { service: 'cloudfront', category: 'Networking' },
      { service: 'directconnect', category: 'Networking' },
      { service: 'elb', category: 'Networking' },
      { service: 'globalaccelerator', category: 'Networking' },
      { service: 'privatelink', category: 'Networking' },
      { service: 'route53', category: 'Networking' },
      { service: 'transitgateway', category: 'Networking' },
      { service: 'vpc', category: 'Networking' },
      { service: 'vpn', category: 'Networking' },
      // Security
      { service: 'acm', category: 'Security' },
      { service: 'artifact', category: 'Security' },
      { service: 'auditmanager', category: 'Security' },
      { service: 'cloudhsm', category: 'Security' },
      { service: 'cognito', category: 'Security' },
      { service: 'detective', category: 'Security' },
      { service: 'directory', category: 'Security' },
      { service: 'firewallmanager', category: 'Security' },
      { service: 'guardduty', category: 'Security' },
      { service: 'iam', category: 'Security' },
      { service: 'inspector', category: 'Security' },
      { service: 'kms', category: 'Security' },
      { service: 'macie', category: 'Security' },
      { service: 'networkfirewall', category: 'Security' },
      { service: 'ram', category: 'Security' },
      { service: 'secretsmanager', category: 'Security' },
      { service: 'securityhub', category: 'Security' },
      { service: 'shield', category: 'Security' },
      { service: 'sts', category: 'Security' },
      { service: 'waf', category: 'Security' },
      // Storage
      { service: 'backup', category: 'Storage' },
      { service: 'ebs', category: 'Storage', restrictions: 'gp2/gp3, max 100GB' },
      { service: 'elasticdisasterrecovery', category: 'Storage' },
      { service: 'efs', category: 'Storage' },
      { service: 'fsx', category: 'Storage' },
      { service: 's3', category: 'Storage' },
      { service: 's3glacier', category: 'Storage' },
      { service: 'storagegateway', category: 'Storage' },
    ],

    blockedServices: [
      { service: 'gamelift', reason: 'Out of scope (Game Tech)' },
      { service: 'sagemaker', reason: 'Expensive — use Comprehend/Rekognition' },
      { service: 'braket', reason: 'Out of scope (Quantum)' },
      { service: 'groundstation', reason: 'Out of scope (Satellite)' },
      { service: 'deepracer', reason: 'Out of scope (ML advanced)' },
      { service: 'robomaker', reason: 'Out of scope (Robotics)' },
    ],

    allowedInstanceTypes: {
      aws: ['t2.micro', 't2.small', 't2.medium', 't2.large', 't3.micro', 't3.small', 't3.medium', 't3.large'],
    },

    labs: [
      // Domain 1: Organizational Complexity (26%)
      {
        title: 'AWS Organizations with SCPs',
        domain: 'Design Solutions for Organizational Complexity',
        domainWeight: 26,
        duration: 45,
        difficulty: 'advanced',
        description: 'Design a multi-account landing zone with Organizations, OUs, and Service Control Policies.',
        steps: [
          { order: 1, title: 'Create Organization', description: 'AWS Organizations > Create organization. Enable all features (not just consolidated billing).', service: 'organizations' },
          { order: 2, title: 'Create OUs', description: 'Create OU structure: Security, Workloads (Prod, NonProd), Sandbox. This reflects a standard landing zone.', service: 'organizations' },
          { order: 3, title: 'Attach Deny SCP', description: 'Create an SCP that denies disabling CloudTrail and denies non-approved regions. Attach to the root OU.', service: 'organizations', hint: 'SCPs never grant permissions — they only set the maximum boundary' },
          { order: 4, title: 'Test SCP Effect', description: 'From a member account, try to stop a CloudTrail trail — observe the deny even with admin permissions.', service: 'cloudtrail' },
        ],
      },
      {
        title: 'Transit Gateway Multi-VPC Hub',
        domain: 'Design Solutions for Organizational Complexity',
        domainWeight: 26,
        duration: 50,
        difficulty: 'advanced',
        description: 'Connect 3 VPCs and a simulated on-prem network using AWS Transit Gateway.',
        steps: [
          { order: 1, title: 'Create 3 VPCs', description: 'Non-overlapping CIDRs: 10.1.0.0/16, 10.2.0.0/16, 10.3.0.0/16. One subnet each.', service: 'vpc' },
          { order: 2, title: 'Create Transit Gateway', description: 'Create a TGW. Attach all 3 VPCs via TGW attachments.', service: 'transitgateway' },
          { order: 3, title: 'Configure Routing', description: 'Add TGW routes in each VPC route table for the other VPCs pointing to the TGW attachment.', service: 'transitgateway' },
          { order: 4, title: 'Verify Connectivity', description: 'Launch a t3.micro in each VPC. Ping across — all 3 should reach each other through the TGW hub.', service: 'ec2' },
          { order: 5, title: 'Segmentation via Route Tables', description: 'Create separate TGW route tables to isolate Prod from Dev traffic while sharing a common shared-services VPC.', service: 'transitgateway' },
        ],
      },

      // Domain 2: New Solutions (29%)
      {
        title: 'Multi-Region Active-Active with Route 53',
        domain: 'Design for New Solutions',
        domainWeight: 29,
        duration: 60,
        difficulty: 'advanced',
        description: 'Design an active-active multi-region application using DynamoDB Global Tables and Route 53 latency routing.',
        steps: [
          { order: 1, title: 'Deploy ALB+ASG in Region 1', description: 'In ap-south-1: launch a simple web app behind an ALB with an ASG.', service: 'elb' },
          { order: 2, title: 'Replicate to Region 2', description: 'Repeat in us-east-1. Use the same CloudFormation stack for consistency.', service: 'cloudformation' },
          { order: 3, title: 'DynamoDB Global Table', description: 'Create a DynamoDB table and add us-east-1 as a replica — writes in one region replicate to the other.', service: 'dynamodb', hint: 'Last-writer-wins conflict resolution' },
          { order: 4, title: 'Route 53 Latency Routing', description: 'Create latency-based records pointing to each ALB. Users get routed to the lowest-latency region automatically.', service: 'route53' },
          { order: 5, title: 'Add Health Checks', description: 'Attach Route 53 health checks so a failed region is automatically removed from rotation.', service: 'route53' },
        ],
      },
      {
        title: 'Serverless Image Processing Pipeline',
        domain: 'Design for New Solutions',
        domainWeight: 29,
        duration: 45,
        difficulty: 'intermediate',
        description: 'Build a fully serverless image-processing pipeline using S3, Lambda, Step Functions, and Rekognition.',
        steps: [
          { order: 1, title: 'Create S3 Upload Bucket', description: 'Bucket for source images. Event notification on ObjectCreated.', service: 's3' },
          { order: 2, title: 'Create Step Functions', description: 'State machine: Rekognition DetectLabels → Lambda resize → S3 put → DynamoDB write metadata.', service: 'stepfunctions' },
          { order: 3, title: 'Wire S3 → Lambda → SFN', description: 'S3 event triggers a small Lambda that starts the Step Functions execution.', service: 'lambda' },
          { order: 4, title: 'Test with Image', description: 'Upload a photo. Watch the SFN visual execution, verify labels in DynamoDB.', service: 'stepfunctions' },
        ],
      },

      // Domain 3: Continuous Improvement (25%)
      {
        title: 'CloudWatch + Config for Drift Detection',
        domain: 'Continuous Improvement for Existing Solutions',
        domainWeight: 25,
        duration: 35,
        difficulty: 'intermediate',
        description: 'Use AWS Config rules and CloudWatch Events to detect and auto-remediate non-compliant resources.',
        steps: [
          { order: 1, title: 'Enable AWS Config', description: 'Enable AWS Config to record all resource types in the region.', service: 'config' },
          { order: 2, title: 'Add Managed Rule', description: 'Add the managed rule "s3-bucket-public-read-prohibited".', service: 'config' },
          { order: 3, title: 'Create Public Bucket', description: 'Intentionally make an S3 bucket public. Watch Config flag it as NON_COMPLIANT within minutes.', service: 's3' },
          { order: 4, title: 'Auto-Remediation', description: 'Add an SSM document remediation action to auto-revoke public access.', service: 'systemsmanager' },
        ],
      },
      {
        title: 'Graviton Migration for Cost and Perf',
        domain: 'Continuous Improvement for Existing Solutions',
        domainWeight: 25,
        duration: 30,
        difficulty: 'intermediate',
        description: 'Right-size and modernize an EC2 workload from Intel to Graviton (ARM) using Compute Optimizer.',
        steps: [
          { order: 1, title: 'Enable Compute Optimizer', description: 'Enable Compute Optimizer org-wide. Wait for the initial 14 days of metrics (simulate by reading docs).', service: 'computeoptimizer' },
          { order: 2, title: 'Review Recommendations', description: 'Compute Optimizer surfaces right-sizing and Graviton migration recommendations with cost impact.', service: 'computeoptimizer' },
          { order: 3, title: 'Launch Graviton Instance', description: 'Launch a t4g.micro (ARM) with Amazon Linux 2023 ARM AMI. Note ~20% price/perf improvement.', service: 'ec2' },
          { order: 4, title: 'Test the App', description: 'Rebuild the app for arm64 (multi-arch container) and deploy. Verify functionality.', service: 'ec2' },
        ],
      },

      // Domain 4: Migration and Modernization (20%)
      {
        title: 'Database Migration with DMS',
        domain: 'Accelerate Workload Migration and Modernization',
        domainWeight: 20,
        duration: 60,
        difficulty: 'advanced',
        description: 'Migrate a MySQL database to Aurora PostgreSQL using AWS SCT and DMS with minimal downtime.',
        steps: [
          { order: 1, title: 'Source RDS MySQL', description: 'Create a db.t3.micro MySQL with sample data (mysqlsampledatabase).', service: 'rds' },
          { order: 2, title: 'Target Aurora PostgreSQL', description: 'Create a db.t3.small Aurora PostgreSQL cluster.', service: 'aurora' },
          { order: 3, title: 'Schema Conversion with SCT', description: 'Use AWS SCT to assess and convert the MySQL schema to PostgreSQL. Review conversion warnings.', service: 'sct' },
          { order: 4, title: 'DMS Replication Instance', description: 'Create a dms.t3.small replication instance. Create source/target endpoints.', service: 'dms' },
          { order: 5, title: 'Full Load + CDC Task', description: 'Create a migration task: Full load + ongoing replication. Verify zero-downtime cutover.', service: 'dms', hint: 'CDC (Change Data Capture) lets you keep source live during migration' },
        ],
      },
      {
        title: '7 Rs Migration Assessment',
        domain: 'Accelerate Workload Migration and Modernization',
        domainWeight: 20,
        duration: 40,
        difficulty: 'intermediate',
        description: 'Use AWS Migration Hub and Application Discovery Service to plan a portfolio migration using the 7 Rs.',
        steps: [
          { order: 1, title: 'Migration Hub Setup', description: 'Enable Migration Hub in the home region. Review the wave planning UI.', service: 'migrationhub' },
          { order: 2, title: 'Categorize Apps', description: 'For 5 sample apps, assign each to one of the 7 Rs: Rehost, Replatform, Repurchase, Refactor, Retire, Retain, Relocate.', service: 'migrationhub' },
          { order: 3, title: 'Calculate TCO', description: 'Use AWS Pricing Calculator to estimate 3-year TCO for an on-prem vs AWS scenario.', service: 'costexplorer' },
          { order: 4, title: 'Select Tools', description: 'Map each R to tools: Rehost → Application Migration Service, Replatform → Elastic Beanstalk, Refactor → containerize/Lambda.', service: 'applicationmigration' },
        ],
      },
    ],
  };

  // Auto-generate IAM policies
  clfTemplate.iamPolicy = generateAwsIamPolicy(clfTemplate);
  saaTemplate.iamPolicy = generateAwsIamPolicy(saaTemplate);
  sapTemplate.iamPolicy = generateAwsIamPolicy(sapTemplate);

  const allTemplates = [clfTemplate, saaTemplate, sapTemplate];
  for (const t of allTemplates) {
    await SandboxTemplate.create(t);
    console.log(`Seeded: ${t.name}`);
    console.log(`  Allowed services: ${t.allowedServices.length}`);
    console.log(`  Blocked services: ${t.blockedServices.length}`);
    console.log(`  Guided labs: ${t.labs.length}`);
    console.log(`  IAM policy statements: ${t.iamPolicy.Statement.length}`);
  }

  console.log('\nTotal templates:', await SandboxTemplate.countDocuments());
  process.exit(0);
})();
