require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  const existing = await SandboxTemplate.findOne({ slug: 'azure-databricks' });
  if (existing) {
    console.log('azure-databricks template already exists, updating...');
    existing.customRoleId = '/subscriptions/ba7b8c9b-59c4-475a-a85c-fff76751215a/providers/Microsoft.Authorization/roleDefinitions/dd15bbf4-d253-4042-a283-0ba786365fca';
    existing.policyInitiativeId = '/subscriptions/ba7b8c9b-59c4-475a-a85c-fff76751215a/providers/Microsoft.Authorization/policySetDefinitions/ae62970e3e1c40d1b8dd0827';
    await existing.save();
    console.log('Updated azure-databricks template');
  } else {
    await SandboxTemplate.create({
      name: 'Azure Databricks',
      slug: 'azure-databricks',
      cloud: 'azure',
      isActive: true,
      description: 'Azure Databricks sandbox with custom role and policy initiative for Databricks workspace access.',
      icon: 'databricks',
      sandboxConfig: {
        ttlHours: 4,
        budgetInr: 500,
        region: 'southindia',
      },
      customRoleId: '/subscriptions/ba7b8c9b-59c4-475a-a85c-fff76751215a/providers/Microsoft.Authorization/roleDefinitions/dd15bbf4-d253-4042-a283-0ba786365fca',
      policyInitiativeId: '/subscriptions/ba7b8c9b-59c4-475a-a85c-fff76751215a/providers/Microsoft.Authorization/policySetDefinitions/ae62970e3e1c40d1b8dd0827',
      allowedServices: [
        { service: 'Microsoft.Databricks/workspaces', category: 'Analytics' },
      ],
    });
    console.log('Created azure-databricks template');
  }

  await mongoose.disconnect();
  process.exit(0);
})();
