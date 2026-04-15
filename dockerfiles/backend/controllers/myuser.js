require('dotenv').config();
const User = require('./../models/user');
const { logger } = require('./../plugins/logger');
const Training = require('./../models/training');

const handleGetMyUser = async (req, res) => {
    try {
        // Ensure request has user details
        if (!req.user || !req.user.userType || !req.user.organization) {
            return res.status(403).json({ message: "Unauthorized request" });
        }

        const { trainingName } = req.query;
        if (!trainingName) {
            return res.status(400).json({ message: "TrainingName parameter is required" });
        }

        // Restrict access for normal users
        if (req.user.userType === 'user') {
            return res.status(401).json({ message: "You are not authorized to view this" });
        }

        // Admin access check
        if (req.user.userType === 'admin') {
            const training = await Training.findOne({ name: trainingName }).lean();

            if (!training) {
                return res.status(404).json({ message: "Training not found" });
            }

            if (req.user.organization !== training.organization) {
                return res.status(403).json({ message: "You are not authorized to view this" });
            }
        }

        // Fetch users with filtered fields
        const schedule = await User.findOne(
            { trainingName },
            "-_id loginStart loginStop"
        ).lean();

        return res.status(200).json(schedule);
    } catch (error) {
        logger.error(`Error fetching user details for training ${req.query.trainingName}:`, error);
        return res.status(500).json({
            message: "Error retrieving user details",
            error: error.message || "Unknown error",
        });
    }
};

module.exports = { handleGetMyUser };
