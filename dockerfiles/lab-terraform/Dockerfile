# lab-terraform — Terraform + AWS/Azure/GCP CLIs + Python + code-server
# Runtime: normal runc (no Docker needed inside)
# Pairs with cloud sandbox — student provisions real infra via Terraform
# Build:  docker build --platform linux/amd64 -t getlabs/lab-terraform:1.0 .

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server supervisor \
      python3 python3-pip python3-venv && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Terraform
RUN wget -q https://releases.hashicorp.com/terraform/1.9.2/terraform_1.9.2_linux_amd64.zip -O /tmp/tf.zip && \
    unzip -q /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

# Terragrunt
RUN wget -q https://github.com/gruntwork-io/terragrunt/releases/download/v0.67.4/terragrunt_linux_amd64 \
      -O /usr/local/bin/terragrunt && chmod +x /usr/local/bin/terragrunt

# tflint
RUN curl -fsSL https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash

# AWS CLI v2
RUN curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip && \
    unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

# Azure CLI
RUN curl -fsSL https://aka.ms/InstallAzureCLIDeb | bash

# GCP gcloud CLI
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
      gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    apt-get update && apt-get install -y --no-install-recommends google-cloud-cli && \
    rm -rf /var/lib/apt/lists/*

# Pulumi (alternative IaC)
RUN curl -fsSL https://get.pulumi.com | sh && mv /root/.pulumi/bin/pulumi /usr/local/bin/

# Python IaC libraries
RUN pip3 install --no-cache-dir boto3 azure-identity azure-mgmt-resource google-cloud-storage checkov

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Supervisor config
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 7681
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
