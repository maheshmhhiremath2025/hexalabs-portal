# Claude Code Session Log - 2026-05-25

## Project: HexaLabs Cloud Portal (Synergific Software)
**Repo:** `https://github.com/maheshmhhiremath2025/hexalabs-portal.git`
**Local Path:** `d:\hexalabs\project_backup\synergific-portal`
**Server:** `20.235.11.151` (user: `Hexalabs9`, pass: `<REDACTED_ADMIN_PASS>#@`)
**Server Project Path:** `/opt/hexalabs/`

---

## Full Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 4, React Router 7, Recharts, Framer Motion |
| Backend | Express.js 4.19, Node.js 20+ (server runs v22.22.2), Mongoose 8.5 ODM |
| Database | MongoDB 6+ (db: `userdb`), Redis 7+ |
| Job Queue | Bull (24 named queues, 28 handlers) |
| Cloud SDKs | Azure (compute, network, IAM, cost, policy), AWS (EC2, IAM, STS, AppStream), GCP (googleapis, Firestore, Billing), OCI SDK |
| Containers | Docker 24+ with Sysbox, KasmVNC for browser desktops |
| Remote Access | Apache Guacamole (RDP/SSH), KasmVNC, MeshCentral (Windows) |
| AI | Claude API via Anthropic SDK (lab generation, course analysis, chatbot) |
| Payments | Razorpay |
| Email | Nodemailer + Gmail |
| Deployment | Docker Compose, Nginx, PM2, Certbot SSL |

---

## Project Architecture (Detailed)

### Directory Structure
```
synergific-portal/
├── portal.synergificsoftware.com/frontend/   # React SPA
│   ├── src/pages/          (46 page components)
│   ├── src/components/     (23 components incl. GuidedLab/, Modal/)
│   ├── src/services/       (API call abstractions)
│   ├── src/contexts/       (BrandingContext, etc.)
│   └── dist/               (production build)
├── dockerfiles/
│   ├── backend/            # Express API server
│   │   ├── controllers/    (36 unique controller files, incl. subdirs)
│   │   ├── models/         (28 unique Mongoose schemas)
│   │   ├── routes/         (21 unique route files)
│   │   ├── services/       (cloud SDK wrappers, business logic)
│   │   ├── automations/    (cron jobs: idle shutdown, sandbox cleanup, etc.)
│   │   ├── middlewares/    (auth, logging, error handling)
│   │   ├── scripts/        (DB seeding, migrations)
│   │   └── functions/      (GCP-specific, templates)
│   ├── worker/             # Bull job queue processor
│   │   ├── handlers/       (28 async job handlers)
│   │   ├── functions/      (vmcreation/, vmdeletion/, sandbox/, emails/)
│   │   ├── queues.js       (queue definitions)
│   │   └── worker.js       (entrypoint)
│   ├── lab-*/              (15+ Docker lab images)
│   ├── guacamole/          (Guacamole Docker config)
│   ├── k8s/                (Kubernetes manifests)
│   ├── golden-images/      (pre-built VM images)
│   ├── vm-templates/       (VM customization)
│   └── docker-compose.yml  (full stack orchestration)
├── scripts/                (deployment, monitoring, backup scripts)
├── html/                   (static HTML)
└── CLAUDE_SESSION_LOG.md   (this file)
```

### Key Models (28 Mongoose Schemas)
User, Organization, VM, Container, Training, GuidedLab, LabProgress, LabFeedback,
SandboxTemplate, SandboxDeployment, SandboxUser, GcpSandboxUser, OciSandboxUser,
DockerHost, RosaCluster, AroCluster, AzureCost, CourseAnalysis, CustomImage,
Plan, Subscription, Team, Project, Templates, Email, DemoRequest, ApiKey, AWS

### User Roles
- `superadmin` - Full platform control
- `admin` - Org-level management
- `sandboxuser` - Cloud sandbox access
- `selfservice` - B2C self-service labs

### Cron Automations
- Every 1 min: schedule checker, quota enforcement, sandbox cleanup
- Every 5 min: idle shutdown, cluster cleanup, Docker host scaling
- Every 30 min: quota warnings, budget alerts
- Every 6 hours: Azure cost sync
- Weekly: orphan resource cleanup

---

## Guided Labs Feature (Detailed)

### Backend Files
- **Model:** `dockerfiles/backend/models/guidedLab.js` - Schema with steps, verification, troubleshooting, cloud targeting
- **Routes:** `dockerfiles/backend/routes/guidedLab.js` - Full CRUD, deployment, progress, analytics endpoints
- **Controller:** `dockerfiles/backend/controllers/guidedLab.js` - API handlers (~753 lines of guided lab logic)
- **Lab Generator:** `dockerfiles/backend/services/labGenerator.js` - Claude AI generates labs from PDFs (~510 lines)
- **Verification:** `dockerfiles/backend/services/labVerificationService.js` - Auto-verify student step completion
- **Chatbot:** `dockerfiles/backend/services/labChatbot.js` - AI assistant during labs
- **Progress:** `dockerfiles/backend/models/labProgress.js` - Per-student step tracking
- **Feedback:** `dockerfiles/backend/models/labFeedback.js` - Ratings and reviews
- **Sandbox Provisioner:** `dockerfiles/backend/services/sandboxProvisioner.js` - Auto-provision cloud sandboxes for labs
- **Sandbox Cleanup:** `dockerfiles/backend/services/sandboxCleanup.js` - Auto-cleanup expired sandbox resources

### Frontend Files
- **Lab Listing:** `pages/GuidedLabs.jsx` - Browse/filter/create labs
- **Lab Editor:** `pages/GuidedLabEditor.jsx` - Create/edit lab steps (superadmin)
- **Lab Analytics:** `pages/GuidedLabAnalytics.jsx` - Completion rates, progress stats
- **Lab Panel:** `components/GuidedLab/GuidedLabPanel.jsx` - Step-by-step guide overlay
- **Lab View:** `pages/LabView.jsx` - Fullscreen lab experience (desktop iframe + guide panel)
- **Lab Chatbot:** `components/LabChatbot.jsx` - In-lab AI assistant

### Frontend Routes
| Route | Page | Access |
|-------|------|--------|
| `/guided-labs` | Lab listing & creation | admin+ |
| `/guided-labs/analytics` | Completion & progress stats | admin+ |
| `/guided-labs/editor` | Create new lab | superadmin |
| `/guided-labs/editor/:id` | Edit existing lab | superadmin |
| `/lab-view` | Fullscreen lab + desktop | authenticated |

### Key Capabilities
- AI generation from PDF upload (Claude API)
- Step verification: auto (CLI command + regex), manual, or none
- Per-step troubleshooting guides
- Cloud targeting: azure, aws, gcp, container, vm
- Auto sandbox provisioning for students
- Progress tracking (hints viewed, time spent)
- Feedback (1-5 ratings, difficulty, content quality)
- Difficulty levels: beginner, intermediate, advanced

---

## Platform Features Summary

1. **Multi-Cloud VM Management** - Azure VM full lifecycle (create/start/stop/delete), idle auto-shutdown, expiry
2. **Docker Container Labs** - 15+ pre-built images (AI/ML, Ansible, DevOps, K8s, etc.), 2-3 sec launch, auto-scaling host pool
3. **Multi-Cloud Sandboxes** - Azure/AWS/GCP/OCI with TTL, budget caps, IAM policy injection
4. **Guided Labs** - AI-generated step-by-step tutorials with auto-verification (see detailed section above)
5. **Kubernetes Clusters** - ROSA (AWS) and ARO (Azure) with per-student namespace isolation
6. **Cost Optimization** - Idle detection, right-sizing, orphan cleanup, night pause, spot eviction handling
7. **Analytics** - Lab completion rates, student progress, cost breakdowns per VM/lab/org
8. **B2B/B2C Portal** - Self-service signups, subscription plans, team management
9. **White-Label Branding** - Per-org logos, colors, favicons, support contacts (BrandingContext)
10. **Email Notifications** - Bulk credentials, expiry warnings, branded HTML templates (Handlebars)
11. **Payment Processing** - Razorpay integration for subscriptions
12. **Remote Access** - Guacamole (RDP/SSH), KasmVNC (browser desktops), MeshCentral (Windows agents)

---

## What Was Done This Session

### 1. Full Project Study
- Explored entire codebase: directory structure, tech stack, all features, all files
- Identified 28 models, 36 controllers, 21 routes, 15+ lab images
- Mapped all cloud SDK usage across backend and worker

### 2. Guided Labs Confirmation
- Confirmed Guided Labs is fully implemented with AI generation, verification, analytics
- Mapped all backend and frontend files for the feature

### 3. Three-Way Sync (Git Repo <-> Server <-> Local)
- **Problem:** Server git HEAD was at `6523f3c`, 1 commit behind. Had uncommitted changes matching `cab02e5`
- **Problem:** 4 new files existed as untracked on server (sandboxCleanup.js, sandboxProvisioner.js, seed-databricks-template.js, GuidedLabAnalytics.jsx)
- **Problem:** Local backup had duplicate nested folders (`models/models/`, `controllers/controllers/`, `routes/routes/`) - 82 duplicate files
- **Problem:** Server had `@microsoft/microsoft-graph-client` in package.json but repo/local didn't
- **Fix:** Added missing dependency to local package.json, deleted 82 duplicate files locally
- **Fix:** Committed as `0e32f32` ("fix: add @microsoft/microsoft-graph-client dependency to match server"), pushed to GitHub
- **Fix:** On server: stashed changes, moved untracked files to /tmp, ran `git pull origin main` (fast-forward), dropped stash, cleaned /tmp
- **Result:** All three sources at commit `0e32f32`, clean git state everywhere
- **Verification:** All 22 changed files confirmed byte-for-byte identical across all three sources

### 4. Azure Credentials Updated (New Tenant + Subscription)
Old tenant (`0e22b77c-...`) and subscription (`337f2b3a-...`) replaced with new ones.

**New Azure Credentials (updated on BOTH server and local `.env`):**
```
CLIENT_ID=13cdc803-f6a8-438c-baf1-efac36510ac6
CLIENT_SECRET=<REDACTED_CLIENT_SECRET>
TENANT_ID=4647b273-1b26-45e6-9fec-77680619a098
SUBSCRIPTION_ID=ba7b8c9b-59c4-475a-a85c-fff76751215a
IDENTITY_CLIENT_ID=89518af3-7b55-4f0a-8a59-3fe2497a6e98
IDENTITY_CLIENT_SECRET=<REDACTED_IDENTITY_SECRET>
IDENTITY_TENANT_ID=4647b273-1b26-45e6-9fec-77680619a098
IDENTITY_DOMAIN=hexalabs.online
```

**Azure App Registrations created by user:**
- `HexaLabs-Portal` (CLIENT_ID) → Needs roles: Contributor + User Access Administrator + Cost Management Reader on subscription
- `HexaLabs-Identity` (IDENTITY_CLIENT_ID) → Needs Microsoft Graph permissions: User.ReadWrite.All + Directory.ReadWrite.All (admin consented)

**Step-by-step instructions provided to user for creating these in Azure Portal.**

### 5. Claude Model Fixed
- Original: `CLAUDE_MODEL=claude-sonnet-4-5`
- First attempt: Changed to `claude-sonnet-4-5-20250514` (INVALID - got 404 error)
- Final fix: Changed to `CLAUDE_MODEL=claude-sonnet-4-6` (correct latest model)
- Updated on server `.env`, local `.env`, backend restarted
- Lab generation service (`labGenerator.js`) defaults to `claude-sonnet-4-6` if env var not set

### 6. Container Host IP Updated
- Local `.env` had old IP `CONTAINER_HOST_IP=93.127.194.200`
- Updated to `CONTAINER_HOST_IP=20.235.11.151` (matches server)
- Server already had the correct value

### 7. Superadmin Password Reset
- Queried MongoDB: `db.users.find({userType:"superadmin"})` in `userdb`
- Found user: `admin@hexalabs.online`
- Password was bcrypt hashed (could not be reversed)
- Reset via: `cd /opt/hexalabs/dockerfiles/backend && node -e "bcrypt.hash('<REDACTED_ADMIN_PASS>', 10)..."` → updated MongoDB
- **Login credentials:**
  - Email: `admin@hexalabs.online`
  - Password: `<REDACTED_ADMIN_PASS>`

### 8. Backend Restarts
- Backend and worker restarted multiple times during session via `pm2 restart`
- Final state: all online and healthy

---

## Current Server .env (Full Reference)
```
CLIENT_ID=13cdc803-f6a8-438c-baf1-efac36510ac6
CLIENT_SECRET=<REDACTED_CLIENT_SECRET>
TENANT_ID=4647b273-1b26-45e6-9fec-77680619a098
SUBSCRIPTION_ID=ba7b8c9b-59c4-475a-a85c-fff76751215a
NODE_ENV=production
GMAIL_USER=cloudsynergificsoftware@gmail.com
GMAIL_PASS=<REDACTED_GMAIL_APP_PASSWORD>
RAZORPAY_ID=<REDACTED_RAZORPAY_ID>
RAZORPAY_KEY=<REDACTED_RAZORPAY_KEY>
CLAUDE_API_KEY=<REDACTED_CLAUDE_API_KEY>
CLAUDE_MODEL=claude-sonnet-4-6
OCI_TENANCY_OCID=<REDACTED_OCI_TENANCY>
OCI_USER_OCID=<REDACTED_OCI_USER>
OCI_FINGERPRINT=<REDACTED_OCI_FINGERPRINT>
OCI_REGION=ap-hyderabad-1
OCI_PARENT_COMPARTMENT_OCID=<REDACTED_OCI_COMPARTMENT>
KEYFILENAME=./gcp-service-account.json
PARENTID=organizations/628552726767
GCP_BILLING_ACCOUNT=<REDACTED_GCP_BILLING>
CORS_ORIGINS=http://localhost:3000,https://portal.hexalabs.online,https://portal.synergificsoftware.com,https://www.hexalabs.online,https://hexalabs.online
REDIS_HOST=127.0.0.1
MONGO_URI=mongodb://127.0.0.1:27017/userdb
CONTAINER_HOST_IP=20.235.11.151
CONTAINER_ACCESS_DOMAIN=portal.hexalabs.online
IDENTITY_CLIENT_ID=89518af3-7b55-4f0a-8a59-3fe2497a6e98
IDENTITY_CLIENT_SECRET=<REDACTED_IDENTITY_SECRET>
IDENTITY_TENANT_ID=4647b273-1b26-45e6-9fec-77680619a098
IDENTITY_DOMAIN=hexalabs.online
AWS_ACCESS_KEY=<REDACTED_AWS_KEY>
AWS_ACCESS_SECRET=<REDACTED_AWS_SECRET>
GUACAMOLE_URL=https://labs.synergificsoftware.com
GUACAMOLE_PUBLIC_URL=https://labs.synergificsoftware.com
GUACAMOLE_ADMIN_USER=guacadmin
GUACAMOLE_ADMIN_PASS=<REDACTED_GUAC_PASS>
CONTAINER_SSL_PORT_OFFSET=0
DOCKER_HOST_MODE=local
DOCKER_HOST_REGION=centralindia
DOCKER_HOST_VM_SIZE=Standard_B2ms
DOCKER_HOST_MAX_CONTAINERS=30
DOCKER_HOST_IDLE_TIMEOUT_MIN=30
DOCKER_HOST=unix:///var/run/docker.sock
AWS_CONNECT_ACCESS_KEY=<REDACTED_AWS_CONNECT_KEY>
AWS_CONNECT_ACCESS_SECRET=<REDACTED_AWS_CONNECT_SECRET>
AWS_CONNECT_ACCOUNT_ID=631461173692
AWS_CONNECT_REGION=us-east-1
AWS_CONNECT_STUDENT_POLICY_ARN=arn:aws:iam::631461173692:policy/HexaLabs-Connect-Student
MESHCENTRAL_URL=wss://localhost:8443
MESHCENTRAL_PUBLIC_URL=https://mesh.hexalabs.online
MESHCENTRAL_ADMIN_USER=kumar@hexalabs.online
MESHCENTRAL_ADMIN_PASS=<REDACTED_MC_ADMIN_PASS>
MESHCENTRAL_LOGIN_TOKEN=<REDACTED_MC_TOKEN>
MESHCENTRAL_LOGIN_TOKEN_KEY=<REDACTED_MC_TOKEN_KEY>
MESHCENTRAL_DEVICE_GROUP=portalvms
MESHCENTRAL_MESH_ID=<REDACTED_MC_MESH_ID>
JWT_SECRET=<REDACTED_JWT_SECRET>
SKIP_VM_COUNT_CHECK=1
```

---

## Current Server State (as of 2026-05-25)

### PM2 Processes
| Name | Status | Notes |
|------|--------|-------|
| hexalabs-backend | online | Port 8001, healthy, PID 11924 |
| hexalabs-worker | online | Bull queue processor, PID 4954 |
| meshcentral | online | Windows VM remote access, PID 1118 |

### Docker Containers
| Name | Service | Port |
|------|---------|------|
| mongodb | MongoDB 6+ | 127.0.0.1:27017 |
| redis | Redis 7+ | 127.0.0.1:6379 |

### Health Check
```
curl http://localhost:8001/health → {"status":"healthy"}
```

### Node.js Version on Server
```
v22.22.2
```

---

## Session 2: Guacamole Server Setup (2026-05-26)

### 9. Guacamole Server Provisioned
- **Server:** `52.140.63.216` (user: `Hexalabs09`, pass: `<REDACTED_ADMIN_PASS>@#`)
- **Hostname:** `guacamole-hexalabs`
- **OS:** Ubuntu 22.04.5 LTS, 8GB RAM, 2 CPU, 61GB disk
- **Domain:** `remote.hexalabs.online` → `52.140.63.216`

### 10. Docker Installed on Guacamole Server
- Docker 29.5.2, Docker Compose v5.1.4
- User `Hexalabs09` added to docker group

### 11. Guacamole Stack Deployed (Docker Compose)
- **Location:** `/opt/guacamole/docker-compose.yml`
- **Containers:**
  - `guacd` - Guacamole daemon (RDP/SSH proxy), healthy
  - `guacamole` - Guacamole web app on port 8085
  - `guac-db` - MySQL 8.0 database for Guacamole
- **MySQL credentials:** user=`guacamole_user`, pass=`guacamole_pass`, db=`guacamole_db`, root pass=`rootpass`
- **Schema:** Uploaded from `dockerfiles/guacamole/initdb/001-schema.sql`

### 12. Nginx + SSL Configured
- **Nginx** reverse proxy: `remote.hexalabs.online` → `127.0.0.1:8085`
- **SSL** via Let's Encrypt/Certbot, auto-renew enabled
- **Certificate:** `/etc/letsencrypt/live/remote.hexalabs.online/` (expires 2026-08-24)
- **Config:** `/etc/nginx/sites-available/guacamole`
- HTTP → HTTPS redirect enabled (301)

### 13. Guacamole Login Credentials
- **URL:** `https://remote.hexalabs.online/` (serves at root, no `/guacamole/` path)
- **Username:** `guacadmin`
- **Password:** `<REDACTED_ADMIN_PASS>` (updated via MySQL direct DB update)
- **Docker env:** `WEBAPP_CONTEXT=ROOT` set so Guacamole deploys at `/` instead of `/guacamole/`

### 14. Portal .env Updated for Guacamole
- **Local `.env`:** Updated ✅
- **Portal server `.env`:** Updated ✅
  - `GUACAMOLE_URL=https://remote.hexalabs.online`
  - `GUACAMOLE_PUBLIC_URL=https://remote.hexalabs.online`
- Backend restarted and healthy

---

## Guacamole Server Reference

### Connection
```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('52.140.63.216', username='Hexalabs09', password='<REDACTED_ADMIN_PASS>@#', timeout=15)
```

### Docker Commands (need sudo)
```bash
SUDO="echo '<REDACTED_ADMIN_PASS>@#' | sudo -S"
$SUDO docker ps                              # check containers
$SUDO docker compose -f /opt/guacamole/docker-compose.yml logs   # view logs
$SUDO docker compose -f /opt/guacamole/docker-compose.yml restart # restart all
```

### Nginx Commands
```bash
$SUDO nginx -t                   # test config
$SUDO systemctl reload nginx     # reload after config change
$SUDO certbot renew --dry-run    # test SSL renewal
```

---

## Session 3: Guacamole Auto-Scaling (2026-05-26)

### 15. guacd Auto-Scaler Deployed
- **Problem:** User wanted auto-scaling for guacd replicas, not manual docker-compose replica updates
- **Solution:** Bash autoscaler script + systemd timer (runs every 2 minutes)

### Auto-Scaler Architecture
```
systemd timer (every 2 min)
  → /opt/guacamole/guacd-autoscaler.sh
    → Checks: CPU%, Memory%, Active Sessions
    → Scales: docker compose up --scale guacd=N
    → Logs: /var/log/guacd-autoscaler.log
```

### Scaling Logic
| Condition | Action |
|-----------|--------|
| Avg CPU > 60% per replica | Scale UP (+1 replica) |
| Avg Memory > 70% per replica | Scale UP (+1 replica) |
| Active sessions > 40 per replica | Scale UP to match demand |
| Avg CPU < 20% AND replicas > needed | Scale DOWN (-1 replica) |
| Min replicas | 1 |
| Max replicas | 2x CPU cores (4 on current 2-core VM) |
| Cooldown | 3 minutes between scaling events |

### Files Deployed on Guacamole Server (52.140.63.216)
| File | Purpose |
|------|---------|
| `/opt/guacamole/docker-compose.yml` | Updated: removed `container_name: guacd` to allow scaling, removed `version` key |
| `/opt/guacamole/guacd-autoscaler.sh` | Auto-scaler bash script (chmod +x) |
| `/etc/systemd/system/guacd-autoscaler.service` | Systemd oneshot service |
| `/etc/systemd/system/guacd-autoscaler.timer` | Systemd timer (every 2 min) |
| `/etc/logrotate.d/guacd-autoscaler` | Log rotation (daily, 7 days) |
| `/var/log/guacd-autoscaler.log` | Auto-scaler log output |

### Files Saved Locally
| File | Purpose |
|------|---------|
| `dockerfiles/guacamole/docker-compose.autoscale.yml` | Updated compose file (local copy) |
| `dockerfiles/guacamole/guacd-autoscaler.sh` | Auto-scaler script (local copy) |

### Additional Server Changes
- **2GB swap file** created at `/swapfile` (OOM safety net)
- **`bc` utility** installed for math in bash
- **systemd timer** enabled and active

### How Auto-Scaling Works
1. Timer fires every 2 minutes
2. Script counts running guacd containers via `docker ps --filter "ancestor=guacamole/guacd"`
3. Collects avg CPU% and Memory% via `docker stats`
4. Counts active sessions via TCP connections on port 4822
5. Calculates desired replicas based on all metrics
6. If scaling needed and cooldown expired, runs `docker compose up --scale guacd=N --no-recreate`
7. Logs all decisions to `/var/log/guacd-autoscaler.log`

### Auto-Scaler Commands
```bash
# Check timer status
systemctl status guacd-autoscaler.timer

# View scaling log
cat /var/log/guacd-autoscaler.log

# Manual test run
sudo /opt/guacamole/guacd-autoscaler.sh

# Manually scale guacd to 3 replicas
cd /opt/guacamole && docker compose up -d --scale guacd=3 --no-recreate

# Check current replicas
docker ps --filter "ancestor=guacamole/guacd"
```

### Performance Notes (Current VM: 2 vCPU, 8GB RAM)
- **Current capacity:** ~15-25 concurrent RDP sessions with auto-scaling
- **For 100+ users:** Upgrade VM to Standard_D4s_v3 (4 vCPU, 16GB) or Standard_D8s_v3 (8 vCPU, 32GB)
- **Each guacd replica:** Handles ~40 concurrent sessions
- **Guacamole web app:** Single instance, scales to ~200 sessions
- **Network:** RDP uses ~2-5 Mbps per session; 100 users = ~200-500 Mbps bandwidth needed

---

## Session 4: Gmail Update + Full Rebranding (2026-05-26)

### 16. Gmail Credentials Updated
- **Old:** `cloudsynergificsoftware@gmail.com` / `<REDACTED_GMAIL_APP_PASSWORD>`
- **New:** `hexalabscloud@gmail.com` / `<REDACTED_GMAIL_APP_PASSWORD>`
- Updated on both local `.env` and server `.env`
- SMTP verified: connection OK, test email sent successfully

### 17. Full Rebranding: GetLabs → HexaLabs
- **Scope:** 124 files modified, 368 total replacements
- **What changed:**

| Pattern | Replacement | Count |
|---------|------------|-------|
| `GetLabs` | `HexaLabs` | ~80 |
| `getlabs` | `hexalabs` | ~100 |
| `GETLABS` | `HEXALABS` | ~5 |
| `getlabs.cloud` (domain) | `hexalabs.online` | ~25 |
| `getlabs/` (Docker images) | `hexalabs/` | ~35 |

- **Areas rebranded:**
  - Frontend: page title, sidebar, marketing text, support links, API URLs
  - Backend: email subjects `[HexaLabs]`, PDF report headers, AI prompts, CORS origins
  - Worker: email templates, handler branding, MeshCentral device group
  - Docker: all 12 lab image names (`hexalabs/lab-*`)
  - K8s: ingress domains, pod labels, cluster names
  - Scripts: health monitor, deploy, watchdog, alerts
  - Config: `.env` files (local + server), docker-compose
  - Docs: all markdown files updated
  - COBOL samples: company name in payroll report
- **Server:** All JS files + `.env` files updated, backend + worker restarted, health check passed

---

## Pending / Next Steps

### Other Credentials Still Using Old Values (May Need Updating)
- `RAZORPAY_ID` / `RAZORPAY_KEY` - payment processing (currently live keys)
- `AWS_ACCESS_KEY` / `AWS_ACCESS_SECRET` - AWS sandbox management
- `AWS_CONNECT_*` - AWS Connect account (US-based, account 631461173692)
- `OCI_*` - Oracle Cloud sandbox (ap-hyderabad-1 region)
- `GCP_*` / `KEYFILENAME` / `PARENTID` - GCP sandbox (org 628552726767)
- `MESHCENTRAL_*` - MeshCentral remote access (running on same server)
- `CORS_ORIGINS` - may need new domains added
- `CONTAINER_ACCESS_DOMAIN` - server has `portal.hexalabs.online`, local has `localhost`

---

## Key File Locations

### Server (`20.235.11.151`)
- Project: `/opt/hexalabs/`
- Backend .env: `/opt/hexalabs/dockerfiles/backend/.env`
- Backend code: `/opt/hexalabs/dockerfiles/backend/`
- Worker code: `/opt/hexalabs/dockerfiles/worker/`
- Frontend dist: `/opt/hexalabs/portal.synergificsoftware.com/frontend/dist/`
- Backend logs: `pm2 logs hexalabs-backend`
- Worker logs: `pm2 logs hexalabs-worker`
- MongoDB data: Docker volume
- Nginx config: `/etc/nginx/`

### Local
- Project: `d:\hexalabs\project_backup\synergific-portal\`
- Backend .env: `dockerfiles/backend/.env`
- Frontend: `portal.synergificsoftware.com/frontend/`

### GitHub
- Repo: `https://github.com/maheshmhhiremath2025/hexalabs-portal.git`
- Branch: `main`
- Latest commit: `0e32f32`
- Note: `.env` files are gitignored (credentials not in repo)

---

## How to Connect to Server via Paramiko (Python)
```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('20.235.11.151', username='Hexalabs9', password='<REDACTED_ADMIN_PASS>#@', timeout=15)
stdin, stdout, stderr = ssh.exec_command('your-command-here')
print(stdout.read().decode())
ssh.close()
```
Note: Use Python heredoc (`<< 'PYEOF'`) to avoid escaping issues with special characters in passwords.

## How to Query MongoDB on Server
```bash
# From server, via docker exec:
docker exec mongodb mongosh --quiet --eval 'db.users.find({userType:"superadmin"}).toArray()' userdb

# To run node scripts with backend deps (bcrypt, mongoose, etc.):
cd /opt/hexalabs/dockerfiles/backend && node -e "your-script-here"
```

## How to Restart Services
```bash
pm2 restart hexalabs-backend --update-env    # restart backend with env changes
pm2 restart hexalabs-worker --update-env     # restart worker
pm2 restart meshcentral                     # restart MeshCentral
pm2 list                                    # check status
pm2 logs hexalabs-backend --lines 20         # view recent logs
```

## How to Update .env on Server (via Python/Paramiko)
```bash
sed -i 's|^VARIABLE_NAME=.*|VARIABLE_NAME=new-value|' /opt/hexalabs/dockerfiles/backend/.env
```
