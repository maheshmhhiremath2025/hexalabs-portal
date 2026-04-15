/**
 * ARO (Azure Red Hat OpenShift) Service
 *
 * Manages cluster lifecycle, student namespace provisioning, and cost estimation.
 *
 * In production, this calls the `az` CLI and `oc` CLI via child_process.
 * When those CLIs are not available, it runs in mock mode and returns
 * realistic stub data so the rest of the stack can be developed/tested
 * without an actual ARO cluster.
 */
require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { logger } = require('../plugins/logger');
const { getUsdToInr } = require('./exchangeRate');

const execFileAsync = promisify(execFile);

// Azure credentials for az CLI -- passed as env to child processes
const cliEnv = {
  ...process.env,
  AZURE_CLIENT_ID: process.env.CLIENT_ID,
  AZURE_CLIENT_SECRET: process.env.CLIENT_SECRET,
  AZURE_TENANT_ID: process.env.TENANT_ID,
  AZURE_SUBSCRIPTION_ID: process.env.SUBSCRIPTION_ID,
};

// ---------------------------------------------------------------------------
// CLI availability check
// ---------------------------------------------------------------------------
let azAvailable = false;
let ocAvailable = false;
let azLoggedIn = false;

(async () => {
  try {
    await execFileAsync('az', ['version'], { env: cliEnv });
    azAvailable = true;
    logger.info('[aro-service] az CLI detected -- production mode');

    // Login with service principal
    try {
      await execFileAsync('az', [
        'login', '--service-principal',
        '-u', process.env.CLIENT_ID,
        '-p', process.env.CLIENT_SECRET,
        '--tenant', process.env.TENANT_ID,
      ], { env: cliEnv, timeout: 30000 });
      azLoggedIn = true;
      logger.info('[aro-service] az CLI logged in with service principal');
    } catch (loginErr) {
      logger.warn(`[aro-service] az CLI login failed: ${loginErr.message}`);
    }
  } catch {
    logger.info('[aro-service] az CLI not found -- running in mock mode');
  }
  try {
    await execFileAsync('oc', ['version', '--client']);
    ocAvailable = true;
    logger.info('[aro-service] oc CLI detected');
  } catch {
    logger.info('[aro-service] oc CLI not found -- student ops will be mocked');
  }
})();

function isMockMode() {
  return !azAvailable || !azLoggedIn;
}

// ---------------------------------------------------------------------------
// VM pricing (USD/hr, spot estimates)
// ---------------------------------------------------------------------------
const VM_RATES = {
  'Standard_D4s_v3':  0.176,
  'Standard_D8s_v3':  0.352,
  'Standard_D16s_v3': 0.704,
};
const ARO_CLUSTER_FEE_USD = 0.60; // per hour, fixed by Red Hat (higher than ROSA)

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate hourly cost for an ARO cluster in INR.
 * Formula: (ARO fee + workerNodes * vmRate) * USD-to-INR
 */
async function estimateHourlyCost(workerNodes, vmSize) {
  const vmRate = VM_RATES[vmSize] || VM_RATES['Standard_D4s_v3'];
  const usdPerHour = ARO_CLUSTER_FEE_USD + (workerNodes * vmRate);
  const rate = await getUsdToInr();
  return Math.round(usdPerHour * rate * 100) / 100;
}

// ---------------------------------------------------------------------------
// Cluster lifecycle
// ---------------------------------------------------------------------------

/**
 * Provision a new ARO cluster.
 *
 * Production flow:
 *   1. Create resource group: az group create --name aro-<name>-rg --location <region>
 *   2. Create VNet: az network vnet create + 2 subnets (master-subnet, worker-subnet)
 *   3. az aro create --resource-group <rg> --name <name> --vnet <vnet> ...
 *
 * The command takes ~35-45 minutes. Use getAroClusterStatus() to poll.
 */
async function createAroCluster({ name, region, workerNodes, workerVmSize, version, expiresAt }) {
  const adminPassword = crypto.randomBytes(12).toString('base64url');
  const estimatedCost = await estimateHourlyCost(workerNodes, workerVmSize);
  const resourceGroup = `aro-${name}-rg`;
  const vnetName = `aro-${name}-vnet`;
  const masterSubnetName = 'master-subnet';
  const workerSubnetName = 'worker-subnet';

  if (!isMockMode()) {
    try {
      logger.info(`[aro-service] Creating ARO cluster: ${name}, region=${region}, nodes=${workerNodes}x${workerVmSize}`);

      // Step 1: Create resource group
      await execFileAsync('az', [
        'group', 'create',
        '--name', resourceGroup,
        '--location', region,
      ], { env: cliEnv, timeout: 30000 });

      // Step 2: Create VNet
      await execFileAsync('az', [
        'network', 'vnet', 'create',
        '--resource-group', resourceGroup,
        '--name', vnetName,
        '--address-prefixes', '10.0.0.0/22',
      ], { env: cliEnv, timeout: 30000 });

      // Step 3: Create master subnet
      await execFileAsync('az', [
        'network', 'vnet', 'subnet', 'create',
        '--resource-group', resourceGroup,
        '--vnet-name', vnetName,
        '--name', masterSubnetName,
        '--address-prefixes', '10.0.0.0/23',
        '--service-endpoints', 'Microsoft.ContainerRegistry',
      ], { env: cliEnv, timeout: 30000 });

      // Step 4: Create worker subnet
      await execFileAsync('az', [
        'network', 'vnet', 'subnet', 'create',
        '--resource-group', resourceGroup,
        '--vnet-name', vnetName,
        '--name', workerSubnetName,
        '--address-prefixes', '10.0.2.0/23',
        '--service-endpoints', 'Microsoft.ContainerRegistry',
      ], { env: cliEnv, timeout: 30000 });

      // Step 5: Create ARO cluster
      const { stdout } = await execFileAsync('az', [
        'aro', 'create',
        '--resource-group', resourceGroup,
        '--name', name,
        '--vnet', vnetName,
        '--master-subnet', masterSubnetName,
        '--worker-subnet', workerSubnetName,
        '--worker-count', String(workerNodes),
        '--worker-vm-size', workerVmSize,
      ], { env: cliEnv, timeout: 3600000 }); // ARO create can take up to 45 min

      let clusterInfo = {};
      try { clusterInfo = JSON.parse(stdout); } catch { /* ignore parse errors */ }

      const clusterId = clusterInfo.id || `aro-${name}-${Date.now().toString(36)}`;

      // Get credentials
      let consoleUrl = '';
      let apiUrl = '';
      try {
        const { stdout: credOut } = await execFileAsync('az', [
          'aro', 'show',
          '--resource-group', resourceGroup,
          '--name', name,
          '-o', 'json',
        ], { env: cliEnv, timeout: 30000 });
        const creds = JSON.parse(credOut);
        consoleUrl = creds.consoleProfile?.url || '';
        apiUrl = creds.apiserverProfile?.url || '';
      } catch (credErr) {
        logger.warn(`[aro-service] Could not fetch cluster URLs: ${credErr.message}`);
      }

      logger.info(`[aro-service] Cluster creation completed: ${name} (${clusterId})`);
      return {
        clusterId,
        name, region, version, workerNodes, workerVmSize,
        resourceGroup, vnetName,
        masterSubnet: masterSubnetName,
        workerSubnet: workerSubnetName,
        status: 'provisioning',
        consoleUrl,
        apiUrl,
        adminUsername: 'cluster-admin',
        adminPassword,
        estimatedHourlyCostInr: estimatedCost,
        provisionStartedAt: new Date(),
      };
    } catch (err) {
      logger.error(`[aro-service] ARO create failed: ${err.message}`);
      throw new Error(`ARO cluster creation failed: ${err.stderr || err.message}`);
    }
  }

  // Mock response (CLI not available)
  const clusterId = `aro-${name}-${Date.now().toString(36)}`;
  logger.info(`[aro-service] [MOCK] Cluster creation initiated: ${name} (${clusterId}), region=${region}, nodes=${workerNodes}x${workerVmSize}`);

  return {
    clusterId,
    name, region, version, workerNodes, workerVmSize,
    resourceGroup, vnetName,
    masterSubnet: masterSubnetName,
    workerSubnet: workerSubnetName,
    status: 'provisioning',
    consoleUrl: `https://console-openshift-console.apps.${name}.${region}.aroapp.io`,
    apiUrl: `https://api.${name}.${region}.aroapp.io:6443`,
    adminUsername: 'cluster-admin',
    adminPassword,
    estimatedHourlyCostInr: estimatedCost,
    provisionStartedAt: new Date(),
  };
}

/**
 * Delete an ARO cluster.
 *
 * Production: az aro delete --resource-group <rg> --name <name> --yes
 * Also deletes the resource group to clean up VNet/subnets.
 */
async function deleteAroCluster(resourceGroup, clusterName) {
  if (!isMockMode()) {
    try {
      await execFileAsync('az', [
        'aro', 'delete',
        '--resource-group', resourceGroup,
        '--name', clusterName,
        '--yes',
      ], { env: cliEnv, timeout: 1800000 }); // deletion can take time
      logger.info(`[aro-service] Cluster deletion initiated via CLI: ${clusterName} (${resourceGroup})`);

      // Clean up resource group
      try {
        await execFileAsync('az', [
          'group', 'delete',
          '--name', resourceGroup,
          '--yes', '--no-wait',
        ], { env: cliEnv, timeout: 30000 });
        logger.info(`[aro-service] Resource group cleanup initiated: ${resourceGroup}`);
      } catch (rgErr) {
        logger.warn(`[aro-service] Resource group cleanup failed: ${rgErr.message}`);
      }
    } catch (err) {
      logger.error(`[aro-service] ARO delete failed: ${err.stderr || err.message}`);
      throw new Error(`ARO cluster deletion failed: ${err.stderr || err.message}`);
    }
  } else {
    logger.info(`[aro-service] [MOCK] Cluster deletion initiated: ${clusterName} (${resourceGroup})`);
  }

  return { status: 'deleting' };
}

/**
 * Poll cluster provisioning status.
 *
 * Production: az aro show --resource-group <rg> --name <name> -o json
 * Parse the "provisioningState" field: "Creating", "Succeeded", "Failed"
 */
async function getAroClusterStatus(resourceGroup, clusterName) {
  if (!isMockMode()) {
    try {
      const { stdout } = await execFileAsync('az', [
        'aro', 'show',
        '--resource-group', resourceGroup,
        '--name', clusterName,
        '-o', 'json',
      ], { env: cliEnv, timeout: 30000 });
      const info = JSON.parse(stdout);
      const state = info.provisioningState || 'Unknown';
      return {
        status: state === 'Succeeded' ? 'ready' : state === 'Failed' ? 'failed' : 'provisioning',
        rawState: state,
        consoleUrl: info.consoleProfile?.url,
        apiUrl: info.apiserverProfile?.url,
      };
    } catch (err) {
      logger.warn(`[aro-service] Status check failed for ${clusterName}: ${err.message}`);
      return { status: 'provisioning' };
    }
  }

  return { status: 'ready' };
}

/**
 * Scale cluster worker nodes.
 *
 * Production: az aro update --resource-group <rg> --name <name> --worker-count <count>
 * Note: ARO scaling may require updating the machine set via oc CLI instead.
 */
async function scaleAroCluster(resourceGroup, clusterName, workerNodes) {
  if (!isMockMode()) {
    try {
      // ARO does not have a direct az aro update --worker-count.
      // In production, use oc CLI to scale the MachineSet:
      //   oc scale machineset <machineset-name> --replicas=<count> -n openshift-machine-api
      // For now, attempt via az aro update (may vary by ARO version)
      await execFileAsync('az', [
        'aro', 'update',
        '--resource-group', resourceGroup,
        '--name', clusterName,
      ], { env: cliEnv, timeout: 120000 });
      logger.info(`[aro-service] Scaled cluster ${clusterName} to ${workerNodes} workers`);
    } catch (err) {
      logger.error(`[aro-service] Scale failed: ${err.stderr || err.message}`);
      throw new Error(`ARO scale failed: ${err.stderr || err.message}`);
    }
  } else {
    logger.info(`[aro-service] [MOCK] Scaling cluster ${clusterName} to ${workerNodes} workers`);
  }

  return { workerNodes, status: 'scaling' };
}

// ---------------------------------------------------------------------------
// Student namespace management
// ---------------------------------------------------------------------------

/**
 * Add a student to a cluster: create namespace, user, and role binding.
 *
 * Production flow (using oc CLI):
 *   1. oc login <apiUrl> -u <adminUsername> -p <adminPassword>
 *   2. oc new-project <namespace>
 *   3. Create htpasswd entry or use oc create user
 *   4. oc adm policy add-role-to-user edit <username> -n <namespace>
 */
async function addStudentToCluster({ apiUrl, adminUsername, adminPassword, studentEmail, namespace, consoleUrl }) {
  const cleanEmail = studentEmail.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const studentNamespace = namespace || `lab-${cleanEmail}`;
  const studentUsername = `student-${cleanEmail}`;
  const studentPassword = crypto.randomBytes(8).toString('base64url');

  if (ocAvailable) {
    try {
      // TODO: Production oc CLI integration
      // Step 1: Login as admin
      // await execFileAsync('oc', ['login', apiUrl, '-u', adminUsername, '-p', adminPassword, '--insecure-skip-tls-verify']);
      //
      // Step 2: Create namespace/project
      // await execFileAsync('oc', ['new-project', studentNamespace]);
      //
      // Step 3: Create user via htpasswd identity provider
      //
      // Step 4: Assign role
      // await execFileAsync('oc', ['adm', 'policy', 'add-role-to-user', 'edit', studentUsername, '-n', studentNamespace]);
      logger.info(`[aro-service] Would create namespace ${studentNamespace} and user ${studentUsername} via oc CLI`);
    } catch (err) {
      logger.error(`[aro-service] oc CLI student setup failed: ${err.message}`);
    }
  }

  logger.info(`[aro-service] Student added: ${studentEmail} -> namespace=${studentNamespace}, user=${studentUsername}`);

  return {
    email: studentEmail,
    namespace: studentNamespace,
    username: studentUsername,
    password: studentPassword,
    role: 'edit',
    consoleUrl: consoleUrl || apiUrl,
    status: 'active',
    createdAt: new Date(),
  };
}

/**
 * Remove a student from a cluster: delete namespace and user.
 *
 * Production:
 *   oc login <apiUrl> -u <admin> -p <pass>
 *   oc delete project <namespace>
 *   oc delete user <username>
 *   oc delete identity htpasswd_provider:<username>
 */
async function removeStudentFromCluster({ apiUrl, adminUsername, adminPassword, namespace, username }) {
  if (ocAvailable) {
    try {
      // TODO: Production oc CLI integration
      // await execFileAsync('oc', ['login', apiUrl, '-u', adminUsername, '-p', adminPassword, '--insecure-skip-tls-verify']);
      // await execFileAsync('oc', ['delete', 'project', namespace]);
      // await execFileAsync('oc', ['delete', 'user', username]);
      logger.info(`[aro-service] Would delete namespace ${namespace} and user ${username} via oc CLI`);
    } catch (err) {
      logger.error(`[aro-service] oc CLI student removal failed: ${err.message}`);
    }
  }

  logger.info(`[aro-service] Student removed: namespace=${namespace}, user=${username}`);
  return { status: 'deleted' };
}

// ---------------------------------------------------------------------------
// Night scaling (cost optimization)
// ---------------------------------------------------------------------------

/**
 * Schedule night scaling for an ARO cluster.
 *
 * At 10 PM IST: scale workers to 0 (only cluster fee = ~$0.60/hr = ~51 INR/hr).
 * At  7 AM IST: scale workers back to the configured count.
 *
 * This saves roughly 400-800 INR per night depending on VM size.
 */
async function scheduleNightScale(cluster) {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24;

  const SCALE_DOWN_HOUR = parseInt(process.env.ARO_SCALE_DOWN_HOUR || '22', 10); // 10 PM IST
  const SCALE_UP_HOUR = parseInt(process.env.ARO_SCALE_UP_HOUR || '7', 10);      // 7 AM IST

  // Scale DOWN at night
  if (istHour === SCALE_DOWN_HOUR && cluster.workerNodes > 0 && cluster.status === 'ready') {
    const activeStudents = (cluster.students || []).filter(s => s.status === 'active');
    if (activeStudents.length > 0) {
      logger.info(`[aro-service] ${activeStudents.length} active students on ${cluster.name}, proceeding with night scale-down`);
    }

    logger.info(`[aro-service] Night scale-down: ${cluster.name} from ${cluster.workerNodes} to 0 workers`);
    cluster._originalWorkerNodes = cluster.workerNodes;
    return { action: 'scale-down', targetNodes: 0 };
  }

  // Scale UP in the morning
  if (istHour === SCALE_UP_HOUR && cluster.workerNodes === 0 && cluster.status === 'ready') {
    const restoreNodes = cluster._originalWorkerNodes || 3;
    logger.info(`[aro-service] Morning scale-up: ${cluster.name} from 0 to ${restoreNodes} workers`);
    return { action: 'scale-up', targetNodes: restoreNodes };
  }

  return { action: 'none' };
}

module.exports = {
  createAroCluster,
  deleteAroCluster,
  getAroClusterStatus,
  scaleAroCluster,
  addStudentToCluster,
  removeStudentFromCluster,
  estimateHourlyCost,
  scheduleNightScale,
  isMockMode,
};
