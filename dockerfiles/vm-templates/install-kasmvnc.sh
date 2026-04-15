#!/bin/bash
# ============================================================================
# KasmVNC Installation Script for Azure Ubuntu VMs
# Run this on your Ubuntu VM base image before capturing it as a template.
#
# What it does:
# 1. Installs XFCE desktop (lightweight)
# 2. Installs KasmVNC (GPU-accelerated, web-native VNC)
# 3. Configures auto-start on boot
# 4. Exposes noVNC on port 6901 (browser-accessible)
#
# Usage:
#   ssh labuser@<vm-ip>
#   chmod +x install-kasmvnc.sh
#   sudo ./install-kasmvnc.sh
#   # Then capture the VM as an Azure image template
# ============================================================================

set -e

echo "=== Installing KasmVNC Desktop for Azure VM ==="

# 1. System updates
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# 2. Install XFCE desktop (lightweight, ~800MB)
apt-get install -y xfce4 xfce4-goodies dbus-x11

# 3. Install KasmVNC
KASM_VERSION="1.3.3"
ARCH=$(dpkg --print-architecture)

if [ "$ARCH" = "amd64" ]; then
  KASM_URL="https://github.com/kasmtech/KasmVNC/releases/download/v${KASM_VERSION}/kasmvncserver_jammy_${KASM_VERSION}_amd64.deb"
elif [ "$ARCH" = "arm64" ]; then
  KASM_URL="https://github.com/kasmtech/KasmVNC/releases/download/v${KASM_VERSION}/kasmvncserver_jammy_${KASM_VERSION}_arm64.deb"
fi

echo "Downloading KasmVNC ${KASM_VERSION} for ${ARCH}..."
wget -q "$KASM_URL" -O /tmp/kasmvnc.deb
apt-get install -y /tmp/kasmvnc.deb
rm /tmp/kasmvnc.deb

# 4. Configure KasmVNC
mkdir -p /etc/kasmvnc
cat > /etc/kasmvnc/kasmvnc.yaml << 'KASMCFG'
desktop:
  resolution:
    width: 1920
    height: 1080
  allow_resize: true

network:
  protocol: http
  websocket_port: 6901
  ssl:
    require_ssl: false
  udp:
    public_ip: auto

encoding:
  max_frame_rate: 30
  full_frame_updates: none
  rect_encoding_mode:
    min_quality: 5
    max_quality: 9
    consider_lossless_quality: 10
    rectangle_compress_threads: 0

  video_encoding_mode:
    jpeg_quality: -1
    webp_quality: 5
    max_resolution:
      width: 1920
      height: 1080
    enter_video_encoding_area:
      min_x: 10
      min_y: 10
    time_threshold: 5
    min_change_per_frame: 0.3
    fps: 30
    threads: 0

  compare_framebuffer: auto
  zrle_zlib_level: 5
  hextile_improved: true

pointer:
  enabled: true

clipboard:
  enabled: true
  server_to_client:
    enabled: true
    size: 10000000
  client_to_server:
    enabled: true
    size: 10000000

logging:
  log_writer_name: all
  log_dest: logfile
  level: 30
KASMCFG

# 5. Create systemd service for auto-start
cat > /etc/systemd/system/kasmvnc.service << 'SVCEOF'
[Unit]
Description=KasmVNC Desktop Server
After=network.target

[Service]
Type=forking
User=labuser
Environment=HOME=/home/labuser
Environment=USER=labuser
ExecStartPre=/bin/bash -c 'echo "Welcome1234!" | kasmvncpasswd -u labuser -w -r'
ExecStart=/usr/bin/kasmvncserver :1 -geometry 1920x1080 -depth 24 -websocketPort 6901
ExecStop=/usr/bin/kasmvncserver -kill :1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# 6. Enable on boot
systemctl daemon-reload
systemctl enable kasmvnc.service

# 7. Open port 6901 in local firewall (Azure NSG still needed)
ufw allow 6901/tcp 2>/dev/null || true

# 8. Install useful tools
apt-get install -y \
  firefox \
  terminator \
  nano vim \
  htop \
  wget curl \
  git \
  net-tools \
  unzip

# 9. Clean up
apt-get autoremove -y
apt-get clean

echo ""
echo "=== KasmVNC Installation Complete ==="
echo ""
echo "Access via browser: http://<vm-ip>:6901"
echo "Username: labuser"
echo "Password: Welcome1234!"
echo ""
echo "Next steps:"
echo "1. Start KasmVNC: sudo systemctl start kasmvnc"
echo "2. Test in browser: http://$(hostname -I | awk '{print $1}'):6901"
echo "3. Capture this VM as an Azure image template"
echo "4. In your template, set: official=true, os=Linux, port=6901"
echo ""
