// Fix connectusr12: portal auto-deployed a standard AWS sandbox in the wrong
// account (475184346033) when the user hit /my-sandboxes. Clean up the wrong
// sandbox, restore the Mongo doc to point at the iSkillbox IAM user in
// account 631461173692.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const {
  IAMClient, ListAttachedUserPoliciesCommand, DetachUserPolicyCommand,
  ListUserPoliciesCommand, DeleteUserPolicyCommand,
  ListAccessKeysCommand, DeleteAccessKeyCommand,
  DeleteLoginProfileCommand, DeleteUserCommand, GetLoginProfileCommand,
} = require("@aws-sdk/client-iam");
const mongoose = require("mongoose");

const STD_USER = "sb-connectusr12-kaa4";   // wrong, in 475184346033
const ISKILLBOX_USER = "lab-AWS-CONNECT-connectusr12-7556";  // correct, in 631461173692

const stdIam = new IAMClient({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_ACCESS_SECRET,
  },
});

(async () => {
  console.log(`[1/5] Cleaning up orphan IAM user ${STD_USER} in 475184346033...`);
  // Detach managed policies
  const attached = await stdIam.send(new ListAttachedUserPoliciesCommand({ UserName: STD_USER }));
  for (const p of attached.AttachedPolicies || []) {
    await stdIam.send(new DetachUserPolicyCommand({ UserName: STD_USER, PolicyArn: p.PolicyArn }));
    console.log(`     detached ${p.PolicyName}`);
  }
  // Delete inline policies
  const inline = await stdIam.send(new ListUserPoliciesCommand({ UserName: STD_USER }));
  for (const pn of inline.PolicyNames || []) {
    await stdIam.send(new DeleteUserPolicyCommand({ UserName: STD_USER, PolicyName: pn }));
    console.log(`     inline-policy deleted ${pn}`);
  }
  // Delete access keys
  const keys = await stdIam.send(new ListAccessKeysCommand({ UserName: STD_USER }));
  for (const k of keys.AccessKeyMetadata || []) {
    await stdIam.send(new DeleteAccessKeyCommand({ UserName: STD_USER, AccessKeyId: k.AccessKeyId }));
    console.log(`     access-key deleted ${k.AccessKeyId}`);
  }
  // Delete login profile (if exists)
  try {
    await stdIam.send(new GetLoginProfileCommand({ UserName: STD_USER }));
    await stdIam.send(new DeleteLoginProfileCommand({ UserName: STD_USER }));
    console.log(`     login profile deleted`);
  } catch (e) { /* no profile */ }
  // Delete user
  await stdIam.send(new DeleteUserCommand({ UserName: STD_USER }));
  console.log(`     ✓ ${STD_USER} fully deleted`);

  console.log(`[2/5] Verifying ${ISKILLBOX_USER} still exists in 631461173692...`);
  const cIam = new IAMClient({
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY,
      secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET,
    },
  });
  const { GetUserCommand } = require("@aws-sdk/client-iam");
  const u = await cIam.send(new GetUserCommand({ UserName: ISKILLBOX_USER }));
  console.log(`     ✓ exists, ARN ${u.User.Arn}`);

  console.log(`[3/5] Restoring Mongo awsusers doc...`);
  await mongoose.connect(process.env.MONGO_URI);
  const r = await mongoose.connection.db.collection("awsusers").updateOne(
    { email: "connectusr12@gmail.com" },
    {
      $set: {
        userId: ISKILLBOX_USER,
        organization: "iskillbox",
        // Restore the sandbox subdoc so /my-sandboxes shows the iSkillbox creds
        // and does NOT show a "Deploy" button that would re-trigger this bug.
        sandbox: [{
          name: ISKILLBOX_USER,
          region: "us-east-1",
          createdTime: new Date("2026-05-07T03:43:00.000Z"),
          deleteTime: new Date("2026-05-12T18:29:59.000Z"),
          status: "ready",
          accessUrl: "https://631461173692.signin.aws.amazon.com/console",
          credentials: {
            username: ISKILLBOX_USER,
            password: "Conn55efa9c2bbe7d2c4A1!",  // password from creation; visible in earlier email
          },
          allowedServices: [],
          blockedServices: [],
        }],
        updatedAt: new Date(),
      },
    }
  );
  console.log(`     Mongo updated: ${JSON.stringify(r)}`);

  console.log(`[4/5] Verifying final state...`);
  const v = await mongoose.connection.db.collection("awsusers").findOne({ email: "connectusr12@gmail.com" });
  console.log(`     userId: ${v.userId}`);
  console.log(`     sandbox[0].status: ${v.sandbox[0]?.status}`);
  console.log(`     sandbox[0].name: ${v.sandbox[0]?.name}`);

  await mongoose.disconnect();
  console.log(`[5/5] Done. connectusr12 now points at iSkillbox setup.`);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
