/**
 * One-time script to provision a Windows KVM Docker host on Azure.
 * Run: node scripts/provision-win-host.js
 */
require('dotenv').config();
const { connectMongoDB } = require('../connection');
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { ResourceManagementClient } = require('@azure/arm-resources');
const Docker = require('dockerode');
const DockerHost = require('../models/dockerHost');

const RG = 'windows-containers';
const VM = 'win-container-host';
const REGION = 'southindia';
const VM_SIZE = 'Standard_D16s_v3';

const CLOUD_INIT = `#!/bin/bash
set -e
apt-get update -y && apt-get install -y docker.io qemu-kvm libvirt-daemon-system
systemctl enable docker && systemctl start docker
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf << 'DEOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://0.0.0.0:2376
DEOF
systemctl daemon-reload && systemctl restart docker
docker pull dockurr/windows:latest &
mkdir -p /opt/windows-disks /opt/windows-base-template
echo 'READY' > /root/docker-ready.txt
`;

async function main() {
  await connectMongoDB(process.env.MONGO_URI);

  const credential = new ClientSecretCredential(
    process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
  );
  const subscriptionId = process.env.SUBSCRIPTION_ID;
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const networkClient = new NetworkManagementClient(credential, subscriptionId);
  const resourceClient = new ResourceManagementClient(credential, subscriptionId);

  console.log('1. Creating resource group...');
  await resourceClient.resourceGroups.createOrUpdate(RG, { location: REGION });

  console.log('2. Creating VNet + Subnet...');
  const vnetResult = await networkClient.virtualNetworks.beginCreateOrUpdateAndWait(RG, VM + '-vnet', {
    location: REGION,
    addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
    subnets: [{ name: 'default', addressPrefix: '10.0.1.0/24' }],
  });

  console.log('3. Creating NSG...');
  const nsgResult = await networkClient.networkSecurityGroups.beginCreateOrUpdateAndWait(RG, VM + '-nsg', {
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

  console.log('4. Creating Public IP...');
  const ipResult = await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(RG, VM + '-ip', {
    location: REGION,
    publicIPAllocationMethod: 'Static',
    sku: { name: 'Standard' },
  });
  const publicIp = ipResult.ipAddress;
  console.log('   Public IP:', publicIp);

  console.log('5. Creating NIC...');
  const nicResult = await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(RG, VM + '-nic', {
    location: REGION,
    ipConfigurations: [{
      name: 'ipconfig1',
      subnet: { id: vnetResult.subnets[0].id },
      publicIPAddress: { id: ipResult.id },
    }],
    networkSecurityGroup: { id: nsgResult.id },
  });

  console.log('6. Creating Spot VM with KVM...');
  await computeClient.virtualMachines.beginCreateOrUpdateAndWait(RG, VM, {
    location: REGION,
    hardwareProfile: { vmSize: VM_SIZE },
    priority: 'Spot',
    evictionPolicy: 'Deallocate',
    billingProfile: { maxPrice: -1 },
    storageProfile: {
      imageReference: {
        publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts', version: 'latest',
      },
      osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'Standard_LRS' }, diskSizeGB: 128 },
    },
    osProfile: {
      computerName: VM,
      adminUsername: 'azureuser',
      adminPassword: 'WinContainers2026!P',
      customData: Buffer.from(CLOUD_INIT).toString('base64'),
    },
    networkProfile: { networkInterfaces: [{ id: nicResult.id }] },
  });
  console.log('   VM created!');

  console.log('7. Waiting for Docker TCP (up to 5 min)...');
  let dockerReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const testDocker = new Docker({ host: publicIp, port: 2376 });
      await testDocker.info();
      dockerReady = true;
      console.log('\n   Docker ready on ' + publicIp + ':2376');
      break;
    } catch {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  if (!dockerReady) {
    console.error('\nDocker not ready after 5 min — check VM manually at ' + publicIp);
    process.exit(1);
  }

  console.log('8. Updating DB record...');
  await DockerHost.updateOne(
    { name: 'win-container-host' },
    { $set: {
      status: 'ready',
      publicIp,
      vmName: VM,
      resourceGroup: RG,
      vmSize: VM_SIZE,
      totalMemoryMb: 65536,
      usedMemoryMb: 0,
      maxContainers: 14,
      currentContainers: 0,
      containers: [],
      region: REGION,
      spotInstance: true,
      kvmEnabled: true,
      windowsOnly: true,
      provisionedAt: new Date(),
      lastActivityAt: new Date(),
      idleSince: null,
    }},
    { upsert: true }
  );

  // Update Nginx upstream for Windows container proxy
  const winProxyBlock = publicIp;
  console.log('9. NOTE: Update /win/ proxy in Nginx to point to ' + winProxyBlock);

  console.log('\nDONE! Windows KVM host ready at ' + publicIp);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
