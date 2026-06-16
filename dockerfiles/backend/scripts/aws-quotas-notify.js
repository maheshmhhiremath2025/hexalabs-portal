// One-shot mailer — sends 'all approved' notification when AWS Connect lab
// quota requests are fully approved. Called by check-aws-connect-quotas.sh.
require('dotenv').config({ path: __dirname + '/../.env' });
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const TO = 'labs@hexalabs.online';
const SUBJECT = 'AWS Connect lab — all 7 quota increases APPROVED';
const text = `All 7 service-quota increases for the AWS Connect lab account (631461173692, us-east-1) are now approved.

Approved quotas:
  - Amazon Connect: Instance count        -> 20
  - Lambda:         Concurrent executions -> 2000
  - VPC:            VPCs per region        -> 20
  - VPC:            Internet gateways      -> 20
  - VPC:            NAT gateways per AZ    -> 15
  - EC2:            EIPs per region        -> 25
  - EC2:            vCPU (Standard)        -> 40

Trainer can now provision the full 12-student batch.

This is an auto-notification from the prod server poller (cron self-disabled).
`;

(async () => {
  try {
    const info = await transporter.sendMail({
      from: `"Hexalabs Ops" <${process.env.GMAIL_USER}>`,
      to: TO,
      subject: SUBJECT,
      text,
    });
    console.log('sent:', info.messageId);
  } catch (e) {
    console.error('send failed:', e.message);
    process.exit(1);
  }
})();
