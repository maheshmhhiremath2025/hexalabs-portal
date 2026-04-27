// MeshCentral agent installation — installs MeshAgent on Windows VMs via
// Azure Custom Script Extension after VM creation.
//
// The agent connects outbound to MeshCentral on port 443 — no inbound
// NSG rules needed. Tags the device with the portal vmName for lookup.

const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { logger } = require('./../plugins/logger');

require('dotenv').config();

const credentials = new ClientSecretCredential(
  process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET
);
const computeClient = new ComputeManagementClient(credentials, process.env.SUBSCRIPTION_ID);

const MC_PUBLIC_URL = process.env.MESHCENTRAL_PUBLIC_URL || 'https://mesh.getlabs.cloud';
const MC_DEVICE_GROUP = process.env.MESHCENTRAL_DEVICE_GROUP || 'getlabs-windows';
const MC_MESH_ID = process.env.MESHCENTRAL_MESH_ID || '';

function generateMshContent(vmName) {
  const serverHost = MC_PUBLIC_URL.replace(/^https?:\/\//, '');
  return [
    `MeshName=${MC_DEVICE_GROUP}`,
    `MeshType=2`,
    `MeshID=${MC_MESH_ID}`,
    `MeshServer=wss://${serverHost}/agent.ashx`,
    `Tag=${vmName}`,
  ].join('\r\n');
}

const handler = async (job) => {
  const { vmName, resourceGroup, os } = job.data;
  const isWindows = (os || '').toLowerCase().includes('windows');

  if (!isWindows) {
    logger.info(`[meshcentral] Skipping ${vmName} — not Windows`);
    return 'SKIP';
  }

  if (!MC_MESH_ID) {
    logger.error(`[meshcentral] MESHCENTRAL_MESH_ID not configured — cannot install agent on ${vmName}`);
    throw new Error('MESHCENTRAL_MESH_ID not configured');
  }

  try {
    const mshContent = generateMshContent(vmName);

    // PowerShell script to download and install MeshAgent silently.
    // The agent reads the adjacent .msh file for connection parameters.
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$agentDir = "C:\\MeshAgent"',
      '$agentExe = "$agentDir\\meshagent.exe"',
      '$mshFile = "$agentDir\\meshagent.msh"',
      'New-Item -ItemType Directory -Force -Path $agentDir | Out-Null',
      `Invoke-WebRequest -Uri "${MC_PUBLIC_URL}/meshagents?id=4" -OutFile $agentExe -UseBasicParsing`,
      `Set-Content -Path $mshFile -Value '${mshContent.replace(/'/g, "''")}' -Encoding ASCII`,
      'Start-Process -FilePath $agentExe -ArgumentList "-install" -Wait -NoNewWindow',
      `Write-Output "MeshAgent installed for ${vmName}"`,
    ].join('; ');

    // Get VM location for the extension
    const vmInfo = await computeClient.virtualMachines.get(resourceGroup, vmName);
    const location = vmInfo.location;

    logger.info(`[meshcentral] Installing MeshAgent on ${vmName} via Custom Script Extension...`);

    const poller = await computeClient.virtualMachineExtensions.beginCreateOrUpdate(
      resourceGroup, vmName, 'MeshAgentInstall', {
        location,
        publisher: 'Microsoft.Compute',
        typePropertiesType: 'CustomScriptExtension',
        typeHandlerVersion: '1.10',
        autoUpgradeMinorVersion: true,
        settings: {
          commandToExecute: `powershell -ExecutionPolicy Unrestricted -Command "${script.replace(/"/g, '\\"')}"`,
        },
      }
    );
    await poller.pollUntilDone();

    logger.info(`[meshcentral] MeshAgent installed on ${vmName}`);
    return 'OK';
  } catch (err) {
    logger.error(`[meshcentral] Agent install failed for ${vmName}: ${err.message}`);
    throw err; // Bull retries (3 attempts, exponential backoff)
  }
};

module.exports = handler;
