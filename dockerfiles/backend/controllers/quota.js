require('dotenv').config()
const User = require('./../models/user')
const { logger } = require('./../plugins/logger')
const Organization = require('./../models/organization')
const Templates = require('./../models/templates')
const Training = require('./../models/training')
const VM = require('./../models/vm')


const handleGetQuota = async (req, res) => {
    try {
        const { trainingName } = req.query;

        if (!trainingName) {
            return res.status(400).json({ message: "Training name is required." });
        }

        // Find all matching VMs and return only the quota field
        const data = await VM.find({ trainingName }, { quota: 1, _id: 0 }).lean();

        if (!data.length) {
            return res.status(404).json({ message: "No VMs found for the given training name." });
        }

        // Assuming all VMs for a given training should have the same quota structure
        const quota = data[0].quota;

        res.json(quota);
    } catch (error) {
        logger.error("Error fetching quota:", error);
        res.status(500).json({ message: "Failed to fetch quota due to a server error." });
    }
};


const handleIncreaseQuota = async (req, res) => {
    const { trainingName, increaseBy } = req.body;

    if (!increaseBy || isNaN(increaseBy) || Number(increaseBy) <= 0) {
        return res.status(400).json({ message: "Please enter a valid positive number." });
    }

    if (!trainingName) {
        return res.status(400).json({ message: "Training name is required." });
    }

    try {
        // Check if the training exists and is active
        const training = await Training.findOne({ name: trainingName });

        if (!training) {
            return res.status(404).json({ message: "Training not found." });
        }

        if (training.status === "deleted") {
            return res.status(400).json({ message: "The training is deleted. Quota cannot be increased." });
        }

        // Proceed with updating the VM documents
        const updateResponse = await VM.updateMany(
            { trainingName },
            {
                $inc: { "quota.total": Number(increaseBy) },
                $set: { isAlive: true, remarks: "Increased Quota" }
            }
        );

        if (updateResponse.modifiedCount > 0) {
            res.status(200).json({ message: `Quota increased by ${increaseBy} for all matching training VMs.` });
        } else {
            res.status(404).json({ message: "No matching training VMs found or no update performed." });
        }
    } catch (error) {
        logger.error("Error updating quota:", error);
        res.status(500).json({ message: "Failed to update quota due to a server error." });
    }
};


module.exports = {handleGetQuota, handleIncreaseQuota}