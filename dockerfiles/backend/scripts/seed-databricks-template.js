require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  const existing = await SandboxTemplate.findOne({ slug: 'azure-databricks' });
  if (existing) {
    console.log('azure-databricks template already exists, updating...');
    existing.customRoleId = '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/roleDefinitions/1043b243-4369-4a1b-a537-972204808823';
    existing.policyInitiativeId = '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/policySetDefinitions/ae62970e3e1c40d1b8dd0827';
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
      customRoleId: '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/roleDefinitions/1043b243-4369-4a1b-a537-972204808823',
      policyInitiativeId: '/subscriptions/337f2b3a-68b6-4a2e-befd-01a13f20c1d0/providers/Microsoft.Authorization/policySetDefinitions/ae62970e3e1c40d1b8dd0827',
      allowedServices: [
        { service: 'Microsoft.Databricks/workspaces', category: 'Analytics' },
      ],
    });
    console.log('Created azure-databricks template');
  }

  await mongoose.disconnect();
  process.exit(0);
})();
