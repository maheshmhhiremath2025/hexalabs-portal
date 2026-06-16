require("dotenv").config();
const { ClientSecretCredential } = require("@azure/identity");
const { ResourceManagementClient } = require("@azure/arm-resources");
(async () => {
  const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
  const rmc = new ResourceManagementClient(cred, process.env.SUBSCRIPTION_ID);
  console.log("=== ALL RGs starting with sb-azde ===");
  for await (const rg of rmc.resourceGroups.list()) {
    if (/^sb-azde/.test(rg.name)) console.log(`${rg.name}  state=${rg.properties?.provisioningState}  loc=${rg.location}`);
  }
})().catch(e => console.error("ERR:", e.message));
