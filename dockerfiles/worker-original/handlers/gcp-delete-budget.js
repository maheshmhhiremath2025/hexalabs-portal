const { deleteBudget } = require('./../functions/gcp/manage/budgetProject');
const {logger} = require('./../plugins/logger')

const handler = async (job) => {
  const {projectId} = job.data
  try {
    await deleteBudget(projectId)
    logger.info(`Budget Deleted for: ${projectId}`)
  } catch (error) {
    logger.error(`Error Deleting Budget for: ${projectId}`, error)
    return new error
  }
  };
  
  module.exports = handler;
  
  