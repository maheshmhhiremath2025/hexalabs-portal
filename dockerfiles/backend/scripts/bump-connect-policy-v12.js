// Bump GetLabs-Connect-Student policy to v12.
// Adds polly:* and transcribe:* to SupportingServices statement so:
//   - Lex V2 console can populate the voice-interaction dropdown
//     (calls polly:DescribeVoices)
//   - Speech-to-text models in Lex (which use Transcribe under the hood)
//     are visible in the Speech model preference dropdown
//
// Pattern mirrors prior v8/v9/v10/v11 bumps — idempotent + version-rotation aware.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const { IAMClient, GetPolicyCommand, GetPolicyVersionCommand, CreatePolicyVersionCommand,
        ListPolicyVersionsCommand, DeletePolicyVersionCommand } = require("@aws-sdk/client-iam");

const ARN = "arn:aws:iam::631461173692:policy/GetLabs-Connect-Student";
const client = new IAMClient({
  region: "us-east-1",
  credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
});

(async () => {
  const pol = await client.send(new GetPolicyCommand({ PolicyArn: ARN }));
  const defaultV = pol.Policy.DefaultVersionId;
  console.log("current default:", defaultV);

  const ver = await client.send(new GetPolicyVersionCommand({ PolicyArn: ARN, VersionId: defaultV }));
  const doc = JSON.parse(decodeURIComponent(ver.PolicyVersion.Document));

  // 1. Add polly:* + transcribe:* to SupportingServices
  const sup = doc.Statement.find(s => s.Sid === "SupportingServices");
  if (!sup) throw new Error("SupportingServices statement not found");
  const before = (sup.Action || []).slice();
  const additions = ["polly:*", "transcribe:*"];
  for (const a of additions) if (!sup.Action.includes(a)) sup.Action.push(a);
  sup.Action = [...new Set(sup.Action)].sort();
  console.log("SupportingServices actions before:", before.length, "after:", sup.Action.length);
  console.log("added:", additions.filter(a => !before.includes(a)));

  // 2. Rotate versions if at cap
  const versions = await client.send(new ListPolicyVersionsCommand({ PolicyArn: ARN }));
  if (versions.Versions.length >= 5) {
    const oldest = versions.Versions.filter(v => !v.IsDefaultVersion)
      .sort((a, b) => new Date(a.CreateDate) - new Date(b.CreateDate))[0];
    console.log("deleting oldest non-default:", oldest.VersionId);
    await client.send(new DeletePolicyVersionCommand({ PolicyArn: ARN, VersionId: oldest.VersionId }));
  }

  // 3. Create v12 + set default
  const out = await client.send(new CreatePolicyVersionCommand({
    PolicyArn: ARN,
    PolicyDocument: JSON.stringify(doc),
    SetAsDefault: true,
  }));
  console.log("new default:", out.PolicyVersion.VersionId);
  console.log("doc bytes:", JSON.stringify(doc).length);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
