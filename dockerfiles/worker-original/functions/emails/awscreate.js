const Handlebars = require('handlebars');

// Function to generate the credentials table
const generateCredentialsTable = (users) => {
  let tableRows = users.map(user => `
      <tr style="background-color: #f9f9f9;">
        <td style="padding: 8px; border: 1px solid #ddd;">${user.username}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${user.password}</td>
      </tr>
    `).join('');

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-family: Arial, sans-serif;">
      <thead>
        <tr style="background-color: #4CAF50; color: white; text-align: left;">
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
const generateEmail = (users) => {
  const template = `
      <div style="width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1); font-family: Arial, sans-serif; background-color: #f4f4f4;">
        <div style="padding: 20px; background-color: #ffffff; border-radius: 8px;">
          <p style="font-size: 16px; color: #333;"><b>Dear User,</b></p>
          <p style="font-size: 16px; color: #333;">Congratulations on signing up for <b>Synergific AWS Sandbox!</b> We are excited to have you onboard and look forward to providing you with a <b>secure, flexible, and high-performance AWS cloud environment.</b></p>
          
          <p style="font-size: 16px; color: #333;">To get started, please find below your login credentials:</p>
          {{{credentialsTable}}}

          <hr style="border-top: 1px solid #ddd; margin: 20px 0;">

          <b style="font-size: 16px; color: #333;">Access Instructions:</b>
          <ul style="font-size: 16px; color: #333;">
            <li>Log in to your AWS Console at <a href="https://synergificsoftware.signin.aws.amazon.com/console" style="color: #1a73e8;">AWS Console</a> using the credentials provided above.</li>
            <li>If you encounter any issues, feel free to contact our support team.</li>
          </ul>

          <b style="font-size: 16px; color: #333;">AWS Sandbox Deployment Details:</b>
          <ul style="font-size: 16px; color: #333;">
            <li><b>VM Sizes Allowed:</b> t2.micro, t3.micro</li>
            <li><b>Disk Size Allowed:</b> 32GB gp2 and gp3 with 3000 IOPS</li>
            <li><b>IAM Configuration:</b> Access Keys, Roles & Policy Read Access</li>
            <li><b>RDS Configuration:</b> db.t2.micro, db.t3.micro, MySQL - Aurora</li>
          </ul>
          
          <p style="font-size: 16px; color: #333;">📌 Additional enabled services and any restrictions are detailed in the attached PDF.</p>
          <a href="https://www.cloudportal.co.in/aws-sandbox.pdf" style="font-size: 16px; color: #1a73e8;">Download AWS Sandbox Guide</a>    
          <b style="font-size: 16px; color: #333;">Next Steps to Get Started:</b>
          <ol style="font-size: 16px; color: #333;">
            <li>Login & Access: Sign in to your AWS Sandbox environment using the credentials provided.</li>
            <li>Deploy Your Workloads: Start provisioning VMs, databases, and other cloud services.</li>
            <li>Explore & Optimize: Experiment with various AWS features while ensuring best practices for security and cost efficiency.</li>
            <li>Need Assistance? Our support team is here to help you navigate and make the most of your AWS Sandbox.</li>
          </ol>

          <p style="font-size: 16px; color: #333;"><b>Support Contact:</b> <a href="mailto:itops@synergificsoftware.com" style="color: #1a73e8;">itops@synergificsoftware.com</a></p>
          
          <p style="font-size: 16px; color: #333;">Thank you for choosing <b>Synergific Software.</b> We look forward to supporting you on your cloud journey! 🚀</p>
          
          <p style="font-size: 16px; color: #333;">Best regards,</p>
          <p style="font-size: 16px; color: #333;"><b>Krishan Agarwal</b> <br/>
            Delivery Team <br/>
            Synergific Software Pvt. Ltd. <br/>
            <a href="mailto:krishan@synergificsoftware.com" style="color: #1a73e8;">krishan@synergificsoftware.com</a>
          </p>

          <hr style="border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 14px; color: #555;">⚠ This is an automated email. If you have any questions or need assistance, please reach out to our support team.</p>
        </div>
      </div>
    `;

  const compiledTemplate = Handlebars.compile(template);

  const data = {
    credentialsTable: generateCredentialsTable(users),
  };

  const finalMessage = compiledTemplate(data);

  return {
    subject: "Welcome to Synergific AWS Sandbox – Your Cloud Journey Begins! 🚀",
    body: finalMessage
  };
};

module.exports = { generateEmail };