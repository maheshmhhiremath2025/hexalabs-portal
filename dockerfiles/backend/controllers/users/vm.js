const queues = require('./../newQueues')

const {logger} = require('./../../plugins/logger')

async function handleVMOperations(req, res){
    const data = req.body;
    const startVm = data[0].operation === 1;
    data.shift();
    if(data.length < 1)
        return res.status(400).json({message: "No vm to start"})
    try {
        if(startVm){

            data.forEach(vm => queues['azure-start-vm'].add(vm))
            res.status(200).json({message: "Start Request Submitted"})
        }
        else{
            data.forEach(vm => queues['azure-stop-vm'].add(vm))
            res.status(200).json({message: "Stop Request Submitted"})
        }
    } catch (error) {
        logger.error("Error adding to ques", error)
        res.status(500).json("Internal Error")
    }
    
   

    
}

module.exports = {handleVMOperations}