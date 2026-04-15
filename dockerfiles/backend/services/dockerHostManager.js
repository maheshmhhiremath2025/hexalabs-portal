/**
 * Docker Host Auto-Scaling Manager
 *
 * Manages a pool of Azure Spot VMs as Docker hosts.
 * Auto-provisions new hosts when capacity is needed.
 * Auto-terminates idle hosts to minimize cost.
 */
require('dotenv').config();
const Docker = require('dockerode');
const DockerHost = require('../models/dockerHost');
const { logger } = require('../plugins/logger');

const IDLE_TIMEOUT_MIN = parseInt(process.env.DOCKER_HOST_IDLE_TIMEOUT_MIN || '30');
const VM_SIZE = process.env.DOCKER_HOST_VM_SIZE || 'Standard_B4ms';
const REGION = process.env.DOCKER_HOST_REGION || 'southindia';
const MAX_CONTAINERS_PER_HOST = parseInt(process.env.DOCKER_HOST_MAX_CONTAINERS || '30');
const HOST_MODE = process.env.DOCKER_HOST_MODE || 'local'; // 'auto' or 'local'

// Reserve resources for portal services (backend, workers, MongoDB, Redis, Nginx)
// When free RAM drops below this, new containers go to Azure instead of local
const RESERVED_RAM_MB = parseInt(process.env.DOCKER_HOST_RESERVED_RAM_MB || '3072'); // 3GB for portal
const RESERVED_CPU_PERCENT = parseInt(process.env.DOCKER_HOST_RESERVED_CPU_PERCENT || '25'); // keep 25% CPU free

// VM size → memory mapping
const VM_MEMORY = {
  'Standard_B2s': 4096, 'Standard_B2ms': 8192,
  'Standard_B4ms': 16384, 'Standard_B8ms': 32768,
};

/**
 * Get a Dockerode client for a specific host
 */
function getDockerClient(host) {
  if (!host || host.provider === 'local') {
    return new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
  }
  return new Docker({ host: host.publicIp, port: host.dockerPort || 2376 });
}

/**
 * Find a Docker host with enough capacity
 */
async function getAvailableHost(requiredMemoryMb = 512) {
  if (HOST_MODE === 'local') return null; // Use local Docker

  const hosts = await DockerHost.find({
    status: { $in: ['ready', 'busy'] },
    provider: 'azure',
  }).sort({ currentContainers: -1 }); // Fill existing hosts first (bin-packing)

  for (const host of hosts) {
    const freeMemory = host.totalMemoryMb - host.usedMemoryMb;
    if (freeMemory >= requiredMemoryMb && host.currentContainers < host.maxContainers) {
      return host;
    }
  }
  return null;
}

/**
 * Provision a new Azure Spot VM as a Docker host
 */
async function provisionNewHost() {
  const { ClientSecretCredential } = require('@azure/identity');
  const { ComputeManagementClient } = require('@azure/arm-compute');
  const { NetworkManagementClient } = require('@azure/arm-network');
  const { ResourceManagementClient } = require('@azure/arm-resources');

  const credential = new ClientSecretCredential(
    process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
  );
  const subscriptionId = process.env.SUBSCRIPTION_ID;
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const networkClient = new NetworkManagementClient(credential, subscriptionId);
  const resourceClient = new ResourceManagementClient(credential, subscriptionId);

  const timestamp = Date.now().toString(36);
  const hostName = `dh-${timestamp}`;
  const rgName = `docker-host-${timestamp}-rg`;
  const vmName = `docker-host-${timestamp}`;

  logger.info(`[docker-host] Provisioning new host: ${hostName} (${VM_SIZE} Spot, ${REGION})`);

  // Save to DB immediately as 'provisioning'
  const hostDoc = await DockerHost.create({
    name: hostName,
    provider: 'azure',
    vmName,
    resourceGroup: rgName,
    status: 'provisioning',
    vmSize: VM_SIZE,
    totalMemoryMb: VM_MEMORY[VM_SIZE] || 16384,
    maxContainers: MAX_CONTAINERS_PER_HOST,
    region: REGION,
    spotInstance: true,
    provisionedAt: new Date(),
  });

  try {
    // 1. Create resource group
    await resourceClient.resourceGroups.createOrUpdate(rgName, { location: REGION });

    // 2. Create VNet + Subnet
    const vnetResult = await networkClient.virtualNetworks.beginCreateOrUpdateAndWait(rgName, `${vmName}-vnet`, {
      location: REGION,
      addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
      subnets: [{ name: 'default', addressPrefix: '10.0.1.0/24' }],
    });

    // 3. Create NSG with required ports
    const nsgResult = await networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait(rgName, `${vmName}-nsg`, {
      location: REGION,
      securityRules: [
        { name: 'SSH', priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp',
          sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '22' },
        { name: 'DockerTCP', priority: 110, direction: 'Inbound', access: 'Allow', protocol: 'Tcp',
          sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '2376' },
        { name: 'ContainerPorts', priority: 120, direction: 'Inbound', access: 'Allow', protocol: 'Tcp',
          sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '10000-11000' },
        { name: 'SSHPorts', priority: 130, direction: 'Inbound', access: 'Allow', protocol: 'Tcp',
          sourceAddressPrefix: '*', sourcePortRange: '*', destinationAddressPrefix: '*', destinationPortRange: '15000-16000' },
      ],
    });

    // 4. Create Public IP
    const ipResult = await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(rgName, `${vmName}-ip`, {
      location: REGION,
      publicIPAllocationMethod: 'Static',
      sku: { name: 'Standard' },
    });
    const publicIp = ipResult.ipAddress;

    // 5. Create NIC
    const subnetId = vnetResult.subnets[0].id;
    const nicResult = await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(rgName, `${vmName}-nic`, {
      location: REGION,
      ipConfigurations: [{
        name: 'ipconfig1',
        subnet: { id: subnetId },
        publicIPAddress: { id: ipResult.id },
      }],
      networkSecurityGroup: { id: nsgResult.id },
    });

    // 6. Cloud-init to install Docker with TCP
    const cloudInit = Buffer.from(`#!/bin/bash
set -e
apt-get update -y && apt-get install -y docker.io
systemctl enable docker && systemctl start docker
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf << 'DEOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://0.0.0.0:2376
DEOF
systemctl daemon-reload && systemctl restart docker
# Pre-pull common image
docker pull linuxserver/webtop:ubuntu-xfce-kasm-version-a17e259b &
echo 'READY' > /root/docker-ready.txt
`).toString('base64');

    // 7. Create Spot VM
    await computeClient.virtualMachines.beginCreateOrUpdateAndWait(rgName, vmName, {
      location: REGION,
      hardwareProfile: { vmSize: VM_SIZE },
      priority: 'Spot',
      evictionPolicy: 'Deallocate',
      billingProfile: { maxPrice: -1 }, // Pay up to on-demand price
      storageProfile: {
        imageReference: {
          publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts', version: 'latest',
        },
        osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'Standard_LRS' }, diskSizeGB: 64 },
      },
      osProfile: {
        computerName: vmName,
        adminUsername: 'azureuser',
        adminPassword: 'DockerHost2026!P',
        customData: cloudInit,
      },
      networkProfile: { networkInterfaces: [{ id: nicResult.id }] },
    });

    logger.info(`[docker-host] VM created: ${vmName} at ${publicIp}`);

    // 8. Wait for Docker TCP to be ready (poll every 15s, max 5 min)
    let dockerReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const testDocker = new Docker({ host: publicIp, port: 2376 });
        await testDocker.info();
        dockerReady = true;
        logger.info(`[docker-host] Docker ready on ${publicIp}:2376`);
        break;
      } catch {
        await new Promise(r => setTimeout(r, 15000));
      }
    }

    if (!dockerReady) {
      logger.error(`[docker-host] Docker TCP not ready after 5 min on ${publicIp}`);
      hostDoc.status = 'terminated';
      await hostDoc.save();
      // Cleanup
      try { await resourceClient.resourceGroups.beginDeleteAndWait(rgName); } catch {}
      return null;
    }

    // 9. Update host record
    hostDoc.publicIp = publicIp;
    hostDoc.status = 'ready';
    hostDoc.lastActivityAt = new Date();
    hostDoc.costPerHour = 4; // B4ms Spot ~4 INR/hr
    await hostDoc.save();

    logger.info(`[docker-host] Host ${hostName} ready at ${publicIp}`);
    return hostDoc;

  } catch (err) {
    logger.error(`[docker-host] Provisioning failed: ${err.message}`);
    hostDoc.status = 'terminated';
    await hostDoc.save();
    try { await resourceClient.resourceGroups.beginDeleteAndWait(rgName); } catch {}
    throw err;
  }
}

/**
 * Terminate a Docker host and delete Azure resources
 */
async function terminateHost(hostId) {
  const host = await DockerHost.findById(hostId);
  if (!host || host.status === 'terminated') return;

  logger.info(`[docker-host] Terminating host: ${host.name}`);
  host.status = 'terminating';
  await host.save();

  try {
    const { ClientSecretCredential } = require('@azure/identity');
    const { ResourceManagementClient } = require('@azure/arm-resources');
    const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
    const resourceClient = new ResourceManagementClient(credential, process.env.SUBSCRIPTION_ID);

    await resourceClient.resourceGroups.beginDeleteAndWait(host.resourceGroup);
    logger.info(`[docker-host] Azure RG ${host.resourceGroup} deleted`);
  } catch (err) {
    logger.error(`[docker-host] Azure cleanup failed: ${err.message}`);
  }

  host.status = 'terminated';
  host.terminatedAt = new Date();
  await host.save();
}

/**
 * Update container count on a host after create/delete
 */
async function addContainerToHost(hostId, containerId, name, memoryMb) {
  await DockerHost.updateOne({ _id: hostId }, {
    $push: { containers: { containerId, name, memoryMb } },
    $inc: { currentContainers: 1, usedMemoryMb: memoryMb },
    $set: { lastActivityAt: new Date(), status: 'busy', idleSince: null },
  });
}

async function removeContainerFromHost(hostId, containerId, memoryMb) {
  const host = await DockerHost.findByIdAndUpdate(hostId, {
    $pull: { containers: { containerId } },
    $inc: { currentContainers: -1, usedMemoryMb: -memoryMb },
    $set: { lastActivityAt: new Date() },
  }, { new: true });

  if (host && host.currentContainers <= 0) {
    host.status = 'idle';
    host.idleSince = new Date();
    host.currentContainers = 0;
    host.usedMemoryMb = 0;
    await host.save();
  }
}

/**
 * Check and terminate idle hosts (called every 5 min by cron)
 */
async function checkAndScaleDown() {
  const now = new Date();
  const threshold = new Date(now.getTime() - IDLE_TIMEOUT_MIN * 60 * 1000);

  const idleHosts = await DockerHost.find({
    status: 'idle',
    idleSince: { $lt: threshold },
    provider: 'azure',
  });

  for (const host of idleHosts) {
    logger.info(`[docker-host] Host ${host.name} idle for ${IDLE_TIMEOUT_MIN}+ min — terminating`);
    try {
      await terminateHost(host._id);
    } catch (err) {
      logger.error(`[docker-host] Failed to terminate ${host.name}: ${err.message}`);
    }
  }

  // Log pool status
  const active = await DockerHost.find({ status: { $in: ['ready', 'busy', 'idle'] } });
  const totalContainers = active.reduce((s, h) => s + h.currentContainers, 0);
  const totalMemory = active.reduce((s, h) => s + h.usedMemoryMb, 0);
  if (active.length > 0) {
    logger.info(`[docker-host] Pool: ${active.length} hosts, ${totalContainers} containers, ${Math.round(totalMemory / 1024)}GB used`);
  }
}

/**
 * Check if the local host has enough free resources for a new container
 * while keeping enough reserved for portal services.
 */
async function localHostHasCapacity(requiredMemoryMb) {
  try {
    const os = require('os');
    const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
    const loadAvg1m = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const cpuUsagePercent = Math.round((loadAvg1m / cpuCount) * 100);

    // After deploying this container, would we still have enough for the portal?
    const remainingAfterDeploy = freeMemMb - requiredMemoryMb;
    const memOk = remainingAfterDeploy >= RESERVED_RAM_MB;
    const cpuOk = cpuUsagePercent < (100 - RESERVED_CPU_PERCENT);

    logger.info(`[docker-host] Local resources: ${freeMemMb}MB free / ${totalMemMb}MB total, CPU ${cpuUsagePercent}% | Need ${requiredMemoryMb}MB + ${RESERVED_RAM_MB}MB reserved = ${memOk ? 'OK' : 'FULL'}`);

    return memOk && cpuOk;
  } catch {
    return true; // If we can't check, assume OK
  }
}

/**
 * Get Docker instance — auto-scales if needed
 * Returns { docker: Dockerode, host: DockerHost|null }
 *
 * Strategy (auto mode):
 * 1. Check if local host has enough free RAM/CPU (after reserving for portal)
 * 2. If local has capacity → deploy locally (instant)
 * 3. If local is full → try existing remote Azure Docker host
 * 4. If no remote host → deploy locally anyway (don't block) + provision Azure in background
 *
 * This ensures the portal (backend, MongoDB, Redis, workers, Nginx) always has
 * enough resources, while auto-scaling to Azure when the local server gets busy.
 */
async function getDockerInstance(memoryMb = 512) {
  const localDocker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

  if (HOST_MODE === 'local') {
    return { docker: localDocker, host: null };
  }

  // AUTO mode: check local capacity first
  const localOk = await localHostHasCapacity(memoryMb);

  if (localOk) {
    // Local has room — deploy here (instant, no Azure cost)
    return { docker: localDocker, host: null };
  }

  // Local is getting full — try remote Azure hosts
  logger.info(`[docker-host] Local host low on resources — looking for remote Azure host`);
  let host = await getAvailableHost(memoryMb);

  if (host) {
    logger.info(`[docker-host] Using remote host ${host.name} (${host.publicIp})`);
    return { docker: getDockerClient(host), host };
  }

  // No remote host available — provision one in background
  const provisioning = await DockerHost.findOne({ status: 'provisioning' });
  if (!provisioning) {
    logger.info('[docker-host] Provisioning new Azure Spot VM in background...');
    provisionNewHost().catch(err => {
      logger.error(`[docker-host] Background provisioning failed: ${err.message}`);
    });
  } else {
    logger.info(`[docker-host] Host ${provisioning.name} already provisioning`);
  }

  // Meanwhile deploy locally to avoid blocking the user (Azure VM takes ~3 min)
  logger.info('[docker-host] No remote host ready yet — deploying locally (Azure provisioning in background)');
  return { docker: localDocker, host: null };
}

module.exports = {
  getDockerClient,
  getAvailableHost,
  provisionNewHost,
  terminateHost,
  addContainerToHost,
  removeContainerFromHost,
  checkAndScaleDown,
  getDockerInstance,
  HOST_MODE,
};
