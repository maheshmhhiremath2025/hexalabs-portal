const { projectCleaner, manageGCPBilling } = require('./../../controllers/gcp/handleTraining');
const Project = require('./../../models/project');
const { logger } = require('./../../plugins/logger');

async function handleCloudFunction(req, res) {
    try {
        const { 
            budgetDisplayName, 
            costAmount, 
            costIntervalStart, 
            budgetAmount, 
            budgetAmountType, 
            currencyCode 
        } = req.body;
        // Validate inputs if necessary
        if (!budgetDisplayName || costAmount === undefined || !budgetAmount) {
            return res.status(400).json({ error: 'Invalid input parameters' });
        }
         logger.info(`${budgetDisplayName} amount: ${costAmount} budget: ${budgetAmount}`)
        
      
        // Check if the costAmount exceeds 90% of the budgetAmount
        if (costAmount >= budgetAmount * 0.9) {
            const projectId = budgetDisplayName;

            // Perform actions
            await projectCleaner(projectId);
            await manageGCPBilling(false, projectId);
            await Project.findOneAndUpdate({ name: projectId }, { isAlive: false });

            logger.info(`Project ${projectId} has been disabled for exceeding budget`);
            return res.status(200).json({ message: `Recieved Payload` });
        }

        // If costAmount is within limits, just respond with a success message
        res.status(200).json({ message: 'Recieved Payload' });

    } catch (error) {
        logger.error(`Error in disabling the project for exceeding budget: ${error.message}`);
        res.status(200).json({ message: 'Recieved Payload' });
    }
}

module.exports = { handleCloudFunction };
