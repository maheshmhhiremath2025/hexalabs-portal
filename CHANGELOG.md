# GetLabs Cloud Portal — Complete Development Changelog

**Period:** April 9-10, 2026
**Starting Point:** Existing cloud training portal with Azure VM management, basic billing, and Guacamole integration
**End Result:** Full-stack cloud lab platform with containers, multi-cloud sandboxes, self-service B2C portal, cost optimization, and enterprise features

---

## 1. SECURITY & INFRASTRUCTURE FIXES

### 1.1 Authentication Hardening
- Moved JWT secret from hardcoded string to `JWT_SECRET` environment variable
- Added 24-hour JWT token expiration (was: never expires)
- Added bcrypt password hashing with salt rounds of 10 (was: plaintext passwords)
- Updated login controller to use `comparePassword()` instead of plaintext match
- Updated user creation to use Mongoose pre-save hook for auto-hashing

### 1.2 Backend Architecture
- Made MongoDB connection string configurable via `MONGO_URI` env var (was: hardcoded Docker hostname)
- Added `/health` endpoint returning `{ status, uptime }` with proper HTTP status codes
- Fixed MongoDB connection to be awaited before starting cron jobs (was: fire-and-forget)
- Made CORS origins configurable via `CORS_ORIGINS` env var
- Created `.env.example` for both backend and worker with all required variables

### 1.3 Auto-Logout
- Added 15-minute inactivity auto-logout on the frontend
- Tracks mouse, keyboard, scroll, and touch events
- Shows amber warning banner at 13 minutes: "You'll be logged out in 2 minutes"
- "Stay logged in" button resets the timer

---

## 2. UI/UX REDESIGN

### 2.1 Design System
- Replaced cartoon-style UI with enterprise-grade design
- New font: Inter (professional, widely used in SaaS)
- New color palette: Muted indigo primary, neutral grays, no candy gradients
- Custom CSS utility classes: `.card`, `.btn-primary`, `.btn-secondary`, `.input-field`, `.label`
- Custom scrollbars, anti-aliased text, clean selection highlight

### 2.2 Sidebar
- Dark navy blue theme (`#11192a`) inspired by VMware HOL
- Blue-to-cyan accent stripe at the top
- Collapsible with proper width coordination
- Section labels (Main, Infrastructure, Finance, Administration)
- Differentiated icons per menu item (was: all using FaUsers)
- Role-based nav: selfservice users see simplified "My Labs + Support" only

### 2.3 Navbar
- Shows page title based on current route
- Search bar, notification bell, user badge with email + role

### 2.4 Login Page
- Clean split layout: branding panel + form panel
- No external image dependencies
- "Sign up" link for B2C users

### 2.5 Pages Redesigned
- Home: Clean welcome page with stat cards, quick actions, FAQ accordion
- Lab Console (vmDetails): Compact table with copy-on-hover credentials, inline search, status badges
- Table component: Added column sorting, search with icon
- Chatbot: Subdued styling, smaller floating button
- 404 page: Clean with CTA
- Customer/Lab selector: Compact labeled dropdowns replacing old "sidebar-card" style

---

## 3. COST OPTIMIZATION

### 3.1 Azure Cost Analytics
- **Model:** `LabCost` — stores per-VM cost breakdown (compute, osDisk, dataDisk, networking, snapshots)
- **Service:** Calls Azure Cost Management Query API, categorizes by meter, aggregates per-lab and per-org
- **Cron:** Syncs costs every 6 hours
- **Frontend:** `/costs` page with overview stats, org drill-down, lab drill-down, per-VM breakdown table
- **API Endpoints:** `/admin/costs/overview`, `/admin/costs/summary`, `/admin/costs/lab`, `/admin/costs/sync`

### 3.2 Auto-Shutdown Idle VMs
- New VM model fields: `autoShutdown`, `idleMinutes`, `lastActivityAt`
- Cron runs every 5 minutes: checks Azure Monitor CPU metrics for each VM with `autoShutdown: true`
- If avg CPU < 5% for idle period → deallocates VM → updates DB → sends email notification
- Configurable idle timeout: 15 min, 30 min, 1 hour, 2 hours (set during VM creation)
- Added to CreateVM UI as checkbox + dropdown

### 3.3 Orphan Resource Cleanup
- Scans Azure for: unattached disks, unused public IPs, orphan NICs/NSGs, old snapshots (>30 days)
- Shows monthly waste estimate per resource
- One-click delete button per orphan
- Frontend: `/optimize` page → "Orphan Cleanup" tab

### 3.4 Right-Sizing Recommendations
- Analyzes running VMs: fetches 7-day CPU metrics from Azure Monitor
- If avg CPU < 20% AND peak < 50% → recommends downsize
- Shows: current size → recommended size, monthly savings, confidence level
- Frontend: `/optimize` page → "Right-Sizing" tab

### 3.5 K8s Night Scale-Down
- CronJob manifests for AKS: scale spot node pool to 1 node at 11 PM IST, back to 20 at 7 AM
- Estimated savings: ~₹12,000/month on node costs
- Frontend: `/optimize` page → "Night Scale-Down" tab (info + deploy command)

### 3.6 Live Azure Pricing
- Fetches real VM prices from Azure Retail Prices API (`prices.azure.com`)
- Live USD/INR exchange rate from `open.er-api.com` (cached 6 hours)
- All cost comparisons use real Spot pricing for South India region
- API: `GET /admin/pricing/live` returns all VM size prices in INR

---

## 4. DOCKER CONTAINER LABS

### 4.1 Container System
- **22 container images** across 4 categories:
  - **Desktop:** Ubuntu XFCE/KDE/MATE/Openbox, Alpine, Fedora, Arch, Rocky Linux 9, AlmaLinux 9, Oracle Linux 8, Kasm Ubuntu/Deluxe
  - **Security:** Kali Linux Desktop, Kali XFCE
  - **Applications:** Chrome, Firefox, LibreOffice, Terminal
  - **Development:** VS Code (Kasm), VS Code Server, Jupyter SciPy, Jupyter TensorFlow
- **Model:** `Container` — tracks state, ports, costs, quota, Docker container ID
- **Service:** Dockerode-based creation, start, stop, delete with port allocation
- **KasmVNC passwordless access:** `-disableBasicAuth` flag on all Kasm images
- **LinuxServer Webtop:** HTTP access on port 3000
- **Pre-pull script:** `scripts/prepull-images.sh` for instant deploys in production

### 4.2 Container Deployment
- Real-time progress bar with job polling (backend creates in background, frontend polls every 1.5s)
- Shows: "Creating container-c3 (3/5)..." with progress %, elapsed time, created/failed counts
- Cost comparison banner: shows Azure VM equivalent cost vs container cost with % savings

### 4.3 Container in Lab Console
- Containers appear alongside Azure VMs in Lab Console with blue "CONTAINER" badge
- "Open Desktop" button (not "Launch" — different from Guacamole)
- Start/stop routes split: containers use Docker API directly (instant), VMs use Azure API (poll)
- Individual delete for superadmin

---

## 5. WINDOWS SHARED DESKTOP (RDS)

### 5.1 RDS Service
- Creates Windows Server 2022 VM on Azure (Spot instance)
- PowerShell script auto-runs: enables RDS Session Host, creates N local user accounts, configures multi-session
- Each user gets unique username + random password
- Per-user entries saved to VM model → show up in Lab Console with "Open in Browser"
- Users per VM capped by size: 8 (D4s), 15 (D8s), 30 (D16s)

### 5.2 RDS Frontend
- `/rds` page with cost comparison (shared vs individual VMs)
- VM size selector with max users shown
- User count capped based on selected VM size (frontend + backend validation)
- Allocated hours + auto-shutdown toggle
- Progress bar during deployment
- User credentials table in result

---

## 6. AZURE VIRTUAL DESKTOP (AVD)

### 6.1 AVD Service
- Creates Host Pool (pooled, breadth-first load balancing)
- Creates Desktop App Group + Workspace
- Adds Session Host VMs (Spot, Windows 11 Multi-Session or Win10/Office 365)
- Generates registration token for AVD agent installation
- User assignment via app group permissions

### 6.2 AVD Frontend
- `/avd` page with cost comparison
- Windows image selection (Win11, Win11+Office, Win10)
- Progress bar during deployment (job-based polling)
- How-it-works explainer section

---

## 7. BROWSER-BASED VM ACCESS

### 7.1 Self-Hosted Guacamole
- Docker Compose: guacd + guacamole webapp + MySQL
- Integrated into main `docker-compose.yml` for production
- Scalable: `GUACD_REPLICAS` env var (1 replica = ~50-80 concurrent RDP sessions)

### 7.2 Guacamole Performance Tuning
- RDP: 16-bit color, disabled wallpaper/composition/font-smoothing/theming/menu-animations
- Audio disabled, bitmap caching enabled
- Connection reuse (checks for existing connections before creating new ones)
- Passwordless access via `?token=` parameter in URL

### 7.3 KasmVNC for Linux VMs
- Install script: `vm-templates/install-kasmvnc.sh`
- KasmVNC config: 30fps, WebSocket-native, GPU-accelerated encoding
- New VM model field: `kasmVnc: true`
- Frontend auto-detects KasmVNC VMs and uses VNC protocol instead of SSH

### 7.4 Universal "Open in Browser"
- All VMs now show "Open in Browser" button (not just Guacamole-enabled)
- Windows → RDP via Guacamole (tuned settings)
- Linux (standard) → SSH via Guacamole
- Linux (KasmVNC) → Direct VNC (fastest)
- Containers → Direct noVNC/KasmVNC (no Guacamole)

---

## 8. CLOUD SANDBOXES

### 8.1 Azure Sandbox Improvements
- Configurable TTL per user (was: hardcoded 4 hours)
- VM size restriction: Azure Policy `Allowed VM SKUs` → B-series only
- Storage restriction: Standard only (no Premium SSD)
- Hard budget cap via Azure Budget API (alerts at 80%, 100%)
- Resource group tags for cost tracking
- Expiry warning email 30 minutes before deletion
- Concurrent sandbox limit per user
- Direct synchronous creation for self-service (no worker queue needed)
- Azure AD user creation via Microsoft Graph API with real credentials

### 8.2 AWS Sandbox Improvements
- Inline IAM policy restricting to t2/t3 only, denying GPUs, expensive services, large volumes
- Real IAM user creation with password (shown in dashboard)
- Account ID displayed in dashboard
- Comprehensive resource cleanup on expiry: EC2 instances, EBS volumes, Elastic IPs, security groups, key pairs
- TTL-based auto-deletion (was: only subscription expiry)

### 8.3 GCP Sandbox (NEW)
- Full feature parity with Azure sandboxes
- Model: `GcpSandboxUser` with project-based sandboxes
- Org Policy VM restrictions (e2/f1/g1 only)
- Budget API integration
- Auto-cleanup with warning emails
- Frontend pages for both sandbox users and superadmin management

### 8.4 Sandbox Cost Restrictions Summary
| Cloud | VM Restriction | Budget | Blocked Services |
|-------|---------------|--------|-----------------|
| Azure | B-series only | Azure Budget API | GPU, Premium SSD, AKS, Cosmos DB |
| AWS | t2/t3 only | IAM policy deny | GPU, Redshift, SageMaker, EKS |
| GCP | e2/f1 only | GCP Budget API | GPU, GKE, BigTable, Spanner |

---

## 9. SELF-SERVICE B2C PORTAL

### 9.1 Plan System
- 4 plans: Free Trial (₹0), Starter (₹499), Pro (₹1,499), Enterprise (₹3,999)
- Each plan includes: container hours, sandbox credits (per cloud), VM hours, guided labs
- Plan model with: tier, badges, highlights, allowed images, resource limits

### 9.2 Signup Flow
- Public signup page at `/signup` (no auth required, sidebar hidden)
- Plan selection with 4-column grid showing features, sandbox credits, container hours
- Free Trial: instant activation (no Razorpay)
- Paid plans: Razorpay checkout → auto-login on success
- `selfservice` user type with simplified sidebar

### 9.3 Self-Service Dashboard
- **Subscription card:** Container hours (used/total with progress bar), sandbox credits per cloud, VM hours, days remaining
- **Upgrade prompt:** Blue banner when credits are low with "Upgrade Plan" button
- **Three tabs:**
  - **Containers:** Deploy container, manage instances (start/stop/delete/open), deploy progress
  - **Cloud Sandboxes:** Create Azure/AWS/GCP sandbox, active sandboxes with full details
  - **Guided Labs:** Step-by-step hands-on labs with progress tracking

### 9.4 Sandbox Access Details
Each active sandbox shows:
- Login URL, Account ID (AWS), Resource Group (Azure), Project ID (GCP)
- Region
- Username + Password (with show/hide toggle + copy buttons)
- Budget alert amount (with billing delay disclaimer)
- TTL countdown
- ✅ Allowed Resources: VMs, Storage, Services (detailed per cloud)
- 🚫 Blocked Resources: VMs, Storage, Services (detailed per cloud)

---

## 10. GUIDED LABS

### 10.1 Lab System
- Model: `GuidedLab` with steps, difficulty, cloud, category, sandbox config
- 8 labs seeded across all clouds:
  1. Deploy Your First Azure VM (Azure, Beginner, 30 min)
  2. Create an S3 Bucket in AWS (AWS, Beginner, 20 min)
  3. Launch a GCP Compute Instance (GCP, Beginner, 25 min)
  4. Linux Desktop in Browser (Container, Beginner, 5 min)
  5. Kali Linux Security Lab (Container, Intermediate, 45 min)
  6. Azure Networking: VNet and Subnets (Azure, Intermediate, 40 min)
  7. VS Code in the Cloud (Container, Beginner, 10 min)
  8. AWS IAM: Users and Policies (AWS, Intermediate, 35 min)

### 10.2 Lab Detail Page
- Header with icon, title, difficulty badge, cloud badge, estimated time
- Progress bar tracking completed steps (persisted in localStorage)
- "Start Sandbox" button auto-provisions the right environment
- Step-by-step checklist with clickable completion circles
- Hints for tricky steps
- Completion celebration (🎉) when all steps done

---

## 11. ANALYTICS & MONITORING

### 11.1 Usage Analytics
- **Overview:** Total VMs/containers, runtime hours, revenue, container savings
- **Customers:** Per-org breakdown with VMs, containers, running count, revenue, idle risk
- **Idle Risk:** VMs running without auto-shutdown + potential waste (₹/hr, ₹/day, ₹/month)
- Frontend: `/analytics` page with 3 tabs

### 11.2 Email Notifications
- VM/Container ready: Access details + "Open Desktop" button
- Quota at 80%: Usage bar + "contact admin"
- Quota at 95%: Critical warning
- Auto-shutdown: "Your VM was stopped (idle)"
- Sandbox expiry warning: 30 minutes before deletion (all 3 clouds)

---

## 12. PURGE/DELETION

### 12.1 Training Purge (End Batch)
- Handles ALL resource types: Azure VMs, Docker containers, RDS servers/sessions, AVD host pools
- Progress UI: spinner → result cards showing what was cleaned up
- Preview before delete: counts resources by type
- Dynamic impact list (only shows resource types that exist)

### 12.2 Individual Instance Delete
- Superadmin can delete individual VMs/containers from Lab Console
- Containers: Docker API (instant)
- Azure VMs: Queued for Azure resource cleanup (VM + disk + NIC + IP + NSG)
- Confirmation dialog with instance name

### 12.3 Sandbox Auto-Cleanup
| Cloud | What's Deleted | When |
|-------|---------------|------|
| Azure | Resource group + everything inside | TTL expiry (cron every 1 min) |
| AWS | EC2 instances + EBS volumes + EIPs + SGs + key pairs + IAM user | TTL expiry (cron every 1 min) |
| GCP | Entire project + everything inside | TTL expiry (cron every 1 min) |

---

## 13. KUBERNETES (AKS) READY

### 13.1 K8s Manifests
- `namespace.yaml`: lab-containers namespace
- `lab-pod-template.yaml`: Pod + Service template per lab desktop
- `ingress.yaml`: Nginx Ingress with WebSocket support for noVNC
- `spot-nodepool.yaml`: AKS Spot node pool commands + cost breakdown
- `night-scaler.yaml`: CronJob for night scale-down (11 PM - 7 AM IST)

### 13.2 K8s Provisioning Service
- Creates Pod + Service + Ingress rule per lab
- Each user gets `https://lab-{name}.labs.getlabs.cloud`
- Pods schedule on Spot nodes (60-80% cheaper)
- Auto-scales 1-20 nodes via AKS cluster autoscaler

---

## 14. FILES CREATED/MODIFIED

### New Backend Files (42)
- `models/`: azureCost.js, container.js, plan.js, subscription.js, gcpSandboxUser.js, guidedLab.js
- `services/`: azureCostService.js, containerService.js, k8sContainerService.js, guacamoleService.js, avdService.js, rdsService.js, directSandbox.js, awsResourceCleanup.js, emailNotifications.js, exchangeRate.js, azurePricing.js, orphanCleanup.js, rightSizing.js
- `controllers/`: costAnalytics.js, containers.js, costOptimization.js, analytics.js, avd.js, rds.js, selfservice.js, gcpSandbox.js
- `routes/`: containers.js, avd.js, rds.js, selfservice.js, gcpSandbox.js
- `automations/`: idleShutdown.js, gcpSandbox.js (updated awsSandbox.js, azureSandbox.js)
- `scripts/`: prepull-images.sh, seed-guided-labs.js
- `k8s/`: namespace.yaml, lab-pod-template.yaml, ingress.yaml, spot-nodepool.yaml, night-scaler.yaml
- `guacamole/`: docker-compose.yml, initdb/001-schema.sql
- `vm-templates/`: install-kasmvnc.sh
- `worker/functions/sandbox-policies/`: aws-sandbox-policy.json, gcp-restrictions.js

### New Frontend Files (12)
- `pages/`: CostAnalytics.jsx, CostOptimization.jsx, DeployContainer.jsx, DeployAVD.jsx, DeployRDS.jsx, Analytics.jsx, Signup.jsx, SelfServiceDashboard.jsx, GuidedLabDetail.jsx, NotFound.jsx
- `pages/sandbox/`: GcpSandbox.jsx, GcpUsers.jsx

### Modified Files (30+)
- Backend: index.js, models/vm.js, models/user.js, models/sandboxuser.js, models/aws.js, controllers/admin.js, controllers/user.js, controllers/users/azure.js, controllers/users/azureVmCreate.js, controllers/killTraining.js, controllers/sandbox.js, routes/admin.js, routes/azure.js, routes/sandbox.js, services/auth.js, plugins/logger.js, docker-compose.yml, .env
- Worker: handlers/azure-create-vm.js, handlers/azure-create-sandbox.js, handlers/aws-create-user.js, handlers/gcp-create-project.js
- Frontend: App.jsx, App.css, index.css, index.html, Sidebar.jsx, Navbar.jsx, Selector.jsx, vmDetails.jsx, CreateVM.jsx, Login.jsx, Table.jsx, Chatbot.jsx, DeleteTraining.jsx, Home.jsx, apiRoutes.jsx, apiCaller.jsx

---

## 15. NPM PACKAGES ADDED

### Backend
@azure/arm-costmanagement, @azure/arm-monitor, @azure/arm-compute, @azure/arm-network, @azure/arm-resources, @azure/arm-authorization, @azure/arm-desktopvirtualization, @azure/arm-consumption, @azure/identity, @kubernetes/client-node, @microsoft/microsoft-graph-client, @aws-sdk/client-iam, @aws-sdk/client-sts, @aws-sdk/client-ec2, isomorphic-fetch, dockerode, bcrypt, googleapis

### Worker
@azure/arm-consumption, dockerode

---

## 16. ENVIRONMENT VARIABLES ADDED

```
JWT_SECRET, MONGO_URI, CORS_ORIGINS, REDIS_HOST
GUACAMOLE_URL, GUACAMOLE_PUBLIC_URL, GUACAMOLE_ADMIN_USER/PASS
GUACD_REPLICAS, GUACAMOLE_REPLICAS
CONTAINER_HOST_IP, DOCKER_SOCKET, CONTAINER_PORT_START/END
K8S_IN_CLUSTER, K8S_NAMESPACE, LABS_DOMAIN
IDENTITY_CLIENT_ID/SECRET/TENANT_ID/DOMAIN
AWS_ACCESS_KEY/SECRET, AWS_REGION
RDS_RESOURCE_GROUP, RDS_LOCATION
```

---

*Generated: April 10, 2026*
*Total development time: ~12 hours across 2 sessions*
