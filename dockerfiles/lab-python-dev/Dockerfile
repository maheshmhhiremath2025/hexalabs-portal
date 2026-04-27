# =============================================================================
# lab-python-dev
#
# Python development lab with Django, Flask, FastAPI, and common data/web libs.
# Browser terminal via ttyd on port 7681.
#
# Build:  docker build --platform linux/amd64 -t kumar202699/lab-python-dev:1.0 .
# Run:    docker run -d --name lab-python -p 7681:7681 -p 2222:22 kumar202699/lab-python-dev:1.0
# =============================================================================

FROM ubuntu:22.04

ARG TTYD_VERSION=1.7.7

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    LANG=C.UTF-8

# Base packages + Python 3.11 from deadsnakes PPA
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano less git unzip jq tmux htop procps \
      openssh-server supervisor \
      software-properties-common && \
    add-apt-repository -y ppa:deadsnakes/ppa && \
    apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3.11-venv python3.11-dev python3.11-distutils \
      python3-pip build-essential libpq-dev libffi-dev && \
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
    update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Upgrade pip and install Python frameworks + common libs
RUN python3.11 -m pip install --no-cache-dir --upgrade pip setuptools wheel && \
    python3.11 -m pip install --no-cache-dir --ignore-installed \
      # Web frameworks
      django==5.1 \
      flask==3.1.0 \
      fastapi==0.115.0 \
      uvicorn[standard]==0.30.0 \
      # REST / API
      djangorestframework==3.15.2 \
      requests==2.32.3 \
      httpx==0.27.2 \
      # Database drivers
      psycopg2-binary==2.9.9 \
      pymongo==4.8.0 \
      redis==5.0.8 \
      SQLAlchemy==2.0.35 \
      # Data / utilities
      pandas==2.2.3 \
      numpy==2.1.1 \
      matplotlib==3.9.2 \
      # Testing
      pytest==8.3.3 \
      pytest-django==4.9.0 \
      # Linting / formatting
      black==24.8.0 \
      ruff==0.6.8 \
      # Task runner
      celery==5.4.0 \
      # Env management
      python-dotenv==1.0.1 \
      poetry==1.8.3 \
      virtualenv==20.26.5

# Node.js 20 LTS (needed for frontend tooling in full-stack Python courses)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# ttyd — browser terminal
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Sample project scaffolds for lab exercises
RUN mkdir -p /home/lab/projects && \
    cd /home/lab/projects && \
    python3.11 -m django startproject mysite && \
    mkdir -p flask_app && printf 'from flask import Flask\n\napp = Flask(__name__)\n\n@app.route("/")\ndef hello():\n    return "Hello from Flask!"\n\nif __name__ == "__main__":\n    app.run(host="0.0.0.0", port=5000, debug=True)\n' > flask_app/app.py && \
    mkdir -p fastapi_app && printf 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello from FastAPI!"}\n\n# Run: uvicorn main:app --host 0.0.0.0 --port 8000 --reload\n' > fastapi_app/main.py && \
    chown -R lab:lab /home/lab

# Supervisor config
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 5000 7681 8000

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
