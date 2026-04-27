const Training = require('../../models/training');
const VM = require('../../models/vm');
const { logger } = require('../../plugins/logger');
const queues = require('./../newQueues');

// Accepts "80", "4000-5000", or a comma-separated mix like
// "80, 443, 4000-5000". Returns normalized string entries or throws.
function parsePortInput(raw) {
    if (raw === undefined || raw === null) throw new Error('Port is required');
    const text = String(raw).trim();
    if (!text) throw new Error('Port is required');

    const out = [];
    for (const chunk of text.split(',')) {
        const piece = chunk.trim();
        if (!piece) continue;

        if (piece.includes('-')) {
            const [aStr, bStr, ...rest] = piece.split('-');
            if (rest.length) throw new Error(`Invalid port range: ${piece}`);
            const a = Number(aStr);
            const b = Number(bStr);
            if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid port range: ${piece}`);
            if (a < 1 || b > 65535 || a >= b) throw new Error(`Port range must be 1-65535 with start < end: ${piece}`);
            out.push(`${a}-${b}`);
        } else {
            const n = Number(piece);
            if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Invalid port: ${piece}`);
            out.push(String(n));
        }
    }
    if (!out.length) throw new Error('Port is required');
    return out;
}

async function getVMs(trainingName) {
    const results = await VM.find({ trainingName }, 'name resourceGroup -_id').lean();
    return {
        vmNames: results.map(r => r.name),
        resourceGroups: results.map(r => r.resourceGroup),
    };
}

async function handleGetTrainingPorts(req, res) {
    const trainingName = req.query.trainingName;
    if (!trainingName) {
        return res.status(400).json({ message: 'Training Name is required to get Ports' });
    }
    try {
        const doc = await Training.findOne({ name: trainingName }, 'ports -_id').lean();
        if (!doc) return res.status(404).json({ message: 'Training not found' });
        res.status(200).json({ ports: doc.ports || [] });
    } catch (error) {
        logger.error('Error fetching training ports:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

async function handleOpenTrainingPorts(req, res) {
    const { trainingName, port, direction = 'inbound' } = req.body;
    if (!trainingName || port === undefined) {
        return res.status(400).json({ error: 'Training Name and Port are required' });
    }

    let ports;
    try {
        ports = parsePortInput(port);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const dir = String(direction).toLowerCase();
    if (!['inbound', 'outbound', 'both'].includes(dir)) {
        return res.status(400).json({ error: `Invalid direction: ${direction}` });
    }

    try {
        const { vmNames, resourceGroups } = await getVMs(trainingName);
        if (!vmNames.length) {
            return res.status(400).json({
                error: `No Azure VMs found for training "${trainingName}". Port rules only apply to Azure training VMs.`,
            });
        }

        for (let i = 0; i < vmNames.length; i++) {
            await queues['azure-add-port'].add({
                vmName: vmNames[i],
                resourceGroup: resourceGroups[i],
                ports,
                direction: dir,
            });
        }

        // Persist to Training doc (de-duped)
        await Training.findOneAndUpdate(
            { name: trainingName },
            { $addToSet: { ports: { $each: ports } } }
        );

        res.status(200).json({
            message: `Queued ${ports.length} port rule(s) (${dir}) across ${vmNames.length} VM(s). Azure may take up to a few minutes to apply.`,
            ports,
        });
    } catch (error) {
        logger.error('Error opening port:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleCloseTrainingPorts(req, res) {
    const { trainingName, port, direction = 'inbound' } = req.body;
    if (!trainingName || port === undefined) {
        return res.status(400).json({ error: 'Training Name and Port are required' });
    }

    let ports;
    try {
        ports = parsePortInput(port);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const dir = String(direction).toLowerCase();
    if (!['inbound', 'outbound', 'both'].includes(dir)) {
        return res.status(400).json({ error: `Invalid direction: ${direction}` });
    }

    try {
        const { vmNames, resourceGroups } = await getVMs(trainingName);
        if (!vmNames.length) {
            return res.status(400).json({
                error: `No Azure VMs found for training "${trainingName}".`,
            });
        }

        for (let i = 0; i < vmNames.length; i++) {
            await queues['azure-remove-port'].add({
                vmName: vmNames[i],
                resourceGroup: resourceGroups[i],
                ports,
                direction: dir,
            });
        }

        await Training.findOneAndUpdate(
            { name: trainingName },
            { $pull: { ports: { $in: ports } } }
        );

        res.status(200).json({
            message: `Queued close for ${ports.length} port rule(s) (${dir}). Changes take a few minutes to apply.`,
            ports,
        });
    } catch (error) {
        logger.error('Error closing port:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = { handleGetTrainingPorts, handleOpenTrainingPorts, handleCloseTrainingPorts };
