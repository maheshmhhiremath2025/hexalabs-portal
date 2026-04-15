# lab-bigdata-workspace

A self-contained big-data training lab image for B2B courses that ask for
"a Linux VM with Kafka, Spark, MySQL, Cassandra, JDK 17, Python 3.10."

This is the GetLabs answer to the recurring customer spec:

```
Requested VM Specifications:
  vCPU:    4–8 vCPUs
  RAM:     16–32 GB
  Storage: SSD, 200–300 GB
  OS:      Ubuntu 22.04 LTS or RHEL 8
  Tools:   Kafka, Spark, MySQL/Cassandra, JDK 17, Python 3.10
  Access:  SSH enabled, network connectivity between lab VMs
```

## Two deployment modes

### Mode A: All-in-one container (default)

One container per student. Everything runs locally inside the container —
Kafka, Spark, MySQL, optional Cassandra, the lab user shell, the browser
terminal. No cross-student networking, perfect isolation.

```bash
# Build (one-time, ~10 min)
cd dockerfiles/lab-bigdata-workspace
docker build -t getlabs/lab-bigdata-workspace:latest .

# Run for one student
docker run -d --name lab-bd-student01 \
  --memory=6g --cpus=2 \
  -p 7681:7681 -p 8888:8888 \
  -e ENABLE_KAFKA=true \
  -e ENABLE_SPARK=true \
  -e ENABLE_CASSANDRA=false \
  -e ENABLE_SSH=false \
  -e LAB_PASSWORD='ChooseAGoodPassword!' \
  getlabs/lab-bigdata-workspace:latest
```

Student opens `http://<host-ip>:7681` in a browser → drops into a
pre-configured shell with Kafka, Spark, MySQL all reachable on `localhost`.

### Mode B: Multi-container per-student stack

Separate `kafka`, `spark-master`, `spark-worker`, `mysql`, `cassandra`
containers wired by docker network. Use this when the customer specifically
asks for a "real" multi-host architecture.

```bash
# Per-student stack — give each student their own COMPOSE_PROJECT_NAME
COMPOSE_PROJECT_NAME=lab-student-01 \
WORKSPACE_TTY_PORT=7681 \
WORKSPACE_SSH_PORT=2201 \
JUPYTER_PORT=8801 \
LAB_PASSWORD='ChooseAGoodPassword!' \
docker-compose up -d

# With Cassandra
COMPOSE_PROJECT_NAME=lab-student-02 \
WORKSPACE_TTY_PORT=7682 \
WORKSPACE_SSH_PORT=2202 \
JUPYTER_PORT=8802 \
LAB_PASSWORD='ChooseAGoodPassword!' \
docker-compose --profile cassandra up -d
```

## Service matrix and env vars

| Service        | Env var            | Default | Notes |
|----------------|--------------------|---------|-------|
| ttyd terminal  | always on          | ✓       | port 7681, browser shell as `lab` |
| MySQL 8        | always on          | ✓       | localhost:3306, db=`labdb`, user=`lab` |
| Kafka 3.7 KRaft| `ENABLE_KAFKA`     | true    | localhost:9092 |
| Spark 3.5      | `ENABLE_SPARK`     | true    | local + standalone master |
| Cassandra 4.1  | `ENABLE_CASSANDRA` | false   | heavy — only enable if course needs it |
| Jupyter Lab    | `ENABLE_JUPYTER`   | false   | port 8888, no token |
| SSH server     | `ENABLE_SSH`       | false   | prefer the browser terminal |

`LAB_PASSWORD` (default `Welcome1234!`) is the password for the `lab` user
both in shell and in MySQL.

## Resource budget

| Configuration                  | Image size | RAM at runtime | vCPU |
|--------------------------------|------------|----------------|------|
| Mode A, Kafka+Spark, no Cassandra | ~3.5 GB | ~2.5 GB        | 1–2  |
| Mode A, full stack with Cassandra | ~3.9 GB | ~3.7 GB        | 2–3  |
| Mode B, per-student multi-container | n/a   | ~5 GB          | 2–3  |
| Mode B with Cassandra              | n/a   | ~7 GB          | 3–4  |

For 25 students on a single host:

| Mode              | Host RAM needed | Host vCPU |
|-------------------|-----------------|-----------|
| Mode A no Cassandra | 80 GB         | 32        |
| Mode A + Cassandra  | 110 GB        | 50        |
| Mode B no Cassandra | 140 GB        | 60        |
| Mode B + Cassandra  | 200 GB        | 80        |

See `docs/HOST_SIZING_GUIDE.md` for the full sizing matrix and cost model.

## Tools verification (after build)

```bash
docker run --rm getlabs/lab-bigdata-workspace:latest bash -c '
  echo "--- Java ---"        && java -version 2>&1
  echo "--- Python ---"      && python3 --version
  echo "--- Kafka ---"       && kafka-topics.sh --version
  echo "--- Spark ---"       && spark-submit --version 2>&1 | head -5
  echo "--- MySQL ---"       && mysql --version
  echo "--- Cassandra ---"   && /opt/cassandra/bin/cassandra -v
  echo "--- ttyd ---"        && /usr/local/bin/ttyd --version
'
```

All seven commands should print versions.

## Cleanup

GetLabs' existing `containerService.js` already supports stop/start/delete on
arbitrary containers. The `lab-bigdata-workspace` image is registered in the
catalog at `services/containerService.js` with key `bigdata-workspace`, and
follows the same per-container TTL + idle-shutdown automation as every other
image in the catalog.
