# lab-fullstack — MEAN/MERN stack: Node.js + React + Angular + MongoDB + Redis + Nginx
# Runtime: normal runc | Per-seat: 1 vCPU / 3 GB
# Build:  docker build --platform linux/amd64 -t getlabs/lab-fullstack:1.0 .

FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG NODE_MAJOR=20
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server supervisor \
      python3 python3-pip \
      nginx && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g npm@latest yarn pnpm

# MongoDB 7
RUN wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | \
      gpg --dearmor -o /etc/apt/keyrings/mongodb.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    apt-get update && apt-get install -y --no-install-recommends mongodb-org && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /data/db && chown -R mongodb:mongodb /data/db

# Redis
RUN apt-get update && apt-get install -y --no-install-recommends redis-server && \
    rm -rf /var/lib/apt/lists/* && \
    sed -i 's/bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf

# Global npm packages for React + Angular + Express scaffolding
RUN npm install -g \
      create-react-app \
      @angular/cli \
      express-generator \
      typescript \
      ts-node \
      nodemon \
      pm2 \
      serve

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

RUN mkdir -p /var/run/sshd /home/lab/projects && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    chown -R lab:lab /home/lab

# Sample starter project
RUN su - lab -c "mkdir -p /home/lab/projects/hello-express && cd /home/lab/projects/hello-express && npm init -y" && \
    printf 'const express = require("express");\nconst app = express();\napp.get("/", (req, res) => res.json({ message: "Hello from GetLabs!", stack: "MERN" }));\napp.listen(3001, () => console.log("Server on http://localhost:3001"));\n' \
      > /home/lab/projects/hello-express/index.js && \
    cd /home/lab/projects/hello-express && npm install express && \
    chown -R lab:lab /home/lab/projects

# Supervisor
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n\n[program:mongodb]\ncommand=/usr/bin/mongod --dbpath=/data/db --bind_ip=127.0.0.1\nuser=mongodb\nautostart=true\nautorestart=true\npriority=20\n\n[program:redis]\ncommand=/usr/bin/redis-server /etc/redis/redis.conf\nautostart=true\nautorestart=true\npriority=20\n\n[program:nginx]\ncommand=/usr/sbin/nginx -g "daemon off;"\nautostart=true\nautorestart=true\npriority=30\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 80 3000 3001 5173 7681 8080 27017 6379
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
