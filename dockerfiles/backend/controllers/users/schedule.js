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

// === Additive: bulk schedule management by VM (2026-05-28) ===
// Two new handlers added below the existing three. The existing
// handleGetExistingSchedule/handleDeleteSchedule/handleCreateSchedule
// are unchanged — these are purely additive endpoints exposed at
// GET  /azure/schedules/by-vm?vmName=...&status=...
// POST /azure/schedules/bulk-delete  { items[] OR filter{} }

async function handleGetSchedulesByVm(req, res) {
    const vmName = req.query.vmName;
    const status = req.query.status; // optional: 'pending'|'completed'|'missed'|'failed'
    if (!vmName) {
        return res.status(400).json({ message: "vmName query param is required" });
    }
    try {
        const match = { 'schedules.scope': 'specific', 'schedules.targetVMs': vmName };
        if (status) match['schedules.status'] = status;
        const rows = await Training.aggregate([
            { $unwind: '$schedules' },
            { $match: match },
            { $project: {
                _id: 0,
                trainingName: '$name',
                scheduleId: '$schedules._id',
                date: '$schedules.date',
                time: '$schedules.time',
                action: '$schedules.action',
                scope: '$schedules.scope',
                targetVMs: '$schedules.targetVMs',
                status: '$schedules.status',
            }},
            { $sort: { date: 1, time: 1 } }
        ]);
        res.status(200).json({ schedules: rows, count: rows.length });
    } catch (err) {
        logger.error('Error fetching schedules by VM:', err);
        res.status(500).json({ message: "Internal server error" });
    }
}

async function handleBulkDeleteSchedules(req, res) {
    const { items, filter } = req.body || {};
    try {
        // Mode A: explicit list of (trainingName, scheduleId) pairs
        if (Array.isArray(items) && items.length > 0) {
            const byTraining = {};
            for (const it of items) {
                if (!it || !it.trainingName || !it.scheduleId) continue;
                if (!byTraining[it.trainingName]) byTraining[it.trainingName] = [];
                byTraining[it.trainingName].push(it.scheduleId);
            }
            let requested = 0;
            for (const ids of Object.values(byTraining)) requested += ids.length;
            for (const [trainingName, ids] of Object.entries(byTraining)) {
                await Training.updateOne(
                    { name: trainingName },
                    { $pull: { schedules: { _id: { $in: ids } } } }
                );
            }
            logger.info(`[schedules-bulk-delete] items mode: ${requested} entries deleted across ${Object.keys(byTraining).length} trainings`);
            return res.status(200).json({ message: `Deleted ${requested} entries`, count: requested });
        }
        // Mode B: filter-based — all schedules for a VM (optionally + status)
        if (filter && filter.vmName) {
            const match = { 'schedules.scope': 'specific', 'schedules.targetVMs': filter.vmName };
            if (filter.status) match['schedules.status'] = filter.status;
            const found = await Training.aggregate([
                { $unwind: '$schedules' },
                { $match: match },
                { $count: 'n' }
            ]);
            const count = (found[0] && found[0].n) || 0;
            const pullCond = { scope: 'specific', targetVMs: filter.vmName };
            if (filter.status) pullCond.status = filter.status;
            await Training.updateMany(
                { 'schedules.targetVMs': filter.vmName },
                { $pull: { schedules: pullCond } }
            );
            logger.info(`[schedules-bulk-delete] filter mode: vm=${filter.vmName} status=${filter.status || '*'} deleted=${count}`);
            return res.status(200).json({ message: `Deleted ${count} entries`, count });
        }
        return res.status(400).json({ message: "Provide either items[] (array of {trainingName, scheduleId}) or filter{vmName,status?}" });
    } catch (err) {
        logger.error('Error bulk-deleting schedules:', err);
        res.status(500).json({ message: "Internal server error" });
    }
}

// === Additive: bulk schedule UPDATE by VM (2026-05-29) ===
// Mirrors bulk-delete shape. Editable fields (whitelist): time, action, status.
// Body modes:
//   { items: [{trainingName, scheduleId}, …], updates: { time?, action?, status? } }
//   { filter: { vmName, status? },             updates: { time?, action?, status? } }
// Returns { count, message }. The update IS persisted to Mongo via
// arrayFilters (subdoc-level $set), so this is not a UI-only mutation.

async function handleBulkUpdateSchedules(req, res) {
    const mongoose = require('mongoose');
    const { items, filter, updates } = req.body || {};

    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "Provide updates{} with at least one of: time, action, status" });
    }

    // Whitelist + validate the fields we allow to be patched in bulk.
    // Anything else is silently dropped so a malicious body can't
    // overwrite date / targetVMs / scope / _id.
    const allowed = ['time', 'action', 'status'];
    const setObj = {};
    for (const k of allowed) {
        const v = updates[k];
        if (v === undefined || v === null || v === '') continue;
        if (k === 'time' && !/^\d{2}:\d{2}$/.test(v)) {
            return res.status(400).json({ message: "time must be HH:MM (24-hour)" });
        }
        if (k === 'action' && !['start', 'stop', 'power on', 'shut down'].includes(v)) {
            return res.status(400).json({ message: "action must be start|stop|power on|shut down" });
        }
        if (k === 'status' && !['pending', 'completed', 'missed', 'failed'].includes(v)) {
            return res.status(400).json({ message: "status must be pending|completed|missed|failed" });
        }
        setObj['schedules.$[elem].' + k] = v;
    }
    if (Object.keys(setObj).length === 0) {
        return res.status(400).json({ message: "No valid update fields provided (allowed: time, action, status)" });
    }

    try {
        // Mode A: explicit list of (trainingName, scheduleId) pairs
        if (Array.isArray(items) && items.length > 0) {
            const byTraining = {};
            for (const it of items) {
                if (!it || !it.trainingName || !it.scheduleId) continue;
                if (!byTraining[it.trainingName]) byTraining[it.trainingName] = [];
                let oid;
                try { oid = new mongoose.Types.ObjectId(String(it.scheduleId)); }
                catch { oid = it.scheduleId; }
                byTraining[it.trainingName].push(oid);
            }
            let total = 0;
            for (const [trainingName, ids] of Object.entries(byTraining)) {
                await Training.updateOne(
                    { name: trainingName },
                    { $set: setObj },
                    { arrayFilters: [{ 'elem._id': { $in: ids } }] }
                );
                total += ids.length;
            }
            logger.info(`[schedules-bulk-update] items mode: ${total} entries patched across ${Object.keys(byTraining).length} trainings, fields=${Object.keys(setObj).join(',')}`);
            return res.status(200).json({ message: `Updated ${total} entries`, count: total });
        }

        // Mode B: filter-based — all schedules targeting a VM (optionally + status)
        if (filter && filter.vmName) {
            const matchStage = { 'schedules.scope': 'specific', 'schedules.targetVMs': filter.vmName };
            if (filter.status) matchStage['schedules.status'] = filter.status;
            const found = await Training.aggregate([
                { $unwind: '$schedules' },
                { $match: matchStage },
                { $count: 'n' }
            ]);
            const count = (found[0] && found[0].n) || 0;
            const af = { 'elem.scope': 'specific', 'elem.targetVMs': filter.vmName };
            if (filter.status) af['elem.status'] = filter.status;
            await Training.updateMany(
                { 'schedules.targetVMs': filter.vmName },
                { $set: setObj },
                { arrayFilters: [af] }
            );
            logger.info(`[schedules-bulk-update] filter mode: vm=${filter.vmName} status=${filter.status || '*'} patched=${count} fields=${Object.keys(setObj).join(',')}`);
            return res.status(200).json({ message: `Updated ${count} entries`, count });
        }

        return res.status(400).json({ message: "Provide either items[] (array of {trainingName, scheduleId}) or filter{vmName,status?}" });
    } catch (err) {
        logger.error('Error bulk-updating schedules:', err);
        res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = { 
    handleGetExistingSchedule, 
    handleDeleteSchedule, 
    handleCreateSchedule,
    handleGetSchedulesByVm,
    handleBulkDeleteSchedules,
    handleBulkUpdateSchedules
};