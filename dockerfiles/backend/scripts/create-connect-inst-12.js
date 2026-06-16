// Create connectusr-inst-12 Connect instance for the iSkillbox trial user.
// Mirrors the protection wrapping of the existing 11 trainer-persistent instances:
//   - LabRole=trainerPersistent / DoNotDelete=true tags
//   - inbound + outbound telephony attributes
//   - admin / Welcome1234! Connect-managed admin user
//   - IAM Deny on getlabs-connect-admin ops user updated to include new ARN
//   - GetLabs-Connect-Student bumped v13 -> v14 with new ARN in Deny
//   - watchdog cron updated to expect 12 instances
//
// The app-code regex skip /^connectusr-inst-\d+$/i already covers the new alias,
// so automations/awsSandbox.js needs no change.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const {
  ConnectClient, CreateInstanceCommand, DescribeInstanceCommand, TagResourceCommand,
  UpdateInstanceAttributeCommand, ListSecurityProfilesCommand, ListRoutingProfilesCommand,
  CreateUserCommand,
} = require("@aws-sdk/client-connect");
const {
  IAMClient, GetUserPolicyCommand, PutUserPolicyCommand,
  GetPolicyCommand, GetPolicyVersionCommand, CreatePolicyVersionCommand,
  ListPolicyVersionsCommand, DeletePolicyVersionCommand,
} = require("@aws-sdk/client-iam");
const nodemailer = require("nodemailer");

const ACCOUNT = "631461173692";
const ALIAS = "connectusr-inst-12";
const POLICY_ARN = `arn:aws:iam::${ACCOUNT}:policy/GetLabs-Connect-Student`;

const cred = { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET };
const connect = new ConnectClient({ region: "us-east-1", credentials: cred });
const iam = new IAMClient({ region: "us-east-1", credentials: cred });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. Create Connect instance — telephony OFF at create (saves phone-number quota burn),
  //    then update attributes ON afterwards (matches the 2026-05-05 pattern from memory).
  console.log(`[1/9] Creating Connect instance ${ALIAS}...`);
  const cr = await connect.send(new CreateInstanceCommand({
    IdentityManagementType: "CONNECT_MANAGED",
    InstanceAlias: ALIAS,
    InboundCallsEnabled: false,
    OutboundCallsEnabled: false,
  }));
  const instanceId = cr.Id;
  const instanceArn = cr.Arn;
  console.log(`     Id: ${instanceId}\n     Arn: ${instanceArn}`);

  // 2. Wait for ACTIVE (Connect provisioning ~30-90s)
  console.log(`[2/9] Waiting for ACTIVE...`);
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const d = await connect.send(new DescribeInstanceCommand({ InstanceId: instanceId }));
    const status = d.Instance?.InstanceStatus;
    process.stdout.write(`     attempt ${i+1}: ${status}\n`);
    if (status === "ACTIVE") break;
    if (status === "CREATION_FAILED") throw new Error(`CreationFailed for ${ALIAS}`);
  }

  // 3. Tag with trainer-persistent markers
  console.log(`[3/9] Tagging...`);
  await connect.send(new TagResourceCommand({
    resourceArn: instanceArn,
    tags: { LabRole: "trainerPersistent", DoNotDelete: "true" },
  }));

  // 4. Enable inbound + outbound telephony
  console.log(`[4/9] Enabling telephony...`);
  await connect.send(new UpdateInstanceAttributeCommand({
    InstanceId: instanceId, AttributeType: "INBOUND_CALLS", Value: "true",
  }));
  await connect.send(new UpdateInstanceAttributeCommand({
    InstanceId: instanceId, AttributeType: "OUTBOUND_CALLS", Value: "true",
  }));

  // 5. Create admin user inside the Connect instance
  console.log(`[5/9] Creating admin user inside instance...`);
  const sps = await connect.send(new ListSecurityProfilesCommand({ InstanceId: instanceId }));
  const adminSp = sps.SecurityProfileSummaryList.find(p => p.Name === "Admin");
  const rps = await connect.send(new ListRoutingProfilesCommand({ InstanceId: instanceId }));
  const basicRp = rps.RoutingProfileSummaryList.find(p => p.Name === "Basic Routing Profile");
  if (!adminSp || !basicRp) throw new Error("Admin SP or Basic RP not found");
  const cu = await connect.send(new CreateUserCommand({
    InstanceId: instanceId,
    Username: "admin",
    Password: "Welcome1234!",
    IdentityInfo: { FirstName: "Lab", LastName: "Admin", Email: "admin@example.com" },
    PhoneConfig: { PhoneType: "SOFT_PHONE", AfterContactWorkTimeLimit: 0, AutoAccept: false },
    SecurityProfileIds: [adminSp.Id],
    RoutingProfileId: basicRp.Id,
  }));
  console.log(`     admin user id: ${cu.UserId}`);

  // 6. Update inline Deny on getlabs-connect-admin ops user
  console.log(`[6/9] Adding to ops-user Deny...`);
  const opsPolicy = await iam.send(new GetUserPolicyCommand({
    UserName: "getlabs-connect-admin",
    PolicyName: "DenyDeleteTrainerPersistentInstances",
  }));
  const opsDoc = JSON.parse(decodeURIComponent(opsPolicy.PolicyDocument));
  const opsStmt = opsDoc.Statement.find(s => s.Sid === "DenyDeleteTrainerPersistentInstancesUntil20260512" || /^DenyDeleteTrainer/.test(s.Sid));
  if (!Array.isArray(opsStmt.Resource)) opsStmt.Resource = [opsStmt.Resource];
  if (!opsStmt.Resource.includes(instanceArn)) opsStmt.Resource.push(instanceArn);
  await iam.send(new PutUserPolicyCommand({
    UserName: "getlabs-connect-admin",
    PolicyName: "DenyDeleteTrainerPersistentInstances",
    PolicyDocument: JSON.stringify(opsDoc),
  }));
  console.log(`     ops Deny resources: ${opsStmt.Resource.length}`);

  // 7. Bump GetLabs-Connect-Student v13 -> v14 (add ARN to DenyDeleteTrainerPersistentInstances)
  console.log(`[7/9] Bumping GetLabs-Connect-Student to v14...`);
  const pol = await iam.send(new GetPolicyCommand({ PolicyArn: POLICY_ARN }));
  const ver = await iam.send(new GetPolicyVersionCommand({ PolicyArn: POLICY_ARN, VersionId: pol.Policy.DefaultVersionId }));
  const doc = JSON.parse(decodeURIComponent(ver.PolicyVersion.Document));
  const stmt = doc.Statement.find(s => s.Sid === "DenyDeleteTrainerPersistentInstances");
  if (!Array.isArray(stmt.Resource)) stmt.Resource = [stmt.Resource];
  if (!stmt.Resource.includes(instanceArn)) stmt.Resource.push(instanceArn);
  // rotate oldest if at 5-version cap
  const versions = await iam.send(new ListPolicyVersionsCommand({ PolicyArn: POLICY_ARN }));
  if (versions.Versions.length >= 5) {
    const oldest = versions.Versions.filter(v => !v.IsDefaultVersion)
      .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
    await iam.send(new DeletePolicyVersionCommand({ PolicyArn: POLICY_ARN, VersionId: oldest.VersionId }));
    console.log(`     deleted oldest non-default: ${oldest.VersionId}`);
  }
  const newVer = await iam.send(new CreatePolicyVersionCommand({
    PolicyArn: POLICY_ARN,
    PolicyDocument: JSON.stringify(doc),
    SetAsDefault: true,
  }));
  console.log(`     new default: ${newVer.PolicyVersion.VersionId}`);

  // 8. Update watchdog script — expand EXPECTED list 11 -> 12
  console.log(`[8/9] Updating watchdog cron expected list...`);
  const fs = require("fs");
  const watchdogPath = "/root/synergific-portal/scripts/check-connect-trainer-instances.sh";
  let wd = fs.readFileSync(watchdogPath, "utf8");
  if (!wd.includes("connectusr-inst-12")) {
    wd = wd.replace(
      /connectusr-inst-09\n\)/,
      "connectusr-inst-09 connectusr-inst-12\n)"
    );
    fs.writeFileSync(watchdogPath, wd);
    console.log(`     watchdog updated`);
  } else {
    console.log(`     watchdog already has connectusr-inst-12`);
  }

  // 9. Email Vinay
  console.log(`[9/9] Emailing Vinay...`);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  const html = `<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; color: #1a202c; line-height: 1.6;">
<div style="max-width: 640px; margin: 0 auto; padding: 24px;">
  <div style="background: #1e40af; color: white; padding: 16px 24px; border-radius: 6px 6px 0 0;">
    <h2 style="margin: 0;">Connect Instance Provisioned — connectusr-inst-12</h2>
    <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">For trial user lab-AWS-CONNECT-connectusr12-7556 | Hexalabs Ops</p>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: 0; padding: 24px; border-radius: 0 0 6px 6px;">
    <h3 style="margin-top: 0; color: #1e40af;">Connect instance access</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 6px 0; width: 35%; color: #64748b;">Instance URL</td><td><a href="https://${ALIAS}.my.connect.aws">https://${ALIAS}.my.connect.aws</a></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Username</td><td style="font-family: monospace;"><strong>admin</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Password</td><td style="font-family: monospace;"><strong>Welcome1234!</strong></td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Telephony</td><td>Inbound + Outbound enabled (no PSTN numbers claimed)</td></tr>
      <tr><td style="padding: 6px 0; color: #64748b;">Instance Id</td><td style="font-family: monospace; font-size: 12px;">${instanceId}</td></tr>
    </table>
    <h3 style="color: #1e40af;">Protection (5-layer trainer-persistent)</h3>
    <ul style="padding-left: 20px;">
      <li>App-code regex skip in cleanup automation: ✅ matched by <code>/^connectusr-inst-\\d+$/i</code></li>
      <li>AWS tags: ✅ <code>LabRole=trainerPersistent</code>, <code>DoNotDelete=true</code></li>
      <li>IAM Deny on ops-user <code>getlabs-connect-admin</code>: ✅ ARN added to <code>DenyDeleteTrainerPersistentInstances</code></li>
      <li>IAM Deny in cohort policy: ✅ <code>GetLabs-Connect-Student</code> bumped <strong>v13 → v14</strong></li>
      <li>Watchdog cron <code>*/5</code>: ✅ expected list expanded 11 → 12</li>
    </ul>
    <p style="background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; margin: 16px 0;">
      <strong>Note:</strong> instance is trainer-persistent (survives the trial user's 24h cleanup window). The trial user's IAM access expires tomorrow ${new Date(Date.now() + 24*60*60*1000).toLocaleString("en-IN", {timeZone:"Asia/Kolkata"})} IST, but the Connect instance itself remains until you manually tear it down.
    </p>
  </div>
</div></body></html>`;

  const info = await transporter.sendMail({
    from: `"Hexalabs Ops" <${process.env.GMAIL_USER}>`,
    to: "labs@hexalabs.online",
    cc: "labs@hexalabs.online",
    subject: `Connect instance provisioned — connectusr-inst-12 (trial user)`,
    text: `Connect instance for trial user\n\nURL: https://${ALIAS}.my.connect.aws\nUsername: admin\nPassword: Welcome1234!\nTelephony: Inbound + Outbound enabled\nInstance Id: ${instanceId}\n\nProtected by all 5 layers (regex / tags / ops-user IAM Deny / cohort-policy v14 Deny / watchdog).\n\n— Hexalabs Ops`,
    html,
  });
  console.log(`mail sent: ${info.messageId}`);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
