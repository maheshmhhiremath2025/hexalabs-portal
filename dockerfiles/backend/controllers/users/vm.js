const queues = require('./../newQueues');
const VM = require('../../models/vm');
const { logger } = require('./../../plugins/logger');

const STOP_COOLDOWN_MS = 90 * 1000;   // covers worker's deallocate -> snapshot -> delete sequence

async function handleVMOperations(req, res) {
    const data = req.body;
    const startVm = data[0].operation === 1;
    data.shift();
    if (data.length < 1) return res.status(400).json({ message: "No vm to start" });

    const vmNames = data.map(v => v.name).filter(Boolean);

    try {
        if (startVm) {
            // Refuse Start while any selected VM is mid-stop (cooldown active)
            const now = new Date();
            const stillStopping = await VM.find({
                name: { $in: vmNames },
                stoppingUntil: { $gt: now },
            }).select('name stoppingUntil').lean();

            if (stillStopping.length > 0) {
                const longestSec = Math.max(...stillStopping.map(v =>
                    Math.ceil((new Date(v.stoppingUntil) - now) / 1000)
                ));
                return res.status(409).json({
                    message: `${stillStopping.length} VM(s) are still completing their stop sequence \u2014 please wait ${longestSec}s before starting again.`,
                    stillStopping: stillStopping.map(v => ({
                        name: v.name,
                        secondsLeft: Math.max(0, Math.ceil((new Date(v.stoppingUntil) - now) / 1000)),
                    })),
                });
            }

            data.forEach(vm => queues['azure-start-vm'].add(vm));
            return res.status(200).json({ message: "Start Request Submitted" });
        }

        // Stop: arm the cooldown BEFORE queuing so a fast Start click cannot sneak in.
        const cooldownEnd = new Date(Date.now() + STOP_COOLDOWN_MS);
        await VM.updateMany(
            { name: { $in: vmNames } },
            { $set: { stoppingUntil: cooldownEnd } }
        );
        data.forEach(vm => queues['azure-stop-vm'].add(vm));
        return res.status(200).json({ message: "Stop Request Submitted" });
    } catch (error) {
        logger.error("Error adding to ques", error);
        return res.status(500).json("Internal Error");
    }
}

module.exports = { handleVMOperations };
