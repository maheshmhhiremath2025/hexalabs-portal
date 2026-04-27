const {logger} = require('./../plugins/logger')
const VM = require('./../models/vm')
const {DeleteVMandResources} = require('./../functions/vmdeletion/azure')
const {cascadeRdsSessions} = require('./../functions/rdsCascade')
const queues = require('./../queues');


const handler = async (job) => {
  const vm = job.data
  const data = await VM.findOne({ name: vm.name }, "isRunning isAlive logs duration quota remarks -_id");
       if (data.isRunning) {
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

  logger.info(`${vm.name} is ready to be deleted`)
       }

       if(vm.guacamole){
        await queues['guacamole-remove'].add(vm.name)
      }

       await DeleteVMandResources(vm.name, vm.resourceGroup)
       await VM.findOneAndUpdate({name: vm.name}, {isAlive: false})

       // If this was an RDS host, kill the per-user session rows it spawned.
       await cascadeRdsSessions(vm.name, 'delete').catch(e =>
         logger.error(`[delete-vm] ${vm.name}: rds cascade failed — ${e.message}`)
       );

  };
  
  module.exports = handler;
  
  