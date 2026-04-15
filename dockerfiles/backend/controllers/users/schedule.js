const Training = require('../../models/training');
const User = require('./../../models/user');
const { logger } = require('../../plugins/logger');

async function handleGetExistingSchedule(req, res) {
    const trainingName = req.query.trainingName;
    if (!trainingName) {
        return res.status(400).json({ message: "Training Name is required to get Schedules" });
    }

    try {
        const training = await Training.findOne({ name: trainingName }).lean();
        if (!training) {
            return res.status(404).json({ message: "Training not found" });
        }
        res.status(200).json({ schedules: training.schedules || [] });
    } catch (error) {
        logger.error('Error fetching training schedules:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}

async function handleDeleteSchedule(req, res) {
    const scheduleId = req.query.scheduleId;
    const trainingName = req.query.trainingName;
    if (!scheduleId || !trainingName) {
        return res.status(400).json({ message: "Schedule ID and Training Name are required to delete a schedule" });
    }

    try {
        await Training.findOneAndUpdate(
            { name: trainingName },
            { $pull: { schedules: { _id: scheduleId } } },
            { new: true }
        );
        res.status(200).json({ message: "Schedule deleted successfully" });
    } catch (error) {
        logger.error('Error deleting schedule:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}

async function handleCreateSchedule(req, res) {
    const { trainingName, data } = req.body;
    const { schedules, restrictLogin } = data;

    if (!trainingName || !schedules || !Array.isArray(schedules) || schedules.length === 0) {
        return res.status(400).json({ message: "Training Name and valid schedules array are required" });
    }

    try {
        // Convert frontend format to backend format
        const scheduleEntries = schedules.map((schedule) => {
            const isEntireTraining = schedule.entireTraining;
            
            return {
                date: new Date(schedule.date),
                time: schedule.time,
                action: schedule.action.toLowerCase(),
                status: 'pending',
                scope: isEntireTraining ? 'entire' : 'specific',
                targetVMs: isEntireTraining ? [] : (Array.isArray(schedule.targetVMs) ? schedule.targetVMs : [])
            };
        });

        console.log('📋 Processed schedule entries:', scheduleEntries);

        // Prepare the update object for Training
        const updateFields = {
            $push: { schedules: { $each: scheduleEntries } }
        };

        // If restrictUserLogin is true, update restrictLogin field
        if (restrictLogin?.restrictUserLogin) {
            updateFields.$set = { restrictLogin: true };
            
            // Update user access times for all users in this training
            await User.updateMany(
                { trainingName: trainingName },
                {
                    $set: {
                        loginStart: restrictLogin.userAccessOnTime || null,
                        loginStop: restrictLogin.userAccessOffTime || null
                    }
                }
            );
        }

        // Update the Training document
        const trainingResult = await Training.findOneAndUpdate(
            { name: trainingName },
            updateFields,
            { new: true, useFindAndModify: false }
        );

        if (!trainingResult) {
            return res.status(404).json({ message: "Training not found" });
        }

        res.status(200).json({ 
            message: "Schedules created successfully", 
            schedules: scheduleEntries 
        });

    } catch (error) {
        logger.error('Error creating schedules:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = { 
    handleGetExistingSchedule, 
    handleDeleteSchedule, 
    handleCreateSchedule
};