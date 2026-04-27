#!/bin/bash
# Pre-pull all container lab images so deployment is instant.
# Run this once on your server, or add to a cron to keep images updated.
#
# Usage: ./scripts/prepull-images.sh

echo "=== Pre-pulling all lab container images ==="
echo "This will download ~30GB total. Run once per server."
echo ""

IMAGES=(
  # LinuxServer Webtop (HTTP, lightweight)
  "linuxserver/webtop:ubuntu-xfce"
  "linuxserver/webtop:ubuntu-kde"
  "linuxserver/webtop:ubuntu-mate"
  "linuxserver/webtop:ubuntu-openbox"
  "linuxserver/webtop:alpine-xfce"
  "linuxserver/webtop:fedora-xfce"
  "linuxserver/webtop:arch-xfce"

  # KasmWeb Desktops (HTTPS)
  "kasmweb/desktop:1.16.0"
  "kasmweb/desktop-deluxe:1.16.0"
  "kasmweb/kali-rolling-desktop:1.16.0"

  # RHEL / CentOS family
  "kasmweb/rockylinux-9-desktop:1.16.0"
  "kasmweb/almalinux-9-desktop:1.16.0"
  "kasmweb/oracle-8-desktop:1.16.0"

  # KasmWeb Apps
  "kasmweb/chrome:1.16.0"
  "kasmweb/firefox:1.16.0"
  "kasmweb/vs-code:1.16.0"
  "kasmweb/terminal:1.16.0"
  "kasmweb/libre-office:1.16.0"

  # Dev environments
  "codercom/code-server:latest"
  "jupyter/scipy-notebook:latest"
  "jupyter/tensorflow-notebook:latest"

  # Other Kali
  "lukaszlach/kali-desktop:xfce"
)

TOTAL=${#IMAGES[@]}
COUNT=0

for img in "${IMAGES[@]}"; do
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] Pulling $img ..."
  docker pull "$img" 2>&1 | tail -1
  echo ""
done

echo "=== Done. All $TOTAL images pulled. ==="
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep -E "kasmweb|linuxserver|codercom|jupyter|lukaszlach" | sort
