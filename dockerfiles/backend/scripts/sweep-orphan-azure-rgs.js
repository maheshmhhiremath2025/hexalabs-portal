require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
const mongoose = require("mongoose");

const SUB = process.env.SUBSCRIPTION_ID;
const DRY_RUN = process.argv.includes("--dry-run");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const sbCol = mongoose.connection.db.collection("sandboxusers");

  const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const rmc = new ResourceManagementClient(cred, SUB);

  // 1. List all sb-azde* RGs in Azure
  const azureRgs = [];
  for await (const rg of rmc.resourceGroups.list()) {
    if (/^sb-azde/.test(rg.name || "")) azureRgs.push(rg.name);
  }
  console.log(`Azure has ${azureRgs.length} sb-azde* RGs`);

  // 2. Collect all RG names referenced by status=ready Mongo subdocs
  const referenced = new Set();
  for await (const u of sbCol.find({})) {
    for (const sb of (u.sandbox || [])) {
      if (sb.status === "ready" && sb.resourceGroupName) referenced.add(sb.resourceGroupName);
    }
  }
  console.log(`Mongo references ${referenced.size} ready RGs total`);

  // 3. Orphans = Azure RGs not referenced
  const orphans = azureRgs.filter(rg => !referenced.has(rg));
  console.log(`\nOrphan RGs to delete: ${orphans.length}`);
  console.log(orphans.join(", "));

  // 4. Verify each orphan is empty (no resources inside)
  let nonEmpty = [];
  for (const rgName of orphans.slice(0, 999)) {
    const items = [];
    for await (const r of rmc.resources.listByResourceGroup(rgName)) items.push(r.id);
    if (items.length > 0) nonEmpty.push({ rg: rgName, count: items.length });
  }
  if (nonEmpty.length) {
    console.log(`\nWARNING: ${nonEmpty.length} orphan RGs have resources inside — NOT deleting these:`);
    console.log(JSON.stringify(nonEmpty, null, 2));
  }
  const safeToDelete = orphans.filter(rg => !nonEmpty.find(x => x.rg === rg));
  console.log(`\nSafe to delete (empty): ${safeToDelete.length}`);

  if (DRY_RUN) {
    console.log("DRY-RUN — no deletes performed");
    await mongoose.disconnect();
    process.exit(0);
  }

  // 5. Delete in parallel batches of 8
  let deleted = 0, failed = [];
  const batchSize = 8;
  for (let i = 0; i < safeToDelete.length; i += batchSize) {
    const batch = safeToDelete.slice(i, i + batchSize);
    await Promise.all(batch.map(async rgName => {
      try {
        // Fire-and-forget delete (do NOT wait — saves ~5min per RG)
        await rmc.resourceGroups.beginDelete(rgName);
        console.log(`  [DELETE] ${rgName} initiated`);
        deleted++;
      } catch (e) {
        failed.push({ rg: rgName, err: e.message.slice(0, 100) });
      }
    }));
  }
  console.log(`\n=== deleted=${deleted} failed=${failed.length} ===`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
