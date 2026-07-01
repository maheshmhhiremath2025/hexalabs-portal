const queues = require('./../newQueues')
const Templates = require("./../../models/templates")
const VM = require("./../../models/vm");
const { logger } = require('./../../plugins/logger');
const MARKETPLACE_IMAGES = require('./../../config/marketplaceImages');

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
        const templateData = await Templates.findOne({ name: templateName }, 'name creation rate kasmVnc hasXrdp cloud dcv -_id');
        if (!templateData)
            return res.status(404).json({ message: "Template not found" });

        const { name, rate, creation: template, kasmVnc: templateKasmVnc, hasXrdp: templateHasXrdp, cloud: templateCloud, dcv: templateDcv } = templateData;
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

            // Add VM creation request to the queue — route by cloud
            const queueName = (templateCloud === 'aws' || template?.cloud === 'aws') ? 'aws-create-vm' : 'azure-create-vm';
            await queues[queueName].add(vmData);
        }

        // Return success response
        res.status(200).json({ message: "VM Creation Request Submitted" });
    } catch (error) {
        logger.error(`Error adding to VM creation queue: ${error}`);
        res.status(500).json({ message: "Internal Server Error" });
    }
}


/**
 * Return the marketplace image catalog to the frontend.
 */
async function handleGetMarketplaceImages(req, res) {
    const images = Object.entries(MARKETPLACE_IMAGES).map(([id, cfg]) => ({
        id,
        label: cfg.label,
        os: cfg.os,
        icon: cfg.icon,
        defaultVmSize: cfg.defaultVmSize,
        defaultDiskGB: cfg.defaultDiskGB,
        planRequired: cfg.planRequired || false,
    }));
    res.json(images);
}

/**
 * Create fresh VMs from Azure Marketplace images (no pre-built template needed).
 * Admin + Superadmin only.
 */
async function handleCreateFreshVMs(req, res) {
    const {
        marketplaceImageId, email, trainingName, allocatedHours,
        createVmCount, guacamole, autoShutdown = false, idleMinutes = 15,
        vmSize, resourceGroup, location, vnet, expiresAt, rate, diskSizeGB,
    } = req.body;

    if (!['admin', 'superadmin'].includes(req.user?.userType)) {
        return res.status(403).json({ message: 'Admin or Superadmin access required' });
    }

    if (!marketplaceImageId || !email || !trainingName || !createVmCount || !resourceGroup || !vnet) {
        return res.status(400).json({ message: 'Required fields missing' });
    }
    if (createVmCount != email.length) {
        return res.status(400).json({ message: 'Mismatch between VM count and emails' });
    }

    const imageConfig = MARKETPLACE_IMAGES[marketplaceImageId];
    if (!imageConfig) {
        return res.status(400).json({ message: `Unknown marketplace image: ${marketplaceImageId}` });
    }

    if (diskSizeGB && diskSizeGB < imageConfig.defaultDiskGB) {
        return res.status(400).json({ message: `Disk size cannot be less than image default (${imageConfig.defaultDiskGB} GB)` });
    }

    try {
        // Build a synthetic template that the worker handler expects
        const syntheticTemplate = {
            resourceGroup,
            vmSize: vmSize || imageConfig.defaultVmSize,
            location: location || 'southindia',
            os: imageConfig.os,
            vnet,
            licence: imageConfig.licence,
            // Marketplace image reference (no imageId)
            publisher: imageConfig.publisher,
            offer: imageConfig.offer,
            sku: imageConfig.sku,
            marketplaceVersion: imageConfig.version,
            // Plan block (for Rocky Linux etc.)
            planPublisher: imageConfig.planRequired ? imageConfig.planPublisher : undefined,
            product: imageConfig.planRequired ? imageConfig.product : undefined,
            version: imageConfig.planRequired ? imageConfig.planName : undefined,
            securityType: imageConfig.securityType || 'TrustedLaunch',
            diskSizeGB: (diskSizeGB && diskSizeGB > 0) ? diskSizeGB : undefined,
        };

        const currentVmCount = await VM.countDocuments({ trainingName });

        for (let i = 0; i < createVmCount; i++) {
            const vmName = `${trainingName}-${currentVmCount + 1 + i}`;
            const vmData = {
                vmName,
                email: email[i],
                trainingName,
                allocatedHours,
                rate: rate || 15,
                templateName: `marketplace:${imageConfig.label}`,
                template: syntheticTemplate,
                kasmVnc: false,
                hasXrdp: false,
                guacamole: guacamole || false,
                autoShutdown,
                idleMinutes,
                expiresAt: expiresAt || null,
                user: req.user,
                total: createVmCount + currentVmCount,
            };
            await queues['azure-create-vm'].add(vmData);
        }

        res.status(200).json({ message: 'Marketplace VM creation request submitted' });
    } catch (error) {
        logger.error(`Error creating marketplace VMs: ${error}`);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

module.exports = { handleCreateMachines, handleCreateFreshVMs, handleGetMarketplaceImages }