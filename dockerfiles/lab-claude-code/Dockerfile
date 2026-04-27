# lab-claude-code — VS Code Server (code-server) + Claude Code CLI
# Browser-based VS Code with AI-powered coding via Claude
# Build:  docker build --platform linux/amd64 -t getlabs/lab-claude-code:1.0 .
# Run:    docker run -d -p 8080:8080 -e PASSWORD=test123 -e ANTHROPIC_API_KEY=sk-... getlabs/lab-claude-code:1.0

FROM codercom/code-server:latest

USER root

# System tools + Node.js 22 (required for Claude Code CLI)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg sudo \
      vim nano git unzip jq htop procps \
      openssh-client iproute2 iputils-ping net-tools \
      python3 python3-pip python3-venv \
      build-essential && \
    # Node.js 22 (Claude Code requires Node 18+)
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI (npm global install)
RUN npm install -g @anthropic-ai/claude-code

# Common VS Code extensions (pre-installed for faster startup)
RUN code-server --install-extension ms-python.python && \
    code-server --install-extension esbenp.prettier-vscode && \
    code-server --install-extension dbaeumer.vscode-eslint && \
    code-server --install-extension bradlc.vscode-tailwindcss || true

# Lab user setup — give the default coder user sudo access
RUN echo 'coder ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/coder

# Workspace directory
RUN mkdir -p /home/coder/workspace && chown -R coder:coder /home/coder/workspace

USER coder
WORKDIR /home/coder/workspace

# Default environment
ENV SHELL=/bin/bash

# code-server runs on 8080 by default
EXPOSE 8080
