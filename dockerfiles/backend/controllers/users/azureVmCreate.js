const queues = require('./../newQueues')
const Templates = require("./../../models/templates")
const VM = require("./../../models/vm");
const { logger } = require('./../../plugins/logger');

async function handleCreateMachines(req, res) {
    const { templateName, email, trainingName, allocatedHours, createVmCount, guacamole, autoShutdown = false, idleMinutes = 15, hybridBenefit = false, expiresAt } = req.body;
    // Validate required fields
    if (!templateName || !email || !trainingName || !createVmCount)
        return res.status(400).json({ message: "Required data not received" });

    // Ensure createVmCount matches the length of the email array
    if (createVmCount != email.length)
        return res.status(400).json({ message: "Mismatch between number of VMs and emails provided" });

    try {
        // Find the template
        const templateData = await Templates.findOne({ name: templateName }, 'name creation rate kasmVnc hasXrdp -_id');
        if (!templateData)
            return res.status(404).json({ message: "Template not found" });

        const { name, rate, creation: template, kasmVnc: templateKasmVnc, hasXrdp: templateHasXrdp } = templateData;
        const currentVmCount = await VM.countDocuments({ trainingName: trainingName });

        // Loop through VM creation requests
        for (let i = 0; i < createVmCount; i++) {
            const vmName = `${trainingName}-${currentVmCount + 1 + i}`;
            const vmData = {
                vmName: vmName,
                email: email[i],
                trainingName: trainingName,
                allocatedHours: allocatedHours,
                rate: rate,
                templateName: name,
                template: template,
                kasmVnc: !!templateKasmVnc,
                hasXrdp: !!templateHasXrdp,
                guacamole: guacamole,
                autoShutdown: autoShutdown,
                idleMinutes: idleMinutes,
                hybridBenefit: hybridBenefit,
                expiresAt: expiresAt || null,
                user: req.user,
                total: createVmCount + currentVmCount
            };

            // Add VM creation request to the queue
            await queues['azure-create-vm'].add(vmData);
        }

        // Return success response
        res.status(200).json({ message: "VM Creation Request Submitted" });
    } catch (error) {
        logger.error(`Error adding to VM creation queue: ${error}`);
        res.status(500).json({ message: "Internal Server Error" });
    }
}


module.exports = { handleCreateMachines }