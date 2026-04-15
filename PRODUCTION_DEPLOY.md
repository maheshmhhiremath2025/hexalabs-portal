# GetLabs Cloud Portal -- Production Deployment Guide

This document covers everything needed to deploy the GetLabs cloud training portal
on a fresh Ubuntu 22.04+ server.

---

## 1. System Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | v20+ | Backend + frontend build |
| MongoDB | 6+ | Primary database |
| Redis | 7+ | Optional -- Bull job queues (cleanup automations now use direct SDK calls) |
| Docker | 24+ | Container/workspace labs |
| Sysbox Runtime | 0.6.4+ | Docker-in-Docker labs (nested containers without --privileged) |
| Nginx | 1.18+ | Reverse proxy, SSL termination |
| PM2 | 5+ | Node.js process manager |

## 2. CLI Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `rosa` | ROSA (Red Hat OpenShift on AWS) cluster management | `rosa download rosa` |
| `oc` | OpenShift CLI for cluster operations | From Red Hat mirror |
| `az` | Azure CLI for ARO clusters + sandbox policies | `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash` |
| `gcloud` | Optional -- GCP debugging (SDK handles provisioning) | `snap install google-cloud-cli` |
| `aws` | Optional -- AWS debugging (SDK handles IAM) | `snap install aws-cli` |

## 3. NPM Dependencies (Backend)

### Core Framework
- `express` ^4.19.2 -- HTTP server
- `mongoose` ^8.5.1 -- MongoDB ODM
- `dotenv` ^16.4.5 -- Environment variable loading
- `cors` ^2.8.5 -- Cross-origin resource sharing
- `cookie-parser` ^1.4.6 -- Cookie parsing middleware

### Authentication and Security
- `jsonwebtoken` ^9.0.2 -- JWT auth tokens
- `bcrypt` ^6.0.0 -- Password hashing

### Cloud Provider SDKs
- `@aws-sdk/client-iam` ^3.1028.0 -- AWS IAM user management
- `@aws-sdk/client-sts` ^3.1028.0 -- AWS STS assume-role
- `@azure/identity` ^4.13.1 -- Azure AD authentication
- `@azure/arm-resources` ^7.0.0 -- Azure resource group management
- `@azure/arm-authorization` ^9.0.0 -- Azure RBAC
- `@azure/arm-compute` ^23.3.0 -- Azure VM management
- `@azure/arm-network` ^36.0.0 -- Azure networking
- `@azure/arm-policy` ^7.0.0 -- Azure sandbox policies
- `@azure/arm-monitor` ^7.0.0 -- Azure monitoring/metrics
- `@azure/arm-costmanagement` ^1.0.0-beta.1 -- Azure cost tracking
- `oci-sdk` ^2.127.0 -- Oracle Cloud Infrastructure SDK
- `googleapis` (peer/transitive) -- GCP project management

### Container and Orchestration
- `dockerode` ^4.0.10 -- Docker API client
- `@kubernetes/client-node` ^1.4.0 -- Kubernetes API client

### Job Processing
- `bull` ^4.16.0 -- Redis-backed job queues (optional, direct SDK calls preferred)
- `node-cron` ^3.0.3 -- Scheduled cleanup automations

### AI and Document Processing
- `@anthropic-ai/sdk` ^0.30.1 -- Claude API for course analysis
- `pdf-parse` ^1.1.4 -- PDF content extraction
- `pdfkit` ^0.14.0 -- PDF generation (certificates, reports)
- `handlebars` ^4.7.8 -- Email/report templates
- `csv-writer` ^1.6.0 -- CSV export

### Email and Notifications
- `nodemailer` ^6.9.7 -- SMTP email sending

### Payments
- `razorpay` ^2.9.5 -- Payment processing

### Logging
- `winston` ^3.13.1 -- Structured logging

### Other
- `multer` ^1.4.5-lts.1 -- File upload handling
- `moment-timezone` ^0.5.47 -- Timezone-aware date handling

### Frontend Dependencies (Vite + React 19)
- `react` ^19.0.0, `react-dom` ^19.0.0
- `react-router-dom` ^7.4.1
- `tailwindcss` ^4.1.2, `@tailwindcss/vite` ^4.1.2
- `axios` ^1.8.4
- `framer-motion` ^12.23.12
- `recharts` ^3.1.2
- `lucide-react` ^0.542.0, `react-icons` ^5.5.0
- `react-toastify` ^11.0.5
- `react-day-picker` ^9.11.1
- `vite` ^6.2.0

## 4. Environment Variables

Create `/dockerfiles/backend/.env` with the following variables.
All values below are placeholders -- replace with your actual credentials.

```bash
# === Node Environment ===
NODE_ENV='production'

# === Azure (Sandbox Resource Management) ===
CLIENT_ID=<azure-app-client-id>
CLIENT_SECRET=<azure-app-client-secret>
TENANT_ID=<azure-tenant-id>
SUBSCRIPTION_ID=<azure-subscription-id>

# === Azure (Identity / Azure AD user management) ===
IDENTITY_CLIENT_ID=<identity-app-client-id>
IDENTITY_CLIENT_SECRET=<identity-app-client-secret>
IDENTITY_TENANT_ID=<identity-tenant-id>
IDENTITY_DOMAIN=<your-domain.com>

# === AWS (IAM sandbox user management) ===
AWS_ACCESS_KEY=<aws-access-key-id>
AWS_ACCESS_SECRET=<aws-secret-access-key>
AWS_REGION=ap-south-1

# === GCP (Sandbox project provisioning) ===
KEYFILENAME=./gcp-service-account.json
PARENTID=organizations/<org-id>
GCP_BILLING_ACCOUNT=<billing-account-id>

# === Oracle Cloud Infrastructure ===
OCI_TENANCY_OCID=<oci-tenancy-ocid>
OCI_USER_OCID=<oci-user-ocid>
OCI_FINGERPRINT=<oci-api-key-fingerprint>
OCI_PRIVATE_KEY=<base64-encoded-private-key>
OCI_REGION=<oci-region>
OCI_PARENT_COMPARTMENT_OCID=<oci-compartment-ocid>

# === Email (Gmail SMTP) ===
GMAIL_USER=<gmail-address>
GMAIL_PASS=<gmail-app-password>

# === Payments (Razorpay) ===
RAZORPAY_ID=<razorpay-key-id>
RAZORPAY_KEY=<razorpay-key-secret>

# === AI (Anthropic Claude) ===
CLAUDE_API_KEY=<anthropic-api-key>
CLAUDE_MODEL=claude-haiku-4-5-20251001

# === MongoDB ===
MONGO_URI=mongodb://localhost:27017/cloudportal

# === Redis (optional) ===
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# === JWT ===
JWT_SECRET=<random-secret-string>
```

## 5. Docker Images (33 images)

All container images used for workspace/lab provisioning:

### Linux Desktops (LinuxServer Webtop)
1. `linuxserver/webtop:ubuntu-xfce`
2. `linuxserver/webtop:ubuntu-kde`
3. `linuxserver/webtop:ubuntu-mate`
4. `linuxserver/webtop:ubuntu-openbox`
5. `linuxserver/webtop:alpine-xfce`
6. `linuxserver/webtop:fedora-xfce`
7. `linuxserver/webtop:arch-xfce`

### KasmWeb Full Desktops
8. `kasmweb/desktop:1.16.0`
9. `kasmweb/desktop-deluxe:1.16.0`

### RHEL / CentOS Family
10. `kasmweb/rockylinux-9-desktop:1.16.0`
11. `kasmweb/almalinux-9-desktop:1.16.0`
12. `kasmweb/oracle-8-desktop:1.16.0`

### Cybersecurity / Pentesting
13. `kasmweb/kali-rolling-desktop:1.16.0`
14. `lukaszlach/kali-desktop:xfce`

### Single Applications (KasmWeb)
15. `kasmweb/chrome:1.16.0`
16. `kasmweb/firefox:1.16.0`
17. `kasmweb/vs-code:1.16.0`
18. `kasmweb/terminal:1.16.0`
19. `kasmweb/libre-office:1.16.0`

### Dev Environments
20. `codercom/code-server:latest`
21. `jupyter/scipy-notebook:latest`
22. `jupyter/tensorflow-notebook:latest`

### GetLabs Custom Lab Images (build from dockerfiles/)
23. `getlabs/lab-devops-cicd:1.0`
24. `getlabs/lab-terraform:1.0`
25. `getlabs/lab-elk-stack:1.0`
26. `getlabs/lab-ai-ml:1.0`
27. `getlabs/lab-ansible:1.0`
28. `getlabs/lab-monitoring:1.0`
29. `getlabs/lab-fullstack:1.0`
30. `getlabs/lab-docker-k8s:1.0`
31. `getlabs/lab-bigdata-workspace:1.0`

### Sysbox / Docker-in-Docker
32. `nestybox/ubuntu-jammy-systemd-docker:latest`

### Guacamole (remote desktop gateway)
33. `guacamole/guacd:latest`

## 6. Ports

| Port | Service |
|------|---------|
| 8001 | Backend API (Express) |
| 3000 | Frontend dev server (Vite) / Production: served via Nginx |
| 27017 | MongoDB |
| 6379 | Redis |
| 8085 | Apache Guacamole (remote desktop gateway) |
| 10000-11000 | Container VNC/HTTP port range (dynamically assigned) |
| 15000-16000 | Container SSH port range (dynamically assigned) |
| 80 | Nginx HTTP (redirects to 443) |
| 443 | Nginx HTTPS |

## 7. Deployment Steps

### Step 1: Clone Repository

```bash
git clone <repo-url> /opt/cloudportal
cd /opt/cloudportal
```

### Step 2: Install Node.js Dependencies

```bash
# Backend
cd dockerfiles/backend
npm install

# Frontend
cd ../../portal.synergificsoftware.com/frontend
npm install
```

### Step 3: Configure Environment

```bash
cp dockerfiles/backend/.env.example dockerfiles/backend/.env
# Edit .env with your actual credentials (see Section 4 above)
nano dockerfiles/backend/.env
```

Place your GCP service account JSON key at `dockerfiles/backend/gcp-service-account.json`.

### Step 4: Start MongoDB

```bash
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Step 5: Start Redis (optional)

```bash
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### Step 6: Seed Database Templates

```bash
cd dockerfiles/backend
node scripts/seed-sandbox-templates.js
node scripts/seed-guided-labs.js
```

### Step 7: Build Custom Docker Images

```bash
cd dockerfiles

# Build each custom lab image
for lab in lab-bigdata-workspace lab-devops-cicd lab-terraform lab-elk-stack \
           lab-ai-ml lab-ansible lab-monitoring lab-fullstack lab-docker-k8s; do
  echo "Building $lab..."
  cd $lab && docker build -t getlabs/$lab:1.0 . && cd ..
done
```

### Step 8: Pull Third-Party Docker Images

```bash
# Pull all third-party images (run in background)
docker pull linuxserver/webtop:ubuntu-xfce &
docker pull linuxserver/webtop:ubuntu-kde &
docker pull linuxserver/webtop:ubuntu-mate &
docker pull linuxserver/webtop:ubuntu-openbox &
docker pull linuxserver/webtop:alpine-xfce &
docker pull linuxserver/webtop:fedora-xfce &
docker pull linuxserver/webtop:arch-xfce &
docker pull kasmweb/desktop:1.16.0 &
docker pull kasmweb/desktop-deluxe:1.16.0 &
docker pull kasmweb/rockylinux-9-desktop:1.16.0 &
docker pull kasmweb/almalinux-9-desktop:1.16.0 &
docker pull kasmweb/oracle-8-desktop:1.16.0 &
docker pull kasmweb/kali-rolling-desktop:1.16.0 &
docker pull lukaszlach/kali-desktop:xfce &
docker pull kasmweb/chrome:1.16.0 &
docker pull kasmweb/firefox:1.16.0 &
docker pull kasmweb/vs-code:1.16.0 &
docker pull kasmweb/terminal:1.16.0 &
docker pull kasmweb/libre-office:1.16.0 &
docker pull codercom/code-server:latest &
docker pull jupyter/scipy-notebook:latest &
docker pull jupyter/tensorflow-notebook:latest &
docker pull nestybox/ubuntu-jammy-systemd-docker:latest &
docker pull guacamole/guacd:latest &
wait
echo "All images pulled."
```

### Step 9: Start Backend with PM2

```bash
cd /opt/cloudportal/dockerfiles/backend
pm2 start index.js --name cloudportal-backend --max-memory-restart 1G
pm2 save
pm2 startup
```

### Step 10: Build and Serve Frontend

```bash
cd /opt/cloudportal/portal.synergificsoftware.com/frontend
npm run build
# The dist/ folder will be served by Nginx
```

### Step 11: Configure Nginx

Create `/etc/nginx/sites-available/cloudportal`:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Frontend (Vite build output)
    location / {
        root /opt/cloudportal/portal.synergificsoftware.com/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }

    # Guacamole (remote desktop)
    location /guacamole/ {
        proxy_pass http://127.0.0.1:8085/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_buffering off;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/cloudportal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### Step 12: SSL with Certbot

```bash
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

## 8. Install Sysbox Runtime (for Docker-in-Docker Labs)

Required for `docker-k8s-lab`, `ansible-lab`, and `docker-lab-basic` images.

```bash
wget https://downloads.nestybox.com/sysbox/releases/v0.6.4/sysbox-ce_0.6.4-0.linux_amd64.deb
sudo dpkg -i sysbox-ce_0.6.4-0.linux_amd64.deb
sudo systemctl restart docker
```

Verify: `docker info | grep -i sysbox` should show `sysbox-runc` as an available runtime.

## 9. Monitoring and Maintenance

```bash
# Check backend status
pm2 status
pm2 logs cloudportal-backend

# Check MongoDB
sudo systemctl status mongod

# Check Docker containers
docker ps

# Check disk space (images are large)
df -h
docker system df

# Prune stopped containers and dangling images
docker system prune -f
```

## 10. Firewall Rules

```bash
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 22/tcp    # SSH admin
# Do NOT expose 8001, 27017, 6379 publicly
# Container ports 10000-11000 and 15000-16000 are accessed via Nginx proxy
```
