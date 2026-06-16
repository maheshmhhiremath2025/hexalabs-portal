// Bump GetLabs-Connect-Student policy to v11.
// Adds iam:Get* + iam:List* to IAMForConnect statement so Lex console can
// display the auto-created service role without erroring.
//
// Pattern mirrors prior v8/v9/v10 bumps — idempotent + version-rotation aware.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const { IAMClient, GetPolicyCommand, GetPolicyVersionCommand, CreatePolicyVersionCommand,
        ListPolicyVersionsCommand, DeletePolicyVersionCommand } = require("@aws-sdk/client-iam");

const ARN = "arn:aws:iam::631461173692:policy/GetLabs-Connect-Student";
const client = new IAMClient({
  region: "us-east-1",
  credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
});

(async () => {
  // 1. Pull current default version
  const pol = await client.send(new GetPolicyCommand({ PolicyArn: ARN }));
  const defaultV = pol.Policy.DefaultVersionId;
  console.log("current default:", defaultV);

  const ver = await client.send(new GetPolicyVersionCommand({ PolicyArn: ARN, VersionId: defaultV }));
  const doc = JSON.parse(decodeURIComponent(ver.PolicyVersion.Document));

  // 2. Locate IAMForConnect statement, broaden it
  const iamStmt = doc.Statement.find(s => s.Sid === "IAMForConnect");
  if (!iamStmt) throw new Error("IAMForConnect statement not found");
  const before = (iamStmt.Action || []).slice();
  // Replace specific List/Get items with wildcards, keep all write actions
  const writes = [
    "iam:CreateServiceLinkedRole",
    "iam:CreateRole",
    "iam:CreatePolicy",
    "iam:AttachRolePolicy",
    "iam:DetachRolePolicy",
    "iam:PutRolePolicy",
    "iam:DeleteRolePolicy",
    "iam:PassRole",
    "iam:CreateUser",
    "iam:DeleteUser",
    "iam:TagRole",
    "iam:TagUser",
    "iam:UntagRole",
    "iam:UntagUser",
    "iam:UpdateAssumeRolePolicy",
  ];
  const reads = ["iam:Get*", "iam:List*", "iam:Simulate*"];
  iamStmt.Action = [...new Set([...writes, ...reads])].sort();
  console.log("IAMForConnect actions before:", before.length, "after:", iamStmt.Action.length);

  // 3. Rotate versions — delete oldest non-default if at 5-version cap
  const versions = await client.send(new ListPolicyVersionsCommand({ PolicyArn: ARN }));
  if (versions.Versions.length >= 5) {
    const oldest = versions.Versions.filter(v => !v.IsDefaultVersion)
      .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
    console.log("deleting oldest non-default:", oldest.VersionId);
    await client.send(new DeletePolicyVersionCommand({ PolicyArn: ARN, VersionId: oldest.VersionId }));
  }

  // 4. Create new version + set as default
  const out = await client.send(new CreatePolicyVersionCommand({
    PolicyArn: ARN,
    PolicyDocument: JSON.stringify(doc),
    SetAsDefault: true,
  }));
  console.log("new default:", out.PolicyVersion.VersionId);
  console.log("doc bytes:", JSON.stringify(doc).length);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
