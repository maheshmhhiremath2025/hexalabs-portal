# Customer Welcome — GetLabs Big Data Lab

> **For ops:** copy this file, fill in the `{{PLACEHOLDER}}` values from your deploy result, save as a PDF or paste into an email, and send to the customer. Each student gets one container — fill the table at the bottom with the per-student credentials from the deploy results.

---

## Welcome to your GetLabs Big Data Lab

You have access to a fully-configured Linux environment with everything pre-installed for the **{{COURSE_NAME}}** training. No setup, no installs, no waiting — just open your browser and start.

**Lab duration:** {{DURATION_HOURS}} hours · auto-shutdown when expired
**Number of seats:** {{SEAT_COUNT}}
**Region:** South India (Mumbai)
**Support:** {{SUPPORT_EMAIL}}

---

## How to access your lab

### Browser terminal (recommended — no SSH keys, no VPN)

Open your assigned URL in any modern browser (Chrome, Firefox, Edge, Safari). You'll be dropped straight into a Linux terminal as the `lab` user. No login prompt, no password to type — the URL is your authentication.

```
URL:        {{ACCESS_URL}}
User:       lab
Password:   {{LAB_PASSWORD}}     (only needed if you use sudo)
```

The terminal stays connected as long as your browser tab is open. If you close it and come back, just reopen the URL — your work is preserved inside the container.

### SSH access (optional, if you prefer your own terminal)

```bash
ssh lab@{{HOST_IP}} -p {{SSH_PORT}}
# password: {{LAB_PASSWORD}}
```

Note: SSH is enabled but the browser terminal is faster, more reliable, and doesn't require SSH key setup. Use either.

---

## What's pre-installed

| Component | Version | Notes |
|---|---|---|
| **Ubuntu** | 22.04 LTS | base OS |
| **Java** | OpenJDK 17 (Eclipse Temurin) | `JAVA_HOME=/usr/lib/jvm/temurin-17-jdk-amd64` |
| **Python** | 3.10.12 | with pip + virtualenv |
| **Apache Kafka** | 3.7.0 (KRaft mode) | running on `localhost:9092`, no Zookeeper needed |
| **Apache Spark** | 3.5.1 | local mode + standalone cluster, `spark-submit` ready |
| **PySpark** | 3.5.1 | Python bindings for Spark |
| **MySQL** | 8.0.45 | running on `localhost:3306`, db `labdb`, user `lab` |
| **Apache Cassandra** | 4.1.5 | *(only on `bigdata-workspace-cassandra` image)* running on `localhost:9042` |
| **JupyterLab** | 4.2.0 | optional — start with `jupyter lab --ip=0.0.0.0` |
| **Pandas, NumPy** | latest | for data analysis |
| **kafka-python, confluent-kafka** | 2.x | Python clients for Kafka |
| **pymysql, cassandra-driver** | latest | Python clients for the databases |
| **CLI tools** | git, curl, wget, vim, nano, tmux, htop, jq | standard developer kit |

---

## Quick start — verify everything works

Paste these into your terminal to confirm every component is healthy:

```bash
# Check installed versions
java -version
python3 --version
kafka-topics.sh --version
spark-submit --version 2>&1 | grep version
mysql --version
cqlsh --version          # only on cassandra image

# Service status (everything should show RUNNING)
sudo supervisorctl status

# Expected output:
#   ttyd                             RUNNING
#   mysql                            RUNNING
#   kafka                            RUNNING
#   spark-master                     RUNNING
#   spark-worker                     RUNNING
#   cassandra                        RUNNING (cassandra image only)
```

If anything is `STOPPED`, restart it: `sudo supervisorctl restart <name>`

---

## Hands-on exercises — try each one to confirm the stack works

### 1. Kafka — produce and consume your first message

```bash
# Create a topic
kafka-topics.sh --bootstrap-server localhost:9092 --create \
  --topic test-topic --partitions 3 --replication-factor 1

# List topics
kafka-topics.sh --bootstrap-server localhost:9092 --list

# In one terminal: produce messages (type lines, hit Enter to send each)
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic test-topic
> hello world
> this is a test
> ^C

# In another tab (open the URL again in a new browser tab): consume them
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic test-topic --from-beginning
```

You should see your messages appear in the consumer. If yes — Kafka works.

### 2. Spark — run a quick computation

```bash
# Spark interactive shell (Scala)
spark-shell

# In the shell, paste:
val data = (1 to 1000000).toArray
val rdd = sc.parallelize(data)
println("Sum: " + rdd.sum())
println("Count: " + rdd.count())
:quit
```

Or in Python:

```bash
pyspark

# In pyspark:
df = spark.range(1000000)
df.count()
df.agg({'id': 'sum'}).show()
exit()
```

Spark UI is at `http://{{HOST_IP}}:{{SPARK_UI_PORT}}` while a job is running.

### 3. MySQL — connect and create a table

```bash
mysql -ulab -p{{LAB_PASSWORD}} labdb

# At the mysql> prompt:
CREATE TABLE events (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(50), ts DATETIME);
INSERT INTO events (name, ts) VALUES ('login', NOW()), ('click', NOW());
SELECT * FROM events;
EXIT;
```

### 4. Cassandra — *(only on `bigdata-workspace-cassandra` image)*

```bash
cqlsh

# At the cqlsh> prompt:
CREATE KEYSPACE labks WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
USE labks;
CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT);
INSERT INTO users (id, name, email) VALUES (uuid(), 'Alice', 'alice@example.com');
SELECT * FROM users;
EXIT;
```

### 5. End-to-end pipeline (Kafka → Spark → MySQL)

A small Python script that ties it together:

```python
# Save as /home/lab/work/pipeline.py
from kafka import KafkaProducer, KafkaConsumer
import pymysql
import json
import time

# 1. Produce some messages to Kafka
producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    value_serializer=lambda v: json.dumps(v).encode('utf-8'),
)
for i in range(10):
    producer.send('events', {'id': i, 'value': f'event-{i}'})
producer.flush()
print("Produced 10 events")

# 2. Consume them back
consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    auto_offset_reset='earliest',
    consumer_timeout_ms=3000,
    value_deserializer=lambda v: json.loads(v.decode('utf-8')),
)

# 3. Write to MySQL
conn = pymysql.connect(host='localhost', user='lab', password='Welcome1234!', database='labdb')
cur = conn.cursor()
cur.execute("CREATE TABLE IF NOT EXISTS events (id INT PRIMARY KEY, value VARCHAR(100))")

for msg in consumer:
    cur.execute("REPLACE INTO events (id, value) VALUES (%s, %s)", (msg.value['id'], msg.value['value']))
    print(f"Stored: {msg.value}")

conn.commit()
conn.close()
print("Pipeline complete")
```

Run it:
```bash
cd /home/lab/work
python3 pipeline.py
```

If you see "Pipeline complete" with 10 events stored, your full Kafka → Spark/Python → MySQL pipeline is working.

---

## Useful directories

| Path | Purpose |
|---|---|
| `/home/lab/work` | your workspace — put your code, scripts, data here |
| `/home/lab/datasets` | place to drop training datasets |
| `/home/lab/.spark-events` | Spark job event logs (used by the History Server) |
| `/var/log/` | service logs (`kafka.stdout.log`, `spark-master.stdout.log`, `mysql.stdout.log`, etc.) |

---

## Service control reference

The lab uses **supervisord** to manage services. Useful commands:

```bash
# Status of all services
sudo supervisorctl status

# Restart a single service
sudo supervisorctl restart kafka
sudo supervisorctl restart spark-master spark-worker
sudo supervisorctl restart mysql

# Stop / start
sudo supervisorctl stop kafka
sudo supervisorctl start kafka

# Tail a service log live
tail -f /var/log/kafka.stdout.log
tail -f /var/log/spark-master.stdout.log
```

---

## Troubleshooting

| Symptom | Try this |
|---|---|
| `kafka-topics: Connection refused` | `sudo supervisorctl restart kafka` and wait 5 seconds |
| `mysql: Can't connect to local MySQL server` | `sudo supervisorctl restart mysql` |
| `pyspark` hangs at startup | Spark master might be down: `sudo supervisorctl restart spark-master spark-worker` |
| `cqlsh: Unable to connect` | Cassandra takes ~30s to start. `sudo supervisorctl status cassandra` should say RUNNING after that. |
| Container terminal disconnected | Just refresh the browser tab — your shell is preserved server-side |
| Out of memory | The container has {{PER_SEAT_RAM}} GB total. Free some by stopping unused services: `sudo supervisorctl stop cassandra` (or jupyter, or whatever you're not using) |
| Disk full | The container has {{PER_SEAT_DISK}} GB. Clean up old data: `rm -rf /tmp/*` |
| Lost your work | Your work in `/home/lab/work` persists across container restarts but is destroyed when the lab expires. **Push to git or download regularly.** |
| Lab expired before you finished | Contact {{SUPPORT_EMAIL}} and we can extend it |

---

## Lab lifecycle

- **Started:** {{DEPLOYED_AT}}
- **Expires:** {{EXPIRES_AT}} ({{DURATION_HOURS}} hours from start)
- **30 minutes before expiry:** automatic email reminder
- **At expiry:** the container is stopped and removed; any data you didn't export is gone

To extend, contact {{SUPPORT_EMAIL}} before the expiry time.

---

## Per-student credentials

Below is the list of lab containers we provisioned for your batch. Distribute one row per student:

| # | Student name / email | Browser URL | SSH port | Username | Password |
|---|---|---|---|---|---|
| 1 | {{STUDENT_1_EMAIL}} | {{STUDENT_1_URL}} | {{STUDENT_1_SSH_PORT}} | lab | {{LAB_PASSWORD}} |
| 2 | {{STUDENT_2_EMAIL}} | {{STUDENT_2_URL}} | {{STUDENT_2_SSH_PORT}} | lab | {{LAB_PASSWORD}} |
| ... | ... | ... | ... | ... | ... |

(Ops: copy this from your deploy result table.)

---

## Support

- **Email:** {{SUPPORT_EMAIL}}
- **Phone (urgent only):** {{SUPPORT_PHONE}}
- **Hours:** Mon-Fri 9 AM – 9 PM IST, Sat 10 AM – 6 PM IST

We monitor the lab health automatically. If a container crashes, we'll notice and restart it within 5 minutes. If you notice an issue before we do, just email us with the URL and a short description.

---

**Have a great training!**

— GetLabs Cloud Portal
