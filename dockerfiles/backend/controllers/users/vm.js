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

    // Multi-cloud routing: look up each VM's cloud once so Start/Stop go to the right worker queue.
    // AWS VMs use aws-start-vm/aws-stop-vm (DCV + EC2). Everything else is azure-* (legacy default).
    const cloudDocs = await VM.find({ name: { $in: vmNames } }).select('name cloud').lean();
    const cloudOf = new Map(cloudDocs.map(v => [v.name, v.cloud === 'aws' ? 'aws' : 'azure']));
    const queueFor = (vmName, op) => (cloudOf.get(vmName) === 'aws' ? `aws-${op}-vm` : `azure-${op}-vm`);

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

            /* jobid-dedup-2026-05-27: minute-bucket jobId so duplicate clicks/retries within the same minute silently coalesce */
            data.forEach(vm => queues[queueFor(vm.name, 'start')].add(vm, { jobId: `start-${vm.name}-${Math.floor(Date.now()/60000)}` }));
            return res.status(200).json({ message: "Start Request Submitted" });
        }

        // Stop: arm the cooldown BEFORE queuing so a fast Start click cannot sneak in.
        const cooldownEnd = new Date(Date.now() + STOP_COOLDOWN_MS);
        await VM.updateMany(
            { name: { $in: vmNames } },
            { $set: { stoppingUntil: cooldownEnd } }
        );
        data.forEach(vm => queues[queueFor(vm.name, 'stop')].add(vm));
        return res.status(200).json({ message: "Stop Request Submitted" });
    } catch (error) {
        logger.error("Error adding to ques", error);
        return res.status(500).json("Internal Error");
    }
}

module.exports = { handleVMOperations };
