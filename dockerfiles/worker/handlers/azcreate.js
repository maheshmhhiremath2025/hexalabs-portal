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
      organization: data.user.organization,
      location: data.template.location
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

    // Step 5b: Send per-student welcome email (non-blocking)
    const vmExpiresStr = data.expiresAt
      ? new Date(data.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
      : 'Contact your administrator';
    const portalLink = 'https://portal.synergificsoftware.com';
    const welcomeSubject = `[GetLabs] ${data.trainingName || data.vmName} - Your Virtual Machine is Ready`;
    const welcomeHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg, #0078D4 0%, #00BCF2 100%);border-radius:12px 12px 0 0;padding:32px 24px;text-align:center;">
        <div style="display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:4px 14px;margin-bottom:12px;">
          <span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:1.5px;">VM</span>
        </div>
        <div style="font-size:24px;font-weight:700;color:#ffffff;margin-bottom:4px;">Your Virtual Machine is Ready</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.85);">${data.trainingName || 'GetLabs Cloud Training'}</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
        <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:20px;">
          Hi there,<br><br>
          Your <strong>Virtual Machine</strong> (${data.vmName}) has been provisioned and is ready to use. Below are your login credentials.
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:16px;">
          <div style="font-weight:600;color:#1e40af;font-size:14px;margin-bottom:10px;">Step 1 - Log in to the Training Portal</div>
          <table style="width:100%;font-size:13px;">
            <tr><td style="padding:4px 0;color:#6b7280;width:100px;">Portal URL</td><td style="color:#111;"><a href="${portalLink}" style="color:#2563eb;">${portalLink}</a></td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">Email</td><td style="color:#111;font-family:monospace;">${data.email}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">Welcome1234!</td></tr>
          </table>
          <div style="font-size:11px;color:#6b7280;margin-top:8px;">After logging in, go to "My Labs" to view your resources and credentials.</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
          <div style="font-weight:600;color:#166534;font-size:14px;margin-bottom:10px;">Step 2 - Access Your Virtual Machine</div>
          <table style="width:100%;font-size:13px;">
            <tr><td style="padding:4px 0;color:#6b7280;width:110px;">Public IP</td><td style="color:#111;font-family:monospace;">${createdVm.publicIpAddress}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">Username</td><td style="color:#111;font-family:monospace;">${createdVm.adminUsername}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">Password</td><td style="color:#111;font-family:monospace;font-weight:600;">${createdVm.adminPassword}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280;">SSH</td><td style="color:#111;font-family:monospace;font-size:12px;">ssh ${createdVm.adminUsername}@${createdVm.publicIpAddress}</td></tr>
          </table>
          <div style="font-size:11px;color:#6b7280;margin-top:8px;">Use the credentials above to connect via SSH or the browser-based console in the portal.</div>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px;">
          <div style="padding:10px 16px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;">Resource Specs</div>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 16px;color:#6b7280;font-size:13px;width:100px;">Template</td><td style="padding:6px 16px;font-size:13px;color:#111;">${data.templateName}</td></tr>
            <tr><td style="padding:6px 16px;color:#6b7280;font-size:13px;">OS</td><td style="padding:6px 16px;font-size:13px;color:#111;">${data.template.os || 'Linux'}</td></tr>
          </table>
        </div>
        <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
          <div style="font-size:13px;color:#92400e;">
            <strong>Lab Expires:</strong> ${vmExpiresStr} IST<br>
            <span style="font-size:12px;">All resources will be automatically cleaned up at this time. Save your work before expiry.</span>
          </div>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;">
          <div style="font-size:12px;color:#9ca3af;">
            Need help? Reply to this email or contact your trainer.<br>
            <strong>Synergific Cloud Portal</strong> - Enterprise Cloud Training Labs
          </div>
        </div>
      </div>
    </div>`;
    queues['email-queue'].add({
      email: data.email,
      subject: welcomeSubject,
      body: welcomeHtml,
    }).catch(e => logger.error(`VM welcome email queue failed for ${data.email}: ${e.message}`));

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
