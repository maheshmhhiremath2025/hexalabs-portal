/**
 * Direct sandbox creation — calls Azure/AWS/GCP APIs synchronously.
 * No worker/queue needed. Used for self-service portal.
 */
require('dotenv').config();
const { logger } = require('../plugins/logger');

// Generic propagation-retry helper. Cloud IAM principals (AWS users, AAD
// users, GCP project members) take 5-30s to propagate after creation, and
// follow-up attach/bind calls fail with predictable transient errors. We
// retry up to 6 times with linear backoff (5s, 10s, 15s, ...) — total
// budget ~105s. On terminal failure we THROW so the relaunch route
// surfaces a 500 and the user retries cleanly, instead of silently
// continuing with a half-provisioned sandbox.
async function withPropagationRetry(label, fn, transientPattern) {
  const re = transientPattern || /NoSuchEntity|PrincipalNotFound|does not exist|propagat|EtagMismatch|FAILED_PRECONDITION|409/i;
  let last;
  for (let i = 0; i < 6; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (re.test(e.message) && i < 5) {
        logger.warn(`[propagation-retry] ${label} attempt ${i+1}/6: ${e.message.slice(0, 100)}`);
        await new Promise(r => setTimeout(r, 5000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}


// ===== AZURE =====
async function createAzureSandbox(resourceGroupName, location = 'southindia', userId, userEmail, options = {}) {
  const { ClientSecretCredential } = require('@azure/identity');
  const { ResourceManagementClient } = require('@azure/arm-resources');
  const { AuthorizationManagementClient } = require('@azure/arm-authorization');
  const crypto = require('crypto');
  require('isomorphic-fetch');
  const { Client } = require('@microsoft/microsoft-graph-client');

  const credential = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const subscriptionId = process.env.SUBSCRIPTION_ID;
  const resourceClient = new ResourceManagementClient(credential, subscriptionId);
  const authClient = new AuthorizationManagementClient(credential, subscriptionId);

  // 1. Provision Entra (Azure AD) user for sandbox access.
  //    Static-user policy: if caller passes options.reuseUser={upn,password},
  //    look up the existing user by UPN, reuse it, and SKIP user creation.
  //    Only create a fresh Entra user on first-ever sandbox for this learner.
  let azureUsername = '';
  let azurePassword = '';
  let azureObjectId = '';
  const domain = process.env.IDENTITY_DOMAIN || process.env.AZURE_DOMAIN || 'hexalabs.online';

  // Build the identity Graph client up-front so the reuse branch can use it too.
  let graphClient = null;
  try {
    const identityCredential = new ClientSecretCredential(
      process.env.IDENTITY_TENANT_ID || process.env.TENANT_ID,
      process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
      process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
    );
    const tokenRes = await identityCredential.getToken('https://graph.microsoft.com/.default');
    graphClient = Client.init({ authProvider: (done) => done(null, tokenRes.token) });
  } catch (e) {
    logger.error(`Graph client init failed: ${e.message}`);
  }

  // Reuse branch
  const reuseUPN = options.reuseUser?.upn;
  const reusePass = options.reuseUser?.password;
  if (reuseUPN && graphClient) {
    try {
      const existing = await graphClient.api(`/users/${encodeURIComponent(reuseUPN)}`).get();
      azureObjectId = existing.id;
      azureUsername = reuseUPN;
      azurePassword = reusePass || '';
      logger.info(`Azure AD user reused (static): ${azureUsername} (${azureObjectId})`);
    } catch (e) {
      // Prior user is gone (deleted out-of-band, tenant purged, etc.) — fall through to create new.
      logger.warn(`Azure AD reuse failed for ${reuseUPN}: ${e.message}; creating fresh user`);
    }
  }

  // Create branch (first-ever sandbox OR reuse fell through)
  if (!azureObjectId && graphClient) {
    try {
      const cleanName = (userEmail || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 15);
      azureUsername = `sb-${cleanName}-${Date.now().toString(36).slice(-4)}@${domain}`;
      azurePassword = `Sb${crypto.randomBytes(4).toString('hex')}!1`;

      const newUser = await graphClient.api('/users').post({
        accountEnabled: true,
        displayName: `Sandbox - ${cleanName}`,
        mailNickname: `sb-${cleanName}`,
        userPrincipalName: azureUsername,
        passwordProfile: {
          forceChangePasswordNextSignIn: false,
          password: azurePassword,
        },
      });
      azureObjectId = newUser.id;
      logger.info(`Azure AD user created: ${azureUsername} (${azureObjectId})`);
    } catch (e) {
      logger.error(`Azure AD user creation failed: ${e.message}`);
      // Continue — resource group still gets created, just no portal access
    }
  }

  // 2. Create resource group
  await resourceClient.resourceGroups.createOrUpdate(resourceGroupName, {
    location,
    tags: { sandbox: 'true', user: azureUsername || userId || 'selfservice', created: new Date().toISOString() },
  });
  logger.info(`Azure RG created: ${resourceGroupName}`);

  // 3. Assign role to the new Azure AD user — retry on PrincipalNotFound
  // since AAD principals can take 5-30s to propagate to RBAC after creation.
  if (azureObjectId) {
    const CUSTOM_ROLE_ID = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/57fce75e-14f9-4736-84e6-9c55ba17b975`;
    const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;
    let assigned = false;
    for (let i = 0; i < 6; i++) {
      try {
        await authClient.roleAssignments.create(scope, crypto.randomUUID(),
          { principalId: azureObjectId, roleDefinitionId: CUSTOM_ROLE_ID, scope });
        logger.info(`Role assigned to ${azureUsername} on ${resourceGroupName} (attempt ${i+1})`);
        assigned = true;
        break;
      } catch (e) {
        if (/already exists|RoleAssignmentExists/i.test(e.message)) { assigned = true; break; }
        if (/PrincipalNotFound|does not exist|propagat/i.test(e.message) && i < 5) {
          logger.warn(`Role assign attempt ${i+1}/6 for ${azureUsername} on ${resourceGroupName}: ${e.message}`);
          await new Promise(r => setTimeout(r, 5000 * (i + 1)));
          continue;
        }
        logger.error(`Role assignment for ${azureUsername} on ${resourceGroupName} failed: ${e.message}`);
        throw e;
      }
    }
    if (!assigned) throw new Error(`Role assignment failed after 6 retries for ${azureUsername} on ${resourceGroupName}`);
  }

  // 4. Apply Azure Policy "Allowed virtual machine SKUs" if caller supplied a list.
  //    Closes the gap discovered 2026-05-18 where templates documented "B-series only"
  //    but the custom role allowed Microsoft.Compute/* with no SKU filter and no
  //    Azure Policy was assigned, letting stripedata learners deploy Standard_D2s_v3.
  if (Array.isArray(options.allowedVmSkus)) {
    try {
      const { PolicyClient } = require('@azure/arm-policy');
      const policyClient = new PolicyClient(credential, subscriptionId);
      const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`;
      await policyClient.policyAssignments.create(scope, 'sandbox-allowed-vm-skus', {
        displayName: 'Sandbox - Allowed VM SKUs',
        description: 'Restrict VM SKUs deployable inside this sandbox. Wired from SandboxTemplate.allowedInstanceTypes.azure.',
        policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/cccc23c7-8427-4f53-ad12-b6a63eb452b3',
        parameters: { listOfAllowedSKUs: { value: options.allowedVmSkus } },
        enforcementMode: 'Default',
      });
      logger.info(`Azure Policy allowed-vm-skus assigned to ${resourceGroupName}: [${options.allowedVmSkus.join(', ')}]`);
    } catch (e) {
      logger.error(`Failed to assign allowed-vm-skus policy to ${resourceGroupName}: ${e.message}`);
    }
  } else {
    logger.warn(`createAzureSandbox: no allowedVmSkus passed by caller for ${resourceGroupName} - SKU policy NOT applied. Caller should pass template.allowedInstanceTypes.azure to close the gap.`);
  }

  return {
    resourceGroupName,
    location,
    accessUrl: `https://portal.azure.com/#@${process.env.TENANT_ID}/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
    portalUrl: 'https://portal.azure.com',
    username: azureUsername,
    password: azurePassword,
    objectId: azureObjectId,
  };
}

// ===== AWS =====
async function createAwsSandbox(username, email, overrideCreds) {
  const { IAMClient, CreateUserCommand, AttachUserPolicyCommand, CreateLoginProfileCommand, PutUserPolicyCommand } = require('@aws-sdk/client-iam');
  const fs = require('fs');
  const path = require('path');

  const awsKey = overrideCreds?.accessKeyId || process.env.AWS_ACCESS_KEY;
  const awsSecret = overrideCreds?.secretAccessKey || process.env.AWS_ACCESS_SECRET;
  const client = new IAMClient({
    region: overrideCreds ? 'us-east-1' : (process.env.AWS_REGION || 'ap-south-1'),
    credentials: { accessKeyId: awsKey, secretAccessKey: awsSecret },
  });

  const password = Math.random().toString(36).slice(-8) + 'A1!';

  // Create user
  await client.send(new CreateUserCommand({ UserName: username }));
  logger.info(`AWS user created: ${username}`);

  // Attach policies (skip for override/Connect account — those get their own policies)
  if (!overrideCreds) {
    const policies = [
      'arn:aws:iam::475184346033:policy/1maiaccessall1',
      'arn:aws:iam::475184346033:policy/sandbox1',
      'arn:aws:iam::475184346033:policy/sandbox2',
      'arn:aws:iam::475184346033:policy/sandbox3',
      'arn:aws:iam::475184346033:policy/sandbox4',
    ];
    for (const arn of policies) {
      await withPropagationRetry(
        `AWS AttachUserPolicy ${arn.split('/').pop()} on ${username}`,
        () => client.send(new AttachUserPolicyCommand({ UserName: username, PolicyArn: arn }))
      );
    }
  }

  // Attach cost restriction inline policy (instance type + region lock)
  // Skip for Connect account — Connect students get their own managed policy
  if (!overrideCreds) try {
    // Try to load the file-based policy first
    let restrictionPolicy;
    try {
      restrictionPolicy = fs.readFileSync(path.join(__dirname, '../worker/functions/sandbox-policies/aws-sandbox-policy.json'), 'utf8');
    } catch {
      try {
        restrictionPolicy = fs.readFileSync(path.join(__dirname, '../../worker/functions/sandbox-policies/aws-sandbox-policy.json'), 'utf8');
      } catch {}
    }
    if (restrictionPolicy) {
      await withPropagationRetry(
        `AWS PutUserPolicy SandboxCostRestrictions on ${username}`,
        () => client.send(new PutUserPolicyCommand({ UserName: username, PolicyName: 'SandboxCostRestrictions', PolicyDocument: restrictionPolicy }))
      );
    }

    // Always apply the instance-type + region lock policy
    const defaultAllowedTypes = ['t2.micro', 't2.small', 't3.micro', 't3.small'];
    const instanceRegionPolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyExpensiveInstanceTypes',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: 'arn:aws:ec2:*:*:instance/*',
          Condition: {
            'ForAllValues:StringNotEquals': {
              'ec2:InstanceType': defaultAllowedTypes,
            },
          },
        },
        {
          Sid: 'DenyGPUInstances',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: '*',
          Condition: {
            StringLike: { 'ec2:InstanceType': ['p*', 'g*', 'inf*', 'trn*', 'dl*'] },
          },
        },
        {
          Sid: 'DenyOutOfRegion',
          Effect: 'Deny',
          Action: ['ec2:RunInstances', 'ec2:CreateVolume', 'rds:CreateDBInstance'],
          Resource: '*',
          Condition: {
            StringNotEquals: { 'aws:RequestedRegion': 'ap-south-1' },
          },
        },
      ],
    });
    await withPropagationRetry(
      `AWS PutUserPolicy InstanceTypeAndRegionLock on ${username}`,
      () => client.send(new PutUserPolicyCommand({
        UserName: username,
        PolicyName: 'InstanceTypeAndRegionLock',
        PolicyDocument: instanceRegionPolicy,
      }))
    );
  } catch (e) {
    logger.error(`Failed to attach cost restriction policies for ${username}: ${e.message}`);
  }

  // Set password
  await client.send(new CreateLoginProfileCommand({ UserName: username, Password: password, PasswordResetRequired: false }));
  logger.info(`AWS login profile created for ${username}`);

  const accountId = overrideCreds ? (process.env.AWS_CONNECT_ACCOUNT_ID || '631461173692') : '475184346033';
  return {
    username,
    password,
    accessUrl: `https://${accountId}.signin.aws.amazon.com/console`,
    region: overrideCreds ? 'us-east-1' : 'ap-south-1',
  };
}

// ===== GCP =====
async function createGcpSandbox(projectId, userEmail, budgetLimit = 500, templateSlug = null) {
  const { google } = require('googleapis');
  const parentId = process.env.PARENTID || 'organizations/628552726767';

  // Helper: add a user binding with ETag-conflict retry. Used by step 7b/7c/7d.
  async function _gcpAddBinding(cloudResourceManager, projectId, role, memberKey, label) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const cur = (await cloudResourceManager.projects.getIamPolicy({
          resource: `projects/${projectId}`,
          requestBody: {},
        })).data || { bindings: [] };
        cur.bindings = cur.bindings || [];
        let b = cur.bindings.find(x => x.role === role);
        if (b && b.members.includes(memberKey)) return;
        if (b) b.members.push(memberKey);
        else cur.bindings.push({ role, members: [memberKey] });
        await cloudResourceManager.projects.setIamPolicy({
          resource: `projects/${projectId}`,
          requestBody: { policy: cur },
        });
        logger.info(`GCP ${label} (${role}) bound to ${memberKey} on ${projectId}`);
        return;
      } catch (e) {
        if (/concurrent policy changes|ETag/i.test(e.message) && attempt < 5) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        logger.error(`GCP ${label} binding failed on ${projectId}: ${e.message}`);
        return;
      }
    }
  }
  const keyFile = process.env.KEYFILENAME;

  const auth = new google.auth.GoogleAuth({
    keyFile: keyFile,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  // 1. Create the GCP project
  try {
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

    await cloudResourceManager.projects.create({
      requestBody: {
        projectId: projectId,
        displayName: projectId,
        parent: parentId,
      },
    });
    logger.info(`GCP project created: ${projectId}`);

    // Wait a few seconds for project to propagate (GCP is eventually consistent)
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    logger.error(`GCP project creation: ${e.message}`);
  }

  // 2. Grant the student access to the project via IAM policy binding.
  //    The userEmail MUST be a real Google account (Gmail or Google Workspace).
  //    If it's not (e.g. admin@hexalabs.online), the binding will fail and the
  //    student won't be able to access the project. In that case, ops needs
  //    to provide the student's Google email explicitly.
  //
  //    We grant roles/editor (not roles/owner) so the student can create
  //    resources but can't delete the project or change IAM policies.
  let iamBindingSuccess = false;
  try {
    const cloudResourceManager = google.cloudresourcemanager({ version: 'v3', auth });

    // Get existing policy first (so we don't overwrite org-level bindings)
    let existingPolicy = { bindings: [] };
    try {
      const existing = await cloudResourceManager.projects.getIamPolicy({
        resource: `projects/${projectId}`,
        requestBody: {},
      });
      existingPolicy = existing.data || existingPolicy;
    } catch (e) {
      logger.error(`GCP get IAM policy: ${e.message}`);
    }

    // Add the student as editor
    const bindings = existingPolicy.bindings || [];
    bindings.push({
      role: 'roles/editor',
      members: [`user:${userEmail}`],
    });

    await withPropagationRetry(
      `GCP setIamPolicy ${userEmail} -> editor on ${projectId}`,
      () => cloudResourceManager.projects.setIamPolicy({
        resource: `projects/${projectId}`,
        requestBody: { policy: { bindings, etag: existingPolicy.etag } },
      })
    );

    iamBindingSuccess = true;
    logger.info(`GCP IAM binding set: ${userEmail} → roles/editor on ${projectId}`);
  } catch (e) {
    logger.error(`GCP IAM binding failed for ${userEmail}: ${e.message}`);
    // Common cause: userEmail is not a valid Google account.
    // The project was still created; ops can manually add access later.
  }

  // 3. Enable billing on the project (required for creating resources)
  try {
    const billingAccountId = process.env.GCP_BILLING_ACCOUNT;
    if (billingAccountId) {
      const cloudbilling = google.cloudbilling({ version: 'v1', auth });
      await cloudbilling.projects.updateBillingInfo({
        name: `projects/${projectId}`,
        requestBody: {
          billingAccountName: `billingAccounts/${billingAccountId}`,
        },
      });
      logger.info(`GCP billing linked: ${projectId} → ${billingAccountId}`);
    }
  } catch (e) {
    logger.error(`GCP billing link failed: ${e.message}`);
  }

  // 4. Set a budget alert (if budget API is available)
  try {
    const billingAccountId = process.env.GCP_BILLING_ACCOUNT;
    if (billingAccountId && budgetLimit > 0) {
      const billingbudgets = google.billingbudgets({ version: 'v1', auth });
      await billingbudgets.billingAccounts.budgets.create({
        parent: `billingAccounts/${billingAccountId}`,
        requestBody: {
          displayName: `Lab budget: ${projectId}`,
          budgetFilter: {
            projects: [`projects/${projectId}`],
          },
          amount: {
            specifiedAmount: {
              currencyCode: 'INR',
              units: String(budgetLimit),
            },
          },
          thresholdRules: [
            { thresholdPercent: 0.5 },
            { thresholdPercent: 0.8 },
            { thresholdPercent: 1.0 },
          ],
        },
      });
      logger.info(`GCP budget set: ₹${budgetLimit} for ${projectId}`);
    }
  } catch (e) {
    logger.error(`GCP budget creation failed: ${e.message}`);
  }

  // 5. Auto-enable all required APIs so students don't have to manually enable each one
  try {
    const serviceusage = google.serviceusage({ version: 'v1', auth });

    // All APIs needed for the GCP Standard Lab scope
    const requiredApis = [
      'compute.googleapis.com',                  // Compute Engine (VMs, VMSS)
      'container.googleapis.com',                 // Google Kubernetes Engine (GKE)
      'cloudfunctions.googleapis.com',            // Cloud Functions
      'run.googleapis.com',                       // Cloud Run
      'sqladmin.googleapis.com',                  // Cloud SQL
      'spanner.googleapis.com',                   // Spanner
      'alloydb.googleapis.com',                   // AlloyDB
      'firestore.googleapis.com',                 // Firestore
      'bigtableadmin.googleapis.com',             // Bigtable
      'bigquery.googleapis.com',                  // BigQuery
      'dataflow.googleapis.com',                  // Dataflow
      'dataproc.googleapis.com',                  // Dataproc
      'pubsub.googleapis.com',                    // Pub/Sub
      'storage.googleapis.com',                   // Cloud Storage
      'artifactregistry.googleapis.com',           // Artifact Registry
      'clouddeploy.googleapis.com',               // Cloud Deploy
      'cloudscheduler.googleapis.com',            // Cloud Scheduler
      'eventarc.googleapis.com',                  // Eventarc
      'workflows.googleapis.com',                 // Workflows
      'batch.googleapis.com',                     // Batch
      'iam.googleapis.com',                       // IAM (Service Accounts)
      'cloudresourcemanager.googleapis.com',      // Resource Manager
      'logging.googleapis.com',                   // Cloud Logging
      'monitoring.googleapis.com',                // Cloud Monitoring
      'cloudbuild.googleapis.com',                // Cloud Build (needed by some services)
      'servicenetworking.googleapis.com',         // Service Networking (needed by Cloud SQL)
    ];

    // Per-template API extensions (added on top of the standard list)
    const TEMPLATE_API_EXTENSIONS = {
      "gcp-appengine-lab": [
        "appengine.googleapis.com",       // App Engine Standard
        "appengineflex.googleapis.com",   // App Engine Flex
      ],
      "gcp-vertex-ai-explore-lab": [
        "aiplatform.googleapis.com",
        "notebooks.googleapis.com",
        "generativelanguage.googleapis.com",
        "ml.googleapis.com",
        "artifactregistry.googleapis.com",
      ],
    };
    if (templateSlug && TEMPLATE_API_EXTENSIONS[templateSlug]) {
      for (const extra of TEMPLATE_API_EXTENSIONS[templateSlug]) {
        if (!requiredApis.includes(extra)) requiredApis.push(extra);
      }
    }

    // Enable APIs in parallel batches of 5 to avoid rate limits
    const batchSize = 5;
    let enabled = 0;
    for (let i = 0; i < requiredApis.length; i += batchSize) {
      const batch = requiredApis.slice(i, i + batchSize);
      await Promise.all(batch.map(async (api) => {
        try {
          await serviceusage.services.enable({ name: `projects/${projectId}/services/${api}` });
          enabled++;
        } catch (apiErr) {
          // Some APIs may not be available — that's OK, skip silently
          logger.warn(`GCP API enable skipped for ${api}: ${apiErr.message?.slice(0, 60)}`);
        }
      }));
    }
    logger.info(`GCP APIs enabled: ${enabled}/${requiredApis.length} for ${projectId}`);
  } catch (e) {
    logger.error(`GCP API enable failed: ${e.message}`);
  }

  // Per-template project quotas. For Vertex AI Explore, hard-cap CPUs to 2
  // (1 small VM at a time). GPUs default to 0 in new GCP projects so no
  // override needed for that.
  if (templateSlug === 'gcp-vertex-ai-explore-lab') {
    try {
      const serviceUsage = google.serviceusage({ version: 'v1beta1', auth });
      const parent = 'projects/' + projectId + '/services/compute.googleapis.com/consumerQuotaMetrics/compute.googleapis.com%2Fcpus_all_regions/limits/%2Fproject';
      await serviceUsage.services.consumerQuotaMetrics.limits.consumerOverrides.create({
        parent, force: true,
        requestBody: { overrideValue: '2' },
      });
      logger.info('GCP CPUS_ALL_REGIONS quota override = 2 applied for ' + projectId);
    } catch (qErr) {
      logger.warn('GCP CPU quota override failed for ' + projectId + ': ' + (qErr.message || '').slice(0, 80));
    }
  }

  // 6. Apply GCP Org Policies for cost control
  try {
    const orgpolicy = google.orgpolicy({ version: 'v2', auth });

    const policies = [
      // Region lock — only us-central1
      { constraint: 'gcp.resourceLocations', rule: { values: { allowedValues: ['in:us-central1-locations'] } } },
      // Restrict machine types (custom boolean constraint defined at org level)
      { constraint: 'custom.restrictMachineType', rule: { enforce: true } },
      // Disable serial port access
      { constraint: 'compute.disableSerialPortAccess', rule: { enforce: true } },
    ];

    for (const p of policies) {
      try {
        await orgpolicy.projects.policies.create({
          parent: `projects/${projectId}`,
          requestBody: {
            name: `projects/${projectId}/policies/${p.constraint}`,
            spec: { rules: [p.rule] },
          },
        });
      } catch (pErr) {
        logger.warn(`GCP org policy ${p.constraint} failed for ${projectId}: ${pErr.message}`);
      }
    }
    logger.info(`GCP org policies applied to ${projectId}`);
  } catch (e) {
    logger.error(`GCP org policy setup failed: ${e.message}`);
  }

  // 7. (gcp-appengine-lab only) Create the custom Dynatrace GCP Monitor role
  //     on this project + bind it to the learner. Adds permissions beyond
  //     roles/editor that Dynatrace's helm chart and pub/sub ingest need:
  //     iam.roles.create/list/update, iam.serviceAccounts.set/getIamPolicy,
  //     pubsub topics IAM, project setIamPolicy, serviceusage.enable.
  if (templateSlug === "gcp-appengine-lab") {
    try {
      const iam = google.iam({ version: "v1", auth });
      const DT_ROLE_ID = "synergificDtGcpMonitor";
      const DT_PERMS = [
        "container.clusters.get",
        "container.configMaps.create",
        "container.configMaps.delete",
        "container.configMaps.get",
        "container.configMaps.update",
        "container.deployments.create",
        "container.deployments.delete",
        "container.deployments.get",
        "container.deployments.update",
        "container.namespaces.create",
        "container.namespaces.get",
        "container.pods.get",
        "container.pods.list",
        "container.secrets.create",
        "container.secrets.delete",
        "container.secrets.get",
        "container.secrets.list",
        "container.secrets.update",
        "container.serviceAccounts.create",
        "container.serviceAccounts.delete",
        "container.serviceAccounts.get",
        "iam.roles.create",
        "iam.roles.list",
        "iam.roles.update",
        "iam.serviceAccounts.actAs",
        "iam.serviceAccounts.create",
        "iam.serviceAccounts.getIamPolicy",
        "iam.serviceAccounts.list",
        "iam.serviceAccounts.setIamPolicy",
        "pubsub.subscriptions.create",
        "pubsub.subscriptions.get",
        "pubsub.subscriptions.list",
        "pubsub.topics.attachSubscription",
        "pubsub.topics.create",
        "pubsub.topics.getIamPolicy",
        "pubsub.topics.list",
        "pubsub.topics.setIamPolicy",
        "pubsub.topics.update",
        "resourcemanager.projects.get",
        "resourcemanager.projects.getIamPolicy",
        "resourcemanager.projects.setIamPolicy",
        "serviceusage.services.enable",
        "serviceusage.services.get",
      ];

      // 7a. Create the custom role on the project
      try {
        await iam.projects.roles.create({
          parent: `projects/${projectId}`,
          requestBody: {
            roleId: DT_ROLE_ID,
            role: {
              title: "Dynatrace GCP Monitor helm deployment role",
              description: "Role for Dynatrace GCP Monitor helm and pubsub deployment",
              stage: "GA",
              includedPermissions: DT_PERMS,
            },
          },
        });
        logger.info(`GCP custom role ${DT_ROLE_ID} created on ${projectId}`);
      } catch (roleErr) {
        if (!String(roleErr.message).match(/already exists/i)) throw roleErr;
        logger.info(`GCP custom role ${DT_ROLE_ID} already exists on ${projectId}`);
      }

      // 7b. Bind the learner to the new custom role (in addition to roles/editor)
      const cloudResourceManager = google.cloudresourcemanager({ version: "v3", auth });
      const customRoleName = `projects/${projectId}/roles/${DT_ROLE_ID}`;
      await _gcpAddBinding(cloudResourceManager, projectId, customRoleName, `user:${userEmail}`, `custom DT role`);

      // 7c. Bind roles/appengine.appAdmin (lets the learner click "Create Application")
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/appengine.appAdmin", `user:${userEmail}`, "appengine.appAdmin");

      // 7d. Bind roles/iam.serviceAccountUser (deploy code as App Engine SA, Cloud Build, etc.)
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/iam.serviceAccountUser", `user:${userEmail}`, "iam.serviceAccountUser");

      // 7d-extras. Owner-equivalent role bundle for gcp-appengine-lab learners.
      //   roles/owner cannot be granted to external Gmail accounts via API
      //   (ORG_MUST_INVITE_EXTERNAL_OWNERS); these 5 roles together give every
      //   project-level admin power the learner needs for end-to-end Dynatrace
      //   + App Engine + Pub/Sub work.
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/resourcemanager.projectIamAdmin", `user:${userEmail}`, "projectIamAdmin");
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/iam.securityAdmin", `user:${userEmail}`, "iam.securityAdmin");
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/iam.serviceAccountAdmin", `user:${userEmail}`, "iam.serviceAccountAdmin");
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/serviceusage.serviceUsageAdmin", `user:${userEmail}`, "serviceusage.serviceUsageAdmin");
      await _gcpAddBinding(cloudResourceManager, projectId, "roles/appengine.serviceAdmin", `user:${userEmail}`, "appengine.serviceAdmin");

      // 7e. Pre-create the App Engine application with us-central region.
      //     Avoids the "Create Application" greyed-button UX issue and locks
      //     region to us-central so the learner can't pick a wrong region.
      try {
        const ae = google.appengine({ version: "v1", auth });
        const op = await ae.apps.create({ requestBody: { id: projectId, locationId: "us-central" } });
        const opName = op.data.name.split("/").pop();
        for (let i = 0; i < 24; i++) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            const o = await ae.apps.operations.get({ appsId: projectId, operationsId: opName });
            if (o.data.done) { break; }
          } catch (e) { break; }
        }
        logger.info(`GCP App Engine app pre-created (us-central) on ${projectId}`);
      } catch (e) {
        if (!/already exists/i.test(e.message)) {
          logger.error(`GCP App Engine app pre-create failed for ${projectId}: ${e.message}`);
        }
      }
    } catch (e) {
      logger.error(`GCP dt-monitor-role setup failed for ${projectId}: ${e.message}`);
    }
  }

  return {
    projectId,
    accessUrl: `https://console.cloud.google.com/home/dashboard?project=${projectId}`,
    region: 'us-central1',
    iamBindingSuccess,
    username: userEmail,
    password: 'Use your Google account password',
    note: iamBindingSuccess
      ? `${userEmail} has Editor access to project ${projectId}`
      : `IAM binding failed — ${userEmail} may not be a valid Google account. Add access manually in GCP Console → IAM.`,
  };
}

module.exports = { createAzureSandbox, createAwsSandbox, createGcpSandbox };
