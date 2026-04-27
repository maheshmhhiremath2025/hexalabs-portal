# =============================================================================
# lab-linux-admin
#
# Linux administration training lab for RHCSA/LFCS prep. Includes systemd
# services, user/group management, LVM, firewall, networking, cron, SELinux
# basics, and common sysadmin tools.
# Browser terminal via ttyd on port 7681.
#
# Build:  docker build --platform linux/amd64 -t kumar202699/lab-linux-admin:1.0 .
# Run:    docker run -d --name lab-linux -p 7681:7681 -p 2222:22 kumar202699/lab-linux-admin:1.0
# =============================================================================

FROM ubuntu:22.04

ARG TTYD_VERSION=1.7.7

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Kolkata \
    LANG=C.UTF-8

# Base packages + sysadmin tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg lsb-release tzdata sudo \
      vim nano less git unzip jq tmux htop procps \
      openssh-server supervisor \
      # Networking tools
      iproute2 iputils-ping dnsutils net-tools traceroute nmap \
      iptables nftables tcpdump whois mtr-tiny \
      # System admin tools
      cron at logrotate rsyslog \
      acl attr quota \
      lvm2 parted gdisk e2fsprogs xfsprogs dosfstools \
      # Process & performance
      strace ltrace sysstat iotop lsof \
      # Compression / archiving
      tar gzip bzip2 xz-utils zip p7zip-full \
      # Text processing
      gawk \
      # User management / auth
      passwd adduser libpam-modules \
      # Package management practice
      apt-utils dpkg-dev \
      # Misc sysadmin
      tree file bc dc man-db manpages \
      bash-completion locate mlocate \
      rsync openssh-client \
      # Web server (for service management practice)
      nginx \
      # Python for scripting
      python3 python3-pip && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user (primary)
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

# Practice users for user/group management exercises
RUN groupadd developers && \
    groupadd operations && \
    groupadd dbadmins && \
    useradd -m -s /bin/bash -G developers alice && echo 'alice:Pass1234!' | chpasswd && \
    useradd -m -s /bin/bash -G developers bob && echo 'bob:Pass1234!' | chpasswd && \
    useradd -m -s /bin/bash -G operations charlie && echo 'charlie:Pass1234!' | chpasswd && \
    useradd -m -s /bin/bash -G dbadmins diana && echo 'diana:Pass1234!' | chpasswd

# SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# Create practice directories and files for exercises
RUN mkdir -p /home/lab/exercises /home/lab/scripts /var/log/practice && \
    # Exercise: file permissions
    mkdir -p /home/lab/exercises/permissions && \
    touch /home/lab/exercises/permissions/{public.txt,private.txt,shared.txt,script.sh} && \
    echo "This file should be readable by everyone" > /home/lab/exercises/permissions/public.txt && \
    echo "This file should be readable only by owner" > /home/lab/exercises/permissions/private.txt && \
    echo "This file should be readable by group 'developers'" > /home/lab/exercises/permissions/shared.txt && \
    printf '#!/bin/bash\necho "Hello from script!"\ndate\nwhoami\n' > /home/lab/exercises/permissions/script.sh && \
    # Exercise: log analysis
    mkdir -p /home/lab/exercises/logs && \
    printf 'Jan 15 10:23:45 server sshd[1234]: Accepted password for alice from 192.168.1.100 port 52341\nJan 15 10:25:12 server sshd[1235]: Failed password for bob from 10.0.0.50 port 43210\nJan 15 11:00:00 server CRON[1300]: (root) CMD (/usr/local/bin/backup.sh)\nJan 15 11:05:33 server sshd[1400]: Failed password for invalid user admin from 203.0.113.5 port 55555\nJan 15 11:05:35 server sshd[1400]: Failed password for invalid user admin from 203.0.113.5 port 55555\nJan 15 11:05:37 server sshd[1400]: Failed password for invalid user root from 203.0.113.5 port 55556\nJan 15 12:00:00 server CRON[1500]: (lab) CMD (/home/lab/scripts/check-disk.sh)\nJan 15 14:30:22 server sshd[1600]: Accepted publickey for charlie from 172.16.0.10 port 60001\nJan 15 15:45:00 server nginx[800]: 192.168.1.50 - - "GET /index.html HTTP/1.1" 200 612\nJan 15 15:45:01 server nginx[800]: 10.0.0.99 - - "GET /admin HTTP/1.1" 403 162\n' > /home/lab/exercises/logs/sample-auth.log && \
    # Exercise: shell scripting
    mkdir -p /home/lab/exercises/scripting && \
    printf '#!/bin/bash\n# Exercise 1: Write a script that:\n# 1. Takes a directory path as argument\n# 2. Lists all files larger than 1MB\n# 3. Outputs: filename, size, last modified date\n# 4. Sorts by size (largest first)\n\necho "TODO: Implement this script"\n' > /home/lab/exercises/scripting/ex1-large-files.sh && \
    printf '#!/bin/bash\n# Exercise 2: Write a script that:\n# 1. Reads the sample auth log\n# 2. Counts failed login attempts per IP\n# 3. Flags IPs with more than 3 failures\n# 4. Outputs a summary report\n\necho "TODO: Implement this script"\n' > /home/lab/exercises/scripting/ex2-log-analyzer.sh && \
    printf '#!/bin/bash\n# Exercise 3: Write a backup script that:\n# 1. Creates a tar.gz of /home/lab/exercises\n# 2. Names it backup-YYYY-MM-DD.tar.gz\n# 3. Stores in /home/lab/backups/\n# 4. Keeps only last 5 backups (delete older ones)\n\necho "TODO: Implement this script"\n' > /home/lab/exercises/scripting/ex3-backup.sh && \
    chmod +x /home/lab/exercises/scripting/*.sh && \
    # Cron exercise
    mkdir -p /home/lab/exercises/cron && \
    printf '# Cron Exercises\n#\n# 1. Schedule a job to run /home/lab/scripts/check-disk.sh every 5 minutes\n# 2. Create a job that backs up /home/lab/exercises daily at 2 AM\n# 3. Set up log rotation for /var/log/practice/*.log\n# 4. Create an at job that runs 10 minutes from now\n#\n# Hints:\n#   crontab -e          # Edit your crontab\n#   crontab -l          # List current crontab\n#   sudo at now + 10 minutes\n#   man 5 crontab       # Crontab syntax reference\n' > /home/lab/exercises/cron/README.txt && \
    # Networking exercise
    mkdir -p /home/lab/exercises/networking && \
    printf '# Networking Exercises\n#\n# 1. Display all network interfaces and their IP addresses (ip addr)\n# 2. Check which ports are listening (ss -tlnp)\n# 3. Trace the route to google.com (traceroute)\n# 4. Scan localhost for open ports (nmap localhost)\n# 5. Capture 10 packets on any interface (sudo tcpdump -c 10)\n# 6. Look up DNS records for google.com (dig, nslookup)\n# 7. Check the routing table (ip route)\n' > /home/lab/exercises/networking/README.txt && \
    # Update mlocate database
    updatedb 2>/dev/null || true && \
    chown -R lab:lab /home/lab

# Disable nginx autostart (students will manage it as an exercise)
RUN rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Supervisor config
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=10\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=10\n\n[program:cron]\ncommand=/usr/sbin/cron -f\nautostart=true\nautorestart=true\npriority=10\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 80 7681

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
