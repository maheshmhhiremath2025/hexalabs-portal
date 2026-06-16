const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const axios = require('axios');
const VM = require('../models/vm');
const Training = require('../models/training');
const User = require('../models/user');
const { logger } = require('../plugins/logger');
const { getVmPriceInr } = require('./azurePricing');
const { ensureUser, grantRead } = require('./guacamoleService');

// Minimal Guac helpers — we can't use the main createVmConnection path here
// because it assumes Azure-VM-shaped inputs (per-VM disk, single protocol).
// RDS needs N RDP connections against one host, each with different creds.
const GUAC_API_URL = process.env.GUACAMOLE_URL || 'http://localhost:8085/guacamole';
const GUAC_ADMIN_USER = process.env.GUACAMOLE_ADMIN_USER || 'guacadmin';
const GUAC_ADMIN_PASS = process.env.GUACAMOLE_ADMIN_PASS || 'guacadmin';

async function getGuacAdminToken() {
  const r = await axios.post(`${GUAC_API_URL}/api/tokens`,
    `username=${encodeURIComponent(GUAC_ADMIN_USER)}&password=${encodeURIComponent(GUAC_ADMIN_PASS)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return r.data.authToken;
}

function rdpConnParams(ip, username, password) {
  return {
    hostname: ip, port: '3389', username, password, security: 'nla', 'ignore-cert': 'true',
    'color-depth': '16', 'resize-method': 'display-update',
    'enable-wallpaper': 'false', 'enable-theming': 'false', 'enable-font-smoothing': 'false',
    'enable-full-window-drag': 'false', 'enable-desktop-composition': 'false', 'enable-menu-animations': 'false',
    'disable-bitmap-caching': 'false', 'disable-offscreen-caching': 'false', 'disable-glyph-caching': 'false',
    'enable-drive': 'false', 'enable-printing': 'false', 'enable-audio': 'false',
    'timezone': 'Asia/Kolkata',
  };
}

async function upsertRdpConn(admTok, name, params) {
  const list = (await axios.get(`${GUAC_API_URL}/api/session/data/mysql/connections?token=${admTok}`)).data;
  const existing = Object.entries(list).find(([, c]) => c.name === name)?.[0];
  const body = {
    parentIdentifier: 'ROOT', name, protocol: 'rdp', parameters: params,
    attributes: { 'max-connections': '3', 'max-connections-per-user': '2' },
  };
  if (existing) {
    await axios.put(`${GUAC_API_URL}/api/session/data/mysql/connections/${existing}?token=${admTok}`, { ...body, identifier: existing });
    return existing;
  }
  const r = await axios.post(`${GUAC_API_URL}/api/session/data/mysql/connections?token=${admTok}`, body);
  return r.data.identifier;
}

const credential = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const subscriptionId = process.env.SUBSCRIPTION_ID;
const computeClient = new ComputeManagementClient(credential, subscriptionId);
const networkClient = new NetworkManagementClient(credential, subscriptionId);

// RDS VM sizes — Windows Spot pricing from Azure Retail API (South India, Apr 2026)
const RDS_VM_SIZES = {
  'small':  { vmSize: 'Standard_D4s_v3',  maxUsers: 8,  cost: 7.4,   onDemandCost: 40,  label: '4 vCPU / 16 GB (up to 8 users) — Spot ₹7.4/hr' },
  'medium': { vmSize: 'Standard_D8s_v3',  maxUsers: 15, cost: 14.9,  onDemandCost: 80,  label: '8 vCPU / 32 GB (up to 15 users) — Spot ₹14.9/hr' },
  'large':  { vmSize: 'Standard_D16s_v3', maxUsers: 30, cost: 29.7,  onDemandCost: 161, label: '16 vCPU / 64 GB (up to 30 users) — Spot ₹29.7/hr' },
};

/**
 * PowerShell script that runs on the Windows Server VM to:
 * 1. Enable Remote Desktop Services
 * 2. Create local user accounts
 * 3. Add them to Remote Desktop Users group
 *
 * Each user gets their own RDP session — fully isolated desktop.
 */
function buildUserSetupScript(users, adminPassword) {
  // users = [{ username: 'user1', password: 'Pass1234!' }, ...]
  const userCommands = users.map(u => `
    New-LocalUser -Name '${u.username}' -Password (ConvertTo-SecureString '${u.password}' -AsPlainText -Force) -FullName '${u.username}' -Description 'Lab user' -ErrorAction SilentlyContinue
    Add-LocalGroupMember -Group 'Remote Desktop Users' -Member '${u.username}' -ErrorAction SilentlyContinue
  `).join('\n');

  return `
    # 1. Install Remote Desktop Session Host role (enables multi-user)
    Install-WindowsFeature -Name RDS-RD-Server -IncludeManagementTools -ErrorAction SilentlyContinue

    # 2. Enable Remote Desktop
    Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
    Enable-NetFirewallRule -DisplayGroup "Remote Desktop"

    # 3. Allow multiple simultaneous sessions per user + unlimited sessions
    Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fSingleSessionPerUser" -Value 0

    # 4. Configure RDS licensing to per-device (grace period = 120 days, no CALs needed initially)
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "LicensingMode" -Value 2 -PropertyType DWord -Force -ErrorAction SilentlyContinue
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "MaxInstanceCount" -Value 999 -PropertyType DWord -Force -ErrorAction SilentlyContinue
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "fAllowUnlistedRemotePrograms" -Value 1 -PropertyType DWord -Force -ErrorAction SilentlyContinue

    # 5. Remove the 2-session limit for admin RDP
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name "AllowMultipleTSSessions" -Value 1 -PropertyType DWord -Force -ErrorAction SilentlyContinue

    # 6. Configure session limits
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "MaxConnectionTime" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "MaxIdleTime" -Value 0 -PropertyType DWord -Force -ErrorAction SilentlyContinue
    New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services' -Name "MaxDisconnectionTime" -Value 60000 -PropertyType DWord -Force -ErrorAction SilentlyContinue

    # 7. Create user accounts
    ${userCommands}

    # 8. Restart to apply RDS role
    Restart-Computer -Force

    Write-Output 'RDS setup complete. ${users.length} users created. Server restarting...'
  `;
}

/**
 * Create an RDS Windows Server VM with multiple user accounts.
 * Returns VM details + per-user credentials.
 */
async function createRdsServer({
  trainingName, organization, vmSize = 'medium', userCount = 10,
  emails = [], resourceGroup, location = 'southindia', vnet,
  allocatedHours = 100, autoShutdown = false, idleMinutes = 15, expiresAt,
}) {
  const sizeConfig = RDS_VM_SIZES[vmSize] || RDS_VM_SIZES['medium'];
  // Azure VM name: max 15 chars, alphanumeric + hyphen, must start/end with alphanumeric
  const cleanName = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  const vmName = `rds${cleanName}`;
  const rg = resourceGroup || process.env.RDS_RESOURCE_GROUP || 'synergific';
  const adminPassword = 'GetLabs@2024!';

  logger.info(`Creating RDS server ${vmName} (${sizeConfig.vmSize}) for ${userCount} users`);

  // Generate user accounts
  const users = [];
  for (let i = 0; i < userCount; i++) {
    const email = emails[i] || `user${i + 1}@${organization}.lab`;
    const username = `labuser${i + 1}`;
    const password = `Lab${Math.random().toString(36).slice(2, 8)}!${i + 1}`;
    users.push({ username, password, email });
  }

  // 1. Create Public IP
  const publicIpName = `${vmName}-pip`;
  await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(rg, publicIpName, {
    location,
    publicIPAllocationMethod: 'Static',
    sku: { name: 'Standard' },
  });
  const pip = await networkClient.publicIPAddresses.get(rg, publicIpName);

  // 2. Create NSG with RDP allowed
  const nsgName = `${vmName}-nsg`;
  await networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait(rg, nsgName, {
    location,
    securityRules: [{
      name: 'AllowRDP',
      protocol: 'Tcp',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
      sourcePortRange: '*',
      destinationPortRange: '3389',
      access: 'Allow',
      direction: 'Inbound',
      priority: 100,
    }],
  });

  // 3. Create NIC
  const nicName = `${vmName}-nic`;
  const vnetName = vnet || 'vnet-southindia-3';
  const subnetName = 'snet-southindia-1';
  await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(rg, nicName, {
    location,
    networkSecurityGroup: { id: `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}` },
    ipConfigurations: [{
      name: 'ipconfig1',
      publicIPAddress: { id: pip.id },
      subnet: { id: `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}` },
    }],
  });

  // 4. Create Windows Server VM (Spot)
  await computeClient.virtualMachines.beginCreateOrUpdateAndWait(rg, vmName, {
    location,
    hardwareProfile: { vmSize: sizeConfig.vmSize },
    storageProfile: {
      imageReference: {
        publisher: 'MicrosoftWindowsServer',
        offer: 'WindowsServer',
        sku: '2022-datacenter',
        version: 'latest',
      },
      osDisk: {
        createOption: 'FromImage',
        managedDisk: { storageAccountType: 'StandardSSD_LRS' },
      },
    },
    osProfile: {
      computerName: vmName,
      adminUsername: 'labadmin',
      adminPassword,
      windowsConfiguration: {
        provisionVMAgent: true,
        enableAutomaticUpdates: false,
      },
    },
    networkProfile: {
      networkInterfaces: [{ id: `/subscriptions/${subscriptionId}/resourceGroups/${rg}/providers/Microsoft.Network/networkInterfaces/${nicName}` }],
    },
    priority: 'Spot',
    evictionPolicy: 'Deallocate',
    billingProfile: { maxPrice: -1 },
    licenseType: 'Windows_Server', // Hybrid Benefit if applicable
  });

  logger.info(`RDS VM ${vmName} created, installing RDS + user accounts...`);

  // 4. Run PowerShell script to setup RDS + users via RunCommand (more reliable than CustomScriptExtension)
  const script = buildUserSetupScript(users, adminPassword);
  await computeClient.virtualMachines.beginRunCommandAndWait(rg, vmName, {
    commandId: 'RunPowerShellScript',
    script: [script],
  });

  logger.info(`RDS setup complete on ${vmName}`);

  // 5. Save to DB — one VM entry for the server + individual "session" entries per user
  const publicIp = pip.ipAddress;
  const cleanTraining = trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Register Guac connections so "Open in browser" works for RDS (best
  // effort — Guacamole may be down during some deployments, shouldn't
  // block the RDS create path).
  let guacOk = false;
  try {
    const admTok = await getGuacAdminToken();
    // Host connection (admin/teacher)
    {
      const id = await upsertRdpConn(admTok, vmName, rdpConnParams(publicIp, 'labadmin', adminPassword));
      await ensureUser(vmName, admTok);
      await grantRead(admTok, vmName, id);
    }
    // Per-user connections
    for (const u of users) {
      const connName = `${vmName}-${u.username}`;
      const id = await upsertRdpConn(admTok, connName, rdpConnParams(publicIp, u.username, u.password));
      await ensureUser(connName, admTok);
      await grantRead(admTok, connName, id);
    }
    guacOk = true;
    logger.info(`[rds] Guacamole connections registered for ${vmName} + ${users.length} sessions`);
  } catch (e) {
    logger.warn(`[rds] Guacamole registration failed for ${vmName}: ${e.message} — VMs will still work via local RDP client`);
  }

  // Save the RDS server as a VM
  await VM.create({
    name: vmName,
    trainingName: cleanTraining,
    email: `admin@${organization}`,
    logs: [{ start: new Date() }],
    rate: sizeConfig.cost,
    duration: 0,
    isRunning: true,
    guacamole: guacOk,
    os: 'Windows Server 2022 (RDS)',
    resourceGroup: rg,
    publicIp,
    adminPass: adminPassword,
    adminUsername: 'labadmin',
    isAlive: true,
    quota: { total: allocatedHours, consumed: 0 },
    remarks: `RDS Server - ${userCount} users`,
    autoShutdown,
    idleMinutes,
    hybridBenefit: true,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    organization, location,
  });

  // Save per-user entries so they show up in Lab Console
  const vmUserMapping = [];
  for (const user of users) {
    await VM.create({
      name: `${vmName}-${user.username}`,
      trainingName: cleanTraining,
      email: user.email,
      logs: [{ start: new Date() }],
      rate: Math.round(sizeConfig.cost / userCount), // Split cost per user
      duration: 0,
      isRunning: true,
      guacamole: guacOk,
      os: 'Windows Server 2022 (RDS Session)',
      resourceGroup: rg,
      publicIp, // Same IP — different username
      adminPass: user.password,
      adminUsername: user.username,
      isAlive: true,
      quota: { total: allocatedHours, consumed: 0 },
      remarks: 'RDS session',
      autoShutdown,
      idleMinutes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      organization, location,
    });

    vmUserMapping.push({ vmName: `${vmName}-${user.username}`, userEmail: user.email });
  }

  // Create/update training
  const existing = await Training.findOne({ name: cleanTraining, organization });
  if (existing) {
    existing.vmUserMapping.push(...vmUserMapping);
    await existing.save();
  } else {
    await Training.create({ name: cleanTraining, organization, vmUserMapping, schedules: [] });
  }

  // Create user accounts in portal
  for (const user of users) {
    if (!(await User.findOne({ email: user.email }))) {
      const newUser = new User({
        organization, email: user.email, name: user.username,
        password: 'Welcome1234!', userType: 'user', trainingName: cleanTraining,
      });
      await newUser.save();
    }
  }

  return {
    serverName: vmName,
    publicIp,
    adminUsername: 'labadmin',
    adminPassword,
    vmSize: sizeConfig.vmSize,
    maxUsers: sizeConfig.maxUsers,
    userCount,
    costPerHour: sizeConfig.cost,
    costPerUserPerHour: Math.round(sizeConfig.cost / userCount),
    individualVmCost: userCount * 6 /* B2s Windows on-demand ₹6/hr - no Spot for B-series */,
    savings: Math.round((1 - sizeConfig.cost / (userCount * 6 /* B2s Windows on-demand ₹6/hr - no Spot for B-series */)) * 100),
    users: users.map(u => ({
      username: u.username,
      password: u.password,
      email: u.email,
      accessUrl: `rdp://${publicIp}`, // Users can also use Guacamole
    })),
  };
}

async function getRdsCostComparison(userCount, vmSize = 'medium') {
  const sizeConfig = RDS_VM_SIZES[vmSize] || RDS_VM_SIZES['medium'];

  // Fetch live prices
  let rdsCostPerVm = sizeConfig.cost; // fallback
  let individualCostPerVm = 6; // fallback B2s
  try {
    const rdsPrice = await getVmPriceInr(sizeConfig.vmSize, 'southindia', 'windows');
    if (rdsPrice.spot) rdsCostPerVm = rdsPrice.spot;
    else if (rdsPrice.onDemand) rdsCostPerVm = rdsPrice.onDemand;

    const b2sPrice = await getVmPriceInr('Standard_B2s', 'southindia', 'windows');
    if (b2sPrice.onDemand) individualCostPerVm = b2sPrice.onDemand;
  } catch {}

  const rdsVmCount = Math.ceil(userCount / sizeConfig.maxUsers);
  const rdsCost = Math.round(rdsVmCount * rdsCostPerVm * 100) / 100;
  const individualCost = Math.round(userCount * individualCostPerVm * 100) / 100;
  const savings = Math.round((individualCost - rdsCost) * 100) / 100;

  return {
    rds: { vmCount: rdsVmCount, vmSize: sizeConfig.vmSize, usersPerVm: sizeConfig.maxUsers, costPerHour: rdsCost, costPerMonth: Math.round(rdsCost * 8 * 22) },
    individual: { vmCount: userCount, vmSize: 'Standard_B2s', usersPerVm: 1, costPerHour: individualCost, costPerMonth: Math.round(individualCost * 8 * 22) },
    savings: { perHour: savings, perMonth: Math.round(savings * 8 * 22), percent: individualCost > 0 ? Math.round((savings / individualCost) * 100) : 0 },
    exchangeRate: (await require('./exchangeRate').getUsdToInr()),
    priceSource: 'Azure Retail API + live USD/INR',
  };
}

module.exports = { createRdsServer, getRdsCostComparison, RDS_VM_SIZES, buildUserSetupScript };
