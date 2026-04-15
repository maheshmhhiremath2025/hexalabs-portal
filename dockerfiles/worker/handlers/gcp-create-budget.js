const {createBudget} = require('./../functions/gcp/manage/budgetProject')
const {logger} = require('./../plugins/logger')
const handler = async (job) => {
    const {projectId, budget} = job.data
    try {
      await createBudget(projectId, budget);
      logger.info(`Budget of: ${budget} created for Project: ${projectId}`)
    } catch (error) {
      logger.error(`Error creating Budget for Project: ${projectId}`)
      return new error
    }
  };
  
  module.exports = handler;
  
  