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
    // P2-17: in production (OCI_TENANCY_OCID set) the mock-mode fallback is
    // a silent footgun — it succeeds the create flow, persists fake OCIDs,
    // and the resulting sandbox doc is unusable. Fail loudly instead so an
    // SDK/credential regression is obvious.
    if (process.env.OCI_TENANCY_OCID) {
      throw new Error('OCI provider failed to initialise in production: SDK unavailable or credentials invalid (OCI_TENANCY_OCID set, but provider could not be built)');
    }
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
  // Set password on the IDENTITY DOMAIN side (the auth surface used by
  // Console login). Legacy createOrResetUIPassword sets a password on the
  // IAM identity, which does NOT propagate to Identity Domains — so we'd
  // get an "Invalid username" on Console. Modern tenancies route Console
  // login through IDCS, so we must call putUserPasswordChanger on the
  // domain user. The legacy IAM password is left untouched (only matters
  // for `oci` CLI auth, which sandbox students don't use).
  let actualPassword = password; // already strong (matches IDCS policy)
  try {
    const idd = require('oci-identitydomains');
    const iddClient = new idd.IdentityDomainsClient({ authenticationDetailsProvider: provider });
    const domainEndpoint = (process.env.OCI_IDCS_URL || '').replace(/\/+$/, '');
    if (!domainEndpoint) throw new Error('OCI_IDCS_URL env var not set — needed for Identity Domains password reset');
    iddClient.endpoint = domainEndpoint;

    // Newly-created IAM user gets auto-mirrored to the default Identity
    // Domain, but propagation can take a few seconds. Poll up to ~15s.
    let domainUser = null;
    for (let i = 0; i < 5; i++) {
      const search = await iddClient.listUsers({ filter: `userName eq "${username}"`, limit: 1 });
      const items = search.users?.Resources || search.users?.resources || [];
      if (items.length) { domainUser = items[0]; break; }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!domainUser) {
      logger.warn(`OCI domain user not found yet for ${username} — Console login may fail until manually reset`);
    } else {
      await iddClient.putUserPasswordChanger({
        userPasswordChangerId: domainUser.id,
        userPasswordChanger: {
          schemas: ['urn:ietf:params:scim:schemas:oracle:idcs:UserPasswordChanger'],
          password: actualPassword,
        },
      });
      logger.info(`OCI domain password set for ${username} (id=${domainUser.id})`);
    }
  } catch (e) {
    logger.error(`OCI domain password setter failed for ${username}: ${e.message}`);
    // Fall back to legacy IAM UI password so something still gets set
    try {
      const pwResponse = await identityClient.createOrResetUIPassword({ userId });
      actualPassword = pwResponse.uIPassword?.password || password;
      logger.warn(`Fell back to legacy IAM password for ${username} — Console login may not work`);
    } catch (e2) {
      logger.error(`OCI UI password creation also failed: ${e2.message}`);
    }
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

// Grant the OAC ServiceAdministrator app role on the analytics-instance app to a
// freshly-created Identity Domain user. createOciSandbox provisions the user
// but does not assign any OAC role, so without this the user can authenticate
// against IDCS but lands on a permissions wall inside Oracle Analytics.
//
// Looks up the OAC analytics-instance app dynamically (serviceTypeURN
// ANALYTICSINST, non-alias, ending in _APPID, excluding the
// SERVICE_INSTANCE_ADMIN_APPID alias). If multiple OAC instances ever coexist
// in the same domain this picks the first match — revisit then.
async function grantOacServiceAdminByUsername(username) {
  const idcsUrl = (process.env.OCI_IDCS_URL || '').replace(/\/+$/, '');
  const clientId = process.env.OCI_IDCS_CLIENT_ID;
  const clientSecret = process.env.OCI_IDCS_CLIENT_SECRET;
  if (!idcsUrl || !clientId || !clientSecret) {
    throw new Error('OCI_IDCS_URL/CLIENT_ID/CLIENT_SECRET not configured');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch(`${idcsUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=urn:opc:idm:__myscopes__',
  });
  if (!tokenRes.ok) throw new Error(`IDCS token: ${tokenRes.status} ${await tokenRes.text()}`);
  const token = (await tokenRes.json()).access_token;
  const auth = { 'Authorization': `Bearer ${token}` };

  const userQ = await fetch(`${idcsUrl}/admin/v1/Users?filter=${encodeURIComponent(`userName eq "${username}"`)}&attributes=id`, { headers: auth });
  const userJson = await userQ.json();
  const userId = userJson.Resources?.[0]?.id;
  if (!userId) throw new Error(`IDCS user not found: ${username}`);

  const appQ = await fetch(`${idcsUrl}/admin/v1/Apps?filter=${encodeURIComponent('serviceTypeURN eq "ANALYTICSINST" and isAliasApp eq false')}&attributes=id,name`, { headers: auth });
  const appJson = await appQ.json();
  const oacApp = (appJson.Resources || []).find(a => /APPID$/.test(a.name) && !/SERVICE_INSTANCE_ADMIN_APPID/.test(a.name));
  if (!oacApp) throw new Error('OAC analytics instance app not found in IDCS');

  const roleQ = await fetch(`${idcsUrl}/admin/v1/AppRoles?filter=${encodeURIComponent(`app.value eq "${oacApp.id}" and displayName eq "ServiceAdministrator"`)}&attributes=id`, { headers: auth });
  const roleJson = await roleQ.json();
  const roleId = roleJson.Resources?.[0]?.id;
  if (!roleId) throw new Error('ServiceAdministrator role not found on OAC app');

  const grantRes = await fetch(`${idcsUrl}/admin/v1/Grants`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/scim+json' },
    body: JSON.stringify({
      schemas: ['urn:ietf:params:scim:schemas:oracle:idcs:Grant'],
      grantee: { value: userId, type: 'User' },
      app: { value: oacApp.id },
      entitlement: { attributeName: 'appRoles', attributeValue: roleId },
      grantMechanism: 'ADMINISTRATOR_TO_USER',
    }),
  });
  if (!grantRes.ok) throw new Error(`grant: ${grantRes.status} ${await grantRes.text()}`);
}

module.exports = { createOciSandbox, deleteOciSandbox, grantOacServiceAdminByUsername };
