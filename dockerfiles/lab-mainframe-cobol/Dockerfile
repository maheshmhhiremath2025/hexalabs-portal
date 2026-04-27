# lab-mainframe-cobol — VS Code Server + GnuCOBOL + gdb for mainframe modernization labs
# Day 3 develop / modify / debug COBOL coverage without a Micro Focus license.
# Build:  docker build --platform linux/amd64 -t getlabs/lab-mainframe-cobol:1.0 .
# Run:    docker run -d -p 8080:8080 -e PASSWORD=test123 getlabs/lab-mainframe-cobol:1.0

FROM codercom/code-server:latest

USER root

# System tools + GnuCOBOL compiler/runtime + gdb
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg sudo \
      vim nano git unzip jq htop procps tmux less tree \
      openssh-client iproute2 iputils-ping net-tools \
      python3 python3-pip \
      build-essential gdb make \
      gnucobol libcob4 libcob4-dev \
      libdb-dev libncurses5-dev libxml2-dev libgmp-dev && \
    rm -rf /var/lib/apt/lists/*

# Pre-install COBOL extensions for faster first-launch UX
RUN code-server --install-extension bitlang.cobol && \
    code-server --install-extension rechinformatica.rech-editor-cobol && \
    code-server --install-extension OlegKunitsyn.gnucobol-debug || true

# Sudo for the default coder user
RUN echo 'coder ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/coder

# Workspace + sample programs
RUN mkdir -p /home/coder/workspace/cobol-samples && \
    chown -R coder:coder /home/coder/workspace

COPY --chown=coder:coder samples/ /home/coder/workspace/cobol-samples/

USER coder
WORKDIR /home/coder/workspace

ENV SHELL=/bin/bash

# code-server listens on 8080
EXPOSE 8080
