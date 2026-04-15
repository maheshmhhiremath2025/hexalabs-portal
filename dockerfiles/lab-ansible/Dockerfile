# lab-ansible — Ansible controller + 3 simulated managed nodes (via SSH)
# Runtime: sysbox-runc (runs multiple SSH targets inside via systemd)
# Build:  docker build --platform linux/amd64 -t getlabs/lab-ansible:1.0 .
# Run:    docker run --runtime=sysbox-runc -d -p 7681:7681 getlabs/lab-ansible:1.0

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server openssh-client sshpass \
      systemd systemd-sysv \
      python3 python3-pip python3-venv && \
    rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/local-fs.target.wants/* \
          /lib/systemd/system/sockets.target.wants/*udev* \
          /lib/systemd/system/sockets.target.wants/*initctl* && \
    rm -rf /var/lib/apt/lists/*

# Docker CE (for sysbox — runs managed node containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Ansible + extras
RUN pip3 install --no-cache-dir \
      ansible==10.1.0 \
      ansible-lint==24.7.0 \
      molecule==24.7.0 \
      jmespath \
      netaddr \
      pywinrm

# Terraform (Ansible + Terraform is a common combo)
RUN wget -q https://releases.hashicorp.com/terraform/1.9.2/terraform_1.9.2_linux_amd64.zip -O /tmp/tf.zip && \
    unzip -q /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo,docker lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# Pre-create SSH key for the lab user (Ansible uses this to connect to managed nodes)
RUN su - lab -c "ssh-keygen -t ed25519 -f /home/lab/.ssh/id_ed25519 -N ''"

# Setup script that starts 3 managed-node containers on first boot
RUN printf '#!/bin/bash\n\
# Wait for Docker to be ready\n\
for i in {1..30}; do docker info >/dev/null 2>&1 && break; sleep 1; done\n\
\n\
# Start 3 managed nodes (lightweight Alpine + SSH)\n\
for n in node1 node2 node3; do\n\
  if ! docker ps -a --format "{{.Names}}" | grep -q "^${n}$"; then\n\
    docker run -d --name $n --hostname $n \\\n\
      -e "AUTHORIZED_KEYS=$(cat /home/lab/.ssh/id_ed25519.pub)" \\\n\
      ghcr.io/linuxserver/openssh-server:latest\n\
  fi\n\
done\n\
\n\
# Build inventory file from running nodes\n\
sleep 3\n\
echo "[managed_nodes]" > /home/lab/inventory.ini\n\
for n in node1 node2 node3; do\n\
  IP=$(docker inspect -f "{{.NetworkSettings.IPAddress}}" $n 2>/dev/null)\n\
  [ -n "$IP" ] && echo "$n ansible_host=$IP ansible_user=linuxserver.io" >> /home/lab/inventory.ini\n\
done\n\
chown lab:lab /home/lab/inventory.ini\n\
echo "Managed nodes ready. Inventory: /home/lab/inventory.ini"\n\
' > /usr/local/bin/setup-nodes.sh && chmod +x /usr/local/bin/setup-nodes.sh

# Systemd services
RUN printf '[Unit]\nDescription=ttyd\nAfter=network.target\n[Service]\nExecStart=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nRestart=always\n[Install]\nWantedBy=multi-user.target\n' \
      > /etc/systemd/system/ttyd.service && \
    printf '[Unit]\nDescription=Setup Ansible managed nodes\nAfter=docker.service\nRequires=docker.service\n[Service]\nType=oneshot\nExecStart=/usr/local/bin/setup-nodes.sh\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n' \
      > /etc/systemd/system/setup-nodes.service && \
    systemctl enable ttyd ssh docker setup-nodes

# Sample playbook
RUN mkdir -p /home/lab/playbooks && \
    printf '---\n- name: Verify managed nodes\n  hosts: managed_nodes\n  tasks:\n    - name: Ping all nodes\n      ansible.builtin.ping:\n    - name: Gather facts\n      ansible.builtin.setup:\n        filter: ansible_os_family\n    - name: Show OS\n      ansible.builtin.debug:\n        msg: "{{ inventory_hostname }} runs {{ ansible_os_family }}"\n' \
      > /home/lab/playbooks/ping.yml && \
    printf '[defaults]\ninventory = /home/lab/inventory.ini\nhost_key_checking = False\nremote_user = linuxserver.io\nprivate_key_file = /home/lab/.ssh/id_ed25519\n' \
      > /home/lab/ansible.cfg && \
    chown -R lab:lab /home/lab

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

EXPOSE 22 7681
ENTRYPOINT ["/sbin/init"]
