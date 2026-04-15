# =============================================================================
# lab-bigdata-workspace
#
# A self-contained big-data training lab image matching the common B2B spec:
#   - Ubuntu 22.04 base (matches typical customer "Linux VM" requests)
#   - Eclipse Temurin JDK 17 (Java 17)
#   - Python 3.10 + pip + virtualenv
#   - Apache Kafka 3.7.0 binaries + CLI tools (producer/consumer/topics)
#   - Apache Spark 3.5.1 binaries + PySpark + spark-submit
#   - MySQL 8 server + CLI
#   - Cassandra 4.1 (optional — started only if ENABLE_CASSANDRA=true)
#   - Browser-based terminal via ttyd (port 7681)
#   - Optional SSH on port 22 (enabled only if ENABLE_SSH=true)
#
# Architecture: one container per student. All services run locally inside
# the container so there's no networking between students and perfect
# isolation. Students SSH or use the browser terminal to interact with
# Kafka/Spark/MySQL as localhost.
#
# Memory footprint at runtime:
#   - JVM heap for Kafka:     ~512 MB
#   - JVM heap for Zookeeper: ~256 MB (embedded in Kafka for KRaft mode)
#   - JVM heap for Spark:     ~1 GB (driver + local executor)
#   - MySQL:                  ~300 MB
#   - Cassandra (optional):   ~1.2 GB
#   - Base OS + ttyd:         ~200 MB
#   => ~2.5 GB without Cassandra, ~3.7 GB with Cassandra
# Recommend --memory=6g per container.
#
# Build:  docker build -t getlabs/lab-bigdata-workspace:latest .
# Run:    docker run -d --name lab-bd-student01 --memory=6g --cpus=2 \
#             -p 7681:7681 -p 8888:8888 \
#             -e ENABLE_SSH=true -e ENABLE_CASSANDRA=false \
#             getlabs/lab-bigdata-workspace:latest
# =============================================================================

FROM ubuntu:22.04

# --- Build-time config ---
ARG KAFKA_VERSION=3.7.0
ARG SCALA_VERSION=2.13
ARG SPARK_VERSION=3.5.1
ARG HADOOP_VERSION=3
ARG CASSANDRA_VERSION=4.1.5
ARG TTYD_VERSION=1.7.7

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    # NOTE: do NOT set JAVA_TOOL_OPTIONS here. Spark sets its own min/max heap
    # via SPARK_DRIVER_MEMORY / spark-submit args, and a conflicting global
    # tool-options breaks `spark-submit` with "Initial heap > max heap".
    # Per-service heap is set in supervisord.conf via KAFKA_HEAP_OPTS,
    # SPARK_DRIVER_MEMORY, MAX_HEAP_SIZE for Cassandra, etc.
    # Kafka / Spark / Cassandra home directories
    KAFKA_HOME=/opt/kafka \
    SPARK_HOME=/opt/spark \
    CASSANDRA_HOME=/opt/cassandra

# --- Base OS + common tooling ---
# We install in one RUN to keep layers small, and clean apt caches at the end.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano less git unzip zip tar \
      net-tools iputils-ping dnsutils netcat-openbsd \
      jq tmux htop procps \
      build-essential \
      openssh-server supervisor \
      libncurses5 libaio1 && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    dpkg-reconfigure --frontend noninteractive tzdata && \
    rm -rf /var/lib/apt/lists/*

# --- Java 17 (Eclipse Temurin) ---
RUN mkdir -p /etc/apt/keyrings && \
    wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | \
      gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/adoptium.list && \
    apt-get update && apt-get install -y --no-install-recommends temurin-17-jdk && \
    rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/temurin-17-jdk-amd64
ENV PATH=$JAVA_HOME/bin:$PATH

# --- Python 3.10 + common data libs ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv python3-dev && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir \
      pyspark==${SPARK_VERSION} \
      kafka-python==2.0.2 \
      confluent-kafka==2.4.0 \
      pymysql==1.1.0 \
      cassandra-driver==3.29.1 \
      pandas==2.2.2 \
      numpy==1.26.4 \
      jupyterlab==4.2.0

# --- Kafka (KRaft mode, no Zookeeper) ---
# KRaft is Kafka 3.0+ native consensus — drops the Zookeeper dependency,
# saves ~500 MB RAM vs. Zookeeper+Kafka combo.
RUN wget -q https://archive.apache.org/dist/kafka/${KAFKA_VERSION}/kafka_${SCALA_VERSION}-${KAFKA_VERSION}.tgz -O /tmp/kafka.tgz && \
    mkdir -p /opt/kafka && \
    tar -xzf /tmp/kafka.tgz -C /opt/kafka --strip-components=1 && \
    rm /tmp/kafka.tgz
ENV PATH=$KAFKA_HOME/bin:$PATH

# --- Spark 3.5 (local mode) ---
RUN wget -q https://archive.apache.org/dist/spark/spark-${SPARK_VERSION}/spark-${SPARK_VERSION}-bin-hadoop${HADOOP_VERSION}.tgz -O /tmp/spark.tgz && \
    mkdir -p /opt/spark && \
    tar -xzf /tmp/spark.tgz -C /opt/spark --strip-components=1 && \
    rm /tmp/spark.tgz
ENV PATH=$SPARK_HOME/bin:$SPARK_HOME/sbin:$PATH \
    PYSPARK_PYTHON=python3

# --- MySQL 8 server + client ---
# Install without starting; supervisord will launch mysqld at container start.
RUN apt-get update && apt-get install -y --no-install-recommends \
      mysql-server-8.0 mysql-client && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/run/mysqld && \
    chown -R mysql:mysql /var/run/mysqld

# --- Cassandra 4.1 (optional, stopped by default) ---
RUN wget -q https://archive.apache.org/dist/cassandra/${CASSANDRA_VERSION}/apache-cassandra-${CASSANDRA_VERSION}-bin.tar.gz -O /tmp/cass.tgz && \
    mkdir -p /opt/cassandra && \
    tar -xzf /tmp/cass.tgz -C /opt/cassandra --strip-components=1 && \
    rm /tmp/cass.tgz && \
    mkdir -p /var/log/cassandra /var/lib/cassandra && \
    useradd -r -M -s /bin/false cassandra || true && \
    chown -R cassandra:cassandra /opt/cassandra /var/log/cassandra /var/lib/cassandra
ENV PATH=$CASSANDRA_HOME/bin:$PATH

# --- ttyd — browser-based terminal on port 7681 ---
# Pre-built static binary, no compile step needed.
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 -O /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd

# --- Lab user (non-root) ---
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab && \
    chmod 0440 /etc/sudoers.d/lab

# Lab home + working dirs
RUN mkdir -p /home/lab/work /home/lab/datasets /home/lab/.spark-events && \
    chown -R lab:lab /home/lab

# --- Copy lab scripts and supervisor config ---
COPY start.sh /usr/local/bin/start.sh
COPY supervisord.conf /etc/supervisor/conf.d/lab.conf
COPY welcome.txt /etc/motd
RUN chmod +x /usr/local/bin/start.sh

# --- SSH setup (enabled via env var at runtime) ---
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

EXPOSE 22 7681 8888 9092 3306 9042 4040 7077

WORKDIR /home/lab

# ttyd + SSH + user-selected services are all launched by supervisord.
# The start.sh script runs MySQL bootstrap, Kafka KRaft format, etc. then
# hands off to supervisord which keeps everything alive.
ENTRYPOINT ["/usr/local/bin/start.sh"]
