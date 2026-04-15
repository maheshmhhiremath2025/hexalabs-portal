const Project = require('./../models/project');
const { logger } = require('./../plugins/logger');
const { removeBilling } = require('./../functions/gcp/manage/modifyProject');
const queues = require('./../queues')

const handler = async (job) => {
  const { projectId, instruction } = job.data;

  try {
    // Fetch project details
    const project = await Project.findOne({ name: projectId });

    if (!project) {
      logger.warn(`Project not found: ${projectId}`);
      return;
    }

    if(!project.billingStatus){
      logger.info(`Project is already down: ${projectId}`)
      return
    }

    // Check if consumed is 90% or more of budget
    const isOverBudget = project.budget > 0 && (project.consumed / project.budget) >= 0.9;

    // Prepare updates
    const updates = {
      billingStatus: false, // Always set billingStatus to false
    };

    if (isOverBudget) {
      updates.isAlive = false; // Mark the project as not alive
    }

    const timestamp = new Date();
    const logEntry = {
      operation: isOverBudget
        ? "Billing Removed and Project Deactivated"
        : "Billing Removed",
      time: timestamp,
    };

    // Remove billing
    await removeBilling(projectId);

    // Update project details
    await Project.findOneAndUpdate(
      { name: projectId },
      { $set: updates, $push: { logs: logEntry } }
    );

    logger.info(
      `Billing removed for project: ${projectId}${
        isOverBudget ? " and project marked as not alive due to over budget." : "."
      }`
    );

    if(instruction === "DeleteProject"){
      queues['gcp-delete-project'].add(projectId)
    }
  } catch (error) {
    logger.error(`Error in billing removal for project: ${projectId}`, error.message || error);
    throw error;
  }
};

module.exports = handler;
