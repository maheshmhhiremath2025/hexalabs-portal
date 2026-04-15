const Handlebars = require('handlebars');

// Function to generate the credentials table
const generateCredentialsTable = (users) => {
  let tableRows = users.map(user => `
    <tr style="background-color: #f9f9f9;">
      <td style="padding: 10px; border: 1px solid #ccc;">${user.email}</td>
      <td style="padding: 10px; border: 1px solid #ccc;">${user.password}</td>
    </tr>
  `).join('');

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-family: Arial, sans-serif;">
      <thead>
        <tr style="background-color: #3840b2; color: white;">
          <th style="padding: 10px; border: 1px solid #ccc;">Email ID</th>
          <th style="padding: 10px; border: 1px solid #ccc;">Password</th>
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
    <div style="max-width: 700px; margin: auto; font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px;">
      <div style="background-color: #ffffff; border-radius: 8px; padding: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
        
        <h2 style="color: #3840b2;">🚀 Welcome to Synergific Azure Sandbox!</h2>

        <p style="font-size: 16px; color: #333;">Dear User,</p>
        <p style="font-size: 16px; color: #333;">We’re excited to have you on <b>Synergific Azure Sandbox</b> — your dedicated, secure, and high-performance cloud environment for hands-on Azure exploration.</p>

        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e0e0e0;" />

        <h3 style="color: #3840b2;">🔐 Your Login Credentials</h3>
        {{{credentialsTable}}}

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;" />

        <h3 style="color: #3840b2;">📥 Getting Started – Quick Steps</h3>
        <ol style="font-size: 16px; color: #333; padding-left: 20px;">
          <li>Login to <a href="https://portal.synergificsoftware.com/" style="color: #1a73e8;">Synergific Cloud Portal</a> using the credentials above.</li>
          <li>Navigate to <b>Access Sandbox</b> &gt; Check your credits &gt; Click <b>Create Sandbox</b>.</li>
          <li>Enter a sandbox name, click <b>Create</b>, then <b>Refresh</b> to view it.</li>
          <li>Once created, <b>copy your Sandbox Name</b>.</li>
          <li>Go to <a href="https://portal.azure.com" style="color: #1a73e8;">Azure Portal</a>, search your sandbox, and begin provisioning resources.</li>
        </ol>

        <h3 style="color: #3840b2; margin-top: 30px;">⏳ Azure Sandbox Lifetime</h3>
        <ul style="font-size: 16px; color: #333; padding-left: 20px;">
          <li>Your sandbox is valid for <b>3 hours only</b>.</li>
          <li>After expiration, <b>all data and resources will be permanently deleted</b>.</li>
          <li>This action is <b>irreversible</b>, so back up any important data in time.</li>
        </ul>

        <h3 style="color: #3840b2; margin-top: 30px;">⚙ Azure Sandbox Configuration</h3>
        <ul style="font-size: 16px; color: #333; padding-left: 20px;">
          <li><b>Allowed VM Sizes:</b> B1ms, B2ms, B1s, B2s, D2s_v3, DS1_v2</li>
          <li><b>Disk Type:</b> Standard HDD only (SSD/Premium SSD restricted)</li>
          <li><b>OS Images:</b> Ubuntu, Windows Server, RHEL, Oracle Linux</li>
          <li><b>Kubernetes Clusters:</b> Dev/Test preset (Free/Standard tiers), D2as_v4 nodes</li>
          <li><b>Container Registry:</b> Regions: East US, East US 2, West US, Central US (Plans: Basic/Standard)</li>
        </ul>

<p style="font-size: 16px; color: #333;">
  📄 Please refer to the 
  <a href="https://portal.synergificsoftware.com/azure-sandbox.pdf" style="color: #1a73e8; text-decoration: none;" target="_blank">
    Azure Sandbox Guide (PDF)
  </a> 
  for full guidelines and allowed services.
</p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;" />

        <h3 style="color: #3840b2;">💬 Need Help?</h3>
        <p style="font-size: 16px; color: #333;">Our support team is here to assist you at <a href="mailto:itops@synergificsoftware.com" style="color: #1a73e8;">itops@synergificsoftware.com</a>.</p>

        <p style="font-size: 16px; color: #333;">Thank you for choosing <b>Synergific Software</b>. We look forward to supporting your cloud journey!</p>

        <p style="font-size: 16px; color: #333;">Warm regards,<br/>
          <b>Mahesh Hiremath</b><br/>
          Delivery Team | Synergific Software Pvt. Ltd.<br/>
          📧 <a href="mailto:mahesh.hiremath@synergificsoftware.com" style="color: #1a73e8;">mahesh.hiremath@synergificsoftware.com</a>
        </p>

        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ccc;" />
        <p style="font-size: 14px; color: #777;">⚠ This is an automated email. For any queries, reach out to our support team.</p>
      </div>
    </div>
  `;

  const compiledTemplate = Handlebars.compile(template);

  const data = {
    credentialsTable: generateCredentialsTable(users),
  };

  const finalMessage = compiledTemplate(data);

  return {
    subject: "Welcome to Synergific Azure Sandbox – Access Details Inside 🚀",
    body: finalMessage
  };
};

module.exports = { generateEmail };
