const {logger} = require('./../plugins/logger')
const queues = require('./../queues');
const {createProject} = require('./../functions/gcp/manage/modifyProject')
// const Project = require('./../models/project')

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
  } catch (error) {
    logger.error(`Error creating project: ${projectId}`)
    return new error
  }
};
  
  module.exports = handler;
  
  