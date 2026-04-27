require("dotenv").config({ path: "/root/synergific-portal/dockerfiles/backend/.env" });
const { ClientSecretCredential } = require("@azure/identity");
const { ComputeManagementClient } = require("@azure/arm-compute");

const cred = new ClientSecretCredential(process.env.TENANT_ID, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
const compute = new ComputeManagementClient(cred, process.env.SUBSCRIPTION_ID);
const RG = "VMsubnet";

const script = [
  "set +e",
  "id labuser >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo labuser",
  "echo labuser:Welcome1234! | chpasswd",
  "echo \"labuser ALL=(ALL) NOPASSWD:ALL\" > /etc/sudoers.d/99-labuser && chmod 440 /etc/sudoers.d/99-labuser",
  "sed -i -E \"s/^#?PasswordAuthentication.*/PasswordAuthentication yes/\" /etc/ssh/sshd_config",
  "systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true",
  "which xrdp >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq xrdp; }",
  "adduser xrdp ssl-cert 2>/dev/null || true",
  "systemctl enable --now xrdp",
  "ufw status 2>/dev/null | grep -q active && ufw allow 3389/tcp || true",
  "XRDP=$(systemctl is-active xrdp)",
  "LISTEN=$(ss -ltn | grep -c :3389)",
  "UID_LAB=$(id -u labuser 2>/dev/null || echo X)",
  "echo STATUS xrdp=$XRDP labuser=$UID_LAB port3389=$LISTEN"
];

const run = async (vm) => {
  const t0 = Date.now();
  try {
    const r = await compute.virtualMachines.beginRunCommandAndWait(RG, vm, {
      commandId: "RunShellScript",
      script,
    });
    const out = r.value?.[0]?.message || "";
    const m = out.match(/STATUS.*/);
    console.log(`${vm}: ${((Date.now()-t0)/1000).toFixed(0)}s — ${m ? m[0] : "(no status line)"}`);
  } catch(e) {
    console.log(`${vm}: FAIL — ${(e.message||e.code).split("\n")[0]}`);
  }
};

(async () => {
  const vms = Array.from({length:11},(_,i)=>`ubtest-${i+1}`);
  await Promise.all(vms.map(run));
  console.log("done");
})().catch(e=>{console.error("FATAL: "+e.message);process.exit(1)});
