#!/usr/bin/env bash
#
# GetLabs Cloud Portal -- Production Setup Script
# Idempotent: safe to run multiple times.
#
# Usage:
#   chmod +x scripts/production-setup.sh
#   sudo ./scripts/production-setup.sh
#
# Environment variables (set before running or edit inline):
#   DOMAIN         - Your domain name (e.g. portal.getlabs.cloud)
#   INSTALL_DIR    - Installation directory (default: /opt/cloudportal)
#   ADMIN_EMAIL    - Email for Let's Encrypt SSL certificate
#   SKIP_SSL       - Set to "true" to skip SSL setup
#   SKIP_IMAGES    - Set to "true" to skip pulling Docker images

set -euo pipefail

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
DOMAIN="${DOMAIN:-portal.example.com}"
INSTALL_DIR="${INSTALL_DIR:-/opt/cloudportal}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
SKIP_SSL="${SKIP_SSL:-false}"
SKIP_IMAGES="${SKIP_IMAGES:-false}"
NODE_MAJOR=20

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
warn() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $*" >&2; }
err()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

# Must run as root
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (sudo)."
fi

# ------------------------------------------------------------------
# 1. System packages
# ------------------------------------------------------------------
log "Updating system packages..."
apt-get update -qq

# ------------------------------------------------------------------
# 2. Node.js v20
# ------------------------------------------------------------------
if command -v node &>/dev/null && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
  log "Node.js $(node -v) already installed."
else
  log "Installing Node.js v${NODE_MAJOR}..."
  if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
  fi
  apt-get install -y nodejs
fi

# ------------------------------------------------------------------
# 3. MongoDB 6+
# ------------------------------------------------------------------
if command -v mongod &>/dev/null; then
  log "MongoDB already installed: $(mongod --version | head -1)"
else
  log "Installing MongoDB 6..."
  curl -fsSL https://www.mongodb.org/static/pgp/server-6.0.asc \
    | gpg --dearmor -o /usr/share/keyrings/mongodb-server-6.0.gpg 2>/dev/null || true
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-6.0.list
  apt-get update -qq
  apt-get install -y mongodb-org
fi
systemctl enable mongod
systemctl start mongod || true
log "MongoDB running."

# ------------------------------------------------------------------
# 4. Redis (optional but installed for queue fallback)
# ------------------------------------------------------------------
if command -v redis-server &>/dev/null; then
  log "Redis already installed."
else
  log "Installing Redis..."
  apt-get install -y redis-server
fi
systemctl enable redis-server
systemctl start redis-server || true
log "Redis running."

# ------------------------------------------------------------------
# 5. Docker
# ------------------------------------------------------------------
if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  apt-get install -y ca-certificates curl gnupg lsb-release
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable docker
systemctl start docker || true
log "Docker running."

# ------------------------------------------------------------------
# 6. Sysbox Runtime (for Docker-in-Docker labs)
# ------------------------------------------------------------------
if docker info 2>/dev/null | grep -q sysbox; then
  log "Sysbox runtime already installed."
else
  log "Installing Sysbox runtime..."
  SYSBOX_DEB="/tmp/sysbox-ce.deb"
  if [ ! -f "$SYSBOX_DEB" ]; then
    wget -q -O "$SYSBOX_DEB" \
      "https://downloads.nestybox.com/sysbox/releases/v0.6.4/sysbox-ce_0.6.4-0.linux_amd64.deb" || \
      warn "Sysbox download failed. Docker-in-Docker labs will not work without it."
  fi
  if [ -f "$SYSBOX_DEB" ]; then
    dpkg -i "$SYSBOX_DEB" || apt-get install -f -y
    systemctl restart docker
    log "Sysbox installed."
  fi
fi

# ------------------------------------------------------------------
# 7. Nginx
# ------------------------------------------------------------------
if command -v nginx &>/dev/null; then
  log "Nginx already installed."
else
  log "Installing Nginx..."
  apt-get install -y nginx
fi
systemctl enable nginx
systemctl start nginx || true

# ------------------------------------------------------------------
# 8. PM2
# ------------------------------------------------------------------
if command -v pm2 &>/dev/null; then
  log "PM2 already installed."
else
  log "Installing PM2..."
  npm install -g pm2
fi

# ------------------------------------------------------------------
# 9. CLI Tools: rosa, oc, az
# ------------------------------------------------------------------

# Azure CLI
if command -v az &>/dev/null; then
  log "Azure CLI already installed."
else
  log "Installing Azure CLI..."
  curl -sL https://aka.ms/InstallAzureCLIDeb | bash
fi

# OpenShift CLI (oc)
if command -v oc &>/dev/null; then
  log "oc CLI already installed."
else
  log "Installing OpenShift CLI (oc)..."
  OC_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz"
  wget -q -O /tmp/oc.tar.gz "$OC_URL" || warn "oc download failed."
  if [ -f /tmp/oc.tar.gz ]; then
    tar xzf /tmp/oc.tar.gz -C /usr/local/bin oc kubectl 2>/dev/null || true
    chmod +x /usr/local/bin/oc /usr/local/bin/kubectl 2>/dev/null || true
    rm -f /tmp/oc.tar.gz
    log "oc CLI installed."
  fi
fi

# ROSA CLI
if command -v rosa &>/dev/null; then
  log "rosa CLI already installed."
else
  log "Installing ROSA CLI..."
  ROSA_URL="https://mirror.openshift.com/pub/openshift-v4/clients/rosa/latest/rosa-linux.tar.gz"
  wget -q -O /tmp/rosa.tar.gz "$ROSA_URL" || warn "rosa download failed."
  if [ -f /tmp/rosa.tar.gz ]; then
    tar xzf /tmp/rosa.tar.gz -C /usr/local/bin rosa 2>/dev/null || true
    chmod +x /usr/local/bin/rosa 2>/dev/null || true
    rm -f /tmp/rosa.tar.gz
    log "rosa CLI installed."
  fi
fi

# Certbot
if command -v certbot &>/dev/null; then
  log "Certbot already installed."
else
  log "Installing Certbot..."
  apt-get install -y certbot python3-certbot-nginx
fi

# ------------------------------------------------------------------
# 10. Create directories
# ------------------------------------------------------------------
log "Setting up directory structure..."
mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/cloudportal

# If the repo is not already at INSTALL_DIR, inform the user
if [ ! -f "$INSTALL_DIR/dockerfiles/backend/package.json" ]; then
  warn "Repository not found at $INSTALL_DIR/dockerfiles/backend/package.json"
  warn "Clone or copy the repository to $INSTALL_DIR before proceeding."
  warn "Skipping npm install, seed, and image steps."
  SKIP_APP=true
else
  SKIP_APP=false
fi

# ------------------------------------------------------------------
# 11. Install NPM dependencies
# ------------------------------------------------------------------
if [ "$SKIP_APP" = false ]; then
  log "Installing backend dependencies..."
  cd "$INSTALL_DIR/dockerfiles/backend"
  npm install --production 2>&1 | tail -3

  if [ -d "$INSTALL_DIR/portal.synergificsoftware.com/frontend" ]; then
    log "Installing frontend dependencies..."
    cd "$INSTALL_DIR/portal.synergificsoftware.com/frontend"
    npm install 2>&1 | tail -3
  fi
fi

# ------------------------------------------------------------------
# 12. Seed database templates
# ------------------------------------------------------------------
if [ "$SKIP_APP" = false ]; then
  log "Seeding database templates..."
  cd "$INSTALL_DIR/dockerfiles/backend"

  if [ -f scripts/seed-sandbox-templates.js ]; then
    node scripts/seed-sandbox-templates.js 2>&1 || warn "Sandbox template seeding failed (may need MONGO_URI)."
  fi
  if [ -f scripts/seed-guided-labs.js ]; then
    node scripts/seed-guided-labs.js 2>&1 || warn "Guided lab seeding failed."
  fi
fi

# ------------------------------------------------------------------
# 13. Build custom Docker images
# ------------------------------------------------------------------
if [ "$SKIP_APP" = false ] && [ "$SKIP_IMAGES" != "true" ]; then
  log "Building custom GetLabs Docker images..."
  cd "$INSTALL_DIR/dockerfiles"

  CUSTOM_LABS=(
    lab-bigdata-workspace
    lab-devops-cicd
    lab-terraform
    lab-elk-stack
    lab-ai-ml
    lab-ansible
    lab-monitoring
    lab-fullstack
    lab-docker-k8s
  )

  for lab in "${CUSTOM_LABS[@]}"; do
    if [ -d "$lab" ] && [ -f "$lab/Dockerfile" ]; then
      log "  Building getlabs/$lab:1.0..."
      docker build -t "getlabs/$lab:1.0" "$lab" 2>&1 | tail -1 || warn "Build failed: $lab"
    else
      warn "  Skipping $lab (no Dockerfile found)."
    fi
  done
fi

# ------------------------------------------------------------------
# 14. Pull third-party Docker images (background)
# ------------------------------------------------------------------
if [ "$SKIP_IMAGES" != "true" ]; then
  log "Pulling third-party Docker images in background..."

  IMAGES=(
    "linuxserver/webtop:ubuntu-xfce"
    "linuxserver/webtop:ubuntu-kde"
    "linuxserver/webtop:ubuntu-mate"
    "linuxserver/webtop:ubuntu-openbox"
    "linuxserver/webtop:alpine-xfce"
    "linuxserver/webtop:fedora-xfce"
    "linuxserver/webtop:arch-xfce"
    "kasmweb/desktop:1.16.0"
    "kasmweb/desktop-deluxe:1.16.0"
    "kasmweb/rockylinux-9-desktop:1.16.0"
    "kasmweb/almalinux-9-desktop:1.16.0"
    "kasmweb/oracle-8-desktop:1.16.0"
    "kasmweb/kali-rolling-desktop:1.16.0"
    "lukaszlach/kali-desktop:xfce"
    "kasmweb/chrome:1.16.0"
    "kasmweb/firefox:1.16.0"
    "kasmweb/vs-code:1.16.0"
    "kasmweb/terminal:1.16.0"
    "kasmweb/libre-office:1.16.0"
    "codercom/code-server:latest"
    "jupyter/scipy-notebook:latest"
    "jupyter/tensorflow-notebook:latest"
    "nestybox/ubuntu-jammy-systemd-docker:latest"
    "guacamole/guacd:latest"
  )

  PULL_LOG="/var/log/cloudportal/image-pull.log"
  echo "Image pull started at $(date)" > "$PULL_LOG"

  for img in "${IMAGES[@]}"; do
    (
      if docker image inspect "$img" &>/dev/null; then
        echo "[CACHED] $img" >> "$PULL_LOG"
      else
        docker pull "$img" >> "$PULL_LOG" 2>&1 && \
          echo "[PULLED] $img" >> "$PULL_LOG" || \
          echo "[FAILED] $img" >> "$PULL_LOG"
      fi
    ) &
  done

  # Don't wait -- pulls happen in background
  log "Image pulls running in background. Check $PULL_LOG for progress."
fi

# ------------------------------------------------------------------
# 15. PM2 ecosystem config
# ------------------------------------------------------------------
if [ "$SKIP_APP" = false ]; then
  log "Configuring PM2..."

  PM2_CONFIG="$INSTALL_DIR/ecosystem.config.js"
  cat > "$PM2_CONFIG" << 'PMEOF'
module.exports = {
  apps: [
    {
      name: 'cloudportal-backend',
      cwd: './dockerfiles/backend',
      script: 'index.js',
      instances: 1,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/cloudportal/backend-error.log',
      out_file: '/var/log/cloudportal/backend-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
PMEOF

  cd "$INSTALL_DIR"
  pm2 delete cloudportal-backend 2>/dev/null || true
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup systemd -u root --hp /root 2>&1 | tail -1 || true
  log "PM2 configured and backend started."
fi

# ------------------------------------------------------------------
# 16. Build frontend
# ------------------------------------------------------------------
if [ "$SKIP_APP" = false ]; then
  if [ -d "$INSTALL_DIR/portal.synergificsoftware.com/frontend" ]; then
    log "Building frontend..."
    cd "$INSTALL_DIR/portal.synergificsoftware.com/frontend"
    npm run build 2>&1 | tail -3 || warn "Frontend build failed."
  fi
fi

# ------------------------------------------------------------------
# 17. Nginx configuration
# ------------------------------------------------------------------
log "Configuring Nginx..."

NGINX_CONF="/etc/nginx/sites-available/cloudportal"
cat > "$NGINX_CONF" << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    # SSL certs -- certbot will update these
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Frontend
    location / {
        root ${INSTALL_DIR}/portal.synergificsoftware.com/frontend/dist;
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }

    # Guacamole
    location /guacamole/ {
        proxy_pass http://127.0.0.1:8085/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_buffering off;
    }
}
NGINXEOF

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/cloudportal
rm -f /etc/nginx/sites-enabled/default

nginx -t 2>&1 && systemctl reload nginx || warn "Nginx config test failed."

# ------------------------------------------------------------------
# 18. SSL certificate (Let's Encrypt)
# ------------------------------------------------------------------
if [ "$SKIP_SSL" != "true" ] && [ "$DOMAIN" != "portal.example.com" ]; then
  log "Obtaining SSL certificate for ${DOMAIN}..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" 2>&1 || \
    warn "Certbot failed. Run manually: certbot --nginx -d ${DOMAIN}"
  systemctl reload nginx || true
else
  if [ "$DOMAIN" = "portal.example.com" ]; then
    warn "Using default domain. Set DOMAIN env var and re-run for SSL."
  else
    log "SSL skipped (SKIP_SSL=true)."
  fi
fi

# ------------------------------------------------------------------
# 19. Firewall
# ------------------------------------------------------------------
if command -v ufw &>/dev/null; then
  log "Configuring firewall..."
  ufw allow 22/tcp   2>/dev/null || true
  ufw allow 80/tcp   2>/dev/null || true
  ufw allow 443/tcp  2>/dev/null || true
  ufw --force enable 2>/dev/null || true
fi

# ------------------------------------------------------------------
# Done
# ------------------------------------------------------------------
log "============================================"
log "Production setup complete."
log ""
log "Next steps:"
log "  1. Copy repo to $INSTALL_DIR (if not already there)"
log "  2. Edit $INSTALL_DIR/dockerfiles/backend/.env with real credentials"
log "  3. Place GCP service account key at $INSTALL_DIR/dockerfiles/backend/gcp-service-account.json"
log "  4. Set DOMAIN=$DOMAIN and re-run if SSL was skipped"
log "  5. Check image pull progress: tail -f /var/log/cloudportal/image-pull.log"
log "  6. Monitor backend: pm2 logs cloudportal-backend"
log "============================================"
