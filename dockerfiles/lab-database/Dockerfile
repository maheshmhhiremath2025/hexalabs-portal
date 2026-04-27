# =============================================================================
# lab-database
#
# Multi-database training lab with MySQL 8, PostgreSQL 16, MongoDB 7, and
# Redis 7. Includes CLI clients, pgAdmin-lite, and sample datasets.
# Browser terminal via ttyd on port 7681.
#
# Build:  docker build --platform linux/amd64 -t kumar202699/lab-database:1.0 .
# Run:    docker run -d --name lab-db -p 7681:7681 -p 2222:22 kumar202699/lab-database:1.0
# =============================================================================

FROM ubuntu:22.04

ARG TTYD_VERSION=1.7.7

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    LANG=C.UTF-8

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano less git unzip jq tmux htop procps \
      openssh-server supervisor \
      python3 python3-pip && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# MySQL 8 (from Ubuntu default repos)
RUN apt-get update && apt-get install -y --no-install-recommends \
      mysql-server mysql-client && \
    rm -rf /var/lib/apt/lists/*

# PostgreSQL 16
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt jammy-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      postgresql-16 postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/*

# MongoDB 7
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/mongodb.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      mongodb-org && \
    rm -rf /var/lib/apt/lists/*

# Redis 7
RUN curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/redis.gpg] https://packages.redis.io/deb jammy main" \
      > /etc/apt/sources.list.d/redis.list && \
    apt-get update && apt-get install -y --no-install-recommends \
      redis-server && \
    rm -rf /var/lib/apt/lists/*

# Python DB drivers (for students to practice programmatic access)
RUN pip3 install --no-cache-dir \
      pymysql==1.1.1 \
      psycopg2-binary==2.9.9 \
      pymongo==4.8.0 \
      redis==5.0.8 \
      sqlalchemy==2.0.35

# Initialize MySQL data directory (Ubuntu package uses mysql_install_db style)
RUN mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld && \
    chown -R mysql:mysql /var/lib/mysql && \
    mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql 2>&1 || \
    (usermod -d /var/lib/mysql mysql && mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql 2>&1) || true

# Initialize PostgreSQL cluster
RUN mkdir -p /var/run/postgresql && \
    chown -R postgres:postgres /var/run/postgresql /var/lib/postgresql /etc/postgresql && \
    rm -rf /var/lib/postgresql/16/main/* && \
    su -s /bin/bash postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/16/main"

# Create MongoDB data directory
RUN mkdir -p /data/db && chown mongodb:mongodb /data/db

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Sample datasets + setup scripts
RUN mkdir -p /home/lab/datasets /home/lab/scripts && \
    # MySQL setup: create lab database and sample table
    printf '#!/bin/bash\nmysql -u root -e "CREATE DATABASE IF NOT EXISTS labdb;"\nmysql -u root -e "CREATE USER IF NOT EXISTS '"'"'lab'"'"'@'"'"'localhost'"'"' IDENTIFIED BY '"'"'Welcome1234!'"'"';"\nmysql -u root -e "GRANT ALL PRIVILEGES ON *.* TO '"'"'lab'"'"'@'"'"'localhost'"'"';"\nmysql -u root labdb -e "\nCREATE TABLE IF NOT EXISTS employees (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(100),\n  department VARCHAR(50),\n  salary DECIMAL(10,2),\n  hire_date DATE\n);\nINSERT IGNORE INTO employees (id, name, department, salary, hire_date) VALUES\n  (1, '"'"'Alice Johnson'"'"', '"'"'Engineering'"'"', 95000, '"'"'2021-03-15'"'"'),\n  (2, '"'"'Bob Smith'"'"', '"'"'Marketing'"'"', 72000, '"'"'2020-06-01'"'"'),\n  (3, '"'"'Carol Williams'"'"', '"'"'Engineering'"'"', 105000, '"'"'2019-11-20'"'"'),\n  (4, '"'"'David Brown'"'"', '"'"'HR'"'"', 68000, '"'"'2022-01-10'"'"'),\n  (5, '"'"'Eve Davis'"'"', '"'"'Engineering'"'"', 98000, '"'"'2021-07-22'"'"');\n"\necho "MySQL lab database ready!"\n' > /home/lab/scripts/setup-mysql.sh && \
    # PostgreSQL setup
    printf '#!/bin/bash\nsu - postgres -c "psql -c \\"CREATE USER lab WITH PASSWORD '"'"'Welcome1234!'"'"' SUPERUSER;\\" 2>/dev/null || true"\nsu - postgres -c "createdb -O lab labdb 2>/dev/null || true"\nsu - postgres -c "psql labdb -c \\"\nCREATE TABLE IF NOT EXISTS products (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100),\n  category VARCHAR(50),\n  price NUMERIC(10,2),\n  stock INT\n);\nINSERT INTO products (name, category, price, stock) VALUES\n  ('"'"'Laptop'"'"', '"'"'Electronics'"'"', 999.99, 50),\n  ('"'"'Keyboard'"'"', '"'"'Electronics'"'"', 79.99, 200),\n  ('"'"'Desk Chair'"'"', '"'"'Furniture'"'"', 299.99, 30),\n  ('"'"'Monitor'"'"', '"'"'Electronics'"'"', 449.99, 75),\n  ('"'"'Notebook'"'"', '"'"'Stationery'"'"', 12.99, 500)\nON CONFLICT DO NOTHING;\n\\""\necho "PostgreSQL lab database ready!"\n' > /home/lab/scripts/setup-postgres.sh && \
    chmod +x /home/lab/scripts/*.sh && \
    chown -R lab:lab /home/lab

# Supervisor config — start all 4 databases + ttyd + sshd
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n\n[program:mysql]\ncommand=/usr/sbin/mysqld --user=mysql\nautostart=true\nautorestart=true\npriority=20\nstdout_logfile=/var/log/mysql.log\nstderr_logfile=/var/log/mysql.err.log\n\n[program:postgresql]\ncommand=/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf\nuser=postgres\nautostart=true\nautorestart=true\npriority=20\nstdout_logfile=/var/log/pg.log\nstderr_logfile=/var/log/pg.err.log\n\n[program:mongodb]\ncommand=/usr/bin/mongod --bind_ip_all --dbpath /data/db\nuser=mongodb\nautostart=true\nautorestart=true\npriority=20\nstdout_logfile=/var/log/mongo.log\nstderr_logfile=/var/log/mongo.err.log\n\n[program:redis]\ncommand=/usr/bin/redis-server --bind 0.0.0.0 --protected-mode no\nautostart=true\nautorestart=true\npriority=20\nstdout_logfile=/var/log/redis.log\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 3306 5432 6379 7681 27017

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
