#!/usr/bin/env bash
# ============================================================================
# Golden Image Setup: Cisco ACI / Data Center Lab
# ============================================================================
# Run this on an Azure D8s_v5 (8 vCPU / 32 GB) Ubuntu 22.04 VM to build
# the golden image. After setup, capture the VM from the portal (Admin →
# Capture) or via Azure CLI:
#
#   az vm deallocate -g <rg> -n <vm>
#   az vm generalize -g <rg> -n <vm>
#   az image create -g <rg> -n cisco-aci-lab-golden --source <vm>
#
# The resulting image ID goes into the template's creation.imageId field.
#
# Student access:
#   - Full Ubuntu desktop via KasmVNC: https://<vm-ip>:6901
#   - Eve-ng web UI:                   http://<vm-ip> (inside desktop or direct)
#   - APIC Simulator GUI:              https://<vm-ip>:443 (inside desktop)
# ============================================================================

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "=== [1/8] System update & prerequisites ==="
apt-get update && apt-get upgrade -y
apt-get install -y \
  qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils \
  virtinst virt-manager cpu-checker \
  python3 python3-pip python3-venv \
  unzip curl wget git net-tools \
  apache2 php libapache2-mod-php php-mysql php-gd php-xml \
  mysql-server \
  openvpn easy-rsa \
  nginx certbot \
  uml-utilities iptables \
  docker.io docker-compose

# Enable nested virtualization (should already be enabled on D-series)
echo "=== [2/8] Verify nested virtualization ==="
if grep -qE 'vmx|svm' /proc/cpuinfo; then
  echo "  ✅ Nested virtualization supported"
else
  echo "  ⚠️  Nested virt NOT detected — ensure VM is D-series v3/v5"
fi

# Enable KVM
modprobe kvm_intel || modprobe kvm_amd || true
echo "kvm_intel" >> /etc/modules 2>/dev/null || true

echo "=== [3/8] Install Eve-ng ==="
# Eve-ng Community Edition
wget -qO - https://www.eve-ng.net/focal/eczema@ecez.io.gpg.key | apt-key add -
echo "deb [arch=amd64] https://www.eve-ng.net/focal focal main" > /etc/apt/sources.list.d/eve-ng.list
apt-get update

# Install Eve-ng (auto-accepts license)
echo "eve-ng eve-ng/accept-eula boolean true" | debconf-set-selections
apt-get install -y eve-ng || {
  echo "  ⚠️  Eve-ng package install had warnings — continuing"
}

# Eve-ng post-install
systemctl enable apache2
systemctl enable mysql

# Create directory for NX-OS images
mkdir -p /opt/unetlab/addons/qemu/nxosv9k-{spine,leaf}
mkdir -p /opt/unetlab/addons/qemu/apic-sim

echo "=== [4/8] Prepare APIC Simulator directory ==="
# APIC Simulator OVA must be manually uploaded (Cisco licensed)
# Create placeholder structure
mkdir -p /opt/apic-simulator
cat > /opt/apic-simulator/README.md << 'APICEOF'
# APIC Simulator Setup

## Download
1. Download APIC Simulator from Cisco Software Download:
   https://software.cisco.com/download/home/286329781/type/286290826
2. File: acisim-X.X-XXXX.ova (typically ~8 GB)

## Import into Eve-ng
1. Upload the OVA to /opt/unetlab/addons/qemu/apic-sim/
2. Extract: tar xf acisim-*.ova
3. Rename disk: mv *-disk1.vmdk hda.qcow2
   (or convert: qemu-img convert -f vmdk -O qcow2 *-disk1.vmdk hda.qcow2)
4. Fix permissions: /opt/unetlab/wrappers/unl_wrapper -a fixpermissions

## NX-OS 9000v Images
1. Download from: https://software.cisco.com/download/home/286312239/type/282088129
2. File: nexus9300v64.XX.XX.XX.qcow2
3. Copy to: /opt/unetlab/addons/qemu/nxosv9k-spine/ as hda.qcow2
4. Copy to: /opt/unetlab/addons/qemu/nxosv9k-leaf/ as hda.qcow2
5. Fix permissions: /opt/unetlab/wrappers/unl_wrapper -a fixpermissions
APICEOF

echo "=== [5/8] Pre-built Eve-ng lab topologies ==="
mkdir -p /opt/unetlab/labs/cisco-aci-training

# Lab 1: Multicast-based VXLAN
cat > /opt/unetlab/labs/cisco-aci-training/01-multicast-vxlan.md << 'LAB1EOF'
# Lab 1: Multicast-based VXLAN

## Topology
- 2x Spine (NX-OS 9000v)
- 4x Leaf (NX-OS 9000v)
- 4x Host VMs (Linux)

## Objectives
1. Configure underlay OSPF routing
2. Configure PIM sparse-mode for multicast
3. Configure NVE interface with multicast replication
4. Verify VXLAN tunnels and BUM traffic
5. Test L2 VNI connectivity between hosts

## Commands Reference
- show nve peers
- show nve vni
- show vxlan
- show ip pim neighbor
LAB1EOF

# Lab 2: BGP EVPN VXLAN
cat > /opt/unetlab/labs/cisco-aci-training/02-bgp-evpn-vxlan.md << 'LAB2EOF'
# Lab 2: BGP EVPN VXLAN

## Topology
- 2x Spine (NX-OS 9000v) — Route Reflectors
- 4x Leaf (NX-OS 9000v)
- 4x Host VMs (Linux)

## Objectives
1. Configure iBGP with EVPN address-family
2. Configure spines as BGP route reflectors
3. Configure NVE with BGP-based replication (ingress-replication)
4. Verify EVPN Type-2 (MAC/IP) and Type-3 (IMET) routes
5. Configure distributed anycast gateway
6. Test L2 and L3 VNI connectivity

## Commands Reference
- show bgp l2vpn evpn summary
- show bgp l2vpn evpn
- show l2route evpn mac all
- show nve peers
LAB2EOF

# Labs 3-10: APIC Simulator labs
for lab in "03-fabric-discovery" "04-logical-constructs" "05-access-policies" \
           "06-epg-deployment" "07-contracts" "08-l2out-l3out" \
           "09-service-graph" "10-vmm-integration"; do
  num=$(echo "$lab" | cut -d- -f1)
  title=$(echo "$lab" | cut -d- -f2- | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
  cat > "/opt/unetlab/labs/cisco-aci-training/${lab}.md" << LABEOF
# Lab ${num}: ${title}

## Tool: APIC Simulator
Access via: https://<vm-ip>:443 (APIC GUI)
Default credentials: admin / C1sco12345

## Objectives
Refer to the training PDF for step-by-step instructions.
LABEOF
done

echo "=== [6/8] Install KasmVNC + XFCE Desktop ==="
# Install XFCE desktop environment (lightweight — suits 32 GB VM)
apt-get install -y \
  xfce4 xfce4-goodies xfce4-terminal \
  dbus-x11 x11-xserver-utils xdg-utils \
  firefox \
  wireshark-qt \
  filezilla \
  mousepad \
  fonts-dejavu-core fonts-liberation \
  xterm

# Install KasmVNC — provides browser-based desktop access
KASMVNC_VER="1.3.3"
KASMVNC_DEB="kasmvncserver_jammy_${KASMVNC_VER}_amd64.deb"
wget -q "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VER}/${KASMVNC_DEB}" -O /tmp/${KASMVNC_DEB}
apt-get install -y /tmp/${KASMVNC_DEB} || {
  echo "  ⚠️  KasmVNC deb install had issues — trying alternate version"
  # Fallback: try latest release
  KASMVNC_VER="1.3.2"
  KASMVNC_DEB="kasmvncserver_jammy_${KASMVNC_VER}_amd64.deb"
  wget -q "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VER}/${KASMVNC_DEB}" -O /tmp/${KASMVNC_DEB}
  apt-get install -y /tmp/${KASMVNC_DEB}
}
rm -f /tmp/kasmvncserver_*.deb

# Create lab user for student access
useradd -m -s /bin/bash -G sudo,kvm,libvirt,docker,wireshark labuser
echo "labuser:Welcome1234!" | chpasswd

# Configure KasmVNC for the lab user
mkdir -p /home/labuser/.vnc
cat > /home/labuser/.vnc/kasmvnc.yaml << 'KASMCFG'
desktop:
  resolution:
    width: 1920
    height: 1080
  allow_resize: true
network:
  protocol: http
  interface: 0.0.0.0
  websocket_port: 6901
  ssl:
    require_ssl: false
  udp:
    public_ip: auto
runtime_configuration:
  allow_override_standard_vnc_server:
    enabled: false
  allow_override_list: []
KASMCFG
chown -R labuser:labuser /home/labuser/.vnc

# Set VNC password for labuser
echo -e "Welcome1234!\nWelcome1234!\n" | su - labuser -c "kasmvncpasswd -u labuser -w"

# Create xstartup for XFCE
cat > /home/labuser/.vnc/xstartup << 'XSTART'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11

# Start XFCE desktop
exec startxfce4
XSTART
chmod +x /home/labuser/.vnc/xstartup
chown labuser:labuser /home/labuser/.vnc/xstartup

# Create desktop shortcuts for the student
mkdir -p /home/labuser/Desktop

# Eve-ng shortcut
cat > /home/labuser/Desktop/Eve-ng.desktop << 'EVESHORT'
[Desktop Entry]
Version=1.0
Type=Application
Name=Eve-ng Lab Console
Comment=Open Eve-ng network emulator in Firefox
Icon=applications-internet
Exec=firefox http://localhost
Terminal=false
Categories=Network;
EVESHORT

# APIC Simulator shortcut
cat > /home/labuser/Desktop/APIC-Simulator.desktop << 'APICSHORT'
[Desktop Entry]
Version=1.0
Type=Application
Name=APIC Simulator
Comment=Open Cisco APIC Simulator GUI in Firefox
Icon=applications-internet
Exec=firefox https://localhost:443
Terminal=false
Categories=Network;
APICSHORT

# Wireshark shortcut
cat > /home/labuser/Desktop/Wireshark.desktop << 'WSHORT'
[Desktop Entry]
Version=1.0
Type=Application
Name=Wireshark
Comment=Network protocol analyzer
Icon=wireshark
Exec=wireshark
Terminal=false
Categories=Network;
WSHORT

# Lab Guide shortcut
cat > /home/labuser/Desktop/Lab-Guide.desktop << 'LABSHORT'
[Desktop Entry]
Version=1.0
Type=Application
Name=Lab Guide
Comment=Open lab instructions
Icon=text-x-generic
Exec=mousepad /opt/unetlab/labs/cisco-aci-training/
Terminal=false
Categories=Documentation;
LABSHORT

chmod +x /home/labuser/Desktop/*.desktop
chown -R labuser:labuser /home/labuser/Desktop

# Create systemd service for KasmVNC — auto-starts on boot
cat > /etc/systemd/system/kasmvnc-lab.service << 'SVCEOF'
[Unit]
Description=KasmVNC Lab Desktop for Students
After=network.target

[Service]
Type=simple
User=labuser
Group=labuser
Environment=HOME=/home/labuser
Environment=USER=labuser
WorkingDirectory=/home/labuser
ExecStartPre=/bin/bash -c 'rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 || true'
ExecStart=/usr/bin/kasmvncserver :1 -websocketPort 6901 -interface 0.0.0.0 -disableBasicAuth -geometry 1920x1080 -depth 24
ExecStop=/usr/bin/kasmvncserver -kill :1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable kasmvnc-lab.service

echo "  KasmVNC installed — desktop will be at http://<vm-ip>:6901"

echo "=== [7/8] Configure firewall & access ==="
# Open required ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # Eve-ng HTTP
ufw allow 443/tcp   # Eve-ng HTTPS / APIC GUI
ufw allow 6901/tcp  # KasmVNC browser desktop
ufw allow 8080/tcp  # Guacamole (if needed)
ufw allow 32768:65535/tcp  # Eve-ng console ports
ufw --force enable

# Configure Eve-ng for remote access
a2enmod proxy proxy_http proxy_wstunnel
systemctl restart apache2

# Set Eve-ng default password
mysql -u root -e "UPDATE eve_ng_db.users SET password=MD5('Welcome1234!') WHERE username='admin';" 2>/dev/null || true

# Clean up for image capture
echo "=== [8/8] Cleanup for golden image capture ==="
apt-get clean
rm -rf /var/lib/apt/lists/*
rm -f /var/log/*.log
cat /dev/null > /var/log/wtmp
cat /dev/null > /var/log/lastlog
history -c

echo ""
echo "=============================================="
echo "  Golden Image Setup Complete!"
echo "=============================================="
echo ""
echo "  Installed components:"
echo "    - XFCE Desktop (via KasmVNC in browser)"
echo "    - KasmVNC on port 6901 (auto-start systemd)"
echo "    - Eve-ng Community Edition (port 80)"
echo "    - Firefox, Wireshark, FileZilla"
echo "    - Docker, KVM/QEMU (nested virt)"
echo ""
echo "  Student access:"
echo "    Desktop:  http://<vm-ip>:6901  (no login required)"
echo "    Eve-ng:   http://<vm-ip>       (admin / Welcome1234!)"
echo "    APIC:     https://<vm-ip>:443  (admin / C1sco12345)"
echo "    SSH:      ssh labuser@<vm-ip>  (Welcome1234!)"
echo ""
echo "  Desktop shortcuts pre-configured:"
echo "    - Eve-ng Lab Console"
echo "    - APIC Simulator GUI"
echo "    - Wireshark"
echo "    - Lab Guide"
echo ""
echo "  Next steps:"
echo "  1. Upload Cisco NX-OS 9000v image to /opt/unetlab/addons/qemu/nxosv9k-*/"
echo "  2. Upload APIC Simulator OVA to /opt/unetlab/addons/qemu/apic-sim/"
echo "  3. Run: /opt/unetlab/wrappers/unl_wrapper -a fixpermissions"
echo "  4. Start KasmVNC: systemctl start kasmvnc-lab"
echo "  5. Test desktop at http://<vm-ip>:6901"
echo "  6. Test Eve-ng at http://<vm-ip> (admin / Welcome1234!)"
echo "  7. Deallocate + generalize + capture the VM"
echo ""
echo "  Azure CLI capture:"
echo "    az vm deallocate -g <rg> -n <vm>"
echo "    az vm generalize -g <rg> -n <vm>"
echo "    az image create -g <rg> -n cisco-aci-lab-golden --source <vm>"
echo "=============================================="
