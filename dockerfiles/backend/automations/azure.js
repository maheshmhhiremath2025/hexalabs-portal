const Training = require('./../models/training');
const VM = require('./../models/vm');
const { logger } = require('./../plugins/logger');
const queues = require('./../controllers/newQueues')

// In your automations/azure.js file
async function scheduleChecker() {
    try {
        // Get current UTC date and time
        const now = new Date();

        // Convert to IST (UTC+5:30)
        const nowIST = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

        // Get current date in YYYY-MM-DD format for comparison
        const currentDateIST = nowIST.toISOString().split('T')[0];
        
        // Extract the current IST time in HH:MM format
        const currentTimeIST = nowIST.toTimeString().substring(0, 5); 

        logger.info(`🔍 Checking for schedules at IST time: ${currentTimeIST}, Date: ${currentDateIST}`);

        // Get ALL pending schedules for today
        const trainingSchedules = await Training.aggregate([
            { $unwind: '$schedules' },
            {
                $match: {
                    'schedules.status': 'pending',
                    'schedules.date': { 
                        $lte: new Date(currentDateIST + 'T23:59:59.999Z'),
                        $gte: new Date(currentDateIST + 'T00:00:00.000Z')
                    }
                }
            },
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
            logger.info('ℹ️ No pending schedules found for today');
            return;
        }

        logger.info(`📋 Found ${trainingSchedules.length} total pending schedules for today`);

        let executedCount = 0;
        let skippedCount = 0;
        
        // Iterate over each matching training schedule
        for (const training of trainingSchedules) {
            const scheduleTime = training.schedules.time;
            
            // ✅ FIX: Execute if schedule time is <= current time (including past schedules)
            if (scheduleTime <= currentTimeIST) {
                // Check if the schedule date matches today's date
                const scheduleDate = new Date(training.schedules.date);
                const scheduleDateIST = new Date(scheduleDate.getTime() + (5.5 * 60 * 60 * 1000));
                const scheduleDateString = scheduleDateIST.toISOString().split('T')[0];

                if (scheduleDateString !== currentDateIST) {
                    logger.info(`📅 Schedule date ${scheduleDateString} doesn't match current date ${currentDateIST}, skipping`);
                    skippedCount++;
                    continue;
                }

                const { scope, targetVMs, action, _id } = training.schedules;
                
                logger.info(`🚀 Executing schedule for training: ${training.name}, Scheduled: ${scheduleTime}, Current: ${currentTimeIST}, Action: ${action}, Scope: ${scope}`);

                if (scope === 'entire') {
                    await processEntireTraining(training.name, action, _id);
                } else if (scope === 'specific' && targetVMs && targetVMs.length > 0) {
                    await processSpecificVMs(training.name, targetVMs, action, _id);
                } else {
                    logger.warn(`⚠️ Invalid scope configuration for training: ${training.name}`);
                    await Training.updateOne(
                        { name: training.name, 'schedules._id': _id },
                        { $set: { 'schedules.$.status': 'failed' } }
                    );
                }
                
                executedCount++;
            } else {
                logger.info(`⏰ Schedule for ${training.name} at ${scheduleTime} is in the future (current: ${currentTimeIST})`);
                skippedCount++;
            }
        }

        logger.info(`✅ Schedule check completed. Executed: ${executedCount}, Skipped: ${skippedCount}`);

    } catch (error) {
        logger.error('❌ Error in running schedule', error);
    }
}

async function processEntireTraining(trainingName, action, scheduleId) {
    try {
        // Find all VMs for this training
        const vmData = await VM.find({ trainingName: trainingName }, "name resourceGroup -_id").lean();

        if (vmData.length === 0) {
            logger.warn(`No VMs found for training: ${trainingName}`);
            // Mark schedule as completed since there are no VMs to process
            await Training.updateOne(
                { name: trainingName, 'schedules._id': scheduleId },
                { $set: { 'schedules.$.status': 'completed' } }
            );
            return;
        }

        let processedCount = 0;
        let failedCount = 0;

        // Process each VM
        for (const vm of vmData) {
            try {
                const jobData = {
                    name: vm.name,
                    resourceGroup: vm.resourceGroup
                };

                if (action === "stop" || action === "shut down") {
                    queues['azure-stop-vm'].add(jobData);
                    logger.info(`Added stop job for VM: ${vm.name} in training: ${trainingName}`);
                } else if (action === "start" || action === "power on") {
                    queues['azure-start-vm'].add(jobData);
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

        // Update schedule status based on processing results
        const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
        
        await Training.updateOne(
            { name: trainingName, 'schedules._id': scheduleId },
            { 
                $set: { 
                    'schedules.$.status': finalStatus,
                    'schedules.$.processedVMs': processedCount,
                    'schedules.$.failedVMs': failedCount
                } 
            }
        );

        logger.info(`Completed processing entire training: ${trainingName}. Processed: ${processedCount}, Failed: ${failedCount}`);

    } catch (error) {
        logger.error(`Error processing entire training ${trainingName}:`, error);
        // Mark as failed in case of overall error
        await Training.updateOne(
            { name: trainingName, 'schedules._id': scheduleId },
            { $set: { 'schedules.$.status': 'failed' } }
        );
    }
}

async function processSpecificVMs(trainingName, targetVMs, action, scheduleId) {
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
                    queues['azure-start-vm'].add(jobData);
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
            { name: trainingName, 'schedules._id': scheduleId },
            { 
                $set: { 
                    'schedules.$.status': finalStatus,
                    'schedules.$.processedVMs': processedCount,
                    'schedules.$.failedVMs': failedCount,
                    'schedules.$.notFoundVMs': notFoundCount
                } 
            }
        );

        logger.info(`Completed processing specific VMs for training: ${trainingName}. Processed: ${processedCount}, Failed: ${failedCount}, Not Found: ${notFoundCount}`);

    } catch (error) {
        logger.error(`Error processing specific VMs for training ${trainingName}:`, error);
        // Mark as failed in case of overall error
        await Training.updateOne(
            { name: trainingName, 'schedules._id': scheduleId },
            { $set: { 'schedules.$.status': 'failed' } }
        );
    }
}

async function quotaChecker(){
    const data = await VM.find({isRunning: true}, "name resourceGroup logs quota duration").lean()
    for(const vm of data){
        const currentTime = new Date ();
        const logIndex = vm.logs.findIndex(log => !log.stop);
        if (logIndex === -1) {
            logger.info(`No ongoing log found for VM: ${vm.name}`);
            continue;
        }
        const logStartTime = new Date(vm.logs[logIndex].start); // Ensure it's a Date object
        const totalUsage = vm.duration + (currentTime - logStartTime) / 60000; // Convert milliseconds to seconds or another unit as needed
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