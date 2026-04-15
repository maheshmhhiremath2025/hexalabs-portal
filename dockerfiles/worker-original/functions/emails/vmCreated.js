const Handlebars = require('handlebars');

// Function to generate the VM Table
const generateVMTable = (vms) => {
    let tableRows = vms.map(vm => `
      <tr style="background-color: #f9f9f9;">
        <td style="padding: 8px; border: 1px solid #ddd;">${vm.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${vm.email}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">Welcome1234!</td>
      </tr>
    `).join('');
    
    return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-family: Arial, sans-serif;">
      <thead>
        <tr style="background-color: #4CAF50; color: white; text-align: left;">
          <th style="padding: 8px; border: 1px solid #ddd;">VM Name</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Email ID</th>
          <th style="padding: 8px; border: 1px solid #ddd;">Password</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
};

// Function to generate the email content
const generateEmail = (vms, customer) => {
    const template = `
      <div style="width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <div style="padding: 20px; background-color: #ffffff; border-radius: 8px;">
          <p style="font-size: 16px; color: #333;">Dear {{customer}},</p>
          <p style="font-size: 16px; color: #333;">Thank you for placing an order with <b>Synergific Software</b>. We are pleased to inform you that your requested Virtual Machines (VMs) have been successfully created and are ready for use.</p>
          <p style="font-size: 16px; color: #333;">Below are the details for each of your VMs:</p>
          {{{vmTable}}}
          <hr style="border-top: 1px solid #ddd; margin: 20px 0;">
          <b style="font-size: 16px; color: #333;">Access Instructions:</b>
          <ol style="font-size: 16px; color: #333;">
            <li>Login to <a href="https://portal.synergificsoftware.com/" style="color: #1a73e8;">Integrated Cloud Portal</a>.</li>
            <li>You can find the Public IP and other details once you log in to the portal.</li>
            <li>You can access your VMs via [SSH, RDP, BROWSER (if opted)].</li>
            <li>If you encounter any issues, feel free to contact our support team (<a href="mailto:itops@synergificsoftware.com" style="color: #1a73e8;">itops@synergificsoftware.com</a>).</li>
          </ol>
          <p style="font-size: 16px; color: #333;">For security reasons, please store this information in a secure place.</p>
          <p style="font-size: 16px; color: #333;">Thank you for choosing Synergific Software. We look forward to assisting you with any further requirements.</p>
          <p style="font-size: 16px; color: #333;">Best regards,</p>
          <p style="font-size: 16px; color: #333;">Mahesh Hiremath <br/>
            Delivery Team <br/>
            Synergific Software Pvt. Ltd. <br/>
            <a href="mailto:mahesh.hiremath@synergificsoftware.com" style="color: #1a73e8;">mahesh.hiremath@synergificsoftware.com</a>
          </p>
          <hr style="border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 14px; color: #555;">This is an automated email. Kindly acknowledge the receipt of this email by replying to this message. If you have any questions or need assistance, feel free to reach out to our support team.</p>
        </div>
      </div>
    `;

    const compiledTemplate = Handlebars.compile(template);

    const data = {
        customer,
        vmTable: generateVMTable(vms),
    };

    const finalMessage = compiledTemplate(data);
    
    return {
        subject: "Your VM Order is Complete - Login Details Enclosed",
        body: finalMessage
    };
};

module.exports = {generateEmail}
