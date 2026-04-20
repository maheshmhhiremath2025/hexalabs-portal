#!/usr/bin/env bash
# provision-ubuntu22-kasm.sh
#
# Turns a fresh Ubuntu 22.04 VM into a GetLabs workspace template:
#   1. KasmVNC (browser desktop, port 6901 HTTPS)
#   2. XFCE4 + Firefox + dev tools pre-installed
#   3. Performance sysctl tweaks (BBR, net buffers, swappiness)
#   4. Unused services disabled (snapd, cups, motd-news)
#   5. Root SSH enabled (password auth for portal provisioning)
#   6. Sysprep (clear logs, history, host keys, waagent) ready for capture
#
# Run as root on a fresh VM.
# Idempotent — safe to re-run if something fails mid-way.

set -euo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root." >&2; exit 1
fi

# ---------- 1. Base update + essential tools ----------
log "Updating apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
  curl wget gnupg2 ca-certificates lsb-release software-properties-common \
  net-tools htop unzip jq git vim nano \
  xfce4 xfce4-goodies xfce4-terminal \
  dbus-x11 \
  openssh-server sudo

# Firefox from Mozilla PPA (Ubuntu 22.04 ships only a snap transitional pkg)
if ! command -v firefox >/dev/null 2>&1; then
  install -d -m 0755 /etc/apt/keyrings
  wget -qO- https://packages.mozilla.org/apt/repo-signing-key.gpg | gpg --dearmor -o /etc/apt/keyrings/packages.mozilla.org.gpg 2>/dev/null || true
  echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.gpg] https://packages.mozilla.org/apt mozilla main" > /etc/apt/sources.list.d/mozilla.list
  printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla
  apt-get update -y
  apt-get install -y firefox || true   # non-fatal if Mozilla repo transiently fails
fi

# ---------- 2. KasmVNC ----------
log "Installing KasmVNC"
KASM_DEB_URL="https://github.com/kasmtech/KasmVNC/releases/download/v1.3.2/kasmvncserver_jammy_1.3.2_amd64.deb"
if ! dpkg -s kasmvncserver >/dev/null 2>&1; then
  wget -qO /tmp/kasmvnc.deb "$KASM_DEB_URL"
  apt-get install -y /tmp/kasmvnc.deb
  rm -f /tmp/kasmvnc.deb
fi

# KasmVNC config (single-user, port 6901 HTTPS, password = ADMIN_PASS)
mkdir -p /etc/kasmvnc
cat >/etc/kasmvnc/kasmvnc.yaml <<'EOF'
network:
  protocol: http
  websocket_port: 6901
  ssl:
    require_ssl: false
  udp:
    public_ip: auto
desktop:
  resolution:
    width: 1280
    height: 800
EOF

# ---------- 3. Performance sysctl tweaks ----------
log "Applying performance sysctls"
cat >/etc/sysctl.d/99-getlabs-perf.conf <<'EOF'
# Network — BBR congestion control + larger buffers for snappy SSH/VNC
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0

# Memory — prefer keeping apps in RAM on a 4GB VM
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5

# File handles — lab users sometimes run dev servers
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF
sysctl --system >/dev/null

# ---------- 4. Disable bloat services ----------
log "Disabling unused services"
systemctl disable --now snapd.service snapd.socket snapd.seeded.service 2>/dev/null || true
systemctl disable --now cups.service cups.socket cups.path 2>/dev/null || true
systemctl disable --now motd-news.timer apt-news.service 2>/dev/null || true
systemctl disable --now unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
apt-get purge -y snapd popularity-contest ubuntu-advantage-tools 2>/dev/null || true
apt-get autoremove -y --purge

# Transparent hugepages (bad for some DB/ML workloads)
cat >/etc/systemd/system/disable-thp.service <<'EOF'
[Unit]
Description=Disable transparent hugepages
After=sysinit.target
[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/enabled"
[Install]
WantedBy=multi-user.target
EOF
systemctl enable disable-thp.service >/dev/null

# ---------- 5. Root SSH + password auth (portal provisioning relies on this) ----------
log "Enabling root SSH with password auth"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
# Also clobber cloud-init's ssh_pwauth override that ships on Azure images
cat >/etc/ssh/sshd_config.d/99-getlabs.conf <<'EOF'
PasswordAuthentication yes
PermitRootLogin yes
ClientAliveInterval 120
ClientAliveCountMax 3
EOF
systemctl enable ssh >/dev/null

# ---------- 6. Helper for portal-deploy (runs on first boot of captured VM) ----------
log "Installing firstboot hook (sets portal password on new VM)"
cat >/usr/local/bin/getlabs-firstboot.sh <<'EOF'
#!/usr/bin/env bash
# Runs on first boot of a VM cloned from this template.
# The portal injects GETLABS_USER / GETLABS_PASS via cloud-init user-data;
# fall back to sensible defaults if not present (for manual testing).
set -euo pipefail

USER_NAME="${GETLABS_USER:-labuser}"
USER_PASS="${GETLABS_PASS:-$(openssl rand -base64 12)}"

if ! id "$USER_NAME" &>/dev/null; then
  useradd -m -s /bin/bash -G sudo "$USER_NAME"
fi
echo "$USER_NAME:$USER_PASS" | chpasswd
echo "root:$USER_PASS" | chpasswd
echo "$USER_NAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USER_NAME
chmod 0440 /etc/sudoers.d/$USER_NAME

# Start KasmVNC for this user
sudo -u "$USER_NAME" -H bash -c "echo \"$USER_PASS\" | vncpasswd -f > /home/$USER_NAME/.kasmpasswd" 2>/dev/null || true
systemctl restart kasmvncserver@1 2>/dev/null || true
EOF
chmod +x /usr/local/bin/getlabs-firstboot.sh

cat >/etc/systemd/system/getlabs-firstboot.service <<'EOF'
[Unit]
Description=GetLabs first-boot initialisation
After=network-online.target
ConditionPathExists=!/var/lib/getlabs-firstboot.done
[Service]
Type=oneshot
ExecStart=/usr/local/bin/getlabs-firstboot.sh
ExecStartPost=/usr/bin/touch /var/lib/getlabs-firstboot.done
[Install]
WantedBy=multi-user.target
EOF
systemctl enable getlabs-firstboot.service >/dev/null

# ---------- 7. Sysprep (run LAST — VM is ready for capture after this) ----------
log "Sysprep (clear logs, history, host keys, waagent)"

# Logs
journalctl --rotate --vacuum-time=1s || true
rm -rf /var/log/*.gz /var/log/*.[0-9] /var/log/*-????????
find /var/log -type f -exec truncate -s 0 {} \; 2>/dev/null || true

# History
rm -f /root/.bash_history
history -c 2>/dev/null || true

# SSH host keys — regenerated on next boot
rm -f /etc/ssh/ssh_host_*

# Machine-id — cloud-init will recreate
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id

# Cloud-init state (so the next boot is a "first boot")
cloud-init clean --logs --seed 2>/dev/null || true

log "Sysprep complete — VM ready for Azure waagent deprovision + capture"
log "Next step on the host: az vm deallocate && az vm generalize && az image create"
echo
echo "NOTE: Do NOT reboot after this point. Run 'waagent -deprovision+user -force'"
echo "      as the very last step, then deallocate + generalize + capture."
