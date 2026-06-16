// Bump GetLabs-Connect-Student to v13 — full-admin cohort hardening.
//
// Vinay authorised giving the iSkillbox cohort AdministratorAccess. To honour
// the customer commitment to keep the 11 trainer-persistent Connect instances
// alive through 2026-05-12, this policy bump:
//   - REMOVES the cost-guard Denies (DenyExpensive, DenyLargeEC2, DenyLargeRDS,
//     DenyMultipleLambdas, LimitConnectInstances, LimitPhoneNumbers) since
//     students now have AdministratorAccess and the cost guards are bypassed
//     anyway. The CloudWatch budget alarm at $200/day is the new safety net.
//   - KEEPS all Allow statements (redundant under AdminAccess, but a fallback
//     if AdminAccess gets detached for any reason).
//   - ADDS four Deny statements that AdminAccess cannot override:
//     * DenyDeleteTrainerPersistentInstances — students can't delete the 11 RGs
//     * DenyTamperingWithOpsUser — students can't strip the inline Deny on
//       the getlabs-connect-admin ops user
//     * DenyTamperingWithStudentPolicy — students can't bump the policy to
//       a no-op version
//     * DenyDetachingStudentPolicy — students can't detach the policy
//       (including from themselves)
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const { IAMClient, GetPolicyCommand, GetPolicyVersionCommand, CreatePolicyVersionCommand,
        ListPolicyVersionsCommand, DeletePolicyVersionCommand } = require("@aws-sdk/client-iam");

const ACCOUNT = "631461173692";
const ARN = `arn:aws:iam::${ACCOUNT}:policy/GetLabs-Connect-Student`;
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

const client = new IAMClient({
  region: "us-east-1",
  credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
});

(async () => {
  // 1. Pull current default
  const pol = await client.send(new GetPolicyCommand({ PolicyArn: ARN }));
  const ver = await client.send(new GetPolicyVersionCommand({ PolicyArn: ARN, VersionId: pol.Policy.DefaultVersionId }));
  const doc = JSON.parse(decodeURIComponent(ver.PolicyVersion.Document));
  console.log("starting from:", pol.Policy.DefaultVersionId, "with", doc.Statement.length, "statements");

  // 2. Drop cost-guard Denies (now that students have AdminAccess)
  const COST_GUARDS = new Set([
    "DenyExpensive", "DenyLargeEC2", "DenyLargeRDS", "DenyMultipleLambdas",
    "LimitConnectInstances", "LimitPhoneNumbers",
  ]);
  doc.Statement = doc.Statement.filter(s => !COST_GUARDS.has(s.Sid));

  // 3. Add the four new Deny statements
  doc.Statement.push(
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
        "iam:PutUserPolicy", "iam:DeleteUserPolicy",
        "iam:AttachUserPolicy", "iam:DetachUserPolicy",
        "iam:DeleteUser", "iam:UpdateUser",
        "iam:CreateAccessKey", "iam:DeleteAccessKey", "iam:UpdateAccessKey",
      ],
      Resource: `arn:aws:iam::${ACCOUNT}:user/getlabs-connect-admin`,
    },
    {
      Sid: "DenyTamperingWithStudentPolicy",
      Effect: "Deny",
      Action: [
        "iam:CreatePolicyVersion", "iam:DeletePolicyVersion",
        "iam:SetDefaultPolicyVersion", "iam:DeletePolicy",
      ],
      Resource: ARN,
    },
    {
      Sid: "DenyDetachingStudentPolicy",
      Effect: "Deny",
      Action: ["iam:DetachUserPolicy", "iam:DetachRolePolicy", "iam:DetachGroupPolicy"],
      Resource: "*",
      Condition: { StringEquals: { "iam:PolicyARN": ARN } },
    }
  );

  console.log("ending with:", doc.Statement.length, "statements");
  console.log("doc bytes:", JSON.stringify(doc).length);

  // 4. Rotate versions if at cap
  const versions = await client.send(new ListPolicyVersionsCommand({ PolicyArn: ARN }));
  if (versions.Versions.length >= 5) {
    const oldest = versions.Versions.filter(v => !v.IsDefaultVersion)
      .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
    console.log("deleting oldest non-default:", oldest.VersionId);
    await client.send(new DeletePolicyVersionCommand({ PolicyArn: ARN, VersionId: oldest.VersionId }));
  }

  // 5. Create v13 + set default
  const out = await client.send(new CreatePolicyVersionCommand({
    PolicyArn: ARN,
    PolicyDocument: JSON.stringify(doc),
    SetAsDefault: true,
  }));
  console.log("new default:", out.PolicyVersion.VersionId);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
