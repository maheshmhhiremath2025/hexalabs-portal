# Host Sizing Guide — Container Lab Hosting

A practical guide for picking the right Azure VM (or any cloud host) to run
a container-based GetLabs training batch. Covers memory math, vCPU
allocation, the ratio of host capacity to student count, and the cost
difference vs the equivalent per-student VM approach.

## TL;DR — quick lookup

| Course profile | Per-seat budget | Students per host (256 GB / 64 vCPU) |
|---|---|---|
| Light dev (VS Code + Node + Python) | 1 vCPU, 2 GB | 80–100 |
| Generic Linux + tools | 1 vCPU, 2 GB | 80–100 |
| Web stack (MEAN, MERN, LAMP) | 1 vCPU, 3 GB | 60–80 |
| ELK (Elastic + Logstash + Kibana) | 2 vCPU, 6 GB | 30–35 |
| Kafka + Spark + MySQL | 2 vCPU, 6 GB | 30–35 |
| Kafka + Spark + MySQL + Cassandra | 2 vCPU, 8 GB | 25–28 |
| K8s admin (kind/k3s in container) | 2 vCPU, 4 GB | 50–60 |
| Hadoop ecosystem (HDFS+YARN+Hive) | 3 vCPU, 8 GB | 25–28 |
| Data science / ML training | 2 vCPU, 6 GB | 30–35 |

These assume Docker on bare-metal Ubuntu with no other workload. Add ~10%
overhead for the host OS and container runtime.

## Sizing math

The formulas are simple:

```
host_vcpu       >= seats * per_seat_vcpu * 1.15        # 15% headroom
host_ram_gb     >= seats * per_seat_ram_gb * 1.20      # 20% headroom (overcommit-aware)
host_disk_gb    >= seats * per_seat_disk_gb + 50       # +50 GB for image cache
```

The 20% RAM headroom accounts for:
- Docker daemon + dockerd overhead (~500 MB)
- Host OS kernel + sshd + monitoring (~1 GB)
- Buffer/cache the kernel keeps free for hot paths

vCPU headroom can be smaller (15%) because Docker actually allows CPU
overcommit: containers share CPU time, idle students give CPU back to busy
students. RAM is reserved per container, so you cannot oversubscribe it
without swapping.

## Recommended Azure VM SKUs

For South India / Mumbai region, in increasing order of student density:

| SKU | vCPU | RAM | Disk | ~₹/hr (Spot) | Best for |
|---|---|---|---|---|---|
| Standard_D8s_v5 | 8 | 32 GB | Premium SSD | ₹15-20 | 5–8 students Kafka/Spark |
| Standard_D16s_v5 | 16 | 64 GB | Premium SSD | ₹30-40 | 10–12 students Kafka/Spark |
| Standard_D32s_v5 | 32 | 128 GB | Premium SSD | ₹60-80 | 20–25 students Kafka/Spark |
| Standard_E16s_v5 | 16 | 128 GB | Premium SSD | ₹50-65 | RAM-heavy: 20 students with Cassandra |
| Standard_D64s_v5 | 64 | 256 GB | Premium SSD | ₹120-160 | 40 students Kafka/Spark, or 30 with Cassandra |
| Standard_E64s_v5 | 64 | 512 GB | Premium SSD | ₹200-260 | 60+ students full stack |

Spot pricing in South India runs ~20% of on-demand. Use Spot for non-critical
training; the 1-2% eviction rate is acceptable for short courses.

**Always use Premium SSD or higher for big-data labs.** Kafka and Spark are
I/O bound — basic SSDs will halve student throughput.

## Concrete worked examples

### Example 1 — 25-student Kafka/Spark/MySQL bootcamp, 3 days

```
per_seat:        2 vCPU, 6 GB RAM, 20 GB disk
host_vcpu:       25 * 2 * 1.15 = 57.5  → round up to 64 vCPU
host_ram_gb:     25 * 6 * 1.20 = 180   → round up to 256 GB
host_disk_gb:    25 * 20 + 50  = 550   → 1 TB Premium SSD

→ Pick: Standard_D64s_v5 + 1 TB Premium SSD
→ Cost (3 days, Spot): 3 days × 24h × ₹140/h = ₹10,080
→ Cost (3 days, on-demand): 3 days × 24h × ₹650/h = ₹46,800
→ Per-seat cost on Spot: ₹403
→ Per-seat cost on demand: ₹1,872
```

For comparison, the same course as 25 individual `Standard_D4s_v3` Spot VMs
(4 vCPU, 16 GB each) would cost:

```
25 VMs × 3 days × 24h × ₹6/h ≈ ₹10,800
```

Spot vs Spot, the per-host price is similar — but the per-host approach has:
- 25× cold-boot delays (~90s each)
- 25× JVM tax (each VM runs its own kernel + Java + everything)
- No central monitoring / unified logs
- More IP addresses, more SSH keys, more attack surface

The container approach delivers the same workload **3-5× faster perceived
performance** at the **same hardware cost**, plus saves ~40% on operational
overhead (one host to monitor, one image to maintain).

### Example 2 — 50-student MEAN stack workshop, 1 day

```
per_seat:        1 vCPU, 2 GB RAM, 10 GB disk
host_vcpu:       50 * 1 * 1.15 = 57.5  → 64 vCPU
host_ram_gb:     50 * 2 * 1.20 = 120   → 128 GB
host_disk_gb:    50 * 10 + 50  = 550   → 1 TB

→ Pick: Standard_D32s_v5 (32 vCPU, 128 GB) + 1 TB Premium SSD
       (vCPU is overcommit-friendly here, 32 cores serve 50 light students)
→ Cost (1 day, Spot): 24h × ₹70/h = ₹1,680
→ Per-seat cost: ₹34
```

vs. 50 individual VMs at ₹3/hr Spot each = ₹3,600. Container path saves 53%.

### Example 3 — 25-student ELK + Cassandra course, 5 days

```
per_seat:        3 vCPU, 10 GB RAM, 30 GB disk  (ELK + Cassandra is heavy)
host_vcpu:       25 * 3 * 1.15 = 86  → 96 vCPU (need a bigger SKU)
host_ram_gb:     25 * 10 * 1.20 = 300 → 384 GB
host_disk_gb:    25 * 30 + 50 = 800   → 1 TB

→ Pick: Standard_E96s_v5 (96 vCPU, 768 GB) + 1 TB Premium SSD
       (overprovisioned on RAM but no smaller SKU has enough vCPU)
→ Cost (5 days, Spot): 5 × 24h × ₹220/h = ₹26,400
→ Per-seat cost: ₹1,056
```

This is a heavy course. If the customer is price-sensitive, consider:
- Dropping Cassandra → drops to 25 × 6 GB = 150 GB → fits Standard_D64s_v5 (~₹140/h Spot)
- Using a shared Cassandra cluster instead of per-student → drops Cassandra cost from 25× to 1×

## Operational checklist

1. **Always use Spot, never on-demand** for training that can tolerate the 1-2% eviction rate (most can — students reconnect to a new container in 30s).
2. **Pre-pull the image** on the host before the batch starts. Add to your provisioning script:
   ```
   docker pull getlabs/lab-bigdata-workspace:latest
   ```
3. **Set per-container limits explicitly** with `--memory` and `--cpus`. Don't rely on Docker defaults.
4. **Use a dedicated data volume** mounted at `/var/lib/docker` on the Premium SSD. Don't put it on the OS disk.
5. **Disable swap** on the host: `swapoff -a` and remove from `/etc/fstab`. Containers should never swap — if they do, they're undersized.
6. **Monitor RAM headroom** every 5 min. If `free -m` shows under 5% free, you're oversubscribed.
7. **Tag the host** with the training name and batch ID so the cleanup automation knows which host to scale down after the course ends.

## Cost comparison cheat sheet

| Approach | 25-seat Kafka/Spark/MySQL bootcamp, 3 days |
|---|---|
| Containers on 1 × D64s_v5 Spot | **₹10,080** total = ₹403/seat |
| Containers on 1 × D64s_v5 OnDemand | ₹46,800 = ₹1,872/seat |
| 25 × D4s_v3 Spot VMs | ₹10,800 = ₹432/seat (similar cost, 3-5× slower UX) |
| 25 × D4s_v3 OnDemand VMs | ₹54,000 = ₹2,160/seat |
| 25 × custom-built Linux VMs from a vendor | ₹37,500–75,000 (depends on margin) |

Container path with Spot is the cheapest **and** the fastest for the student.

## When to NOT use containers

- The course teaches **container internals** with low-level cgroup/namespace work that needs privileged access (use a privileged container or a real VM).
- The course needs **GPU** (containers can use GPUs but the per-host cost economics flip — GPU VMs are expensive enough that VM-per-student is fine).
- The course teaches **kernel modules** or **device drivers** (needs a real VM with `--privileged` or actual hardware access).
- The course requires **bare-metal performance benchmarks** (containers add 0% CPU overhead but I/O virtualization is non-trivial).

For everything else — yes, containerize.
