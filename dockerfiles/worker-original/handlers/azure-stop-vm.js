const { logger } = require('./../plugins/logger')
const VM = require('./../models/vm')
const { stopAzureVM } = require('./../functions/vmManagers')

const handler = async (job) => {
    try {

        const vm = job.data
        const data = await VM.findOne({ name: vm.name }, "isRunning isAlive logs duration quota remarks -_id");
        if (!data.isRunning) {
            return logger.error(`${vm.name} is already stopped, avoiding stop operation`);
        }

        const currentTime = new Date();

        // Find the log entry where stop is null
        const logIndex = data.logs.findIndex(log => !log.stop);
        if (logIndex === -1) {
            return logger.error(`No log entry found with a null stop time for ${vm.name}`);
        }

        const startTime = data.logs[logIndex].start;
        const duration = Math.ceil((currentTime - new Date(startTime)) / 60000);
        const mainDuration = duration + data.duration;
        const consumed = duration + data.quota.consumed;

        await stopAzureVM(vm.resourceGroup, vm.name);

        // Update the specific log entry by its index and other fields
        const updateData = {
            isRunning: false,
            [`logs.${logIndex}.stop`]: currentTime,
            [`logs.${logIndex}.duration`]: duration,
            duration: mainDuration,
            'quota.consumed': consumed,
        };

        if (consumed >= data.quota.total) {
            updateData.isAlive = false;
            updateData.remarks = "Quota Exceeded"
        }

        await VM.updateOne(
            { name: vm.name },
            { $set: updateData }
        );

        logger.info(`${vm.name} stopped sucessfully`)

    } catch (error) {
        logger.error('Error in vmStopOperator:', error);
        throw error; // Let the job handler catch and deal with this   
    }
};
module.exports = handler;

