const Project = require('./../models/project')
const {logger} = require('./../plugins/logger')
const {addBilling} = require('./../functions/gcp/manage/modifyProject');
const queues = require('../queues');

const handler = async (job) => {
    const {projectId, instruction, budget} = job.data
try {
    const project = await Project.findOne({ name: projectId });
    
    if (!project) {
        logger.warn(`Project not found: ${projectId}`);
        return;
      }
  
      if(project.billingStatus){
        logger.info(`Project is already running: ${projectId}`)
        return
      }
    
    const timestamp = new Date();
    const logEntry = {
        operation: "Billing Added",
        time: timestamp
    };
        const data = await Project.findOne({name: projectId}, "isAlive")
        if(data.isAlive){
            await addBilling(projectId);
            await Project.findOneAndUpdate(
                { name: projectId },
                { billingStatus: true, $push: { logs: logEntry } }
            );
            logger.info(`Billing Added for: ${projectId}`)
        }
        logger.info(`Billing Canot be enabled, project is dead: ${projectId}`)

    if(instruction === "addBudget"){
        await queues['gcp-create-budget'].add(projectId, budget)
        logger.error(`Added to Budget que ${projectId}`)
    }
} catch (error) {
    logger.error(`Error in Enabling billing for: ${projectId}`)
    return new error
}
      };
  
  module.exports = handler;
  
  