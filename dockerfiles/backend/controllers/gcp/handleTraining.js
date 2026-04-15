// const { createProject, addBilling, removeBilling} = require("../../functions/gcp/modifyProject");
// const { modifyUsersInProject } = require("../../functions/gcp/modifyUsersInProject");
// const { createBudget, deleteBudget } = require('../../functions/gcp/budgetProject');
const queues = require('./../newQueues')
const Project = require('../../models/project');
const User = require('../../models/user');
const { logger } = require("../../plugins/logger");

async function handleCreateTraining(req, res) {
    const { trainingName, budget, autoClean, permissions, numberOfProjects, validEmails } = req.body;
    console.log(req.body)
    if (!trainingName || !permissions || !validEmails || !numberOfProjects)
        return res.status(400).json({ message: "Insufficient Data" });
    if(validEmails.length < 1)
        return res.status(400).json({message: "Need Valid Emails"})
    try {
        // Check and add users if they don't exist
        await addMissingUsers(validEmails, req.user.organization);

         const projectIds = await createProjectId(numberOfProjects, trainingName);
        let remainingEmails = [...validEmails];

        for (const projectId of projectIds) {
            const maxUsers = Math.min(remainingEmails.length, 5);
            const batchEmails = remainingEmails.slice(0, maxUsers);
            remainingEmails = remainingEmails.slice(maxUsers);

            const userBatch = batchEmails.map(email => ({
                email: email,
                role: permissions,
                budget: budget
            }));
            const projectBudget = budget * maxUsers
            // await createProject(projectId);
            queues['gcp-create-project'].add(projectId, batchEmails, permissions)
            // await modifyUsersInProject(projectId, batchEmails, true, permissions);
            const currentTime = new Date();
            await Project.create({
                name: projectId,
                trainingName: trainingName,
                billingStatus: true,
                autoClean: autoClean,
                lastClean: currentTime,
                isAlive: true,
                organization: req.user.organization,
                budget: projectBudget,
                users: userBatch
            });
               
            // await manageGCPBilling(true, projectId);
            // await createBudget(projectId, projectBudget);


        }

        res.status(201).json({ message: "Training projects created successfully" });

    } catch (error) {
        logger.error(`Error making the GCP Projects: ${error.message}`);
        return res.status(500).json({ message: "Internal Error" });
    }
}

// Function to check and add missing users
const addMissingUsers = async (emails, organization) => {
    for (const email of emails) {
        const userExists = await User.findOne(
            { 
                email: email 
            });
        if (!userExists) {

            await User.create({ 
                organization: organization,
                email: email,
                password: "Welcome1234!",
                userType: "user"
            });
        }
    }
};

// const manageGCPBilling = async (isAddBilling, projectId) => {
//     const timestamp = new Date();
//     const logEntry = {
//         operation: isAddBilling ? "Billing Added" : "Billing Removed",
//         time: timestamp
//     };

//     if (isAddBilling) {
//         const data = await Project.findOne({name: projectId}, "isAlive")
//         if(data.isAlive){
//             await addBilling(projectId);
//             await Project.findOneAndUpdate(
//                 { name: projectId },
//                 { billingStatus: true, $push: { logs: logEntry } }
//             );
//         }
//     } else {
//         await removeBilling(projectId);
//         await Project.findOneAndUpdate(
//             { name: projectId },
//             { billingStatus: false, $push: { logs: logEntry } }
//         );
//     }
// };

const createProjectId = async (numberOfProjects, trainingName) => {
    const projectIds = [];
    for (let i = 0; i < numberOfProjects; i++) {
        const projectId = `${trainingName.toLowerCase()}${i + 1}`;
        projectIds.push(projectId);
    }
    return projectIds;
};

async function handleGetTraining(req, res) {
    const organization = req.query.organization;
    if (!organization) {
        return res.status(400).json({ message: "Organization is required to get TrainingName" });
    }
    try {
        const data = await Project.find({ organization: organization }, "trainingName -_id").lean();
        const trainingName = [...new Set(data.map(project => project.trainingName))]; // Use Set to get unique values
        res.status(200).json({ trainingName: trainingName });
    } catch (error) {
        logger.error(`Error fetching Training name for organization: ${organization}`);
        res.status(500).json({ message: "Internal Error" });
    }
}

async function handleGetProject(req, res){
    const trainingName = req.query.trainingName;
    if(!trainingName){
        return res.status(400).json({message: "trainingName is required to get Projects"});
    }
    try {
        const projects = await Project.find({ trainingName: trainingName }).lean();
        res.status(200).json(projects);
        
    } catch (error) {
        logger.error(`Error fetching Project for Training: ${trainingName}`);
        res.status(500).json({ message: "Internal Error" });
    }
}

async function handleUpdateBilling(req, res){
    const {projectIds, isAddBilling} = req.body;
    try {
        for(const projectId of projectIds)
    {
        if(!isAddBilling){
            await queues['gcp-clean-project'].add({
                projectId: projectId,
                instruction: "shutdown"
            })
        }
        else{
            await queues['gcp-add-billing'].add(projectId);
        }
    }
        res.status(200).json({message: isAddBilling ? "Billing Updated" : "The Project will be cleaned and shutdown"})
    } catch (error) {
        logger.error(`Error Updating Billing for : ${projectIds}`, error)
        res.status(500).json({message: "Internal Error"})        
    }
}

async function handleCleanProject(req, res){
    const {projectIds} = req.body;
    try {
        for(const projectId of projectIds){
           await queues['gcp-clean-project'].add(projectId)
        }
        res.status(200).json({message: "Cleanup queued"})
    } catch (error) {
        logger.error(`Error cleaning the Project: ${projectIds}`);
        res.status(500).json({message: "Internal Error"})
    }
}

async function handleDeleteTraining(req, res) {
    const {trainingName} = req.query;
    try {
        const data = await Project.find({trainingName: trainingName}, "name -_id")
        const projectIds = data.map(project => project.name)
        for(const projectId of projectIds){
            await queues['gcp-remove-billing'].add({
                projectId: projectId,
                instruction: "DeleteProject"
            })
            await queues['gcp-delete-budget'].add(projectId)
        }
        res.status(200).json({message: "Training Delete Request Submitted"})    
    } catch (error) {
        logger.error(`Error Deleting training ${trainingName}`, error)
        res.status(500).json({message: "Internal Error"})
    }
    
}
module.exports = { handleCreateTraining, handleDeleteTraining, handleGetTraining, handleGetProject, handleUpdateBilling, handleCleanProject};
