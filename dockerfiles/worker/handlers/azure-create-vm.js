const { generateEmail } = require('./../functions/emails/vmCreated');
const { createVirtualMachine } = require('./../functions/vmcreation/azure');
const VM = require('./../models/vm');
const User = require('./../models/user');
const Training = require('./../models/training');
const queues = require('./../queues');
const { logger } = require('./../plugins/logger');

const handler = async (job) => {
  const data = job.data;
  logger.info(`Received job: ${JSON.stringify(data)}`);

  try {
    // Step 1: Create VM using Azure function
    const createdVm = await createVirtualMachine(data.vmName, data.template);
    if (!createdVm) {
      logger.error(`VM ${data.vmName} creation FAILED in Azure — see preceding error`);
      throw new Error(`Azure VM creation failed for ${data.vmName}`);
    }
    logger.info(`VM ${data.vmName} created successfully in Azure`, createdVm);

    // Generate a clean training name
    let trainingName = data.trainingName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Step 2: Add VM to guacamole queue if applicable
    if (data.guacamole) {
      await queues['guacamole-add'].add({
        adminUsername: createdVm.adminUsername,
        adminPassword: createdVm.adminPassword,
        os: data.template.os,
        publicIp: createdVm.publicIpAddress,
        vmName: createdVm.vmName,
      });
      logger.info(`Guacamole integration initiated for VM ${data.vmName}`, data.template.os);
    }

    // Step 3: Save VM details to the database
    const vmDetails = {
      name: data.vmName,
      templateName: data.templateName,
      logs: [{ start: new Date() }],
      rate: data.guacamole ? data.rate + 5 : data.rate,
      duration: 0,
      isRunning: true,
      guacamole: data.guacamole,
      kasmVnc: !!data.kasmVnc,
      os: data.template.os,
      trainingName: trainingName,
      email: data.email,
      resourceGroup: createdVm.resourceGroup,
      publicIp: createdVm.publicIpAddress,
      adminPass: createdVm.adminPassword,
      adminUsername: createdVm.adminUsername,
      isAlive: true,
      quota: { total: data.allocatedHours, consumed: 0 },
      remarks: 'Alive',
      autoShutdown: data.autoShutdown || false,
      idleMinutes: data.idleMinutes || 15,
      hybridBenefit: data.hybridBenefit || false,
      lastActivityAt: new Date(),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      organization: data.user.organization,
      location: data.template.location,
      vmTemplate: {
        location: data.template.location,
        vmSize: data.template.vmSize,
        osType: data.template.os || 'Windows',
        tags: {}, // Add any tags if available from template
        nicName: `${data.vmName}-nic` // Inferred from creation logic
      }
    };
    await VM.create(vmDetails);
    logger.info(`VM document created for ${data.vmName}`);

    // Step 4: Check if user exists and create if not
    const userExists = await User.findOne({ email: data.email });
    if (!userExists) {
      const newUser = {
        organization: data.user.organization,
        email: data.email,
        name: data.email,
        password: 'Welcome1234!', // Consider hashing passwords before saving
        userType: 'user',
        trainingName: trainingName
      };
      await User.create(newUser);
      logger.info(`User ${data.email} created successfully`);
    } else {
      logger.info(`User ${data.email} already exists`);
    }

    // Step 5: Update or create Training document
    const existingTraining = await Training.findOne({
      name: trainingName,
      organization: data.user.organization,
    });

    if (existingTraining) {
      existingTraining.vmUserMapping.push({
        vmName: createdVm.vmName,
        userEmail: data.email,
      });
      await existingTraining.save();
      logger.info(`Training document updated for ${trainingName} in ${data.user.organization}`);
    } else {
      const newTraining = {
        name: trainingName,
        organization: data.user.organization,
        vmUserMapping: [
          {
            vmName: createdVm.vmName,
            userEmail: data.email,
          },
        ],
        schedules: [],
        ports: data.template.os === 'Windows' ? [3389, 22] : [22],
      };
      await Training.create(newTraining);
      logger.info(`Training document created for ${trainingName} in ${data.user.organization}`);
    }

    // Step 6: Send email if all VMs are created
    const vmCount = await VM.find({ trainingName }).countDocuments();

    // Validate `job.data.total`
    if (!job.data.total || isNaN(job.data.total) || job.data.total < 1) {
      logger.error('Invalid total VM count for email notification');
      return;
    }

    logger.info(`VM count for ${trainingName}: ${vmCount}/${job.data.total}`);

    if (job.data.total === vmCount) {
      try {
        const vms = await VM.find({ trainingName }, 'name email').lean();
        const customer = job.data.user.organization;

        // Validate generated email content
        const { subject, body } = generateEmail(vms, customer);
        if (!subject || !body) {
          logger.error('Failed to generate email content, skipping email queue');
          return;
        }

        const emailData = {
          email: job.data.user.email,
          subject,
          body,
        };

        await queues['email-queue']
          .add(emailData)
          .then(() => logger.info(`Email queued for ${data.user.email} regarding training ${trainingName}`))
          .catch((err) => logger.error(`Failed to queue email for ${data.user.email}`, err));
      } catch (emailError) {
        logger.error('Error while sending email', emailError);
      }
    }
  } catch (error) {
    logger.error('Error occurred while creating and mapping VMs', error);
    throw error;
  }
};

module.exports = handler;
