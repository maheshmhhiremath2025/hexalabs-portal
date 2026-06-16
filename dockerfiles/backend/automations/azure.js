const Training = require('./../models/training');
const VM = require('./../models/vm');
const { logger } = require('./../plugins/logger');
const queues = require('./../controllers/newQueues')

// scheduleChecker — runs every minute via cron in index.js.
//
// Fix history (2026-05-05):
//   - Old: $match filter scoped to 'today only' (date $gte today $lte today)
//     → any schedule that missed its window for any reason (restart, cron
//     gap, transient error) was permanently locked out — its date became
//     "yesterday" and the find never picked it up again. Verified against
//     staragilevibemay2026 cohort 2026-05-05 (Mon 18:00 Stop pending forever).
//
//   - New: drop the date-window filter. Find ALL pending schedules. For each,
//     compute the full IST datetime (date + time) and compare to now:
//        future                 → skip
//        past, within grace     → fire (catch-up)
//        past, beyond grace     → mark 'missed' (not fired)
//     Grace window is per-action: stop=6h (cost-saving still valuable late),
//     start=30min (firing 10h late wastes compute + confuses learners).
//
// 'missed' is a NEW status value — UI/list endpoints should treat it as a
// terminal state distinct from 'completed' and 'failed'.

const SCHEDULE_GRACE_HOURS = { stop: 6, start: 0.5, 'shut down': 6, 'power on': 0.5 };

async function scheduleChecker() {
    try {
        const now = new Date();
        const nowIST = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
        const currentTimeIST = nowIST.toTimeString().substring(0, 5);
        const currentDateIST = nowIST.toISOString().split('T')[0];

        logger.info(`🔍 Checking for schedules at IST time: ${currentTimeIST}, Date: ${currentDateIST}`);

        // Find ALL pending schedules — date-window evaluated per-entry below
        // using full datetime (date + time IST) so past-due entries get caught up
        // or marked 'missed' instead of silently skipped forever.
        const trainingSchedules = await Training.aggregate([
            { $unwind: '$schedules' },
            { $match: { 'schedules.status': 'pending' } },
            {
                $project: {
                    _id: 0,
                    name: 1,
                    'schedules.action': 1,
                    'schedules._id': 1,
                    'schedules.scope': 1,
                    'schedules.targetVMs': 1,
                    'schedules.date': 1,
                    'schedules.time': 1,
                    'schedules.status': 1
                }
            }
        ]);

        if (trainingSchedules.length === 0) {
            logger.info('ℹ️ No pending schedules found');
            return;
        }

        logger.info(`📋 Found ${trainingSchedules.length} total pending schedules`);

        let executedCount = 0, skippedCount = 0, missedCount = 0;

        for (const training of trainingSchedules) {
            const { date, time, action, scope, targetVMs } = training.schedules;

            // Build the schedule's intended IST wall-clock as a JS Date.
            // schedule.date is stored as YYYY-MM-DDT00:00:00Z (UTC midnight)
            // and 'time' as 'HH:mm' (IST). Combine into IST instant.
            const dateStr = new Date(date).toISOString().split('T')[0];
            const fullDateTime = new Date(`${dateStr}T${time}:00+05:30`);
            const lagMs = now.getTime() - fullDateTime.getTime();

            if (lagMs < 0) {
                logger.info(`⏰ Schedule for ${training.name} ${action} ${dateStr} ${time} IST is in the future`);
                skippedCount++;
                continue;
            }

            const graceMs = (SCHEDULE_GRACE_HOURS[action] ?? 1) * 60 * 60 * 1000;
            const lagMin = Math.round(lagMs / 60000);

            // Composite-key matcher — schedule subdocs DON'T have _id fields,
            // so the previous `'schedules._id': _id` matcher was matching
            // `undefined`, which collapsed onto the first array element via
            // the $ positional operator. Switched to date+time+action+status
            // for a unique, type-safe match.
            const matcher = {
                name: training.name,
                schedules: { $elemMatch: { date, time, action, status: 'pending' } },
            };

            if (lagMs > graceMs) {
                logger.warn(`⏭️ Schedule for ${training.name} ${action} ${dateStr} ${time} IST past ${SCHEDULE_GRACE_HOURS[action]}h grace (lag=${lagMin}min) — marking 'missed'`);
                await Training.updateOne(
                    matcher,
                    { $set: { 'schedules.$.status': 'missed', 'schedules.$.missedAt': now, 'schedules.$.missedLagMin': lagMin } }
                );
                missedCount++;
                continue;
            }

            // Within grace — fire
            logger.info(`🚀 Executing schedule for ${training.name}: ${action} ${dateStr} ${time} IST (lag=${lagMin}min, scope=${scope})`);

            if (scope === 'entire') {
                await processEntireTraining(training.name, action, { date, time });
            } else if (scope === 'specific' && targetVMs && targetVMs.length > 0) {
                await processSpecificVMs(training.name, targetVMs, action, { date, time });
            } else {
                logger.warn(`⚠️ Invalid scope for ${training.name}`);
                await Training.updateOne(
                    matcher,
                    { $set: { 'schedules.$.status': 'failed', 'schedules.$.failedAt': now, 'schedules.$.failureReason': 'invalid_scope' } }
                );
            }
            executedCount++;
        }

        logger.info(`✅ Schedule check completed. Executed: ${executedCount}, Skipped: ${skippedCount}, Missed: ${missedCount}`);

    } catch (error) {
        logger.error(`❌ Error in scheduleChecker: ${error.message}`, error);
    }
}

// scheduleKey: { date, time } — used to build a composite-key matcher since
// schedule subdocs don't have _id fields. The action is included in the
// matcher to disambiguate same-time start/stop pairs across days.
async function processEntireTraining(trainingName, action, scheduleKey) {
    const matcher = {
        name: trainingName,
        schedules: { $elemMatch: { date: scheduleKey.date, time: scheduleKey.time, action, status: 'pending' } },
    };
    try {
        const vmData = await VM.find({ trainingName: trainingName }, "name resourceGroup -_id").lean();

        if (vmData.length === 0) {
            logger.warn(`No VMs found for training: ${trainingName}`);
            await Training.updateOne(
                matcher,
                { $set: { 'schedules.$.status': 'completed', 'schedules.$.executedAt': new Date() } }
            );
            return;
        }

        let processedCount = 0;
        let failedCount = 0;

        for (const vm of vmData) {
            try {
                const jobData = { name: vm.name, resourceGroup: vm.resourceGroup };
                if (action === "stop" || action === "shut down") {
                    queues['azure-stop-vm'].add(jobData);
                    logger.info(`Added stop job for VM: ${vm.name} in training: ${trainingName}`);
                } else if (action === "start" || action === "power on") {
                    /* jobid-dedup-2026-05-27-line160 */
                    queues['azure-start-vm'].add(jobData, { jobId: `start-${jobData.name}-${Math.floor(Date.now()/60000)}` });
                    logger.info(`Added start job for VM: ${vm.name} in training: ${trainingName}`);
                } else {
                    logger.warn(`Unknown action: ${action} for VM: ${vm.name}`);
                    failedCount++;
                    continue;
                }
                processedCount++;
            } catch (vmError) {
                logger.error(`Error processing VM ${vm.name}:`, vmError);
                failedCount++;
            }
        }

        const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';

        await Training.updateOne(
            matcher,
            {
                $set: {
                    'schedules.$.status': finalStatus,
                    'schedules.$.executedAt': new Date(),
                    'schedules.$.processedVMs': processedCount,
                    'schedules.$.failedVMs': failedCount
                }
            }
        );

        logger.info(`Completed processing entire training: ${trainingName}. Processed: ${processedCount}, Failed: ${failedCount}`);

    } catch (error) {
        logger.error(`Error processing entire training ${trainingName}:`, error);
        await Training.updateOne(
            matcher,
            { $set: { 'schedules.$.status': 'failed', 'schedules.$.failedAt': new Date(), 'schedules.$.failureReason': error.message?.slice(0, 200) } }
        );
    }
}

async function processSpecificVMs(trainingName, targetVMs, action, scheduleKey) {
    const matcher = {
        name: trainingName,
        schedules: { $elemMatch: { date: scheduleKey.date, time: scheduleKey.time, action, status: 'pending' } },
    };
    try {
        let processedCount = 0;
        let failedCount = 0;
        let notFoundCount = 0;

        logger.info(`Processing specific VMs for training: ${trainingName}, VMs: ${targetVMs.join(', ')}`);

        // Process each target VM
        for (const vmName of targetVMs) {
            try {
                // Find the specific VM
                const vm = await VM.findOne({ 
                    trainingName: trainingName, 
                    name: vmName 
                }, "name resourceGroup -_id").lean();

                if (!vm) {
                    logger.warn(`VM not found: ${vmName} in training: ${trainingName}`);
                    notFoundCount++;
                    continue;
                }

                const jobData = {
                    name: vm.name,
                    resourceGroup: vm.resourceGroup
                };

                if (action === "stop" || action === "shut down") {
                    queues['azure-stop-vm'].add(jobData);
                    logger.info(`Added stop job for specific VM: ${vm.name}`);
                } else if (action === "start" || action === "power on") {
                    queues['azure-start-vm'].add(jobData, { jobId: `start-${jobData.name}-${Math.floor(Date.now()/60000)}` }); /* jobid-dedup-2026-05-27-rest */
                    logger.info(`Added start job for specific VM: ${vm.name}`);
                } else {
                    logger.warn(`Unknown action: ${action} for VM: ${vm.name}`);
                    failedCount++;
                    continue;
                }

                processedCount++;
            } catch (vmError) {
                logger.error(`Error processing specific VM ${vmName}:`, vmError);
                failedCount++;
            }
        }

        // Update schedule status based on processing results
        let finalStatus = 'completed';
        if (failedCount > 0 || notFoundCount > 0) {
            finalStatus = 'completed_with_errors';
        }
        if (processedCount === 0 && failedCount === 0 && notFoundCount === targetVMs.length) {
            finalStatus = 'failed'; // All VMs not found
        }
        
        await Training.updateOne(
            matcher,
            {
                $set: {
                    'schedules.$.status': finalStatus,
                    'schedules.$.executedAt': new Date(),
                    'schedules.$.processedVMs': processedCount,
                    'schedules.$.failedVMs': failedCount,
                    'schedules.$.notFoundVMs': notFoundCount
                }
            }
        );

        logger.info(`Completed processing specific VMs for training: ${trainingName}. Processed: ${processedCount}, Failed: ${failedCount}, Not Found: ${notFoundCount}`);

    } catch (error) {
        logger.error(`Error processing specific VMs for training ${trainingName}:`, error);
        await Training.updateOne(
            matcher,
            { $set: { 'schedules.$.status': 'failed', 'schedules.$.failedAt': new Date(), 'schedules.$.failureReason': error.message?.slice(0, 200) } }
        );
    }
}

async function quotaChecker(){
    // isAlive:false means the VM was already terminated for quota exhaustion. Skipping
    // those breaks the per-minute stop-job churn loop discovered on acedev-6 (2026-06-04)
    // where the same dead VM was queued for stop on every cron tick.
    const data = await VM.find({isRunning: true, isAlive: {$ne: false}, cloud: {$ne: "aws"}}, "name resourceGroup logs quota duration").lean()
    for(const vm of data){
        const currentTime = new Date ();
        const logIndex = vm.logs.findIndex(log => !log.stop);
        if (logIndex === -1) {
            logger.info(`No ongoing log found for VM: ${vm.name}`);
            continue;
        }
        const logStartTime = new Date(vm.logs[logIndex].start); // Ensure it's a Date object
        const totalUsage = vm.duration + (currentTime - logStartTime) / 60000; // minutes
        if(totalUsage >= vm.quota.total){
            const jobData = {
                name: vm.name,
                resourceGroup: vm.resourceGroup
            };
             queues['azure-stop-vm'].add(jobData)
        }
    }
}

module.exports = {scheduleChecker, quotaChecker};