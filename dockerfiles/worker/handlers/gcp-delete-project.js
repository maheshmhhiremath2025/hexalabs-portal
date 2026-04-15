const { deleteProject } = require('./../functions/gcp/manage/modifyProject');
const {logger} = require('./../plugins/logger')
const Project = require('./../models/project')

const handler = async (job) => {
  const {projectId} = job.data
  try {
    await deleteProject(projectId)
    await Project.findOneAndDelete({name: projectId})
    // await User.deleteMany({
            //     email: { $in: userEmails },
            //     userType: { $eq: 'user' }
            //   });
    logger.info(`Project Deleted: ${projectId}`)

  } catch (error) {
    logger.error(`Error Deleting Project: ${projectId}`, error)
    return new error
  }
  };
  
  module.exports = handler;
  
  