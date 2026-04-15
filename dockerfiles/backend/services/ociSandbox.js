/**
 * OCI Sandbox Service — creates and deletes OCI compartments, users, and policies
 * for student sandbox environments.
 *
 * Uses oci-sdk if available, otherwise returns mock data so the flow works
 * without OCI credentials during development.
 */
require('dotenv').config();
const { logger } = require('../plugins/logger');
const crypto = require('crypto');

let ociSdkAvailable = false;
let identity, common;
try {
  identity = require('oci-identity');
  common = require('oci-common');
  ociSdkAvailable = true;
} catch {
  logger.warn('oci-sdk not installed — OCI sandbox service will return mock data');
}

// Cached converted key content
let _rsaKeyContent = null;

function getProvider() {
  const tenancyId = process.env.OCI_TENANCY_OCID;
  const userId = process.env.OCI_USER_OCID;
  const fingerprint = process.env.OCI_FINGERPRINT;
  const privateKeyBase64 = process.env.OCI_PRIVATE_KEY;
  const region = process.env.OCI_REGION || 'ap-hyderabad-1';

  if (!tenancyId || !userId || !fingerprint || !privateKeyBase64) {
    return null;
  }

  // Convert key once and cache
  if (!_rsaKeyContent) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    let pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

    // OCI SDK needs PKCS#1 (RSA). OCI Console generates PKCS#8. Convert.
    if (pem.includes('BEGIN PRIVATE KEY') && !pem.includes('BEGIN RSA PRIVATE KEY')) {
      try {
        const { execSync } = require('child_process');
        const inPath = path.join(os.tmpdir(), '.oci_pk8.pem');
        const outPath = path.join(os.tmpdir(), '.oci_rsa.pem');
        fs.writeFileSync(inPath, pem, { mode: 0o600 });
        execSync(`openssl rsa -in "${inPath}" -out "${outPath}" -traditional 2>/dev/null`);
        pem = fs.readFileSync(outPath, 'utf8');
        fs.unlinkSync(inPath);
        fs.unlinkSync(outPath);
        logger.info('[oci-service] Converted PKCS#8 key to PKCS#1 (RSA) format');
      } catch (e) {
        logger.warn('[oci-service] Key conversion failed, using original: ' + e.message);
      }
    }
    _rsaKeyContent = pem;
  }

  const provider = new common.SimpleAuthenticationDetailsProvider(
    tenancyId,
    userId,
    fingerprint,
    _rsaKeyContent,
    null,
    common.Region.fromRegionId(region)
  );

  return provider;
}

/**
 * Create an OCI sandbox: compartment + IAM user + policy.
 *
 * @param {string} compartmentName - Name for the student compartment
 * @param {string} region - OCI region identifier
 * @param {string} email - Student email (used for username generation)
 * @returns {{ compartmentId, userId, username, password, accessUrl, policyId }}
 */
async function createOciSandbox(compartmentName, region, email) {
  const ociRegion = region || process.env.OCI_REGION || 'ap-hyderabad-1';
  const parentCompartmentId = process.env.OCI_PARENT_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID;
  const tenancyId = process.env.OCI_TENANCY_OCID;

  if (!ociSdkAvailable || !getProvider()) {
    // Return mock data so the rest of the flow works without OCI credentials
    logger.warn('OCI SDK not configured — returning mock sandbox data');
    const mockId = crypto.randomBytes(8).toString('hex');
    const cleanName = (email || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 15);
    const username = `sb-${cleanName}-${Date.now().toString(36).slice(-4)}`;
    const password = `Oci${crypto.randomBytes(4).toString('hex')}!1`;

    return {
      compartmentId: `ocid1.compartment.oc1..mock${mockId}`,
      userId: `ocid1.user.oc1..mock${mockId}`,
      username,
      password,
      accessUrl: `https://cloud.oracle.com/?region=${ociRegion}`,
      policyId: `ocid1.policy.oc1..mock${mockId}`,
    };
  }

  const provider = getProvider();
  const identityClient = new identity.IdentityClient({ authenticationDetailsProvider: provider });

  // 1. Create compartment under the parent compartment
  logger.info(`Creating OCI compartment: ${compartmentName}`);
  const compartmentResponse = await identityClient.createCompartment({
    createCompartmentDetails: {
      compartmentId: parentCompartmentId,
      name: compartmentName,
      description: `Sandbox compartment for ${email}`,
    },
  });
  const compartmentId = compartmentResponse.compartment.id;
  logger.info(`OCI compartment created: ${compartmentId}`);

  // 2. Create IAM user
  const cleanName = (email || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 15);
  const username = `sb-${cleanName}-${Date.now().toString(36).slice(-4)}`;
  const password = `Oci${crypto.randomBytes(4).toString('hex')}!1`;

  logger.info(`Creating OCI user: ${username}`);
  const userResponse = await identityClient.createUser({
    createUserDetails: {
      compartmentId: tenancyId,
      name: username,
      description: `Sandbox user for ${email}`,
      email: email,
    },
  });
  const userId = userResponse.user.id;
  logger.info(`OCI user created: ${userId}`);

  // 3. Create UI password — OCI generates the password, we capture it
  let actualPassword = password;
  try {
    const pwResponse = await identityClient.createOrResetUIPassword({ userId });
    actualPassword = pwResponse.uIPassword?.password || password;
    logger.info(`OCI UI password created for user ${username}`);
  } catch (e) {
    logger.error(`OCI UI password creation failed: ${e.message}`);
  }

  // 4. Create policy scoping user to their compartment
  // Wait for compartment to propagate in OCI (eventual consistency)
  await new Promise(resolve => setTimeout(resolve, 5000));

  const policyName = `sandbox-policy-${compartmentName}`;
  const policyStatements = [
    `Allow any-user to manage all-resources in compartment id ${compartmentId} where request.user.name='${username}'`,
  ];

  logger.info(`Creating OCI policy: ${policyName}`);
  const policyResponse = await identityClient.createPolicy({
    createPolicyDetails: {
      compartmentId: tenancyId,
      name: policyName,
      description: `Sandbox policy for ${email}`,
      statements: policyStatements,
    },
  });
  const policyId = policyResponse.policy.id;
  logger.info(`OCI policy created: ${policyId}`);

  const accessUrl = `https://cloud.oracle.com/?region=${ociRegion}`;

  return {
    compartmentId,
    userId,
    username,
    password: actualPassword,
    accessUrl,
    policyId,
  };
}

/**
 * Delete an OCI sandbox: user + policy + compartment.
 *
 * @param {string} compartmentId - OCID of the compartment to delete
 * @param {string} userId - OCID of the IAM user to delete
 * @param {string} policyId - OCID of the policy to delete
 */
async function deleteOciSandbox(compartmentId, userId, policyId) {
  if (!ociSdkAvailable || !getProvider()) {
    logger.warn('OCI SDK not configured — skipping OCI resource deletion (mock mode)');
    return;
  }

  const provider = getProvider();
  const identityClient = new identity.IdentityClient({ authenticationDetailsProvider: provider });

  // 1. Delete user
  if (userId) {
    try {
      await identityClient.deleteUser({ userId });
      logger.info(`OCI user deleted: ${userId}`);
    } catch (e) {
      logger.error(`OCI user deletion failed (${userId}): ${e.message}`);
    }
  }

  // 2. Delete policy
  if (policyId) {
    try {
      await identityClient.deletePolicy({ policyId });
      logger.info(`OCI policy deleted: ${policyId}`);
    } catch (e) {
      logger.error(`OCI policy deletion failed (${policyId}): ${e.message}`);
    }
  }

  // 3. Delete compartment (OCI will fail if compartment is not empty;
  //    in production, resources should be cleaned up first)
  if (compartmentId) {
    try {
      await identityClient.deleteCompartment({ compartmentId });
      logger.info(`OCI compartment deleted: ${compartmentId}`);
    } catch (e) {
      logger.error(`OCI compartment deletion failed (${compartmentId}): ${e.message}`);
    }
  }
}

module.exports = { createOciSandbox, deleteOciSandbox };
