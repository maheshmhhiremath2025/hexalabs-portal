# lab-elk-stack — Elasticsearch + Logstash + Kibana + Filebeat
# Runtime: normal runc | Per-seat: 2 vCPU / 6 GB RAM (ES is memory-hungry)
# Build:  docker build --platform linux/amd64 -t getlabs/lab-elk-stack:1.0 .

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG ELK_VERSION=8.14.3
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server supervisor \
      python3 python3-pip openjdk-17-jre-headless && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Elasticsearch
RUN wget -q https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-${ELK_VERSION}-linux-x86_64.tar.gz -O /tmp/es.tgz && \
    mkdir -p /opt/elasticsearch && \
    tar -xzf /tmp/es.tgz -C /opt/elasticsearch --strip-components=1 && rm /tmp/es.tgz && \
    useradd -r -M -d /opt/elasticsearch elastic && \
    mkdir -p /opt/elasticsearch/data /opt/elasticsearch/logs && \
    chown -R elastic:elastic /opt/elasticsearch && \
    # Single-node, disable security for lab simplicity
    echo -e "node.name: lab-node\npath.data: /opt/elasticsearch/data\npath.logs: /opt/elasticsearch/logs\nnetwork.host: 0.0.0.0\ndiscovery.type: single-node\nxpack.security.enabled: false\n" \
      > /opt/elasticsearch/config/elasticsearch.yml

# Kibana
RUN wget -q https://artifacts.elastic.co/downloads/kibana/kibana-${ELK_VERSION}-linux-x86_64.tar.gz -O /tmp/kb.tgz && \
    mkdir -p /opt/kibana && \
    tar -xzf /tmp/kb.tgz -C /opt/kibana --strip-components=1 && rm /tmp/kb.tgz && \
    chown -R elastic:elastic /opt/kibana && \
    echo -e "server.port: 5601\nserver.host: \"0.0.0.0\"\nelasticsearch.hosts: [\"http://localhost:9200\"]\n" \
      > /opt/kibana/config/kibana.yml

# Logstash
RUN wget -q https://artifacts.elastic.co/downloads/logstash/logstash-${ELK_VERSION}-linux-x86_64.tar.gz -O /tmp/ls.tgz && \
    mkdir -p /opt/logstash && \
    tar -xzf /tmp/ls.tgz -C /opt/logstash --strip-components=1 && rm /tmp/ls.tgz && \
    chown -R elastic:elastic /opt/logstash

# Filebeat
RUN wget -q https://artifacts.elastic.co/downloads/beats/filebeat/filebeat-${ELK_VERSION}-linux-x86_64.tar.gz -O /tmp/fb.tgz && \
    mkdir -p /opt/filebeat && \
    tar -xzf /tmp/fb.tgz -C /opt/filebeat --strip-components=1 && rm /tmp/fb.tgz && \
    chown -R elastic:elastic /opt/filebeat

# Python ELK libraries
RUN pip3 install --no-cache-dir elasticsearch==8.14.0 pandas numpy

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Sample log data for lab exercises
RUN mkdir -p /home/lab/datasets && \
    printf '{"@timestamp":"2024-01-01T10:00:00","level":"INFO","message":"User login","user":"alice"}\n{"@timestamp":"2024-01-01T10:01:00","level":"ERROR","message":"Auth failed","user":"bob"}\n{"@timestamp":"2024-01-01T10:02:00","level":"WARN","message":"Rate limit hit","user":"charlie"}\n' \
      > /home/lab/datasets/sample-logs.json && \
    chown -R lab:lab /home/lab

# Sysctl for Elasticsearch (max_map_count)
RUN echo "vm.max_map_count=262144" >> /etc/sysctl.conf || true

# Supervisor
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n\n[program:elasticsearch]\ncommand=/opt/elasticsearch/bin/elasticsearch\nuser=elastic\nautostart=true\nautorestart=true\nenvironment=ES_JAVA_OPTS="-Xms1g -Xmx1g"\npriority=20\nstdout_logfile=/var/log/es.log\nstderr_logfile=/var/log/es.err.log\n\n[program:kibana]\ncommand=/opt/kibana/bin/kibana --allow-root\nuser=elastic\nautostart=true\nautorestart=true\npriority=30\nstdout_logfile=/var/log/kibana.log\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 5601 7681 9200 9300
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
