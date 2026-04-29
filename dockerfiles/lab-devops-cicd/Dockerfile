# lab-devops-cicd — Jenkins + GitLab Runner + ArgoCD CLI + Docker + K8s tools
# Runtime: sysbox-runc (needs Docker inside for CI pipelines)
# Build:  docker build --platform linux/amd64 -t getlabs/lab-devops-cicd:1.0 .
# Run:    docker run --runtime=sysbox-runc -d -p 7681:7681 -p 8080:8080 getlabs/lab-devops-cicd:1.0

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server iproute2 iputils-ping net-tools \
      systemd systemd-sysv \
      python3 python3-pip openjdk-17-jre-headless && \
    rm -f /lib/systemd/system/multi-user.target.wants/* \
          /etc/systemd/system/*.wants/* \
          /lib/systemd/system/local-fs.target.wants/* \
          /lib/systemd/system/sockets.target.wants/*udev* \
          /lib/systemd/system/sockets.target.wants/*initctl* && \
    rm -rf /var/lib/apt/lists/*

# Docker CE
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Jenkins (LTS, war file — lightweight, no systemd service needed for labs)
RUN mkdir -p /opt/jenkins && \
    wget -q https://get.jenkins.io/war-stable/2.462.3/jenkins.war -O /opt/jenkins/jenkins.war

# kubectl + helm + kind
RUN curl -fsSL https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl \
      -o /usr/local/bin/kubectl && chmod +x /usr/local/bin/kubectl && \
    curl -fsSL https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64 \
      -o /usr/local/bin/kind && chmod +x /usr/local/bin/kind && \
    curl -fsSL https://get.helm.sh/helm-v3.15.2-linux-amd64.tar.gz | \
      tar -xz -C /usr/local/bin --strip-components=1 linux-amd64/helm

# Terraform CLI
RUN wget -q https://releases.hashicorp.com/terraform/1.9.2/terraform_1.9.2_linux_amd64.zip -O /tmp/tf.zip && \
    unzip -q /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

# Ansible
RUN pip3 install --no-cache-dir ansible==10.1.0

# ArgoCD CLI
RUN curl -fsSL https://github.com/argoproj/argo-cd/releases/download/v2.11.7/argocd-linux-amd64 \
      -o /usr/local/bin/argocd && chmod +x /usr/local/bin/argocd

# GitLab Runner
RUN curl -fsSL https://packages.gitlab.com/runner/gitlab-runner/gpgkey | gpg --dearmor -o /etc/apt/keyrings/gitlab.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/gitlab.gpg] https://packages.gitlab.com/runner/gitlab-runner/ubuntu/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/gitlab-runner.list && \
    apt-get update && apt-get install -y --no-install-recommends gitlab-runner && \
    rm -rf /var/lib/apt/lists/*

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo,docker lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# Systemd services
RUN printf '[Unit]\nDescription=ttyd\nAfter=network.target\n[Service]\nExecStart=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nRestart=always\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/ttyd.service
RUN printf '[Unit]\nDescription=Jenkins CI\nAfter=network.target docker.service\n[Service]\nUser=lab\nEnvironment=JENKINS_HOME=/home/lab/.jenkins\nExecStart=/usr/bin/java -jar /opt/jenkins/jenkins.war --httpPort=8080\nRestart=always\nRestartSec=5\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/jenkins.service
RUN systemctl enable ttyd ssh docker jenkins

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

EXPOSE 22 7681 8080 8443
ENTRYPOINT ["/sbin/init"]
