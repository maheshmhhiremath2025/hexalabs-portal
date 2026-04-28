#!/usr/bin/env node
const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/synergific';

mongoose.connect(uri).then(async () => {
  const GuidedLab = require('../models/guidedLab');

  // Check if already exists
  const existing = await GuidedLab.findOne({ slug: 'windows-ad-setup' });
  if (existing) {
    console.log('Lab already exists:', existing.title, '- ID:', existing._id);
    process.exit(0);
  }

  const lab = await GuidedLab.create({
    title: 'Windows Server 2022 — Active Directory Setup',
    slug: 'windows-ad-setup',
    description: 'Set up Active Directory Domain Services on Windows Server 2022. Learn how to promote a server to a Domain Controller, create OUs, users, and group policies.',
    cloud: 'azure',
    difficulty: 'intermediate',
    duration: 60,
    category: 'Compute',
    tags: ['windows', 'active-directory', 'server', 'azure'],
    icon: '\uD83E\uDE9F',
    requiresSandbox: false,
    vmTemplateName: 'wi8ntest',
    createdBy: 'superadmin@getlabs.cloud',
    assignedOrgs: [],
    steps: [
      {
        order: 1,
        title: 'Connect to the Windows Server',
        description: [
          'Open the Remote Desktop connection from the Lab Console. Log in using the credentials provided.',
          '',
          '```',
          'Username: azureuser',
          'Password: (shown in Lab Console)',
          '```',
          '',
          'Once logged in, you should see the Server Manager dashboard.',
        ].join('\n'),
        hint: 'If RDP is slow, wait 2-3 minutes after VM creation for all services to start.',
        verifyType: 'manual',
        troubleshooting: [
          { issue: 'RDP connection refused', solution: 'Wait 2 minutes after VM creation. The RDP service takes time to start.' },
          { issue: 'Invalid credentials', solution: 'Use the exact password shown in the Lab Console, not the one from email.' },
        ],
      },
      {
        order: 2,
        title: 'Install Active Directory Domain Services',
        description: [
          'Open **Server Manager** → Click **Add roles and features**.',
          '',
          '1. Click **Next** through the wizard until you reach **Server Roles**',
          '2. Check **Active Directory Domain Services**',
          '3. Click **Add Features** in the popup',
          '4. Click **Next** through remaining steps and then **Install**',
          '',
          'Wait for the installation to complete (2-3 minutes).',
        ].join('\n'),
        hint: [
          'You can also install AD DS via PowerShell:',
          '',
          '```powershell',
          'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools',
          '```',
        ].join('\n'),
        verifyType: 'manual',
        troubleshooting: [
          { issue: 'Role installation fails', solution: 'Ensure the VM has at least 2 GB RAM. Check Windows Update is not running in the background.' },
        ],
      },
      {
        order: 3,
        title: 'Promote to Domain Controller',
        description: [
          'After installation completes, click the **notification flag** (yellow warning) in Server Manager → **Promote this server to a domain controller**.',
          '',
          'Select **Add a new forest** and enter:',
          '',
          '```',
          'Root domain name: lab.local',
          '```',
          '',
          'Set a **DSRM password** (e.g., `P@ssw0rd123!`), click **Next** through all steps, then **Install**.',
          '',
          '> The server will **reboot automatically** after promotion. Wait 3-5 minutes and reconnect via RDP.',
        ].join('\n'),
        hint: [
          'PowerShell alternative:',
          '',
          '```powershell',
          'Install-ADDSForest -DomainName "lab.local" -SafeModeAdministratorPassword (ConvertTo-SecureString "P@ssw0rd123!" -AsPlainText -Force) -Force',
          '```',
        ].join('\n'),
        verifyType: 'manual',
        troubleshooting: [
          { issue: 'Promotion fails with DNS error', solution: 'Ensure the server has a static IP. Go to Network Settings and set the DNS to 127.0.0.1.' },
          { issue: 'Cannot reconnect after reboot', solution: 'Wait 5 minutes. Login with LAB\\Administrator instead of azureuser.' },
        ],
      },
      {
        order: 4,
        title: 'Create Organizational Units',
        description: [
          'After reconnecting, open **Active Directory Users and Computers** (from Server Manager → Tools menu).',
          '',
          'Right-click **lab.local** → **New** → **Organizational Unit**:',
          '',
          '1. Create OU: `Departments`',
          '2. Inside Departments, create: `IT`, `HR`, `Finance`',
          '',
          'Your tree should look like:',
          '```',
          'lab.local',
          '└── Departments',
          '    ├── IT',
          '    ├── HR',
          '    └── Finance',
          '```',
        ].join('\n'),
        hint: [
          'PowerShell:',
          '',
          '```powershell',
          'New-ADOrganizationalUnit -Name "Departments" -Path "DC=lab,DC=local"',
          'New-ADOrganizationalUnit -Name "IT" -Path "OU=Departments,DC=lab,DC=local"',
          'New-ADOrganizationalUnit -Name "HR" -Path "OU=Departments,DC=lab,DC=local"',
          'New-ADOrganizationalUnit -Name "Finance" -Path "OU=Departments,DC=lab,DC=local"',
          '```',
        ].join('\n'),
        verifyType: 'manual',
        troubleshooting: [],
      },
      {
        order: 5,
        title: 'Create Domain Users',
        description: [
          'In **Active Directory Users and Computers**, right-click the **IT** OU → **New** → **User**.',
          '',
          'Create these users:',
          '',
          '| Name | Username | OU | Password |',
          '|------|----------|----|----------|',
          '| John Smith | jsmith | IT | `Welcome1!` |',
          '| Jane Doe | jdoe | HR | `Welcome1!` |',
          '| Bob Wilson | bwilson | Finance | `Welcome1!` |',
          '',
          'Uncheck "User must change password at next logon" for lab purposes.',
        ].join('\n'),
        hint: [
          'PowerShell:',
          '',
          '```powershell',
          '$pw = ConvertTo-SecureString "Welcome1!" -AsPlainText -Force',
          'New-ADUser -Name "John Smith" -SamAccountName jsmith -Path "OU=IT,OU=Departments,DC=lab,DC=local" -AccountPassword $pw -Enabled $true',
          'New-ADUser -Name "Jane Doe" -SamAccountName jdoe -Path "OU=HR,OU=Departments,DC=lab,DC=local" -AccountPassword $pw -Enabled $true',
          'New-ADUser -Name "Bob Wilson" -SamAccountName bwilson -Path "OU=Finance,OU=Departments,DC=lab,DC=local" -AccountPassword $pw -Enabled $true',
          '```',
        ].join('\n'),
        verifyType: 'manual',
        troubleshooting: [
          { issue: 'Password does not meet complexity', solution: 'Use a password with uppercase, lowercase, number, and special char. E.g., Welcome1!' },
        ],
      },
      {
        order: 6,
        title: 'Create and Link a Group Policy',
        description: [
          'Open **Group Policy Management** (Server Manager → Tools).',
          '',
          '1. Right-click the **IT** OU → **Create a GPO in this domain, and Link it here**',
          '2. Name it: `IT Desktop Policy`',
          '3. Right-click the new GPO → **Edit**',
          '4. Navigate to: **User Configuration** → **Administrative Templates** → **Desktop**',
          '5. Double-click **Hide and disable all items on the desktop** → Set to **Enabled** → **OK**',
          '',
          'This policy will hide all desktop icons for users in the IT OU (just for demonstration).',
        ].join('\n'),
        hint: 'To test: log in as jsmith via RDP and verify the desktop is empty. Run `gpupdate /force` if the policy does not apply immediately.',
        verifyType: 'manual',
        troubleshooting: [
          { issue: 'GPO not applying', solution: 'Run gpupdate /force on the target machine. Wait 1-2 minutes. Check gpresult /r for applied policies.' },
        ],
      },
    ],
    labTroubleshooting: [
      { issue: 'Server Manager not opening', solution: 'Wait for all startup services. Try running ServerManager.exe from the Start menu.', category: 'Software' },
      { issue: 'PowerShell commands fail with access denied', solution: 'Run PowerShell as Administrator. Right-click > Run as administrator.', category: 'Permissions' },
      { issue: 'VM is very slow', solution: 'AD DS is resource-intensive. Give it 5 minutes after reboot. Close unnecessary windows.', category: 'Environment' },
    ],
  });

  console.log('Created:', lab.title);
  console.log('ID:', lab._id);
  console.log('Cloud:', lab.cloud);
  console.log('Template:', lab.vmTemplateName);
  console.log('Steps:', lab.steps.length);
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
