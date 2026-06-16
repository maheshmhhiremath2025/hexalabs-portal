const VM = require('./../../models/vm')
const {logger} = require('./../../plugins/logger')

async function handleGetBillingStats (req, res) {
    const trainingName = req.query.trainingName;
    if(!trainingName)
        return res.status(400).json({message: "Training Name is required for Billing"})

    try {
        const data = await VM.find({trainingName: trainingName}, "duration rate isRunning name -_id")
        let duration = 0;
        let amount = 0;
        const vmList = [];
        let status = {online: 0, offline: 0}
        for(let i = 0; i < data.length; i++){
            duration += (data[i].duration / 60);
            amount += ((data[i].duration / 60)* data[i].rate);
            data[i].isRunning ? status.online ++ : status.offline ++
            vmList.push(data[i].name)
        }
        res.status(200).json({
            Duration: duration.toFixed(2),
            Amount: amount.toFixed(2),
            Status: status,
            vmList: vmList
        });
    } catch (error) {
       logger.error(`Error fetching Billing Stats for ${trainingName}`, error)
       res.status(500).json({message: "Internal Error"})
    }
}
async function handleGetLogs (req, res) {
    const {vmName} = req.query;
    if(!vmName)
        return res.status(400).json({message: "vmName is Required for Logs"})
    try {
    const result = await VM.findOne({name: vmName}, "logs -_id")
    res.status(200).json(result.logs)
    } catch (error) {
        logger.error(`Error Fetching logs for ${vmName}`)
        res.status(500).json({message: "Internal Error"})    
    }
    
}

async function handleGetVMnames(req, res) {
    const trainingName = req.query.trainingName;
    if(!trainingName)
        return res.status(400).json({message: "Training Name is required for vmnames"})

    try {
        const data = await VM.find({trainingName: trainingName}, "name -_id")
        const vmList = [];
        for(let i = 0; i < data.length; i++){
            vmList.push(data[i].name)
        }
        res.status(200).json({
            vmList: vmList
        });
    } catch (error) {
        logger.error(`Error fetching VMNames Stats for ${trainingName}`, error)
       res.status(500).json({message: "Internal Error"})
    }

}

/* ────────────────────────────────────────────────────────────────────
 * handleGetCohortLogs — flat activity timeline across all VMs in a
 * training. Used by the redesigned Activity Log page so admins can see
 * recent sessions without picking one VM at a time. Sorted by start desc.
 *
 * Query: trainingName (req), fromDate?, toDate? (ISO), limit? (default 500, max 2000),
 *        status? (running|completed), minDurationMin?
 * Response: { events: [...], summary: { vmCount, eventCount, totalHours, runningNow } }
 * ──────────────────────────────────────────────────────────────────── */
async function handleGetCohortLogs(req, res) {
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName is required' });

    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : null;
    const toDate = req.query.toDate ? new Date(req.query.toDate) : null;
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit) || 500));
    const statusFilter = req.query.status; // 'running' | 'completed' | undefined
    const minDuration = parseInt(req.query.minDurationMin) || 0;

    try {
        const vms = await VM.find({ trainingName }, 'name email logs isRunning -_id').lean();
        const events = [];
        let runningNow = 0;
        for (const vm of vms) {
            if (vm.isRunning) runningNow++;
            const logs = vm.logs || [];
            for (const l of logs) {
                if (!l.start) continue;
                const startDate = new Date(l.start);
                if (fromDate && startDate < fromDate) continue;
                if (toDate && startDate > toDate) continue;
                const isRunning = !l.stop;
                if (statusFilter === 'running' && !isRunning) continue;
                if (statusFilter === 'completed' && isRunning) continue;
                const duration = Number(l.duration) || 0;
                if (minDuration && duration < minDuration) continue;
                events.push({
                    vmName: vm.name,
                    email: vm.email,
                    start: l.start,
                    stop: l.stop || null,
                    duration,
                    status: isRunning ? 'running' : 'completed',
                });
            }
        }
        events.sort((a, b) => new Date(b.start) - new Date(a.start));
        const truncated = events.length > limit;
        const sliced = events.slice(0, limit);
        const totalHours = events.reduce((s, e) => s + (e.duration / 60), 0);

        res.json({
            events: sliced,
            truncated,
            summary: {
                vmCount: vms.length,
                eventCount: events.length,
                totalHours: Math.round(totalHours * 100) / 100,
                runningNow,
            },
        });
    } catch (error) {
        logger.error(`Error fetching cohort logs for ${trainingName}`, error);
        res.status(500).json({ message: 'Internal Error' });
    }
}

module.exports = {handleGetBillingStats, handleGetLogs, handleGetVMnames, handleGetCohortLogs}