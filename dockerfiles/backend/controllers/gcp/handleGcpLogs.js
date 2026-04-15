const Project = require('./../../models/project');
const { logger } = require('./../../plugins/logger');

async function handleGcpLogs(req, res) {
    try {
        const projectName = req.query.projectName;
        if(!projectName){
            return res.status(404).json({error: "Project ID is required to get logs"})
        }
        const data = await Project.findOne({ name: projectName }, "logs -_id");
        
        if (!data) {
            return res.status(404).json({ error: "Project not found" });
        }
        res.status(200).json(data);
    } catch (error) {
        logger.error(`Error fetching logs for project ${req.body.projectName}: ${error.message}`);
        res.status(500).json({ error: "An error occurred while fetching project logs" });
    }
}

module.exports = { handleGcpLogs };
