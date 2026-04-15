# GetLabs Cloud Portal — What's New 🚀

**Release: April 2026 Major Update**

Dear Valued Customer,

We're excited to announce a major upgrade to the GetLabs Cloud Portal. This release brings significant new features, cost savings, and a completely refreshed experience. Here's everything that's new:

---

## 🎨 Fresh New Look

We've completely redesigned the portal with a modern, enterprise-grade interface.

- **New dark sidebar** with better navigation organization — find what you need faster
- **Cleaner Lab Console** with compact tables, copy-on-hover credentials, and inline search
- **Responsive design** that works great on all screen sizes
- The overall experience is faster, cleaner, and more intuitive

---

## 🐳 Docker Container Labs — Up to 85% Cost Savings

**This is our biggest new feature.** Instead of spinning up expensive Azure VMs for every lab session, you can now deploy lightweight Docker containers that launch in seconds.

### What's Available
- **22 pre-built environments** ready to deploy:
  - **Linux Desktops:** Ubuntu (XFCE, KDE, MATE), Alpine, Fedora, Arch, Rocky Linux 9, AlmaLinux 9
  - **Security Labs:** Kali Linux with pre-installed pentesting tools
  - **Development:** VS Code in browser, Jupyter Notebooks (Python/TensorFlow)
  - **Applications:** Chrome, Firefox, LibreOffice — all in the browser
- **Browser-based access** — no VPN, no RDP client, no software to install. Just click "Open Desktop"
- **Instant deployment** — cached images launch in 2-3 seconds
- **Real-time progress** — see exactly what's happening during deployment

### Why This Matters for You
| | Azure VM | Docker Container |
|---|---|---|
| Deploy time | 3-5 minutes | 2-3 seconds |
| Cost per hour | ₹5-25 | ₹0.50-1 |
| Monthly (20 users, 8hr/day) | ₹15,000+ | ₹1,800 |

---

## 🪟 Windows Shared Desktop (RDS)

Need Windows desktops for training? Instead of one VM per user (expensive), you can now deploy **one Windows Server** that hosts **multiple users simultaneously**.

- Each user gets their own isolated Windows desktop session
- 8-30 users per server depending on the size you choose
- Users access via browser — click "Open in Browser" in the Lab Console
- Credentials are auto-generated and visible in the portal
- **Up to 60% cheaper** than individual Windows VMs

---

## 🌐 Browser Access for All VMs

Previously, only Guacamole-enabled VMs could be accessed through the browser. Now **every VM** has an "Open in Browser" button.

- **Windows VMs:** Full Windows desktop via optimized RDP — we've tuned the settings for significantly faster performance (reduced bandwidth by 50%+)
- **Linux VMs:** Terminal access via SSH, or full desktop if KasmVNC is installed
- **Containers:** Direct browser access, passwordless — just click and go
- No more slow, laggy remote sessions — we've optimized color depth, disabled unnecessary visual effects, and enabled caching

---

## ☁️ Multi-Cloud Sandboxes — Azure + AWS + GCP

### Azure Sandbox Improvements
- **Configurable session duration** — 1 hour, 2 hours, 4 hours, up to 8 hours depending on your plan
- **Budget alerts** — we set spending alerts on each sandbox so there are no surprise charges
- **VM size restrictions** — only cost-effective B-series VMs are allowed (no accidental GPU or premium instance launches)
- **30-minute expiry warning** — you'll receive an email before your sandbox is cleaned up
- **Complete resource cleanup** — when a sandbox expires, the entire resource group and everything inside it is automatically deleted

### AWS Sandbox Improvements
- **Real IAM credentials** — username and password visible directly in the portal (no waiting for emails)
- **Account ID displayed** — no more guessing which account to sign into
- **Restricted to small instances** — t2/t3 series only, preventing expensive resource creation
- **Comprehensive cleanup** — when sandbox expires, all resources are deleted: EC2 instances, EBS volumes, Elastic IPs, security groups, key pairs, and the IAM user itself

### GCP Sandbox (NEW!)
- **Brand new offering** — create your own GCP project sandbox
- Same features as Azure: configurable TTL, budget alerts, VM restrictions
- Only e2/f1 machine types allowed (cost-effective)
- Automatic project deletion on expiry — all resources cleaned up
- Access via Google Cloud Console in your browser

---

## 💰 Cost Analytics & Optimization

### For Administrators
- **Azure Cost Analytics** (`/costs`) — See real Azure spending mapped to each lab and customer. Per-VM cost breakdown: compute, disk, networking, snapshots
- **Usage Analytics** (`/analytics`) — Which customers use the most hours, idle VM detection, revenue breakdown
- **Cost Optimization** (`/optimize`) — Three tools:
  - **Orphan Cleanup:** Find and delete leaked Azure resources (unused disks, public IPs, old snapshots) that are costing money
  - **Right-Sizing:** Identify VMs that are over-provisioned based on actual CPU usage, with downsize recommendations
  - **Night Scale-Down:** Reduce infrastructure during off-hours for additional savings

### Live Pricing
- All cost comparisons now use **real Azure pricing** from the official API, converted with **live USD/INR exchange rates**
- No more outdated or estimated numbers — what you see is what you pay

---

## ⏱️ Auto-Shutdown for Idle VMs

VMs that sit idle waste money. Now you can enable **auto-shutdown** when creating VMs:

- Choose idle timeout: 15 minutes, 30 minutes, 1 hour, or 2 hours
- System monitors CPU usage via Azure Monitor every 5 minutes
- If CPU is below 5% for the idle period → VM is automatically deallocated (stops billing)
- Email notification sent when auto-shutdown occurs
- Perfect for training labs where users forget to stop their VMs

You can also leave auto-shutdown disabled for customers who need 24/7 VMs.

---

## 🎓 Guided Labs (NEW!)

We've added **step-by-step hands-on labs** that guide users through real cloud tasks:

| Lab | Cloud | Difficulty | Duration |
|-----|-------|-----------|----------|
| Deploy Your First Azure VM | Azure | Beginner | 30 min |
| Create an S3 Bucket | AWS | Beginner | 20 min |
| Launch a GCP Compute Instance | GCP | Beginner | 25 min |
| Linux Desktop in Browser | Container | Beginner | 5 min |
| Kali Linux Security Lab | Container | Intermediate | 45 min |
| Azure Networking: VNet & Subnets | Azure | Intermediate | 40 min |
| VS Code in the Cloud | Container | Beginner | 10 min |
| AWS IAM: Users & Policies | AWS | Intermediate | 35 min |

Each lab includes:
- One-click sandbox/container provisioning
- Step-by-step instructions with hints
- Progress tracking (saved across sessions)
- Completion celebration

---

## 🛒 Self-Service Portal (B2C)

Your end-users can now **sign up and start using labs on their own** — no admin setup required.

### Plans Available
| | Free Trial | Starter | Pro | Enterprise |
|---|---|---|---|---|
| **Price** | ₹0 | ₹499/mo | ₹1,499/mo | ₹3,999/mo |
| **Containers** | 5 hrs | 30 hrs | 100 hrs | 500 hrs |
| **Azure Sandboxes** | 1 | 5/mo | 20/mo | 100/mo |
| **AWS Sandboxes** | 1 | 5/mo | 20/mo | 100/mo |
| **GCP Sandboxes** | 1 | 3/mo | 15/mo | 50/mo |
| **Guided Labs** | 3 | 10 | Unlimited | Unlimited |
| **Dedicated VMs** | — | — | 10 hrs | 50 hrs |

### Self-Service Dashboard Features
- **Subscription overview** with real-time usage tracking
- **One-click container deployment** — choose from 22 environments
- **Cloud sandbox creation** with full access details, credentials, and allowed/blocked resource lists shown directly in the dashboard
- **Guided labs** with progress tracking
- **Upgrade prompt** when credits are running low
- **Razorpay payment integration** for Indian payments

---

## 🔒 Security Improvements

- **Passwords are now hashed** using industry-standard bcrypt (previously stored in plaintext)
- **JWT tokens expire after 24 hours** (previously never expired)
- **Auto-logout after 15 minutes of inactivity** with a 2-minute warning
- **Sandbox cost restrictions** prevent users from creating expensive resources

---

## 🗑️ Improved Cleanup & Deletion

### Training Purge (End Batch)
When you end a training batch, the system now cleans up **everything**:
- Azure VMs and all associated resources
- Docker containers
- RDS servers and all user sessions
- AVD host pools
- Guacamole connections and port rules

The purge now shows you exactly what will be deleted before you confirm, and displays a detailed result of what was cleaned up.

### Individual Instance Delete
Super admins can now delete individual VMs or containers directly from the Lab Console without purging the entire training.

---

## 📧 Email Notifications

You'll now receive email notifications for important events:
- ✅ VM or container is ready — with access details and "Open Desktop" link
- ⚠️ Quota reaching 80% — with usage bar
- 🔴 Quota reaching 95% — critical warning
- 🛑 VM auto-stopped due to idle — with reason
- ⏰ Sandbox expiring in 30 minutes — save your work reminder

---

## 📊 What This Means for Your Bottom Line

Here's a real example — 20 users doing a 5-day training:

| Method | Your Cost | What You Charge | Profit |
|---|---|---|---|
| Individual Azure VMs | ₹15,000 | ₹50,000 | ₹35,000 |
| Docker Containers | ₹1,800 | ₹50,000 | **₹48,200** |
| Windows Shared (RDS) | ₹6,400 | ₹50,000 | **₹43,600** |

Container labs give you **96% margins** on Linux workloads. RDS gives you **87% margins** on Windows workloads.

---

## 🔜 Coming Soon

- More guided labs covering advanced topics
- Team management for enterprise plans
- Custom container image support
- Multi-region deployment options
- API access for programmatic lab provisioning

---

## Getting Started

All these features are available now in your portal. Here's how to try them:

1. **Container Labs:** Go to Infrastructure → Containers → Deploy
2. **Cloud Sandboxes:** Go to Sandboxes section in the sidebar
3. **Cost Analytics:** Go to Finance → Cost Analytics (superadmin only)
4. **Self-Service Portal:** Visit `/signup` to see the B2C experience
5. **Guided Labs:** Available in the self-service portal under "Guided Labs" tab

If you have any questions or need help with the new features, don't hesitate to reach out to our support team.

Thank you for choosing GetLabs Cloud!

Best regards,
**The GetLabs Team**
*portal.synergificsoftware.com*

---

*This release includes over 40 new backend services, 12 new frontend pages, and modifications to 30+ existing files. Total development scope: 16 major feature areas.*
