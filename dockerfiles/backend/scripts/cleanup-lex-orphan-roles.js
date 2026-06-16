// Delete orphan AmazonLexTestWorkbenchServiceRole-* roles in account 631461173692.
// Skips per-bot SLRs (AWSServiceRoleForLexV2Bots_*) and Connect-association SLRs.
require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const {
  IAMClient, ListRolesCommand, ListAttachedRolePoliciesCommand,
  DetachRolePolicyCommand, ListRolePoliciesCommand, DeleteRolePolicyCommand,
  DeleteRoleCommand,
} = require("@aws-sdk/client-iam");

const client = new IAMClient({
  region: "us-east-1",
  credentials: { accessKeyId: process.env.AWS_CONNECT_ACCESS_KEY, secretAccessKey: process.env.AWS_CONNECT_ACCESS_SECRET },
});

const SAFE_DELETE_PATTERN = /^AmazonLexTestWorkbenchServiceRole-/;

(async () => {
  const all = [];
  let marker;
  do {
    const out = await client.send(new ListRolesCommand({ Marker: marker }));
    all.push(...out.Roles);
    marker = out.IsTruncated ? out.Marker : null;
  } while (marker);

  const targets = all.filter(r => SAFE_DELETE_PATTERN.test(r.RoleName));
  console.log(`Total roles in account: ${all.length}`);
  console.log(`Test Workbench orphans to delete: ${targets.length}`);
  for (const r of targets) console.log(`  - ${r.RoleName} (created ${r.CreateDate.toISOString()})`);

  let deleted = 0, failed = [];
  for (const r of targets) {
    try {
      // Detach all managed policies
      const attached = await client.send(new ListAttachedRolePoliciesCommand({ RoleName: r.RoleName }));
      for (const p of (attached.AttachedPolicies || [])) {
        await client.send(new DetachRolePolicyCommand({ RoleName: r.RoleName, PolicyArn: p.PolicyArn }));
      }
      // Delete all inline policies
      const inline = await client.send(new ListRolePoliciesCommand({ RoleName: r.RoleName }));
      for (const pn of (inline.PolicyNames || [])) {
        await client.send(new DeleteRolePolicyCommand({ RoleName: r.RoleName, PolicyName: pn }));
      }
      // Delete role
      await client.send(new DeleteRoleCommand({ RoleName: r.RoleName }));
      console.log(`  [DELETED] ${r.RoleName}`);
      deleted++;
    } catch (e) {
      failed.push({ name: r.RoleName, err: e.message.slice(0, 120) });
    }
  }

  console.log(`\n=== deleted=${deleted} failed=${failed.length} ===`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
