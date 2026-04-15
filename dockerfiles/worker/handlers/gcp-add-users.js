const {modifyUsersInProject} = require('./../functions/gcp/manage/modifyUsersInProject')
const {logger} = require('./../plugins/logger')
const handler = async (job) => {
    const {projectId, batchEmails, permissions} = job.data;
    try {
      await modifyUsersInProject(projectId, batchEmails, true, permissions)
      logger.info(`Users Added to the Project: ${projectId}`)
    } catch (error) {
      logger.error(`Error adding Users to Project: ${projectId}`)
      return new error
    }
  };
  
  module.exports = handler;
  
  