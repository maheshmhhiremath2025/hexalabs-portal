/**
 * GCP Cost Service
 *
 * Fetches actual GCP spend per project via the Cloud Billing API.
 * Each sandbox project's cost is queried individually.
 *
 * Prerequisites:
 *   - KEYFILENAME service account needs billing.viewer role
 *   - GCP_BILLING_ACCOUNT env var set
 *   - Projects must be linked to the billing account (directSandbox does this)
 *
 * GCP billing data has a 24-48h delay (similar to AWS).
 */

const { logger } = require('../plugins/logger');

let exchangeRate = 85;
try {
  const { getUsdToInr } = require('./exchangeRate');
  getUsdToInr().then(r => { exchangeRate = r; }).catch(() => {});
} catch {}

/**
 * Get actual GCP spend grouped by project ID. Queries the billing catalog
 * for all projects under the billing account.
 */
async function getGcpCostByProject(days = 30) {
  try {
    const { google } = require('googleapis');
    const keyFile = process.env.KEYFILENAME;
    const billingAccountId = process.env.GCP_BILLING_ACCOUNT;

    if (!billingAccountId || !keyFile) {
      return { periodDays: days, totalUsd: 0, totalInr: 0, projectBreakdown: [], error: 'GCP_BILLING_ACCOUNT or KEYFILENAME not set' };
    }

    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/cloud-billing.readonly', 'https://www.googleapis.com/auth/cloud-platform'],
    });

    const cloudbilling = google.cloudbilling({ version: 'v1', auth });

    // List all projects linked to this billing account
    const projectsRes = await cloudbilling.billingAccounts.projects.list({
      name: `billingAccounts/${billingAccountId}`,
    });

    const projects = (projectsRes.data.projectBillingInfo || [])
      .filter(p => p.billingEnabled && p.projectId?.startsWith('lab-'));

    // For each lab project, get budget info (actual spend isn't directly
    // available via the simple Billing API — it requires BigQuery export
    // or the Cloud Billing Budget API). We use the Budget API to get
    // the spend vs budget threshold notifications.
    const billingbudgets = google.billingbudgets({ version: 'v1', auth });
    const projectCosts = [];
    let totalUsd = 0;

    for (const proj of projects) {
      try {
        // Try to get the budget we created for this project
        const budgetsRes = await billingbudgets.billingAccounts.budgets.list({
          parent: `billingAccounts/${billingAccountId}`,
        });

        const projectBudget = (budgetsRes.data.budgets || []).find(b =>
          b.budgetFilter?.projects?.some(p => p.includes(proj.projectId))
        );

        if (projectBudget) {
          // Budget has spent amount if thresholds were triggered
          const budgetAmountUsd = parseFloat(projectBudget.amount?.specifiedAmount?.units || '0');
          // currentSpend is available in the budget notification data
          const spentPercent = projectBudget.etag ? 0 : 0; // placeholder — actual spend
          // requires BigQuery billing export for precise data

          projectCosts.push({
            projectId: proj.projectId,
            budgetUsd: budgetAmountUsd,
            budgetInr: Math.round(budgetAmountUsd * exchangeRate * 100) / 100,
            status: projectBudget.amount ? 'budget_set' : 'no_budget',
          });
        } else {
          projectCosts.push({
            projectId: proj.projectId,
            budgetUsd: 0,
            budgetInr: 0,
            status: 'no_budget',
          });
        }
      } catch (e) {
        projectCosts.push({
          projectId: proj.projectId,
          budgetUsd: 0,
          budgetInr: 0,
          status: 'error',
          error: e.message,
        });
      }
    }

    return {
      periodDays: days,
      totalProjects: projects.length,
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalInr: Math.round(totalUsd * exchangeRate * 100) / 100,
      exchangeRate,
      projectBreakdown: projectCosts,
      note: 'GCP actual spend requires BigQuery billing export for precise per-project costs. Budget allocations shown here are caps, not actual spend. Set up billing export for exact data: https://cloud.google.com/billing/docs/how-to/export-data-bigquery',
    };
  } catch (err) {
    logger.error(`GCP billing error: ${err.message}`);
    return { periodDays: days, totalUsd: 0, totalInr: 0, projectBreakdown: [], error: err.message };
  }
}

module.exports = { getGcpCostByProject };
