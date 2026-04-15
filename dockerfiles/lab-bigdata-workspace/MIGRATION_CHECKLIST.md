# VM-to-Container Migration Checklist

When a customer hands you a course that was originally written for VMs and
you want to deliver it as a container lab instead, walk through this list
**before** you commit to the deal. Most courses migrate cleanly. The ones
that don't tend to fail in predictable ways — and this list catches them.

## Step 1: Read the customer's spec sheet

Look for these phrases in the PDF/email:

| Phrase | Containerize? | Notes |
|---|---|---|
| "VM with X GB RAM, Y vCPU" | ✓ Yes | This is the obvious case. Resource numbers are the customer pricing for peak load — your container budget can be 30-50% lower. |
| "Ubuntu 22.04 / RHEL 8 / CentOS" | ✓ Yes | Pick the right base image. Ubuntu 22.04 is default; RHEL family use `kasmweb/rockylinux-9-desktop` or `kasmweb/almalinux-9-desktop`. |
| "Pre-installed: Java, Python, Kafka, Spark…" | ✓ Yes | Exactly what the bigdata-workspace image is for. |
| "SSH access enabled" | ✓ Yes (with caveat) | Set `ENABLE_SSH=true` and expose port 22, OR sell them on the browser terminal at port 7681 (no SSH keys to manage). |
| "Network connectivity between VMs" | ✓ Yes | If they mean inter-student networking, use the multi-container compose mode. If they mean intra-stack (Kafka talks to Spark), single container handles it. Ask. |
| "Public IP per student" | ⚠ Maybe | Containers can get host port mappings (10000-11000 range in your existing system). One IP per student means port allocation, not VM allocation. |
| "Sudo access required" | ✓ Yes | The bigdata-workspace `lab` user has NOPASSWD sudo. |
| "GPU required" | ✗ No | Use VMs. GPU container support exists but the cost economics don't favor containerization for GPU workloads. |
| "Bare-metal / kernel access" | ✗ No | Use VMs. Containers share the host kernel — you can't install kernel modules. |
| "Nested virtualization (VMs inside the lab)" | ⚠ Maybe | Use a privileged container with `sysbox-runc`, OR fall back to VMs. |
| "Custom kernel parameters / sysctl tuning" | ⚠ Maybe | Most sysctls can be set per-container with `--sysctl`. Some (like `kernel.*`) are host-wide. Check first. |
| "Mac OS / Windows desktop" | ✗ No | Containers can't run other OS kernels. macOS = MacStadium / EC2 Mac. Windows = your existing RDS Windows shared. |
| "Static IP for licensing" | ⚠ Maybe | Container IPs are ephemeral but you can pin them. If the license server checks the host IP, container IP won't match. |

## Step 2: Audit the software list

For each piece of software the customer wants pre-installed, check:

### ✅ Easy — already in the image or trivially `apt install`-able

JDK 8/11/17/21 · Python 2/3 · Node.js · Go · Rust · Ruby · Maven · Gradle ·
Git · Docker CLI · Kubernetes CLI (kubectl, helm, k9s) · MySQL/MariaDB ·
PostgreSQL · Redis · Kafka · Spark · Hadoop · Hive · HBase · Cassandra ·
Elasticsearch · Logstash · Kibana · Nginx · Apache · PHP · Tomcat · Jenkins ·
Ansible · Terraform · vim · emacs · tmux · most CLI tools

### ⚠ Possible but adds image weight

Oracle Database (use `gvenzl/oracle-xe`) ·
SQL Server (use `mcr.microsoft.com/mssql/server`) ·
SAP HANA Express ·
WebLogic, WebSphere ·
IBM MQ ·
Anything that ships as RPM-only on RHEL (find a tarball or use a RHEL base)

### ❌ Hard / not worth containerizing

Anything that ships only as a Windows installer (use RDS shared) ·
Hardware-bound license keys (HASP, Sentinel) ·
Software that requires GUI installation wizards with no headless mode ·
Software that depends on systemd services (containers run with PID 1 = your
process; use s6-overlay or supervisord as we do for bigdata-workspace, but
some software hard-codes systemctl calls and breaks)

## Step 3: Networking review

Single container per student:
- Intra-container networking (Kafka talks to Spark on localhost): just works.
- Cross-student networking: containers are on the host's bridge — they CAN see each other unless you put them on isolated networks. Use `docker network create` per student to isolate.
- Outbound to public internet: works by default.
- Inbound from internet: only the ports you explicitly publish with `-p`.

Multi-container compose stack per student:
- Each compose project gets its own bridge network (Docker auto-creates).
- Service discovery by service name within the project.
- Cross-project isolation is total.

Ask the customer:
- "Will students need to talk to each other's environments?" (rare for training)
- "Does the lab need outbound internet?" (usually yes — for git pulls, package installs)
- "Does anything need to be reachable from the public internet?" (rare — keep it on private ports if possible)

## Step 4: Persistence review

What state does the lab need to keep across container restarts?

- **Code**: students mount `/home/lab/work` as a volume. Persists.
- **Database tables**: MySQL data dir is `/var/lib/mysql`. Mount as a volume.
- **Kafka topic data**: `/tmp/kraft-combined-logs` (or wherever KAFKA_LOG_DIRS points). Mount.
- **Spark events**: `/home/lab/.spark-events`. Persists with `/home/lab` volume.

For training labs that are explicitly "fresh start every day," skip volumes
entirely — let the container be ephemeral. Cleaner state, no data leakage
between batches.

## Step 5: Resource budget sanity check

Take the customer's requested VM spec and divide by 2-3 for the container
budget. The customer's VM number is sized for peak load on a dedicated host.
Containers share a host, so peak load happens at different moments for
different students.

Customer says: 4 vCPU, 16 GB → Container budget: 2 vCPU, 6-8 GB
Customer says: 8 vCPU, 32 GB → Container budget: 3-4 vCPU, 12 GB

If your container budget exceeds 8 GB or 4 vCPU per student, you're either:
- Hitting a heavy service (Cassandra, Elasticsearch, Spark with big datasets) — fine, document it
- Migrating something that should stay on a VM — reconsider

## Step 6: Customer demo before committing

Before you sign the contract:

1. Build the image on a dev host
2. Run `docker run --rm -it getlabs/lab-bigdata-workspace:latest bash` and walk through the customer's first lab manually
3. Time how long the first hands-on exercise takes from "container start" to "first command run" — should be under 30 seconds
4. Run the heaviest exercise from the course — does it complete in the per-seat resource budget?
5. Send a screen recording to the customer with the line: "This is what your students will experience. Want to proceed?"

Customers who say no at this stage save you from a refund later.

## Step 7: After-deployment checks

Once the batch is running:

1. Watch `docker stats` for the first 30 minutes — any container approaching 95% memory? Bump the limit.
2. Check `df -h` on the host — image cache + container layers shouldn't exceed 60% of disk.
3. Verify Kafka/Spark UIs are reachable from each student's browser terminal (curl localhost:8080 from inside the container).
4. Send the host sizing report to your billing team so they know the actual hardware cost for this batch.

## Common failure modes and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Student says "Kafka won't start" | KAFKA_HEAP_OPTS too small for default config | Bump to `-Xmx768m -Xms512m` |
| `docker exec` hangs | Host CPU saturated, wait for current jobs to finish | Reduce per-seat vCPU limit OR move some students to a second host |
| `Connection refused` between Kafka and Spark | Both bound to localhost; in multi-container compose they need to bind to 0.0.0.0 | Set `KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092` |
| MySQL "Too many connections" | Default `max_connections=151` exceeded | Set `--max_connections=500` in mysqld args |
| Cassandra OOM kill | 1 GB heap is the floor; below that it crashes | Don't run Cassandra with less than 1.5 GB container memory |
| Container won't restart after crash | Supervisord is dead; orphaned PID file | `docker rm -f <container>` and recreate |
| Browser terminal disconnects every few minutes | Reverse proxy timeout | Increase `proxy_read_timeout` to 1 hour in nginx |
| Students can see each other's containers | Default bridge network exposes peer containers | Use `docker network create --internal` per student |

## When to walk away from a containerization deal

Refund the customer instead if:

- The course explicitly teaches concepts that need a real VM (kernel modules, hardware drivers, BIOS interaction)
- The licensing terms of any software in the stack forbid container deployment (rare but real — check IBM, Oracle commercial products)
- The customer wants to RDP into a Windows desktop (use your existing RDS shared Windows path)
- You can't build the image in under an hour and the customer wants delivery this week
- The customer's per-seat budget is < ₹100 — at that price you're probably better off pointing them at a free Killercoda / Play with Docker setup
