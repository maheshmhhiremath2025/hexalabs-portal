const Project = require('./../../models/project');
const { logger } = require('./../../plugins/logger');
const queues = require('./../newQueues')

async function handleCloudFunction(req, res) {
    try {
        const { 
            budgetDisplayName, 
            costAmount, 
            budgetAmount, 
        } = req.body;

        // Validate inputs if necessary
        if (!budgetDisplayName || costAmount === undefined || !budgetAmount || typeof costAmount !== 'number' || typeof budgetAmount !== 'number' || costAmount < 0) {
            return res.status(400).json({ error: 'Invalid input parameters' });
        }
                
        const projectId = budgetDisplayName;
        const project = await Project.findOne({ name: projectId }).lean();
        if (!project) {
            logger.info(`Consider removing the Budget for ${projectId}`)
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.consumed !== costAmount) {
            await Project.findOneAndUpdate({ name: projectId }, { consumed: costAmount });
        }

        // Check if the costAmount exceeds 90% of the budgetAmount
        if (costAmount >= budgetAmount * 0.9) {
            try {
                // Perform actions
                await queues['gcp-clean-project'].add({
                    projectId: projectId,
                    instruction: "shutdown"
                })
                logger.info(`Project ${projectId} has been added to cleanup and shutdown for exceeding budget`);
                return res.status(200).json({ message: `Project ${projectId} has been sent to be disabled for exceeding budget` });
            } catch (error) {
                logger.error(`Error in disabling project ${projectId}: ${error.message}`);
                return res.status(500).json({ error: 'Error in disabling project' });
            }
        }

        // If costAmount is within limits, just respond with a success message
        return res.status(200).json({ message: 'Received Payload' });

    } catch (error) {
        logger.error(`Error in handling cloud function: ${error.message}`);
        return res.status(500).json({ error: 'Internal server error' });
    }
}


module.exports = { handleCloudFunction};
