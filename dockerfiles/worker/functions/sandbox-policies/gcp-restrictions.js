/**
 * GCP Sandbox Cost Restrictions
 *
 * Applied when creating a GCP sandbox project:
 * 1. Budget with alert thresholds
 * 2. Org policy to restrict VM machine types
 * 3. Org policy to restrict regions
 * 4. Disable billing if budget exceeded
 */

const { BillingBudgetsClient } = require('@google-cloud/billing-budgets');
const { google } = require('googleapis');
const { logger } = require('../../plugins/logger');

/**
 * Create a budget on the GCP project.
 * @param {string} projectId - GCP project ID
 * @param {number} budgetInr - Budget in INR
 * @param {string} billingAccountId - Billing account ID
 */
async function createGcpBudget(projectId, budgetInr = 500, billingAccountId) {
  try {
    const billingAccount = billingAccountId || process.env.BILLINGACCOUNTID;
    if (!billingAccount) { logger.error('No billing account for GCP budget'); return; }

    // Convert INR to USD
    let rate = 92;
    try {
      const axios = require('axios');
      const res = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
      rate = res.data.rates?.INR || 92;
    } catch {}
    const budgetUsd = Math.round(budgetInr / rate * 100) / 100;

    const budgetsClient = new BillingBudgetsClient();
    const [budget] = await budgetsClient.createBudget({
      parent: `billingAccounts/${billingAccount}`,
      budget: {
        displayName: `sandbox-${projectId}`,
        budgetFilter: {
          projects: [`projects/${projectId}`],
        },
        amount: {
          specifiedAmount: {
            currencyCode: 'USD',
            units: Math.floor(budgetUsd),
            nanos: Math.round((budgetUsd % 1) * 1e9),
          },
        },
        thresholdRules: [
          { thresholdPercent: 0.5, spendBasis: 'CURRENT_SPEND' },   // 50%
          { thresholdPercent: 0.8, spendBasis: 'CURRENT_SPEND' },   // 80%
          { thresholdPercent: 1.0, spendBasis: 'CURRENT_SPEND' },   // 100%
          { thresholdPercent: 1.2, spendBasis: 'CURRENT_SPEND' },   // 120% (overrun)
        ],
      },
    });

    logger.info(`GCP budget created for ${projectId}: ₹${budgetInr} (~$${budgetUsd})`);
    return budget;
  } catch (err) {
    logger.error(`GCP budget creation failed for ${projectId}: ${err.message}`);
  }
}

/**
 * Set GCP Organization Policy to restrict VM machine types.
 * Only allows cheap e2/f1/g1 machine types.
 */
async function setGcpVmRestrictions(projectId) {
  try {
    const orgPolicy = google.orgpolicy('v2');
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.KEYFILENAME,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const authClient = await auth.getClient();

    // Restrict Compute Engine machine types
    await orgPolicy.projects.policies.create({
      parent: `projects/${projectId}`,
      requestBody: {
        name: `projects/${projectId}/policies/compute.restrictMachineTypes`,
        spec: {
          rules: [{
            allowAll: false,
            values: {
              allowedValues: [
                'e2-micro', 'e2-small', 'e2-medium',
                'e2-standard-2',
                'f1-micro', 'g1-small',
              ],
            },
          }],
        },
      },
      auth: authClient,
    });
    logger.info(`GCP VM restriction applied to ${projectId}: e2/f1/g1 only`);
  } catch (err) {
    // Org policy API may require org-level permissions
    logger.error(`GCP VM restriction failed for ${projectId}: ${err.message}`);
  }
}

/**
 * Disable billing on a project (emergency stop if budget exceeded).
 */
async function disableGcpBilling(projectId) {
  try {
    const { CloudBillingClient } = require('@google-cloud/billing');
    const billingClient = new CloudBillingClient();

    await billingClient.updateProjectBillingInfo({
      name: `projects/${projectId}`,
      projectBillingInfo: {
        billingAccountName: '', // Empty = disable billing
      },
    });
    logger.info(`Billing disabled for GCP project ${projectId}`);
  } catch (err) {
    logger.error(`Failed to disable billing for ${projectId}: ${err.message}`);
  }
}

module.exports = { createGcpBudget, setGcpVmRestrictions, disableGcpBilling };
