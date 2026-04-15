const queues = require('./../controllers/newQueues')
const Project = require('./../models/project');
const {logger} = require('./../plugins/logger')

async function autoCleaner() {
    try {
        const projects = await Project.find({ isAlive: true, billingStatus: true }, "autoClean lastClean name").lean();
    
    if (projects.length < 1) {
        return;
    }

    for (const project of projects) {
        if (project.autoClean === 0) {
            continue;  // Skip to the next project
        }

        const currentTime = new Date();
        const timeElapsed = (currentTime - project.lastClean) / 3600000; // Convert ms to hours

        if (timeElapsed > project.autoClean) {
            console.log(`Auto Cleaning project: ${project.name}`);
            await queues['gcp-clean-project'].add(project.name)
        }
    }

        
    } catch (error) {
        logger.error(`Failed to autoclean`, error)
    }
}

module.exports = { autoCleaner };
