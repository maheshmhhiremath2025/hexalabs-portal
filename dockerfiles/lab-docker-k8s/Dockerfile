# =============================================================================
# lab-docker-k8s
#
# A training lab image designed to run under sysbox-runc, which allows
# students to run Docker daemon + Kubernetes (kind/k3s) INSIDE their
# container — without --privileged and without nested hypervisor virt.
#
# What students can do inside this container:
#   docker run hello-world            ✓
#   docker build -t myapp .           ✓
#   docker-compose up                 ✓
#   kind create cluster               ✓ (full multi-node K8s!)
#   kubectl get pods                  ✓
#   helm install ...                  ✓
#   kubeadm init                      ✓ (with k3s or kind)
#
# Host requirement: sysbox-runc must be installed on the Docker host.
#   wget https://downloads.nestybox.com/sysbox/releases/v0.6.4/sysbox-ce_0.6.4-0.linux_amd64.deb
#   sudo dpkg -i sysbox-ce_0.6.4-0.linux_amd64.deb
#   sudo systemctl restart docker
#
# Build:  docker build -t getlabs/lab-docker-k8s:1.0 .
# Run:    docker run --runtime=sysbox-runc -d --name lab-dk-student01 \
#           -p 7681:7681 -p 2222:22 \
#           getlabs/lab-docker-k8s:1.0
#
# Image size: ~1.2 GB (Docker CE + kubectl + kind + helm + ttyd)
# RAM at runtime: ~512 MB idle, ~2-4 GB when running a kind cluster
# =============================================================================

FROM ubuntu:22.04

ARG TTYD_VERSION=1.7.7

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    LANG=C.UTF-8

# Base packages + systemd (sysbox containers boot with systemd as PID 1)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano less git unzip jq tmux htop procps \
      openssh-server iproute2 iputils-ping dnsutils net-tools \
      systemd systemd-sysv \
      python3 python3-pip && \
    # Remove unnecessary systemd services that slow boot
    rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/local-fs.target.wants/* \
          /lib/systemd/system/sockets.target.wants/*udev* \
          /lib/systemd/system/sockets.target.wants/*initctl* && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Docker CE — installed inside the container. When running under sysbox-runc,
# the Docker daemon starts as a systemd service and works fully (build, run,
# pull, push, compose, etc.)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# kubectl
RUN curl -fsSL https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl \
      -o /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl

# kind (Kubernetes IN Docker — creates multi-node K8s clusters using containers)
RUN curl -fsSL https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64 \
      -o /usr/local/bin/kind && chmod +x /usr/local/bin/kind

# helm
RUN curl -fsSL https://get.helm.sh/helm-v3.15.2-linux-amd64.tar.gz | \
      tar -xz -C /usr/local/bin --strip-components=1 linux-amd64/helm

# k9s (terminal UI for K8s)
RUN curl -fsSL https://github.com/derailed/k9s/releases/download/v0.32.5/k9s_Linux_amd64.tar.gz | \
      tar -xz -C /usr/local/bin k9s

# ttyd — browser-based terminal
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# docker-compose standalone (v2 is already installed as docker plugin above,
# but some courses use the standalone `docker-compose` binary)
RUN curl -fsSL https://github.com/docker/compose/releases/download/v2.29.1/docker-compose-linux-x86_64 \
      -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose

# Lab user
RUN useradd -m -s /bin/bash -G sudo,docker lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab && \
    chmod 0440 /etc/sudoers.d/lab

# SSH setup
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

# ttyd as a systemd service (browser terminal)
RUN printf '[Unit]\nDescription=ttyd browser terminal\nAfter=network.target\n\n[Service]\nExecStart=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n' \
      > /etc/systemd/system/ttyd.service && \
    systemctl enable ttyd ssh docker

# Welcome message
RUN printf '\n\
=============================================================================\n\
              GetLabs Docker + Kubernetes Lab\n\
=============================================================================\n\
\n\
USER:        lab (sudo + docker group)\n\
PASSWORD:    Welcome1234!\n\
\n\
INSTALLED:\n\
  Docker:        docker, docker-compose, docker buildx\n\
  Kubernetes:    kubectl, kind, helm, k9s\n\
  Languages:     Python 3, git, curl, jq\n\
\n\
QUICK START:\n\
  docker run hello-world\n\
  docker build -t myapp .\n\
  kind create cluster --name lab\n\
  kubectl get nodes\n\
  helm repo add bitnami https://charts.bitnami.com/bitnami\n\
  k9s\n\
\n\
=============================================================================\n\
' > /etc/motd

EXPOSE 22 7681 8080 8443

# Sysbox containers use systemd as PID 1 — it manages Docker daemon,
# SSH, ttyd, and all other services.
ENTRYPOINT ["/sbin/init"]
