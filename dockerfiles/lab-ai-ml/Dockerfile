# lab-ai-ml — Python AI/ML lab with JupyterLab + TensorFlow + PyTorch + HuggingFace
# Runtime: normal runc | Per-seat: 2 vCPU / 4 GB (CPU), 4 vCPU / 16 GB (GPU)
# Build:  docker build --platform linux/amd64 -t getlabs/lab-ai-ml:1.0 .

FROM python:3.11-slim-bookworm
ENV DEBIAN_FRONTEND=noninteractive TZ=Asia/Kolkata LANG=C.UTF-8
ARG TTYD_VERSION=1.7.7

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget gnupg tzdata sudo \
      vim nano git unzip jq tmux htop procps \
      openssh-server supervisor \
      build-essential libffi-dev libssl-dev \
      # OpenCV dependencies
      libgl1-mesa-glx libglib2.0-0 && \
    ln -fs /usr/share/zoneinfo/${TZ} /etc/localtime && \
    rm -rf /var/lib/apt/lists/*

# Core ML/AI frameworks (CPU versions — use nvidia/cuda base for GPU)
RUN pip install --no-cache-dir \
      jupyterlab==4.2.4 \
      notebook==7.2.1 \
      # TensorFlow (CPU)
      tensorflow-cpu==2.17.0 \
      # PyTorch (CPU)
      torch==2.3.1+cpu torchvision==0.18.1+cpu torchaudio==2.3.1+cpu \
        --extra-index-url https://download.pytorch.org/whl/cpu \
      # HuggingFace
      transformers==4.43.3 \
      datasets==2.20.0 \
      tokenizers==0.19.1 \
      accelerate==0.33.0 \
      # Data science essentials
      pandas==2.2.2 \
      numpy==1.26.4 \
      scipy==1.14.0 \
      scikit-learn==1.5.1 \
      xgboost==2.1.0 \
      lightgbm==4.4.0 \
      # Visualization
      matplotlib==3.9.1 \
      seaborn==0.13.2 \
      plotly==5.23.0 \
      # Computer vision
      opencv-python-headless==4.10.0.84 \
      Pillow==10.4.0 \
      # NLP
      spacy==3.7.5 \
      nltk==3.8.1 \
      # Utilities
      tqdm \
      requests \
      flask

# Download small spaCy model for NLP labs
RUN python -m spacy download en_core_web_sm

# ttyd
RUN wget -q https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 \
      -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd

# Lab user
RUN useradd -m -s /bin/bash -G sudo lab && \
    echo 'lab:Welcome1234!' | chpasswd && \
    echo 'lab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/lab

RUN mkdir -p /var/run/sshd /home/lab/notebooks /home/lab/datasets && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    chown -R lab:lab /home/lab

# Sample notebook
RUN printf '{\n "cells": [\n  {"cell_type": "markdown", "metadata": {}, "source": ["# GetLabs AI/ML Workspace\\n","\\n","Welcome! All frameworks are pre-installed:\\n","- TensorFlow, PyTorch, HuggingFace Transformers\\n","- scikit-learn, XGBoost, LightGBM\\n","- pandas, numpy, matplotlib, seaborn\\n","- spaCy, NLTK, OpenCV"]},\n  {"cell_type": "code", "metadata": {}, "source": ["import tensorflow as tf\\nimport torch\\nimport transformers\\nimport sklearn\\nprint(f\\"TF: {tf.__version__}, PyTorch: {torch.__version__}, HF: {transformers.__version__}, sklearn: {sklearn.__version__}\\")"], "execution_count": null, "outputs": []}\n ],\n "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python", "version": "3.11.0"}},\n "nbformat": 4, "nbformat_minor": 4\n}\n' \
      > /home/lab/notebooks/welcome.ipynb && chown lab:lab /home/lab/notebooks/welcome.ipynb

# Supervisor — JupyterLab as primary interface + ttyd + SSH
RUN printf '[supervisord]\nnodaemon=true\nlogfile=/var/log/supervisord.log\n\n[program:jupyter]\ncommand=su - lab -c "jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --NotebookApp.token=\\\"\\\" --NotebookApp.password=\\\"\\\" --notebook-dir=/home/lab/notebooks"\nautostart=true\nautorestart=true\npriority=10\n\n[program:ttyd]\ncommand=/usr/local/bin/ttyd -p 7681 -W -t fontSize=14 login -f lab\nautostart=true\nautorestart=true\npriority=20\n\n[program:sshd]\ncommand=/usr/sbin/sshd -D -e\nautostart=true\nautorestart=true\npriority=30\n' \
      > /etc/supervisor/conf.d/lab.conf

EXPOSE 22 7681 8888
ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
