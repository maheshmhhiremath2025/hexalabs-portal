const Training = require('../../models/training');
const Templates = require('./../../models/templates')
const Organization = require('../../models/organization')
const VM = require('../../models/vm')
const Container = require('../../models/container')
const { buildAccessUrl } = require('../../services/containerService');
const { logger } = require('../../plugins/logger');
const queues = require('./../newQueues')

async function handleGetTrainingName(req, res) {
    const organization = req.query.organization;
    if (!organization) {
        return res.status(400).json({ message: "UserTag is required to get TrainingName" });
    }
    try {
        const results = await Training.find({ organization: organization }, 'name -_id').lean();
        if(results.length === 0)
            return res.status(200).json({message: "No Training Found"})
        const trainingNames = results.map(result => result.name);
        res.status(200).json({ trainingNames: trainingNames });
    } catch (error) {
        logger.error('Error fetching training names:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}
async function handleGetTemplates(req, res) {
    const organization = req.query.organization;
    if (!organization) {
        return res.status(400).json({ message: "Organization is required to get Templates" });
    }
    try {
        const results = await Organization.findOne({ organization: organization }, 'templates -_id').lean();
        if (!results || !results.templates) {
            return res.status(404).json({ message: "No templates found for the given organization" });
        }

        const templatePromises = results.templates.map(template => 
            Templates.findOne({ name: template }, "name rate display creation.licence").lean()
        );

        const templateData = await Promise.all(templatePromises);

        // Filter out null values in case any template is not found
        const validTemplateData = templateData.filter(template => template);

        res.status(200).json(validTemplateData);
    } catch (error) {
        logger.error('Error fetching template Data:', error);
        res.status(500).json({ message: "Internal server error" });
    }
}
async function handleGetMachines(req,res){
    let vm;
    const trainingName = req.query.trainingName;
    if(!trainingName)
        return res.status(400).json({message: "Training Name is required for fetching VM"})
    
    try {
         const userType = req.user.userType;
         const email = req.user.email;
         let containers = [];

        if(userType === "admin" || userType === "superadmin"){
            vm = await VM.find({trainingName: trainingName});
            containers = await Container.find({trainingName: trainingName});
         }
         else if(userType === "user"){
             vm = await VM.find({trainingName: trainingName, email: email})
             containers = await Container.find({trainingName: trainingName, email: email});
         }
         else{
            return res.status(400).json({message: "Please re-login"})
         }

         // Normalize containers to look like VMs for the frontend
         const normalizedContainers = containers.map(c => ({
           _id: c._id,
           name: c.name,
           trainingName: c.trainingName,
           email: c.email,
           os: c.os,
           adminUsername: c.username,
           adminPass: c.password,
           publicIp: buildAccessUrl(c),
           isRunning: c.isRunning,
           isAlive: c.isAlive,
           logs: c.logs,
           duration: c.duration,
           rate: c.rate,
           quota: c.quota,
           remarks: c.remarks,
           guacamole: false,
           resourceGroup: 'docker',
           // Container-specific fields
           type: 'container',
           containerId: c.containerId,
           vncPort: c.vncPort,
           hostIp: c.hostIp,
           accessUrl: buildAccessUrl(c),
           cpus: c.cpus,
           memory: c.memory,
           azureEquivalentRate: c.azureEquivalentRate,
           // Expiry fields — needed by the lab console banner, the Expires
           // column in the table, and the labExpiryChecker automation.
           expiresAt: c.expiresAt,
           expiryWarningEmailSent: c.expiryWarningEmailSent,
           extendedCount: c.extendedCount,
         }));

         // For VMs whose template has KasmVNC baked in, synthesise a
         // browser-access URL through the portal domain (handled by the
         // /kasm reverse-proxy). IP-based URLs get blocked by many
         // corporate firewalls, hence the domain route. ?password=… &
         // autoconnect=1 skips the noVNC Connect button for a true
         // one-click login.
         const apiBase = process.env.KASM_PROXY_BASE || 'https://api.getlabs.cloud';
         const vmList = (Array.isArray(vm) ? vm : []).map(v => {
           const obj = typeof v.toObject === 'function' ? v.toObject() : v;
           if (obj.kasmVnc && obj.name && !obj.accessUrl) {
             const pw = encodeURIComponent(obj.adminPass || 'Welcome1234!');
             obj.accessUrl = `${apiBase}/kasm/${obj.name}/?password=${pw}&autoconnect=1`;
           }
           return obj;
         });
         const allInstances = [...vmList, ...normalizedContainers];

         if(allInstances.length === 0)
            return res.status(200).json({message: "You don't have any instances"})
         res.status(200).json(allInstances)
    } catch (error) {
        logger.error(`Error fetching vms for ${trainingName}, user: ${email}`)
        res.status(500).json({message: "Internal Error"})
    }
}


async function handleVMRestart(req, res){
    const {vmName, resourceGroup} = req.body;
    if(!vmName || !resourceGroup)
        return res.status(400).json({message: "VM Name and Resource Group required to Restart"})
    try {
        await queues['azure-restart-vm'].add(resourceGroup, vmName)
        // await restartAzureVM(resourceGroup, vmName)
        res.status(200).json({message: 'Restarted added to que'});
    } catch (error) {
        logger.error(`Error restarting the VM ${vmName}`)
        res.status(500).json({message: "Internal Error"})
    }
}


module.exports = { handleGetTrainingName, handleGetTemplates, handleGetMachines, handleVMRestart};
