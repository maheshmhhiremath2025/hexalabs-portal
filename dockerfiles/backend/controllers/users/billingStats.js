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

module.exports = {handleGetBillingStats, handleGetLogs, handleGetVMnames}