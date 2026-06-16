// Provision one additional iSkillbox AWS Connect student with 24-hour access.
// Mirrors the pattern of existing connectusr01-11: full Administrator,
// CoursePolicy NOT attached (cohort runs with full Admin per Vinay 2026-05-06),
// GetLabs-Connect-Student attached for the safety-net Denies.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const {
  IAMClient, CreateUserCommand, CreateLoginProfileCommand,
  AttachUserPolicyCommand,
} = require("@aws-sdk/client-iam");
const crypto = require("crypto");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const ACCOUNT = "631461173692";
const ADMIN_ARN = "arn:aws:iam::aws:policy/AdministratorAccess";
const STUDENT_POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/GetLabs-Connect-Student`;

const cred = { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET };
const iam = new IAMClient({ region: "us-east-1", credentials: cred });

const rand4 = crypto.randomBytes(2).toString("hex");
const slug = "connectusr12";
const userName = `lab-AWS-CONNECT-${slug}-${rand4}`;
const userEmail = `${slug}@gmail.com`;
const password = `Conn${crypto.randomBytes(6).toString("hex")}A1!`;
const now = new Date();
const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

(async () => {
  // 1. Create the IAM user
  await iam.send(new CreateUserCommand({ UserName: userName, Tags: [
    { Key: "training", Value: "iskillbox-connect-2026-05" },
    { Key: "addedBy", Value: "ops-trial-24h" },
  ]}));
  console.log(`[1/5] IAM user created: ${userName}`);

  // 2. Create login profile (console password)
  await iam.send(new CreateLoginProfileCommand({
    UserName: userName, Password: password, PasswordResetRequired: false,
  }));
  console.log(`[2/5] Login profile created`);

  // 3. Attach AdministratorAccess + GetLabs-Connect-Student
  await iam.send(new AttachUserPolicyCommand({ UserName: userName, PolicyArn: ADMIN_ARN }));
  console.log(`[3/5] AdministratorAccess attached`);
  await iam.send(new AttachUserPolicyCommand({ UserName: userName, PolicyArn: STUDENT_POLICY_ARN }));
  console.log(`[4/5] GetLabs-Connect-Student attached (for safety-net Denies)`);

  // 4. Insert awsuser Mongo doc
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.db.collection("awsusers").insertOne({
    userId: userName,
    email: userEmail,
    organization: "iskillbox",
    startDate: now,
    endDate,
    deletionStatus: "none",
    sandbox: [],
    usageSessions: [],
    duration: 1,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  console.log(`[5/5] awsuser doc inserted (endDate=${endDate.toISOString()})`);
  await mongoose.disconnect();

  // 5. Mail credentials to Vinay
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  const html = `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; color: #1a202c; line-height: 1.6;">
<div style="max-width: 640px; margin: 0 auto; padding: 24px;">
  <div style="background: #1e40af; color: white; padding: 16px 24px; border-radius: 6px 6px 0 0;">
    <h2 style="margin: 0;">AWS Connect — Trial User (24-hour access)</h2>
    <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">iSkillbox cohort | full Admin | Hexalabs Ops</p>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: 0; padding: 24px; border-radius: 0 0 6px 6px;">
    <h3 style="margin-top: 0; color: #1e40af;">AWS Console login</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 0; width: 35%; color: #64748b;">Console URL</td><td><a href="https://${ACCOUNT}.signin.aws.amazon.com/console">https://${ACCOUNT}.signin.aws.amazon.com/console</a></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Account ID</td><td style="font-family: monospace;">${ACCOUNT}</td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Username</td><td style="font-family: monospace;"><strong>${userName}</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Password</td><td style="font-family: monospace;"><strong>${password}</strong></td></tr>
    </table>
    <h3 style="color: #1e40af;">Access window</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 0; width: 35%; color: #64748b;">Start</td><td>${now.toISOString()} <span style="color:#64748b;">(${now.toLocaleString("en-IN", {timeZone:"Asia/Kolkata"})} IST)</span></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">End</td><td><strong>${endDate.toISOString()}</strong> <span style="color:#64748b;">(${endDate.toLocaleString("en-IN", {timeZone:"Asia/Kolkata"})} IST)</span></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Duration</td><td>24 hours</td></tr>
    </table>
    <h3 style="color: #1e40af;">Permissions</h3>
    <ul style="padding-left: 20px;">
      <li><strong>AdministratorAccess</strong> — full AWS account permissions</li>
      <li><strong>Connect cohort safety-net Denies</strong> — cannot delete the 11 trainer-persistent Connect instances; cannot tamper with ops-user IAM</li>
      <li>Same trainer-persistent Connect instances available (mahajanrajeev / aldricinstance / connectusr-inst-01-09)</li>
    </ul>
    <p style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin: 16px 0;">
      <strong>Note:</strong> 24-hour window means the awsuser Mongo doc has endDate = ${endDate.toISOString()}. After that, the portal's nightly cleanup will full-delete this IAM user and any resources they created. Cohort budget alarm of $200/day still applies.
    </p>
  </div>
</div></body></html>`;

  const info = await transporter.sendMail({
    from: `"Hexalabs Ops" <${process.env.GMAIL_USER}>`,
    to: "labs@hexalabs.online",
    cc: "labs@hexalabs.online",
    subject: `AWS Connect trial user (24h) — ${userName}`,
    text: `AWS Connect trial user — 24-hour access window\n\nConsole: https://${ACCOUNT}.signin.aws.amazon.com/console\nAccount: ${ACCOUNT}\nUsername: ${userName}\nPassword: ${password}\n\nAccess window: ${now.toISOString()} → ${endDate.toISOString()}\nDuration: 24 hours\n\nPermissions: AdministratorAccess + GetLabs-Connect-Student v13 (safety-net Denies on the 11 trainer-persistent Connect instances).\n\n— Hexalabs Ops`,
    html,
  });
  console.log(`mail sent: ${info.messageId}`);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
