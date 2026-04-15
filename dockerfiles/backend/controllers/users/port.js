const Training = require('../../models/training');
const VM = require('../../models/vm')
const { logger } = require('../../plugins/logger');
const queues = require('./../newQueues')

async function handleGetTrainingPorts(req, res) {
    const trainingName = req.query.trainingName;
    if (!trainingName) {
        return res.status(400).json({ message: "Training Name is required to get Ports" });
    }
    try {
        const ports = await Training.findOne({ name: trainingName }, 'ports -_id').lean();
        if (!ports) {
            return res.status(404).json({ message: "Training not found" });
        }
        res.status(200).json(ports);
    } catch (error) {
        logger.error('Error fetching training ports:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}

async function getVMs(trainingName) {
    const results = await VM.find({ trainingName }, "name resourceGroup -_id").lean();
    return {
        vmNames: results.map(result => result.name),
        resourceGroups: results.map(result => result.resourceGroup),
    };
}

async function updateTrainingPorts(trainingName, port, action) {
    const update = action === 'open' ? { $push: { ports: port } } : { $pull: { ports: port } };
    await Training.findOneAndUpdate({ name: trainingName }, update);
}


async function handleOpenTrainingPorts(req, res) {
    const { trainingName, port, priority, direction = 'inbound' } = req.body;
    if (!trainingName || !port || !priority) {
        return res.status(400).json({ message: "Training Name, Ports and Priority are required to open Ports" });
    }

    console.log('📨 Controller - Opening port with direction:', {
        trainingName,
        port,
        priority,
        direction
    });

    try {
        const { vmNames, resourceGroups } = await getVMs(trainingName);

        for (let i = 0; i < vmNames.length; i++) {
            await queues['azure-add-port'].add({
                vmName: vmNames[i],
                port: port, 
                priority: priority, 
                resourceGroup: resourceGroups[i],
                direction: direction
            });
        }

        await updateTrainingPorts(trainingName, port, 'open');
        res.status(200).json({ message: `Port ${port} opened successfully for ${direction} direction, it might take 5 mins to work` });
    } catch (error) {
        logger.error('Error opening port:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleCloseTrainingPorts(req, res) {
    const { trainingName, port, direction = 'inbound' } = req.body;
    
    if (!trainingName || !port) {
        return res.status(400).json({ message: "Training Name and Ports are required to close Ports" });
    }

    console.log('📨 Controller - Closing port with direction:', {
        trainingName,
        port,
        direction
    });

    try {
        const { vmNames, resourceGroups } = await getVMs(trainingName);

        for (let i = 0; i < vmNames.length; i++) {
            await queues['azure-remove-port'].add({
                vmName: vmNames[i],
                port: port, 
                resourceGroup: resourceGroups[i],
                direction: direction
            });
        }

        await updateTrainingPorts(trainingName, port, 'close');
        res.status(200).json({ message: `Port ${port} closed successfully for ${direction} direction, it might take 5mins to reflect` });
    } catch (error) {
        logger.error('Error closing port:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = {handleGetTrainingPorts, handleOpenTrainingPorts, handleCloseTrainingPorts}