require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const { AuthorizationManagementClient } = require("@azure/arm-authorization");
require("isomorphic-fetch");
const { Client } = require("@microsoft/microsoft-graph-client");
const crypto = require("crypto");
const mongoose = require("mongoose");

const SUB = process.env.SUBSCRIPTION_ID;
const TENANT = process.env.TENANT_ID;
const CUSTOM_ROLE_ID = `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/dd15bbf4-d253-4042-a283-0ba786365fca`;

const BROKEN = [
  { email: "azde5@g.com",  prefix: "azde5"  },
  { email: "azde9@g.com",  prefix: "azde9"  },
  { email: "azde10@g.com", prefix: "azde10" },
  { email: "azde11@g.com", prefix: "azde11" },
  { email: "azde12@g.com", prefix: "azde12" },
  { email: "azde13@g.com", prefix: "azde13" },
  { email: "azde16@g.com", prefix: "azde16" },
  { email: "azde17@g.com", prefix: "azde17" },
];

async function withRetry(fn, label) {
  let last;
  for (let i = 0; i < 5; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (/PrincipalNotFound|does not exist|propagat/i.test(e.message) && i < 4) {
        console.log(`  [retry ${i+1}/5] ${label}: ${e.message.slice(0,80)}`);
        await new Promise(r => setTimeout(r, 5000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const sbCol = mongoose.connection.db.collection("sandboxusers");

  const armCred = new ClientSecretCredential(TENANT, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const rmc = new ResourceManagementClient(armCred, SUB);
  const auth = new AuthorizationManagementClient(armCred, SUB);

  const idCred = new ClientSecretCredential(
    process.env.IDENTITY_TENANT_ID || TENANT,
    process.env.IDENTITY_CLIENT_ID || process.env.CLIENT_ID,
    process.env.IDENTITY_CLIENT_SECRET || process.env.CLIENT_SECRET
  );
  const tok = await idCred.getToken("https://graph.microsoft.com/.default");
  const graph = Client.init({ authProvider: (d) => d(null, tok.token) });

  for (const { email, prefix } of BROKEN) {
    console.log(`\n=== ${email} ===`);
    const u = await sbCol.findOne({ email });
    if (!u) { console.log("  no user doc"); continue; }
    const ready = (u.sandbox || []).find(s => s.status === "ready");
    if (!ready) { console.log("  no ready sandbox subdoc"); continue; }
    const upn = ready.credentials?.username;
    if (!upn) { console.log("  no UPN"); continue; }

    // 1. Get objectId
    const aad = await graph.api(`/users/${upn}`).get().catch(() => null);
    if (!aad) { console.log(`  AAD user ${upn} not found`); continue; }
    console.log(`  AAD ${upn} oid=${aad.id}`);

    // 2. Create fresh RG
    const newRg = `sb-${prefix}-${Date.now().toString(36).slice(-5)}`;
    await rmc.resourceGroups.createOrUpdate(newRg, {
      location: "southindia",
      tags: { sandbox: "true", user: upn, repaired: "2026-05-06" },
    });
    console.log(`  RG created: ${newRg}`);

    // 3. Assign custom Databricks role
    const scope = `/subscriptions/${SUB}/resourceGroups/${newRg}`;
    await withRetry(() => auth.roleAssignments.create(scope, crypto.randomUUID(), {
      principalId: aad.id, roleDefinitionId: CUSTOM_ROLE_ID, scope,
    }), `role-assign ${upn}->${newRg}`);
    console.log(`  role assigned`);

    // 4. Update Mongo subdoc
    const accessUrl = `https://portal.azure.com/#@${TENANT}/resource/subscriptions/${SUB}/resourceGroups/${newRg}`;
    await sbCol.updateOne(
      { _id: u._id, "sandbox._id": ready._id },
      { $set: {
          "sandbox.$.resourceGroupName": newRg,
          "sandbox.$.accessUrl": accessUrl,
          "sandbox.$.repairedAt": new Date(),
      }}
    );
    console.log(`  Mongo updated: ${newRg}`);
    console.log(`  ✓ ${email} repaired`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
