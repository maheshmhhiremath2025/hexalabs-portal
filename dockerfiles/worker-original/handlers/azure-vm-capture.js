const { logger } = require('./../plugins/logger');
const VM = require('./../models/vm');
const Templates = require("./../models/templates");
const Organization = require("./../models/organization");

const { captureSpecializedImage } = require('../functions/vmcapture');

const handler = async (job) => {
    try {
        const { vm } = job.data;

        if (!vm) {
            logger.error("No VM name provided in job data.");
            return;
        }

        const vmDetails = await VM.findOne(
            { name: vm },
            "-_id name resourceGroup os organization location templateName"
        ).lean();

        if (!vmDetails) {
            logger.warn(`VM "${vm}" not found in the database.`);
            return;
        }


        // Fetch the template document using `templateName`
        const template = await Templates.findOne({ name: vmDetails.templateName }).lean();

        if (!template) {
            logger.warn(`Template "${vmDetails.templateName}" not found in the database.`);
            return;
        }


        const vmData = {
            vmName: vmDetails.name,
            os: vmDetails.os,
            resourceGroup: vmDetails.resourceGroup,
            location: vmDetails.location,
            organization: vmDetails.organization
        };

        // Capture the specialized image
        const image = await captureSpecializedImage(vmData);
        if (!image) {
            logger.error(`Failed to capture image for VM: ${vmDetails.name}`);
            return;
        }

        logger.info(`Captured Image URL: ${image}`);

        // Generate a unique name for the new template
        const newTemplateName = `${vmDetails.templateName}-${Date.now()}`;

        // Create a new template document
        const newTemplateData = {
            ...template,
            name: newTemplateName,  // Use the newly generated unique name
            creation: {
                ...template.creation,
                imageId: image  // Replace the old imageId with the newly captured image
            }
        };

        delete newTemplateData._id; // Remove _id field to avoid duplication issues

        const newTemplate = new Templates(newTemplateData);
        await newTemplate.save();

        // Find the Organization document
        const organizationDoc = await Organization.findOne({ organization: vmDetails.organization });

        if (!organizationDoc) {
            logger.warn(`Organization "${vmDetails.organization}" not found in the database.`);
            return;
        }

        // Update the Organization document by adding the new template name to the templates array
        organizationDoc.templates.push(newTemplateName);
        await organizationDoc.save();


    } catch (error) {
        logger.error(`Worker encountered an error: ${error.message || error}`);
    }
};

module.exports = handler;
