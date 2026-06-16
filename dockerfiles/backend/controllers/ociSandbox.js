const { logger } = require('./../plugins/logger');
const OciSandboxUser = require('./../models/ociSandboxUser');
const SandboxTemplate = require('./../models/sandboxTemplate');
const User = require('./../models/user');
const { createOciSandbox, deleteOciSandbox, grantOacServiceAdminByUsername } = require('./../services/ociSandbox');
const { notifySandboxWelcomeEmail } = require('./../services/emailNotifications');

// ─── IDCS access-token helper (for OAC provisioning) ───────────────────
// OAC's CreateAnalyticsInstance API requires an `idcsAccessToken` to bind
// the new instance to a federated IDCS identity. We fetch one via OAuth2
// client_credentials grant against the tenancy's Identity Domain endpoint.
//
// Required env vars:
//   OCI_IDCS_URL           — e.g. https://idcs-xxxxx.identity.oraclecloud.com
//                             (or the Identity Domain URL for newer tenancies)
//   OCI_IDCS_CLIENT_ID     — Confidential App client_id from IDCS
//   OCI_IDCS_CLIENT_SECRET — same app's client_secret
//
// The Confidential App must have "Client Credentials" grant enabled and
// hold an admin role (e.g. Identity Domain Administrator) so OAC accepts
// the token as authorized to provision instances.
async function getIdcsAccessToken() {
  const idcsUrl = process.env.OCI_IDCS_URL;
  const clientId = process.env.OCI_IDCS_CLIENT_ID;
  const clientSecret = process.env.OCI_IDCS_CLIENT_SECRET;
  if (!idcsUrl || !clientId || !clientSecret) {
    throw new Error('IDCS env vars missing — set OCI_IDCS_URL, OCI_IDCS_CLIENT_ID, OCI_IDCS_CLIENT_SECRET in backend .env');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `${idcsUrl.replace(/\/+$/, '')}/oauth2/v1/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=urn:opc:idm:__myscopes__',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`IDCS token fetch failed: HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error(`IDCS token response had no access_token: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

// USER-context token via OAuth2 Resource Owner Password Credentials.
// Required by OAC's createAnalyticsInstance — it rejects app-context tokens
// (sub_type=client) issued by the client_credentials helper above.
//
// Service user creds:
//   OCI_OAC_PROVISIONER_USER     — e.g. oac-provisioner@... (username field in IDCS)
//   OCI_OAC_PROVISIONER_PASSWORD — set via SCIM putUserPasswordChanger
//
// The IDCS Confidential App must have BOTH grant types enabled (Client
// Credentials + Resource Owner) for this to succeed.
async function getIdcsUserAccessToken() {
  const idcsUrl = process.env.OCI_IDCS_URL;
  const clientId = process.env.OCI_IDCS_CLIENT_ID;
  const clientSecret = process.env.OCI_IDCS_CLIENT_SECRET;
  const username = process.env.OCI_OAC_PROVISIONER_USER;
  const password = process.env.OCI_OAC_PROVISIONER_PASSWORD;
  if (!idcsUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error('OAC ROPC env vars missing — set OCI_OAC_PROVISIONER_USER and OCI_OAC_PROVISIONER_PASSWORD in backend .env');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `${idcsUrl.replace(/\/+$/, '')}/oauth2/v1/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope: 'urn:opc:idm:__myscopes__',
  }).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`IDCS user token fetch failed: HTTP ${res.status} — ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error(`IDCS user token response had no access_token: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

async function handleGetOciUsers(req, res) {
    try {
        const { userType, organization } = req.user || {};
        if (userType !== 'superadmin' && userType !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
        const filter = { status: { $ne: 'deleted' } };
        if (userType === 'admin') filter.organization = organization;
        else if (userType === 'superadmin' && req.query.organization) filter.organization = req.query.organization;
        const users = await OciSandboxUser.find(filter).sort({ createdAt: -1 }).lean();
        res.json(users || []);
    } catch (err) {
        logger.error('OCI sandbox get users error:', err.message);
        res.status(500).json({ message: 'Internal server error' });
    }
}

async function handleBulkDeployOci(req, res) {
    try {
        if (req.user.userType !== 'superadmin' && req.user.userType !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        const { templateSlug, emails, ttlHours, dailyCapHours = 12, totalCapHours = 0 } = req.body;
        if (!templateSlug) return res.status(400).json({ message: 'templateSlug required' });
        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ message: 'emails array required' });
        }
        if (req.user.userType === 'admin' && emails.length > 200) {
            return res.status(400).json({ message: `Batch size of ${emails.length} exceeds the 200-student cap for admin role.` });
        }
        // admin is locked to their own org; superadmin may target any org via body
        const targetOrg = req.user.userType === 'superadmin' && req.body.organization
            ? req.body.organization
            : req.user.organization;
        if (!ttlHours || ttlHours < 1) return res.status(400).json({ message: 'ttlHours required (minimum 1)' });

        const template = await SandboxTemplate.findOne({ slug: templateSlug, isActive: true, cloud: 'oci' });
        if (!template) return res.status(404).json({ message: 'OCI template not found' });

        // Org-template entitlement: auto-associate for superadmin; clear 403 for admin.
        const { ensureTemplateAssociation } = require('../services/orgTemplateAssociation');
        const _assoc = await ensureTemplateAssociation({ targetOrg, templateSlug, userType: req.user.userType, adminEmail: req.user.email });
        if (!_assoc.ok) return res.status(_assoc.status).json({ message: _assoc.error });

        const results = [];

        for (const email of emails) {
            const trimmed = email.trim().toLowerCase();
            if (!trimmed) continue;

            try {
                // Generate a unique compartment name
                const randSuffix = Math.random().toString(36).slice(2, 6);
                const certCode = (template.certificationCode || 'oci').toLowerCase();
                const compartmentName = `lab-${certCode}-${randSuffix}-${Date.now().toString(36)}`.slice(0, 30);

                const region = template.sandboxConfig?.region || process.env.OCI_REGION || 'ap-mumbai-1';

                // Create OCI compartment + user + policy
                const ociResult = await createOciSandbox(compartmentName, region, trimmed);

                // Grant OAC ServiceAdministrator so the student actually has
                // data access inside Oracle Analytics — createOciSandbox
                // provisions the IDCS user but does not assign any OAC role.
                try {
                    await grantOacServiceAdminByUsername(ociResult.username);
                } catch (e) {
                    logger.warn(`[bulk-deploy-oci] OAC role grant failed for ${ociResult.username}: ${e.message}`);
                }

                const expiresAt = req.body.expiresAt
                    ? new Date(req.body.expiresAt)
                    : new Date(Date.now() + ttlHours * 60 * 60 * 1000);

                // Upsert user record
                let user = await OciSandboxUser.findOne({ email: trimmed });
                if (user) {
                    // Update existing user with new sandbox details
                    user.compartmentId = ociResult.compartmentId;
                    user.compartmentName = compartmentName;
                    user.userId = ociResult.userId;
                    user.username = ociResult.username;
                    user.password = ociResult.password;
                    user.policyId = ociResult.policyId;
                    user.region = region;
                    user.accessUrl = ociResult.accessUrl;
                    user.expiresAt = expiresAt;
                    if (req.body.batchExpiresAt) user.batchExpiresAt = new Date(req.body.batchExpiresAt);
                    user.organization = targetOrg;
                    user.status = 'active';
                } else {
                    user = new OciSandboxUser({
                        email: trimmed,
                        organization: targetOrg,
                        compartmentId: ociResult.compartmentId,
                        compartmentName,
                        userId: ociResult.userId,
                        username: ociResult.username,
                        password: ociResult.password,
                        policyId: ociResult.policyId,
                        region,
                        accessUrl: ociResult.accessUrl,
                        duration: Math.ceil(ttlHours / 24) || 1,
                        sandboxTtlHours: ttlHours,
                        startDate: new Date(),
                        endDate: expiresAt,
                        expiresAt,
                        batchExpiresAt: req.body.batchExpiresAt ? new Date(req.body.batchExpiresAt) : null,
                        templateId: template._id,
                        allowedServices: (template.allowedServices || []).map(s => ({
                            service: s.service, category: s.category, restrictions: s.restrictions,
                        })),
                        blockedServices: (template.blockedServices || []).map(s => ({
                            service: s.service, reason: s.reason,
                        })),
                    });
                }

                user.dailyCapHours = dailyCapHours;
                user.totalCapHours = totalCapHours;
                user.usageSessions.push({ startedAt: new Date(), ttlHours, templateSlug });
                await user.save();

                // Auto-create portal login for the student
                const existingPortalUser = await User.findOne({ email: trimmed });
                if (!existingPortalUser) {
                    await User.create({
                        email: trimmed, name: trimmed,
                        password: 'Welcome1234!',
                        userType: 'sandboxuser',
                        organization: template.name,
                    });
                    logger.info(`[bulk-deploy-oci] Portal user created for ${trimmed}`);
                }

                // Send welcome email (non-blocking)
                notifySandboxWelcomeEmail({
                    email: trimmed, cloud: 'oci', portalPassword: 'Welcome1234!',
                    sandboxUsername: ociResult.username, sandboxPassword: ociResult.password,
                    sandboxAccessUrl: ociResult.accessUrl, region,
                    expiresAt, templateName: template.name,
                    allowedServices: template.allowedServices,
                    blockedServices: template.blockedServices,
                    compartmentName,
                }).catch(e => logger.error(`Welcome email failed for ${trimmed}: ${e.message}`));

                results.push({
                    email: trimmed,
                    compartmentId: ociResult.compartmentId,
                    compartmentName,
                    username: ociResult.username,
                    password: ociResult.password,
                    status: 'success',
                    accessUrl: ociResult.accessUrl,
                    expiresAt,
                });

                logger.info(`[bulk-deploy-oci] deployed ${compartmentName} for ${trimmed}`);
            } catch (err) {
                results.push({
                    email: trimmed,
                    status: 'failed',
                    error: err.message,
                });
                logger.error(`[bulk-deploy-oci] failed for ${trimmed}: ${err.message}`);
            }
        }

        const succeeded = results.filter(r => r.status === 'success').length;
        const failed = results.filter(r => r.status === 'failed').length;

        res.json({
            message: `Bulk deploy complete: ${succeeded} succeeded, ${failed} failed`,
            templateName: template.name,
            total: results.length,
            succeeded,
            failed,
            results,
        });
    } catch (err) {
        logger.error('Bulk deploy OCI error:', err.message);
        res.status(500).json({ message: `Bulk deploy failed: ${err.message}` });
    }
}

async function handleDeleteOciUser(req, res) {
    try {
        if (req.user.userType !== 'superadmin' && req.user.userType !== 'admin') {
            return res.status(403).send('Unauthorized');
        }

        const { id } = req.params;
        if (!id) return res.status(400).json({ message: 'id required' });

        const user = await OciSandboxUser.findById(id);
        if (!user) return res.status(404).json({ message: 'OCI sandbox user not found' });

        // 1. Mark as deleting before starting cleanup
        user.deletionStatus = 'deleting';
        await user.save();

        // 2. Respond immediately so frontend can poll
        res.json({ message: 'OCI sandbox user deletion started', email: user.email });

        // 3. Perform cloud cleanup in background
        try {
            await deleteOciSandbox(user.compartmentId, user.userId, user.policyId);

            // On success: mark as deleted
            user.status = 'deleted';
            user.deletionStatus = 'none';
            await user.save();

            logger.info(`OCI sandbox user deleted: ${user.email}`);
        } catch (cleanupErr) {
            // On failure: mark as failed, keep the record
            logger.error(`OCI resource cleanup failed for ${user.email}: ${cleanupErr.message}`);
            await OciSandboxUser.updateOne({ _id: id }, { $set: { deletionStatus: 'failed' } });
        }
    } catch (err) {
        logger.error('OCI sandbox delete user error:', err.message);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
}

// =============================================================================
// OAC Shared Instance Management
// =============================================================================

// In-memory tracker for OAC instances (persists across requests, lost on restart).
// Each entry is org-tagged so org-admins only see/manage their own org's batches.
const oacInstances = new Map();

// Tenant scope helper for OAC handlers.
function _oacOrgScope(req) {
    return req.user?.userType === 'superadmin' ? null : (req.user?.organization || null);
}

async function handleOacList(req, res) {
    try {
        if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') return res.status(403).json({ message: 'Unauthorized' });
        const scopeOrg = _oacOrgScope(req);
        const all = Array.from(oacInstances.values());
        const filtered = scopeOrg ? all.filter(i => i.organization === scopeOrg) : all;
        res.json(filtered);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

async function handleOacProvision(req, res) {
    try {
        if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') return res.status(403).json({ message: 'Unauthorized' });

        const { batchName, ocpus = 2 } = req.body;
        if (!batchName) return res.status(400).json({ message: 'batchName required' });
        if (oacInstances.has(batchName)) return res.status(400).json({ message: `Batch "${batchName}" already exists` });

        // Tag the batch with caller's organization for tenant isolation.
        const ownerOrg = req.user?.organization || null;

        // Mark as provisioning immediately
        oacInstances.set(batchName, {
            batchName,
            organization: ownerOrg,
            createdBy: req.user?.email,
            status: 'provisioning',
            ocpus,
            startedAt: new Date().toISOString(),
            oacUrl: null,
            compartmentId: null,
        });

        res.json({ message: `OAC provisioning started for "${batchName}". This takes ~20 minutes.`, status: 'provisioning' });

        // Provision in background
        (async () => {
            try {
                let ociIdentity, ociCommon, ociAnalytics;
                try {
                    ociIdentity = require('oci-identity');
                    ociCommon = require('oci-common');
                    ociAnalytics = require('oci-analytics');
                } catch {
                    throw new Error('oci-sdk not installed');
                }

                const { getProvider } = require('./../services/ociSandbox');
                let provider;
                try {
                    // Try to use exported getProvider
                    provider = typeof getProvider === 'function' ? getProvider() : null;
                } catch {}

                if (!provider) {
                    // Build provider directly
                    const fs = require('fs');
                    const os = require('os');
                    const path = require('path');
                    const { execSync } = require('child_process');
                    let pem = Buffer.from(process.env.OCI_PRIVATE_KEY, 'base64').toString('utf8');
                    if (pem.includes('BEGIN PRIVATE KEY') && !pem.includes('BEGIN RSA PRIVATE KEY')) {
                        const inPath = path.join(os.tmpdir(), '.oci_pk8_oac.pem');
                        const outPath = path.join(os.tmpdir(), '.oci_rsa_oac.pem');
                        fs.writeFileSync(inPath, pem, { mode: 0o600 });
                        try {
                            execSync(`openssl rsa -in "${inPath}" -out "${outPath}" -traditional 2>/dev/null`);
                            pem = fs.readFileSync(outPath, 'utf8');
                        } catch {}
                        try { fs.unlinkSync(inPath); } catch {}
                        try { fs.unlinkSync(outPath); } catch {}
                    }
                    provider = new ociCommon.SimpleAuthenticationDetailsProvider(
                        process.env.OCI_TENANCY_OCID,
                        process.env.OCI_USER_OCID,
                        process.env.OCI_FINGERPRINT,
                        pem, null,
                        ociCommon.Region.fromRegionId(process.env.OCI_REGION || 'ap-hyderabad-1')
                    );
                }

                const identityClient = new ociIdentity.IdentityClient({ authenticationDetailsProvider: provider });
                const analyticsClient = new ociAnalytics.AnalyticsClient({ authenticationDetailsProvider: provider });
                const parentCompartmentId = process.env.OCI_PARENT_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID;
                // Random suffix so a retry doesn't collide with a still-purging
                // compartment from a prior failed attempt (OCI compartments take
                // a few minutes to fully delete after the API accepts the request)
                const suffix = Math.random().toString(36).slice(2, 6);
                const compartmentName = `oac-lab-${batchName}-${suffix}`.slice(0, 100);

                // 1. Create compartment
                const compResp = await identityClient.createCompartment({
                    createCompartmentDetails: {
                        compartmentId: parentCompartmentId,
                        name: compartmentName,
                        description: `OAC lab — ${batchName}`,
                    },
                });
                var compartmentId = compResp.compartment.id;
                // Track the compartmentId in the in-memory map immediately so a
                // failure after this point can be cleaned up by the destroy button
                oacInstances.set(batchName, { ...oacInstances.get(batchName), compartmentId, compartmentName });
                logger.info(`[oac] Compartment created: ${compartmentId}`);

                // Wait for compartment to become visible at parent scope before creating
                // a policy that references it (compartments are eventually consistent).
                await new Promise(r => setTimeout(r, 10000));

                // Grant sandbox students permission to USE the analytics instance
                // in this compartment. Without this, when students navigate to OCI
                // Console with their sandbox creds, they get "Authorization failed"
                // because their per-user policy is scoped to their OWN compartment.
                // We restrict to usernames starting with 'sb-' so non-sandbox identities
                // don't pick up cross-compartment access.
                try {
                    const tenancyId = process.env.OCI_TENANCY_OCID;
                    const policyName = `oac-student-access-${batchName}-${suffix}`.slice(0, 99);
                    await identityClient.createPolicy({
                        createPolicyDetails: {
                            compartmentId: tenancyId,
                            name: policyName,
                            description: `Student access to shared OAC instance for batch ${batchName}`,
                            statements: [
                                `Allow any-user to use analytics-instances in compartment ${compartmentName}`,
                                `Allow any-user to read all-resources in compartment ${compartmentName}`,
                            ],
                        },
                    });
                    logger.info(`[oac] Student-access policy created: ${policyName}`);
                } catch (polErr) {
                    logger.warn(`[oac] student-access policy creation failed: ${polErr.message}`);
                }

                await new Promise(r => setTimeout(r, 30000)); // wait for propagation

                // 2. Fetch USER-context IDCS token (OAC requires sub_type=user;
                // app-context client_credentials tokens are rejected with OAC-DAL-001041).
                logger.info(`[oac] fetching IDCS user-context access token for ${batchName}`);
                const idcsAccessToken = await getIdcsUserAccessToken();

                // 3. Provision OAC
                await analyticsClient.createAnalyticsInstance({
                    createAnalyticsInstanceDetails: {
                        name: `oaclab${batchName.replace(/[^a-z0-9]/gi, '')}`.slice(0, 30),
                        compartmentId,
                        featureSet: 'ENTERPRISE_ANALYTICS',
                        capacity: { capacityType: 'OLPU_COUNT', capacityValue: ocpus },
                        licenseType: 'LICENSE_INCLUDED',
                        description: `Training batch: ${batchName}`,
                        networkEndpointDetails: { networkEndpointType: 'PUBLIC' },
                        idcsAccessToken,
                    },
                });

                // 3. Poll for active
                let oacUrl = null;
                for (let i = 0; i < 40; i++) {
                    await new Promise(r => setTimeout(r, 30000));
                    const instances = await analyticsClient.listAnalyticsInstances({ compartmentId });
                    const inst = instances.items?.find(x => x.lifecycleState === 'ACTIVE');
                    if (inst) {
                        oacUrl = inst.serviceUrl;
                        oacInstances.set(batchName, {
                            batchName, status: 'active', ocpus, oacUrl, compartmentId, compartmentName,
                            oacInstanceId: inst.id,
                            startedAt: oacInstances.get(batchName)?.startedAt,
                            activeAt: new Date().toISOString(),
                        });
                        logger.info(`[oac] Instance active: ${oacUrl}`);
                        return;
                    }
                }
                oacInstances.set(batchName, { ...oacInstances.get(batchName), status: 'failed', error: 'Timed out waiting for ACTIVE state' });
            } catch (err) {
                logger.error(`[oac] Provisioning failed: ${err.message}`);
                oacInstances.set(batchName, { ...oacInstances.get(batchName), status: 'failed', error: err.message });
            }
        })();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

async function handleOacDestroy(req, res) {
    try {
        if (req.user?.userType !== 'superadmin' && req.user?.userType !== 'admin') return res.status(403).json({ message: 'Unauthorized' });

        const { batchName } = req.params;
        const instance = oacInstances.get(batchName);
        if (!instance) return res.status(404).json({ message: `Batch "${batchName}" not found` });

        // Tenant scoping: org-admin can only destroy own org's batches.
        const scopeOrg = _oacOrgScope(req);
        if (scopeOrg && instance.organization !== scopeOrg) {
            return res.status(403).json({ message: 'Cannot destroy a batch outside your organization' });
        }

        oacInstances.set(batchName, { ...instance, status: 'destroying' });
        res.json({ message: `OAC destruction started for "${batchName}"` });

        // Destroy in background
        (async () => {
            try {
                let ociIdentity, ociCommon, ociAnalytics;
                try {
                    ociIdentity = require('oci-identity');
                    ociCommon = require('oci-common');
                    ociAnalytics = require('oci-analytics');
                } catch { throw new Error('oci-sdk not installed'); }

                // Build provider (same as provision)
                const fs = require('fs');
                const os = require('os');
                const path = require('path');
                const { execSync } = require('child_process');
                let pem = Buffer.from(process.env.OCI_PRIVATE_KEY, 'base64').toString('utf8');
                if (pem.includes('BEGIN PRIVATE KEY') && !pem.includes('BEGIN RSA PRIVATE KEY')) {
                    const inPath = path.join(os.tmpdir(), '.oci_pk8_oacd.pem');
                    const outPath = path.join(os.tmpdir(), '.oci_rsa_oacd.pem');
                    fs.writeFileSync(inPath, pem, { mode: 0o600 });
                    try { execSync(`openssl rsa -in "${inPath}" -out "${outPath}" -traditional 2>/dev/null`); pem = fs.readFileSync(outPath, 'utf8'); } catch {}
                    try { fs.unlinkSync(inPath); } catch {}
                    try { fs.unlinkSync(outPath); } catch {}
                }
                const provider = new ociCommon.SimpleAuthenticationDetailsProvider(
                    process.env.OCI_TENANCY_OCID, process.env.OCI_USER_OCID, process.env.OCI_FINGERPRINT,
                    pem, null, ociCommon.Region.fromRegionId(process.env.OCI_REGION || 'ap-hyderabad-1')
                );

                const identityClient = new ociIdentity.IdentityClient({ authenticationDetailsProvider: provider });
                const analyticsClient = new ociAnalytics.AnalyticsClient({ authenticationDetailsProvider: provider });

                if (instance.compartmentId) {
                    // Delete OAC instances
                    const instances = await analyticsClient.listAnalyticsInstances({ compartmentId: instance.compartmentId });
                    for (const inst of (instances.items || [])) {
                        if (inst.lifecycleState !== 'DELETED') {
                            await analyticsClient.deleteAnalyticsInstance({ analyticsInstanceId: inst.id });
                            logger.info(`[oac] Deleting OAC instance: ${inst.name}`);
                        }
                    }

                    // Wait for deletion
                    for (let i = 0; i < 30; i++) {
                        await new Promise(r => setTimeout(r, 20000));
                        const check = await analyticsClient.listAnalyticsInstances({ compartmentId: instance.compartmentId });
                        if (!check.items?.some(x => x.lifecycleState !== 'DELETED')) break;
                    }

                    // Delete compartment
                    await identityClient.deleteCompartment({ compartmentId: instance.compartmentId });
                    logger.info(`[oac] Compartment deleted: ${instance.compartmentId}`);
                }

                oacInstances.set(batchName, { ...instance, status: 'destroyed', destroyedAt: new Date().toISOString() });
            } catch (err) {
                logger.error(`[oac] Destroy failed: ${err.message}`);
                oacInstances.set(batchName, { ...instance, status: 'destroy-failed', error: err.message });
            }
        })();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports = { handleGetOciUsers, handleBulkDeployOci, handleDeleteOciUser, handleOacProvision, handleOacDestroy, handleOacList };
