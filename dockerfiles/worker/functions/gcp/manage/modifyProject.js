const { ProjectsClient } = require('@google-cloud/resource-manager');
const { CloudBillingClient } = require('@google-cloud/billing');
const {logger} = require('./../../../plugins/logger'); // Using the existing logger

const billingId = process.env.BILLINGACCOUNTID;
const keyFilename = process.env.KEYFILENAME;
const parentId = process.env.PARENTID
const credentials = require(keyFilename);

// const billingId = "011BD9-202351-3CFFD0";
// const parentId = "organizations/628552726767";

async function createProject(projectId) {
  const projectsClient = new ProjectsClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
  

  // Create the project
  try {
    const [operation] = await projectsClient.createProject({
      project: {
        projectId: projectId,
        displayName: projectId,
        parent: parentId  // Ensure this is correctly formatted
      }
    });
    await operation.promise();
    logger.info(`Project ${projectId} created successfully.`);
    return projectId;

  } catch (err) {
    logger.error('Failed to create project:', err);
    return;
  }
}
async function addBilling (projectId) {

    const billingClient = new CloudBillingClient({
        credentials: credentials,
        projectId: credentials.project_id
      });

  // Link the project with the billing account
  try {
    const [billingInfo] = await billingClient.updateProjectBillingInfo({
        name: `projects/${projectId}`,
        projectBillingInfo: {
          billingAccountName: `billingAccounts/${billingId}`
        }
      });
    logger.info(`Billing enabled for ${projectId}:`, billingInfo);
  } catch (err) {
    logger.error('Failed to enable billing:', err);
    return;
  }
}
async function removeBilling(projectId) {
    const billingClient = new CloudBillingClient({
        credentials: credentials,
        projectId: credentials.project_id
    });

    // Attempt to unlink the project from its billing account
    try {
        const [billingInfo] = await billingClient.updateProjectBillingInfo({
            name: `projects/${projectId}`,
            projectBillingInfo: {
                billingAccountName: ''  // Setting this to an empty string to unlink the project
            }
        });
        logger.info(`Billing disabled for ${projectId}:`, billingInfo);
    } catch (err) {
        logger.error('Failed to disable billing:', err);
        return;
    }
}
async function deleteProject(projectId){
  const projectsClient = new ProjectsClient({
    credentials: credentials,
    projectId: credentials.project_id
  });

  // Attempt to delete the project
  try {
    const [operation] = await projectsClient.deleteProject({
      name: `projects/${projectId}`
    });
    await operation.promise();  // Wait for the delete operation to complete
    logger.info(`Project ${projectId} deleted successfully.`);
  } catch (err) {
    logger.error('Failed to delete project:', err);
    return;
  }

}

module.exports = {
  createProject,
  addBilling,
  removeBilling,
  deleteProject,
};
