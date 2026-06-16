// Grant full AdministratorAccess to the iSkillbox cohort + safety-net Deny.
// Two safety nets remain in place per Vinay's prior commitment to keep the
// 11 trainer-persistent Connect instances alive through 2026-05-12:
//   1. Inline Deny on connect:DeleteInstance for the 11 protected ARNs
//   2. Inline Deny on iam tampering against the ops user getlabs-connect-admin
//      (so a student with admin can't strip the existing Deny on that user)
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const { IAMClient, AttachUserPolicyCommand, PutUserPolicyCommand, ListUsersCommand } =
  require("@aws-sdk/client-iam");
// budgets via CLI below

const ACCOUNT = "631461173692";
const ADMIN_ARN = "arn:aws:iam::aws:policy/AdministratorAccess";
const OPS_USER_ARN = `arn:aws:iam::${ACCOUNT}:user/getlabs-connect-admin`;
const PROTECTED_INSTANCE_ARNS = [
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/30c61e49-688e-46a5-bf3a-117d4d12cec2`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/46e0c3cc-2720-451a-ba21-e75592be7249`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/539fdfca-bcbc-42fb-a5e4-d945a5d66617`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/564fde10-f4c6-422a-982d-24f450673222`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/88110635-702c-42bd-b575-f8bdfc0bd6eb`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/8b603307-3b3a-411f-b2a8-afc2c680637d`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/922c4424-9c96-427d-86d0-da5acdacaec0`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/9aed032f-33ad-4fb9-ab7d-3aaee13a47fd`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/9e807672-d719-4117-bb75-0fcd3ea082cc`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/e6c073b0-bb07-45af-a522-aba387f9726b`,
  `arn:aws:connect:us-east-1:${ACCOUNT}:instance/eb3e5c0c-f3e2-42f2-a7dc-89c62a5d30e5`,
];

const safetyNetDoc = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "DenyDeleteTrainerPersistentInstances",
      Effect: "Deny",
      Action: "connect:DeleteInstance",
      Resource: PROTECTED_INSTANCE_ARNS,
    },
    {
      Sid: "DenyTamperingWithOpsUser",
      Effect: "Deny",
      Action: [
        "iam:PutUserPolicy",
        "iam:DeleteUserPolicy",
        "iam:AttachUserPolicy",
        "iam:DetachUserPolicy",
        "iam:DeleteUser",
        "iam:UpdateUser",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:UpdateAccessKey",
      ],
      Resource: OPS_USER_ARN,
    },
  ],
};

const cred = { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET };
const iam = new IAMClient({ region: "us-east-1", credentials: cred });


(async () => {
  // 1. List target users
  const out = await iam.send(new ListUsersCommand({}));
  const targets = out.Users.filter(u => /^lab-AWS-CONNECT-/.test(u.UserName)).map(u => u.UserName);
  console.log(`Granting Admin + safety-net to ${targets.length} users:`);
  targets.forEach(n => console.log(`  - ${n}`));

  // 2. For each: attach AdministratorAccess + put inline safety-net policy
  let granted = 0, failed = [];
  for (const userName of targets) {
    try {
      await iam.send(new AttachUserPolicyCommand({ UserName: userName, PolicyArn: ADMIN_ARN }));
      await iam.send(new PutUserPolicyCommand({
        UserName: userName,
        PolicyName: "TrainerPersistentSafetyNet",
        PolicyDocument: JSON.stringify(safetyNetDoc),
      }));
      granted++;
      console.log(`  ✓ ${userName}`);
    } catch (e) {
      failed.push({ userName, err: e.message.slice(0, 120) });
    }
  }
  console.log(`\n=== granted=${granted} failed=${failed.length} ===`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));

})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
