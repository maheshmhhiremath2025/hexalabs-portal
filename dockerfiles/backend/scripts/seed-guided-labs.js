require('dotenv').config();
const mongoose = require('mongoose');
const GuidedLab = require('../models/guidedLab');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  await GuidedLab.deleteMany({});
  await GuidedLab.insertMany([
    {
      title: 'Deploy Your First Azure VM', slug: 'azure-first-vm', cloud: 'azure', difficulty: 'beginner', duration: 30,
      description: 'Learn how to create a virtual machine in Azure from scratch.',
      category: 'Compute', tags: ['vm', 'linux', 'beginner'], icon: '🖥️', requiresSandbox: true, minTier: 'free',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Open Azure Portal', description: 'Navigate to the Azure Portal using the link provided. Sign in with your sandbox credentials.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to Virtual Machines', description: 'In the search bar, type Virtual Machines and click on the service. Click + Create > Azure Virtual Machine.', verifyType: 'manual' },
        { order: 3, title: 'Configure Basic Settings', description: 'Select your sandbox resource group. Choose Standard_B1s as the VM size. Select Ubuntu Server 22.04 LTS as the image.', hint: 'Only B-series VMs are allowed in sandbox', verifyType: 'manual' },
        { order: 4, title: 'Configure Networking', description: 'Leave default networking settings. Ensure SSH (22) is allowed in inbound ports.', verifyType: 'manual' },
        { order: 5, title: 'Review and Create', description: 'Click Review + Create. Verify settings and click Create. Wait for deployment (1-2 minutes).', verifyType: 'manual' },
        { order: 6, title: 'Connect to Your VM', description: 'Go to the VM resource. Copy the Public IP. Open terminal and SSH in. Congratulations!', verifyType: 'manual' },
      ],
    },
    {
      title: 'Create an S3 Bucket in AWS', slug: 'aws-s3-bucket', cloud: 'aws', difficulty: 'beginner', duration: 20,
      description: 'Learn how to create an S3 bucket, upload files, and configure permissions in AWS.',
      category: 'Storage', tags: ['s3', 'storage', 'beginner'], icon: '🪣', requiresSandbox: true, minTier: 'free',
      sandboxConfig: { ttlHours: 1, budgetInr: 100 },
      steps: [
        { order: 1, title: 'Open AWS Console', description: 'Navigate to the AWS Console. Sign in with your sandbox IAM credentials.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to S3', description: 'Search for S3 in the search bar and click on the service.', verifyType: 'manual' },
        { order: 3, title: 'Create a Bucket', description: 'Click Create Bucket. Enter a unique bucket name. Select ap-south-1 region. Click Create bucket.', verifyType: 'manual' },
        { order: 4, title: 'Upload a File', description: 'Click on your bucket. Click Upload > Add files. Select any file and upload it.', verifyType: 'manual' },
        { order: 5, title: 'Explore Properties', description: 'Click on your file. Explore Properties and Permissions tabs. Try generating a presigned URL.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Launch a GCP Compute Instance', slug: 'gcp-compute-instance', cloud: 'gcp', difficulty: 'beginner', duration: 25,
      description: 'Create your first virtual machine on Google Cloud Platform.',
      category: 'Compute', tags: ['vm', 'compute', 'beginner'], icon: '☁️', requiresSandbox: true, minTier: 'starter',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Open GCP Console', description: 'Navigate to the GCP Console. Select your sandbox project.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to Compute Engine', description: 'Go to Compute Engine > VM Instances. Click Create Instance.', verifyType: 'manual' },
        { order: 3, title: 'Configure the Instance', description: 'Name: my-first-vm. Region: asia-south1. Machine type: e2-micro. Boot disk: Debian 11. Click Create.', hint: 'Only e2/f1/g1 types allowed', verifyType: 'manual' },
        { order: 4, title: 'Connect via SSH', description: 'Click the SSH button to open terminal in browser. Run hostname to verify.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Linux Desktop in Browser', slug: 'container-linux-desktop', cloud: 'container', difficulty: 'beginner', duration: 5,
      description: 'Deploy a full Ubuntu desktop accessible from your browser in seconds.',
      category: 'Containers', tags: ['docker', 'ubuntu', 'beginner'], icon: '🐧', requiresSandbox: false, minTier: 'free',
      containerImage: 'ubuntu-xfce',
      steps: [
        { order: 1, title: 'Deploy Container', description: 'Go to the Containers tab and click Deploy with Ubuntu XFCE selected.', verifyType: 'manual' },
        { order: 2, title: 'Open Desktop', description: 'Click Open to launch the desktop in a new tab.', verifyType: 'manual' },
        { order: 3, title: 'Explore', description: 'Open terminal. Run uname -a. Try installing software with sudo apt install htop.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Kali Linux Security Lab', slug: 'kali-pentest-lab', cloud: 'container', difficulty: 'intermediate', duration: 45,
      description: 'Set up Kali Linux and explore penetration testing tools.',
      category: 'Security', tags: ['kali', 'security', 'intermediate'], icon: '🔒', requiresSandbox: false, minTier: 'starter',
      containerImage: 'kali-desktop',
      steps: [
        { order: 1, title: 'Deploy Kali Desktop', description: 'Deploy a Kali Linux Desktop container.', verifyType: 'manual' },
        { order: 2, title: 'Open Terminal', description: 'Open the Kali desktop and launch terminal.', verifyType: 'manual' },
        { order: 3, title: 'Explore Nmap', description: 'Run nmap --version. Try scanning localhost: nmap -sV localhost', verifyType: 'manual' },
        { order: 4, title: 'Explore Metasploit', description: 'Launch msfconsole. Run help to see commands. Type exit to quit.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Azure Networking: VNet and Subnets', slug: 'azure-networking', cloud: 'azure', difficulty: 'intermediate', duration: 40,
      description: 'Create a virtual network with subnets and configure NSGs.',
      category: 'Networking', tags: ['vnet', 'networking', 'intermediate'], icon: '🌐', requiresSandbox: true, minTier: 'starter',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Create a Virtual Network', description: 'Go to Virtual Networks > Create. Name: lab-vnet. Address: 10.0.0.0/16. Add web-subnet and db-subnet.', verifyType: 'manual' },
        { order: 2, title: 'Create NSG', description: 'Create web-nsg. Add rules: Allow HTTP(80), HTTPS(443), SSH(22). Deny all other.', verifyType: 'manual' },
        { order: 3, title: 'Associate NSG', description: 'Associate web-nsg with the web-subnet.', verifyType: 'manual' },
        { order: 4, title: 'Deploy VMs', description: 'Create a B1s VM in each subnet. Verify connectivity follows NSG rules.', verifyType: 'manual' },
      ],
    },
    {
      title: 'VS Code in the Cloud', slug: 'vscode-cloud', cloud: 'container', difficulty: 'beginner', duration: 10,
      description: 'Run Visual Studio Code in your browser with full extension support.',
      category: 'Development', tags: ['vscode', 'dev', 'beginner'], icon: '💻', requiresSandbox: false, minTier: 'free',
      containerImage: 'vscode-kasm',
      steps: [
        { order: 1, title: 'Deploy VS Code', description: 'Deploy a VS Code (Desktop in Browser) container.', verifyType: 'manual' },
        { order: 2, title: 'Open Editor', description: 'Click Open. VS Code opens in your browser with full functionality.', verifyType: 'manual' },
        { order: 3, title: 'Create a Project', description: 'Open terminal (Ctrl+`). Create a folder: mkdir myproject && cd myproject. Create a file: code index.html', verifyType: 'manual' },
        { order: 4, title: 'Install Extensions', description: 'Click the Extensions icon. Search and install Python or any extension.', verifyType: 'manual' },
      ],
    },
    {
      title: 'AWS IAM: Users and Policies', slug: 'aws-iam', cloud: 'aws', difficulty: 'intermediate', duration: 35,
      description: 'Learn how IAM works — create users, groups, and attach policies.',
      category: 'Security', tags: ['iam', 'security', 'intermediate'], icon: '🔐', requiresSandbox: true, minTier: 'starter',
      sandboxConfig: { ttlHours: 2, budgetInr: 100 },
      steps: [
        { order: 1, title: 'Navigate to IAM', description: 'Go to IAM service in AWS Console.', verifyType: 'manual' },
        { order: 2, title: 'Create a User', description: 'Create a new IAM user with programmatic access.', verifyType: 'manual' },
        { order: 3, title: 'Create a Group', description: 'Create a group called developers. Attach AmazonS3ReadOnlyAccess policy.', verifyType: 'manual' },
        { order: 4, title: 'Add User to Group', description: 'Add your new user to the developers group.', verifyType: 'manual' },
        { order: 5, title: 'Test Permissions', description: 'Sign in as the new user. Verify they can read S3 but not write.', verifyType: 'manual' },
      ],
    },
  ]);
  console.log('Guided labs seeded:', await GuidedLab.countDocuments());
  process.exit(0);
})();
