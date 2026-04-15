# lab-monitoring — Prometheus + Grafana + Node Exporter + Alertmanager
# Runtime: normal runc | Per-seat: 1 vCPU / 3 GB
# Build:  docker build --platform linux/amd64 -t getlabs/lab-monitoring:1.0 .

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG PROM_VERSION=2.53.1
ARG GRAFANA_VERSION=11.1.3
ARG ALERTMGR_VERSION=0.27.0
ARG NODE_EXP_VERSION=1.8.2
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server supervisor \
      python3 python3-pip && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Prometheus
RUN wget -q https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/prometheus-${PROM_VERSION}.linux-amd64.tar.gz -O /tmp/prom.tgz && \
    mkdir -p /opt/prometheus && \
    tar -xzf /tmp/prom.tgz -C /opt/prometheus --strip-components=1 && rm /tmp/prom.tgz && \
    useradd -r -M -s /bin/false prometheus && \
    mkdir -p /opt/prometheus/data && chown -R prometheus:prometheus /opt/prometheus

# Prometheus config — scrapes itself + node_exporter + Grafana
RUN printf 'global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: "prometheus"\n    static_configs:\n      - targets: ["localhost:9090"]\n  - job_name: "node"\n    static_configs:\n      - targets: ["localhost:9100"]\n  - job_name: "grafana"\n    static_configs:\n      - targets: ["localhost:3000"]\n' \
      > /opt/prometheus/prometheus.yml

# Alertmanager
RUN wget -q https://github.com/prometheus/alertmanager/releases/download/v${ALERTMGR_VERSION}/alertmanager-${ALERTMGR_VERSION}.linux-amd64.tar.gz -O /tmp/am.tgz && \
    mkdir -p /opt/alertmanager && \
    tar -xzf /tmp/am.tgz -C /opt/alertmanager --strip-components=1 && rm /tmp/am.tgz && \
    chown -R prometheus:prometheus /opt/alertmanager

# Node Exporter
RUN wget -q https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXP_VERSION}/node_exporter-${NODE_EXP_VERSION}.linux-amd64.tar.gz -O /tmp/ne.tgz && \
    mkdir -p /opt/node_exporter && \
    tar -xzf /tmp/ne.tgz -C /opt/node_exporter --strip-components=1 && rm /tmp/ne.tgz

# Grafana (OSS)
RUN wget -q https://dl.grafana.com/oss/release/grafana-${GRAFANA_VERSION}.linux-amd64.tar.gz -O /tmp/gf.tgz && \
    mkdir -p /opt/grafana && \
    tar -xzf /tmp/gf.tgz -C /opt/grafana --strip-components=1 && rm /tmp/gf.tgz && \
    chown -R prometheus:prometheus /opt/grafana

# PromQL + Python client
RUN pip3 install --no-cache-dir prometheus-client requests pandas

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Supervisor
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n\n[program:prometheus]\ncommand=/opt/prometheus/prometheus --config.file=/opt/prometheus/prometheus.yml --storage.tsdb.path=/opt/prometheus/data --web.listen-address=:9090\nuser=prometheus\nautostart=true\nautorestart=true\npriority=20\n\n[program:node_exporter]\ncommand=/opt/node_exporter/node_exporter --web.listen-address=:9100\nautostart=true\nautorestart=true\npriority=20\n\n[program:alertmanager]\ncommand=/opt/alertmanager/alertmanager --config.file=/opt/alertmanager/alertmanager.yml --web.listen-address=:9093\nuser=prometheus\nautostart=true\nautorestart=true\npriority=25\n\n[program:grafana]\ncommand=/opt/grafana/bin/grafana-server --homepath=/opt/grafana --config=/opt/grafana/conf/defaults.ini\nuser=prometheus\nautostart=true\nautorestart=true\npriority=30\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 3000 7681 9090 9093 9100
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
