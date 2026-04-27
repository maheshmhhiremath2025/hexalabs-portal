require("dotenv").config();
const mongoose = require("mongoose");
const { generateEmail } = require("./functions/emails/vmCreated");
const queues = require("./queues");

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { dbName: "userdb" });
  const VM = require("./models/vm");
  const vms = await VM.find({ trainingName: "testing2" }, "name email publicIp adminUsername adminPass").lean();
  console.log("VMs found: " + vms.length);
  vms.forEach(v => console.log("  " + v.name + " | " + v.publicIp + " | " + v.adminUsername + "/" + v.adminPass));
  const { subject, body } = generateEmail(vms, "Azatech");
  const emailData = {
    email: "nadaf@azatech.co.in",
    subject: subject + " (resent with credentials)",
    body,
  };
  await queues["email-queue"].add(emailData);
  console.log("queued email to " + emailData.email);
  await mongoose.disconnect();
  process.exit(0);
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
