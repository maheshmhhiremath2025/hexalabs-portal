require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { AuthorizationManagementClient } = require("@azure/arm-authorization");
require("isomorphic-fetch");
const { Client } = require("@microsoft/microsoft-graph-client");
const crypto = require("crypto");
const mongoose = require("mongoose");

const SUB = process.env.SUBSCRIPTION_ID;
const CUSTOM_ROLE_ID = `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/dd15bbf4-d253-4042-a283-0ba786365fca`;
const DEFAULT_SANDBOX_ROLE_SUFFIX = "bfb6d235-8a98-4c0c-bc06-edea5dc83954";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const sbCol = mongoose.connection.db.collection("sandboxusers");

  const armCred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const auth = new AuthorizationManagementClient(armCred, SUB);

  const idCred = new ClientSecretCredential(
    process.env.IDENTITY_TENANT_ID || process.env.TENANT_ID,
    process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
    process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
  );
  const tok = await idCred.getToken("https://graph.microsoft.com/.default");
  const graph = Client.init({ authProvider: (d) => d(null, tok.token) });

  const cursor = sbCol.find({ "sandbox.status": "ready", "sandbox.resourceGroupName": { $regex: "^sb-azde" } });
  let totalFixed = 0, totalSkipped = 0, errors = [];

  for await (const u of cursor) {
    for (const sb of (u.sandbox || [])) {
      if (sb.status !== "ready" || !sb.resourceGroupName) continue;
      if (!/^sb-azde/.test(sb.resourceGroupName)) continue;
      const upn = sb.credentials?.username;
      if (!upn) { totalSkipped++; continue; }
      try {
        // 1. Look up objectId
        const user = await graph.api(`/users/${upn}`).get();
        const oid = user.id;
        const scope = `/subscriptions/${SUB}/resourceGroups/${sb.resourceGroupName}`;

        // 2. Check existing assignments for this principal
        const existing = [];
        for await (const ra of auth.roleAssignments.listForScope(scope)) existing.push(ra);
        const mine = existing.filter(r => r.principalId === oid && r.scope === scope);
        const hasCustom = mine.some(r => r.roleDefinitionId.includes("dd15bbf4-d253-4042-a283-0ba786365fca"));

        if (hasCustom) {
          console.log(`[SKIP] ${upn} on ${sb.resourceGroupName} already has custom role`);
          totalSkipped++;
          continue;
        }

        // 3. Add the custom Databricks role with retry
        let assigned = false, lastErr;
        for (let i = 0; i < 5; i++) {
          try {
            await auth.roleAssignments.create(scope, crypto.randomUUID(), {
              principalId: oid, roleDefinitionId: CUSTOM_ROLE_ID, scope,
            });
            assigned = true; break;
          } catch (e) {
            lastErr = e;
            if (/PrincipalNotFound|does not exist/i.test(e.message) && i < 4) {
              await new Promise(r => setTimeout(r, 5000 * (i + 1)));
              continue;
            }
            if (/already exists|RoleAssignmentExists/i.test(e.message)) { assigned = true; break; }
            break;
          }
        }
        if (!assigned) { errors.push({ upn, rg: sb.resourceGroupName, err: lastErr?.message }); continue; }

        // 4. Remove any default sandbox role for this principal
        for (const r of mine) {
          if (r.roleDefinitionId.includes(DEFAULT_SANDBOX_ROLE_SUFFIX)) {
            try { await auth.roleAssignments.deleteById(r.id); } catch (_) {}
          }
        }
        console.log(`[FIX] ${upn} on ${sb.resourceGroupName} (oid=${oid}) → custom Databricks role`);
        totalFixed++;
      } catch (e) {
        errors.push({ upn, rg: sb.resourceGroupName, err: e.message });
      }
    }
  }
  console.log(`\n=== fixed=${totalFixed} skipped=${totalSkipped} errors=${errors.length} ===`);
  if (errors.length) console.log(JSON.stringify(errors, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
