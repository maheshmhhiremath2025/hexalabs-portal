const {logger} = require('./../plugins/logger')
const queues = require('./../queues');
const {createProject} = require('./../functions/gcp/manage/modifyProject')
let gcpRestrictions;
try { gcpRestrictions = require('./../functions/sandbox-policies/gcp-restrictions'); } catch {}

const handler = async (job) => {
  const {projectId, batchEmails, permissions} = job.data
  try {
    await createProject(projectId)
    logger.info(`Project: ${projectId} created`)
    await queues['gcp-add-users'].add(projectId, batchEmails, permissions)
    logger.info(`Added to user que: ${projectId}`)
    const numUsers = batchEmails.length();
    const projectBudget = budget * numUsers
    // const currentTime = new Date();
            // await Project.create({
            //     name: projectId,
            //     trainingName: trainingName,
            //     billingStatus: true,
            //     autoClean: autoClean,
            //     lastClean: currentTime,
            //     isAlive: true,
            //     organization: req.user.organization,
            //     budget: projectBudget,
            //     users: userBatch
            // });
    logger.info(`Database object created: ${projectId}`)
    await queues['gcp-add-billing'].add({
      projectId: projectId,
      instuction: "addBudget",
      budget: projectBudget
    })
    logger.info(`Added to add billing que: ${projectId}`)

    // Apply cost restriction policies (VM size limits, etc.)
    if (gcpRestrictions) {
      try {
        await gcpRestrictions.setGcpVmRestrictions(projectId);
        logger.info(`VM restrictions applied to ${projectId}: e2/f1/g1 only`);
      } catch (pErr) {
        logger.error(`Failed to apply VM restrictions to ${projectId}: ${pErr.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error creating project: ${projectId}`)
    return new error
  }
};
  
  module.exports = handler;
  
  