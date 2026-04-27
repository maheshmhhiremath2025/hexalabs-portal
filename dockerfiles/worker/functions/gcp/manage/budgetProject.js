require('dotenv').config()
const {BudgetServiceClient} = require('@google-cloud/billing-budgets');
const {logger} = require('./../../../plugins/logger'); // Using the existing logger

// Replace with the correct path to your service account key file
const billingAccountId = process.env.BILLINGACCOUNTID;
const keyFilename = process.env.KEYFILENAME;
// const keyFilename = './../../../trail-krishan-prefix-0-8f758fd2d555.json'
let _credentials;
function getCredentials() {
  if (!_credentials) _credentials = require(keyFilename);
  return _credentials;
}


// const billingAccountId = "011BD9-202351-3CFFD0";

let _budgetsClient;
function getBudgetsClient() {
  if (!_budgetsClient) _budgetsClient = new BudgetServiceClient({ credentials: getCredentials() });
  return _budgetsClient;
}

async function createBudget(projectId, budgetAmount) {
  const parent = `billingAccounts/${billingAccountId}`;
  const pubsubTopic = `projects/trail-krishan-prefix-0/topics/budget-alert-krishan`;

  const budget = {
    displayName: `${projectId}`,
    amount: {
      specifiedAmount: {
        currencyCode: 'INR',
        units: budgetAmount,
      },
    },
    budgetFilter: {
      projects: [`projects/${projectId}`],
    },
    thresholdRules: [
      {
        thresholdPercent: 0.9,
        spendBasis: 'CURRENT_SPEND',
      },
    ],
    notificationsRule: {
      pubsubTopic: pubsubTopic,
      schemaVersion: '1.0',
    },
  };

  const request = {
    parent: parent,
    budget: budget,
  };

  logger.info('Request:', JSON.stringify(request, null, 2)); // Log the request

  try {
    const [response] = await getBudgetsClient().createBudget(request);
    logger.info(`Budget ${response.name} created for project ${projectId}.`);
    return
  } catch (err) {
    logger.error('Error creating budget:', err);
  }
}
async function deleteBudget(budgetDisplayName) {
  const parent = `billingAccounts/${billingAccountId}`;

  try {
    // List all budgets to find the budget with the specified display name
    const [budgets] = await getBudgetsClient().listBudgets({ parent });

    // Find the budget with the matching display name
    const budget = budgets.find(b => b.displayName === budgetDisplayName);

    if (!budget) {
      logger.error(`Budget with display name ${budgetDisplayName} not found.`);
      return;
    }

    // Delete the budget
    await getBudgetsClient().deleteBudget({ name: budget.name });
    logger.info(`Budget ${budget.name} deleted successfully.`);
  } catch (err) {
    logger.error('Error deleting budget:', err);
  }
}

module.exports= {
  createBudget, 
  deleteBudget
}
