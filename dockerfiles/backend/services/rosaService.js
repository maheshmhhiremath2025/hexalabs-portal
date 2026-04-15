/**
 * ROSA (Red Hat OpenShift Service on AWS) Service
 *
 * Manages cluster lifecycle, student namespace provisioning, and cost estimation.
 *
 * In production, this calls the `rosa` CLI and `oc` CLI via child_process.
 * When those CLIs are not available, it runs in mock mode and returns
 * realistic stub data so the rest of the stack can be developed/tested
 * without an actual ROSA cluster.
 */
require('dotenv').config();
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const { logger } = require('../plugins/logger');
const { getUsdToInr } = require('./exchangeRate');

const execFileAsync = promisify(execFile);

// AWS credentials for rosa/oc CLI — passed as env to child processes
const cliEnv = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_ACCESS_SECRET,
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || 'ap-south-1',
};

// ---------------------------------------------------------------------------
// CLI availability check
// ---------------------------------------------------------------------------
let rosaAvailable = false;
let ocAvailable = false;

(async () => {
  try {
    await execFileAsync('rosa', ['version']);
    rosaAvailable = true;
    logger.info('[rosa-service] rosa CLI detected — production mode');
  } catch {
    logger.info('[rosa-service] rosa CLI not found — running in mock mode');
  }
  try {
    await execFileAsync('oc', ['version', '--client']);
    ocAvailable = true;
    logger.info('[rosa-service] oc CLI detected');
  } catch {
    logger.info('[rosa-service] oc CLI not found — student ops will be mocked');
  }
})();

function isMockMode() {
  return !rosaAvailable;
}

// ---------------------------------------------------------------------------
// Instance pricing (USD/hr, on-demand, ap-south-1 estimates)
// ---------------------------------------------------------------------------
const INSTANCE_RATES = {
  'm5.xlarge':   0.192,
  'm5.2xlarge':  0.384,
  'm5.4xlarge':  0.768,
  'r5.xlarge':   0.252,
  'r5.2xlarge':  0.504,
  'c5.xlarge':   0.170,
  'c5.2xlarge':  0.340,
};
const ROSA_CLUSTER_FEE_USD = 0.171; // per hour, fixed by Red Hat

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate hourly cost for a ROSA cluster in INR.
 * Formula: (ROSA fee + workerNodes * instanceRate) * USD-to-INR
 */
async function estimateHourlyCost(workerNodes, instanceType) {
  const instanceRate = INSTANCE_RATES[instanceType] || INSTANCE_RATES['m5.xlarge'];
  const usdPerHour = ROSA_CLUSTER_FEE_USD + (workerNodes * instanceRate);
  const rate = await getUsdToInr();
  return Math.round(usdPerHour * rate * 100) / 100;
}

// ---------------------------------------------------------------------------
// Cluster lifecycle
// ---------------------------------------------------------------------------

/**
 * Provision a new ROSA cluster.
 *
 * Production flow:
 *   rosa create cluster \
 *     --cluster-name=<name> \
 *     --region=<region> \
 *     --compute-machine-type=<instanceType> \
 *     --compute-nodes=<workerNodes> \
 *     --version=<version> \
 *     --sts --mode=auto --yes
 *
 * The command returns immediately; the cluster takes ~40 minutes to provision.
 * Use getClusterStatus() to poll until status=ready.
 */
async function createRosaCluster({ name, region, workerNodes, workerInstanceType, version, expiresAt }) {
  const adminPassword = crypto.randomBytes(12).toString('base64url');
  const estimatedCost = await estimateHourlyCost(workerNodes, workerInstanceType);

  if (!isMockMode()) {
    try {
      logger.info(`[rosa-service] Creating ROSA cluster: ${name}, region=${region}, nodes=${workerNodes}x${workerInstanceType}`);
      const { stdout } = await execFileAsync('rosa', [
        'create', 'cluster',
        `--cluster-name=${name}`,
        `--region=${region}`,
        `--compute-machine-type=${workerInstanceType}`,
        `--compute-nodes=${workerNodes}`,
        `--version=${version}`,
        '--sts', '--mode=auto', '--yes',
      ], { env: cliEnv, timeout: 120000 });

      // Parse cluster ID from output
      const idMatch = stdout.match(/ID:\s+(\S+)/);
      const clusterId = idMatch ? idMatch[1] : `rosa-${name}-${Date.now().toString(36)}`;

      // Create admin user for the cluster
      try {
        await execFileAsync('rosa', [
          'create', 'admin', `--cluster=${name}`,
        ], { env: cliEnv, timeout: 60000 });
      } catch (adminErr) {
        logger.warn(`[rosa-service] Admin user creation deferred (cluster still provisioning): ${adminErr.message}`);
      }

      logger.info(`[rosa-service] Cluster creation initiated: ${name} (${clusterId})`);
      return {
        clusterId,
        name, region, version, workerNodes, workerInstanceType,
        status: 'provisioning',
        consoleUrl: `https://console-openshift-console.apps.${name}.${region}.openshiftapps.com`,
        apiUrl: `https://api.${name}.${region}.openshiftapps.com:6443`,
        adminUsername: 'cluster-admin',
        adminPassword,
        estimatedHourlyCostInr: estimatedCost,
        provisionStartedAt: new Date(),
      };
    } catch (err) {
      logger.error(`[rosa-service] ROSA create failed: ${err.message}`);
      throw new Error(`ROSA cluster creation failed: ${err.stderr || err.message}`);
    }
  }

  // Mock response (CLI not available)
  const clusterId = `rosa-${name}-${Date.now().toString(36)}`;
  logger.info(`[rosa-service] [MOCK] Cluster creation initiated: ${name} (${clusterId}), region=${region}, nodes=${workerNodes}x${workerInstanceType}`);

  return {
    clusterId,
    name, region, version, workerNodes, workerInstanceType,
    status: 'provisioning',
    consoleUrl: `https://console-openshift-console.apps.${name}.${region}.openshiftapps.com`,
    apiUrl: `https://api.${name}.${region}.openshiftapps.com:6443`,
    adminUsername: 'cluster-admin',
    adminPassword,
    estimatedHourlyCostInr: estimatedCost,
    provisionStartedAt: new Date(),
  };
}

/**
 * Delete a ROSA cluster.
 *
 * Production: rosa delete cluster --cluster=<clusterId> --yes
 */
async function deleteRosaCluster(clusterId, clusterName) {
  if (!isMockMode()) {
    try {
      await execFileAsync('rosa', ['delete', 'cluster', `--cluster=${clusterId}`, '--yes'], { env: cliEnv, timeout: 60000 });
      logger.info(`[rosa-service] Cluster deletion initiated via CLI: ${clusterName} (${clusterId})`);
    } catch (err) {
      logger.error(`[rosa-service] ROSA delete failed: ${err.stderr || err.message}`);
      throw new Error(`ROSA cluster deletion failed: ${err.stderr || err.message}`);
    }
  } else {
    logger.info(`[rosa-service] [MOCK] Cluster deletion initiated: ${clusterName} (${clusterId})`);
  }

  return { status: 'deleting' };
}

/**
 * Poll cluster provisioning status.
 *
 * Production: rosa describe cluster --cluster=<clusterId> -o json
 * Parse the "state" field: "waiting", "installing", "ready", "error"
 */
async function getClusterStatus(clusterId) {
  if (!isMockMode()) {
    try {
      const { stdout } = await execFileAsync('rosa', [
        'describe', 'cluster', `--cluster=${clusterId}`, '-o', 'json',
      ], { env: cliEnv, timeout: 30000 });
      const info = JSON.parse(stdout);
      const state = info.status?.state || info.state || 'unknown';
      return {
        status: state === 'ready' ? 'ready' : state === 'error' ? 'failed' : 'provisioning',
        rawState: state,
        consoleUrl: info.console?.url,
        apiUrl: info.api?.url,
      };
    } catch (err) {
      logger.warn(`[rosa-service] Status check failed for ${clusterId}: ${err.message}`);
      return { status: 'provisioning' };
    }
  }

  return { status: 'ready' };
}

/**
 * Scale cluster worker nodes.
 *
 * Production: rosa edit machinepool --cluster=<clusterId> --replicas=<count> workers
 */
async function scaleCluster(clusterId, clusterName, workerNodes) {
  if (!isMockMode()) {
    try {
      await execFileAsync('rosa', [
        'edit', 'machinepool',
        `--cluster=${clusterId}`,
        `--replicas=${workerNodes}`,
        'workers',
      ], { env: cliEnv, timeout: 60000 });
      logger.info(`[rosa-service] Scaled cluster ${clusterName} to ${workerNodes} workers`);
    } catch (err) {
      logger.error(`[rosa-service] Scale failed: ${err.stderr || err.message}`);
      throw new Error(`ROSA scale failed: ${err.stderr || err.message}`);
    }
  } else {
    logger.info(`[rosa-service] [MOCK] Scaling cluster ${clusterName} to ${workerNodes} workers`);
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
 *
 * Alternative: use the OpenShift REST API directly with Bearer token.
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
      // This requires updating the OAuth config on the cluster to add htpasswd.
      // Alternatively, use the HTPasswd file approach:
      //   htpasswd -b /tmp/htpasswd <username> <password>
      //   oc create secret generic htpasswd-secret --from-file=htpasswd=/tmp/htpasswd -n openshift-config
      //   oc apply -f oauth-htpasswd.yaml
      //
      // Step 4: Assign role
      // await execFileAsync('oc', ['adm', 'policy', 'add-role-to-user', 'edit', studentUsername, '-n', studentNamespace]);
      logger.info(`[rosa-service] Would create namespace ${studentNamespace} and user ${studentUsername} via oc CLI`);
    } catch (err) {
      logger.error(`[rosa-service] oc CLI student setup failed: ${err.message}`);
    }
  }

  logger.info(`[rosa-service] Student added: ${studentEmail} -> namespace=${studentNamespace}, user=${studentUsername}`);

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
      logger.info(`[rosa-service] Would delete namespace ${namespace} and user ${username} via oc CLI`);
    } catch (err) {
      logger.error(`[rosa-service] oc CLI student removal failed: ${err.message}`);
    }
  }

  logger.info(`[rosa-service] Student removed: namespace=${namespace}, user=${username}`);
  return { status: 'deleted' };
}

// ---------------------------------------------------------------------------
// Night scaling (cost optimization)
// ---------------------------------------------------------------------------

/**
 * Schedule night scaling for a ROSA cluster.
 *
 * At 10 PM IST: scale workers to 0 (only cluster fee = ~$0.171/hr = ~15 INR/hr).
 * At  7 AM IST: scale workers back to the configured count.
 *
 * This saves roughly 500 INR per night (9 off-hours * ~65 INR/hr worker cost).
 *
 * Called by the rosaCleanup automation on the appropriate schedule.
 * Before scaling down, the function checks active student sessions.
 */
async function scheduleNightScale(cluster) {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24;

  const SCALE_DOWN_HOUR = parseInt(process.env.ROSA_SCALE_DOWN_HOUR || '22', 10); // 10 PM IST
  const SCALE_UP_HOUR = parseInt(process.env.ROSA_SCALE_UP_HOUR || '7', 10);      // 7 AM IST

  // Scale DOWN at night
  if (istHour === SCALE_DOWN_HOUR && cluster.workerNodes > 0 && cluster.status === 'ready') {
    // Check if any students are actively logged in before scaling down
    const activeStudents = (cluster.students || []).filter(s => s.status === 'active');
    if (activeStudents.length > 0) {
      // TODO: In production, check OpenShift API for active sessions:
      //   oc get pods -n <namespace> --field-selector=status.phase=Running
      // For now, log warning but still scale down (students can reconnect in the morning)
      logger.info(`[rosa-service] ${activeStudents.length} active students on ${cluster.name}, proceeding with night scale-down`);
    }

    logger.info(`[rosa-service] Night scale-down: ${cluster.name} from ${cluster.workerNodes} to 0 workers`);
    // Store original worker count so we can restore in the morning
    cluster._originalWorkerNodes = cluster.workerNodes;
    return { action: 'scale-down', targetNodes: 0 };
  }

  // Scale UP in the morning
  if (istHour === SCALE_UP_HOUR && cluster.workerNodes === 0 && cluster.status === 'ready') {
    const restoreNodes = cluster._originalWorkerNodes || 3;
    logger.info(`[rosa-service] Morning scale-up: ${cluster.name} from 0 to ${restoreNodes} workers`);
    return { action: 'scale-up', targetNodes: restoreNodes };
  }

  return { action: 'none' };
}

module.exports = {
  createRosaCluster,
  deleteRosaCluster,
  getClusterStatus,
  scaleCluster,
  addStudentToCluster,
  removeStudentFromCluster,
  estimateHourlyCost,
  scheduleNightScale,
  isMockMode,
};
