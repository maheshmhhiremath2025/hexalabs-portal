# lab-soc-analyst — SOC Analyst Training Lab
# Wazuh Manager + Elasticsearch + Kibana + Suricata + Filebeat
# Browser terminal via ttyd on port 7681, Kibana on 5601
# Build:  docker build --platform linux/amd64 -t getlabs/lab-soc-analyst:1.0 .
# Run:    docker run -d -p 7681:7681 --cap-add NET_ADMIN getlabs/lab-soc-analyst:1.0

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG TTYD_VERSION=1.7.7

# Base packages + Java (required for Elasticsearch)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server iproute2 iputils-ping net-tools tcpdump nmap \
      python3 python3-pip \
      openjdk-17-jre-headless \
      supervisor && \
    rm -rf /var/lib/apt/lists/*

# ttyd — browser terminal
RUN wget -qO /usr/local/bin/ttyd \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" && \
    chmod +x /usr/local/bin/ttyd

# Elasticsearch 8.x (single-node, security disabled for lab simplicity)
RUN wget -qO- https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --dearmor -o /usr/share/keyrings/elastic.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/elastic.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" \
      > /etc/apt/sources.list.d/elastic-8.x.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      elasticsearch kibana filebeat && \
    rm -rf /var/lib/apt/lists/*

# Configure Elasticsearch for single-node lab
RUN echo "xpack.security.enabled: false" >> /etc/elasticsearch/elasticsearch.yml && \
    echo "discovery.type: single-node" >> /etc/elasticsearch/elasticsearch.yml && \
    echo "network.host: 0.0.0.0" >> /etc/elasticsearch/elasticsearch.yml && \
    echo "xpack.security.http.ssl.enabled: false" >> /etc/elasticsearch/elasticsearch.yml && \
    echo "xpack.security.transport.ssl.enabled: false" >> /etc/elasticsearch/elasticsearch.yml

# Configure Kibana
RUN echo 'server.host: "0.0.0.0"' >> /etc/kibana/kibana.yml && \
    echo 'elasticsearch.hosts: ["http://localhost:9200"]' >> /etc/kibana/kibana.yml

# Wazuh Manager
RUN curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
      > /etc/apt/sources.list.d/wazuh.list && \
    apt-get update && apt-get install -y --no-install-recommends wazuh-manager && \
    rm -rf /var/lib/apt/lists/*

# Suricata IDS
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository ppa:oisf/suricata-stable -y && \
    apt-get update && apt-get install -y --no-install-recommends suricata && \
    rm -rf /var/lib/apt/lists/*

# Configure Filebeat for Wazuh alerts → Elasticsearch
RUN filebeat modules enable suricata 2>/dev/null || true

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# Sample attack logs + pcap files for training exercises
RUN mkdir -p /home/lab/exercises && \
    echo '#!/bin/bash\necho "=== SOC Analyst Training Lab ==="\necho ""\necho "Services:"\necho "  Elasticsearch : http://localhost:9200"\necho "  Kibana        : http://localhost:5601"\necho "  Wazuh Manager : running on port 1514/1515"\necho "  Suricata IDS  : monitoring eth0"\necho ""\necho "Quick start:"\necho "  1. Open Kibana at http://localhost:5601"\necho "  2. Check Wazuh alerts: /var/ossec/logs/alerts/alerts.json"\necho "  3. Check Suricata: /var/log/suricata/eve.json"\necho "  4. Generate test traffic: nmap -sS localhost"\necho ""' > /home/lab/lab-info.sh && \
    chmod +x /home/lab/lab-info.sh && \
    chown -R lab:lab /home/lab/exercises

# Supervisor config — manage all services
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 7681 5601 9200

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
