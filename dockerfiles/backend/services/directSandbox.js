/**
 * Direct sandbox creation — calls Azure/AWS/GCP APIs synchronously.
 * No worker/queue needed. Used for self-service portal.
 */
require('dotenv').config();
const { logger } = require('../plugins/logger');

// ===== AZURE =====
async function createAzureSandbox(resourceGroupName, location = 'southindia', userId, userEmail) {
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

  // 1. Create Azure AD user for sandbox access
  let azureUsername = '';
  let azurePassword = '';
  let azureObjectId = '';
  const domain = process.env.IDENTITY_DOMAIN || process.env.AZURE_DOMAIN || 'synergificsoftware.com';

  try {
    // Use identity credential (separate app with User.ReadWrite.All permission)
    const identityCredential = new ClientSecretCredential(
      process.env.IDENTITY_TENANT_ID || process.env.TENANT_ID,
      process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
      process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
    );
    const tokenRes = await identityCredential.getToken('https://graph.microsoft.com/.default');
    const graphClient = Client.init({
      authProvider: (done) => done(null, tokenRes.token),
    });

    // Generate username from email
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

  // 2. Create resource group
  await resourceClient.resourceGroups.createOrUpdate(resourceGroupName, {
    location,
    tags: { sandbox: 'true', user: azureUsername || userId || 'selfservice', created: new Date().toISOString() },
  });
  logger.info(`Azure RG created: ${resourceGroupName}`);

  // 3. Assign role to the new Azure AD user
  if (azureObjectId) {
    try {
      const CUSTOM_ROLE_ID = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/57fce75e-14f9-4736-84e6-9c55ba17b975`;
      await authClient.roleAssignments.create(
        `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
        crypto.randomUUID(),
        { principalId: azureObjectId, roleDefinitionId: CUSTOM_ROLE_ID, scope: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}` }
      );
      logger.info(`Role assigned to ${azureUsername} on ${resourceGroupName}`);
    } catch (e) { logger.error(`Role assignment: ${e.message}`); }
  }

  return {
    resourceGroupName,
    location,
    accessUrl: `https://portal.azure.com/#@${process.env.TENANT_ID}/resource/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
    portalUrl: 'https://portal.azure.com',
    username: azureUsername,
    password: azurePassword,
  };
}

// ===== AWS =====
async function createAwsSandbox(username, email) {
  const { IAMClient, CreateUserCommand, AttachUserPolicyCommand, CreateLoginProfileCommand, PutUserPolicyCommand } = require('@aws-sdk/client-iam');
  const fs = require('fs');
  const path = require('path');

  const client = new IAMClient({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY, secretAccessKey: process.env.AWS_ACCESS_SECRET },
  });

  const password = Math.random().toString(36).slice(-8) + 'A1!';

  // Create user
  await client.send(new CreateUserCommand({ UserName: username }));
  logger.info(`AWS user created: ${username}`);

  // Attach policies
  const policies = [
    'arn:aws:iam::475184346033:policy/1maiaccessall1',
    'arn:aws:iam::475184346033:policy/sandbox1',
    'arn:aws:iam::475184346033:policy/sandbox2',
    'arn:aws:iam::475184346033:policy/sandbox3',
    'arn:aws:iam::475184346033:policy/sandbox4',
  ];
  for (const arn of policies) {
    try { await client.send(new AttachUserPolicyCommand({ UserName: username, PolicyArn: arn })); } catch {}
  }

  // Attach cost restriction inline policy (instance type + region lock)
  try {
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
      await client.send(new PutUserPolicyCommand({ UserName: username, PolicyName: 'SandboxCostRestrictions', PolicyDocument: restrictionPolicy }));
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
    await client.send(new PutUserPolicyCommand({
      UserName: username,
      PolicyName: 'InstanceTypeAndRegionLock',
      PolicyDocument: instanceRegionPolicy,
    }));
  } catch (e) {
    logger.error(`Failed to attach cost restriction policies for ${username}: ${e.message}`);
  }

  // Set password
  await client.send(new CreateLoginProfileCommand({ UserName: username, Password: password, PasswordResetRequired: false }));
  logger.info(`AWS login profile created for ${username}`);

  return {
    username,
    password,
    accessUrl: 'https://475184346033.signin.aws.amazon.com/console',
    region: 'ap-south-1',
  };
}

// ===== GCP =====
async function createGcpSandbox(projectId, userEmail, budgetLimit = 500) {
  const { google } = require('googleapis');
  const parentId = process.env.PARENTID || 'organizations/628552726767';
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
  //    If it's not (e.g. admin@getlabs.cloud), the binding will fail and the
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

    await cloudResourceManager.projects.setIamPolicy({
      resource: `projects/${projectId}`,
      requestBody: {
        policy: {
          bindings,
          etag: existingPolicy.etag,
        },
      },
    });

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
