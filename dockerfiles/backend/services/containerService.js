const Docker = require('dockerode');
const Container = require('../models/container');
const Training = require('../models/training');
const User = require('../models/user');
const { logger } = require('../plugins/logger');
const { getDockerInstance, addContainerToHost, removeContainerFromHost, HOST_MODE } = require('./dockerHostManager');

// Build HTTPS domain-based access URL for a container record
function buildAccessUrl(container) {
  const accessDomain = process.env.CONTAINER_ACCESS_DOMAIN;
  const protocol = container.accessProtocol || 'http';
  const port = container.vncPort;
  if (accessDomain && protocol === 'https') {
    const sslPortOffset = parseInt(process.env.CONTAINER_SSL_PORT_OFFSET || '10000');
    return `https://${accessDomain}:${port + sslPortOffset}/`;
  } else if (accessDomain) {
    return `https://${accessDomain}/ws/${port}/`;
  }
  return `${protocol}://${container.hostIp}:${port}`;
}

// Fallback local Docker client (for stop/start/delete when host info is in container record)
const localDocker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

// Get Docker client for a specific container (looks up its host)
function getDockerForContainer(containerDoc) {
  if (containerDoc.dockerHostIp && containerDoc.dockerHostIp !== 'localhost') {
    return new Docker({ host: containerDoc.dockerHostIp, port: containerDoc.dockerHostPort || 2376 });
  }
  return localDocker;
}

// Available container images organized by category
// Desktop images use getlabs/desktop-lite:1.0 (Alpine + Openbox + Chromium, ~2.6GB)
// All desktops share one image to maximise cache hits and minimise disk/memory.
const CONTAINER_IMAGES = {
  // === Real OS Desktops — linuxserver/webtop (HTTP/3000, SUBFOLDER proxy) ===
  'ubuntu-desktop': {
    image: 'linuxserver/webtop:ubuntu-xfce', label: 'Ubuntu Desktop (XFCE)', os: 'Ubuntu',
    category: 'desktop', vncPort: 3000, protocol: 'http',
    env: ['PUID=1000', 'PGID=1000', 'TZ=Asia/Kolkata', 'TITLE=Ubuntu Desktop'], shmSize: '512m',
  },
  'redhat-desktop': {
    image: 'linuxserver/webtop:fedora-xfce', label: 'Red Hat / Fedora Desktop (XFCE)', os: 'RHEL / Fedora',
    category: 'desktop', vncPort: 3000, protocol: 'http',
    env: ['PUID=1000', 'PGID=1000', 'TZ=Asia/Kolkata', 'TITLE=RHEL Desktop'], shmSize: '512m',
  },
  'centos-desktop': {
    image: 'linuxserver/webtop:fedora-xfce', label: 'CentOS / Fedora Desktop (XFCE)', os: 'CentOS / Fedora',
    category: 'desktop', vncPort: 3000, protocol: 'http',
    env: ['PUID=1000', 'PGID=1000', 'TZ=Asia/Kolkata', 'TITLE=CentOS Desktop'], shmSize: '512m',
  },
  // === Real OS Desktops — KasmWeb (HTTPS/6901, SSL port proxy) ===
  'kali-desktop': {
    image: 'kasmweb/kali-rolling-desktop:1.16.0', label: 'Kali Linux Desktop', os: 'Kali Linux',
    category: 'desktop', vncPort: 6901, protocol: 'https', defaultUser: 'kasm_user',
    env: ['VNC_PW=password', 'VNCOPTIONS=-disableBasicAuth'], shmSize: '512m',
  },
  'oracle-desktop': {
    image: 'kasmweb/oracle-8-desktop:1.16.0', label: 'Oracle Linux 8 Desktop', os: 'Oracle Linux 8',
    category: 'desktop', vncPort: 6901, protocol: 'https', defaultUser: 'kasm_user',
    env: ['VNC_PW=password', 'VNCOPTIONS=-disableBasicAuth'], shmSize: '512m',
  },
  'alma-desktop': {
    image: 'kasmweb/almalinux-9-desktop:1.16.0', label: 'AlmaLinux 9 Desktop', os: 'AlmaLinux 9',
    category: 'desktop', vncPort: 6901, protocol: 'https', defaultUser: 'kasm_user',
    env: ['VNC_PW=password', 'VNCOPTIONS=-disableBasicAuth'], shmSize: '512m',
  },

  // === Dev Environments (HTTP) ===
  'code-server': {
    image: 'codercom/code-server:latest', label: 'VS Code Server (code-server)', os: 'VS Code Server',
    category: 'dev', vncPort: 8080, protocol: 'http',
    env: ['PASSWORD=password'],
  },
  'jupyter-scipy': {
    image: 'jupyter/scipy-notebook:latest', label: 'Jupyter Notebook (Python/Science)', os: 'Jupyter',
    category: 'dev', vncPort: 8888, protocol: 'http',
    env: ['JUPYTER_TOKEN=password'],
  },
  'jupyter-tensorflow': {
    image: 'jupyter/tensorflow-notebook:latest', label: 'Jupyter + TensorFlow', os: 'Jupyter + TF',
    category: 'dev', vncPort: 8888, protocol: 'http',
    env: ['JUPYTER_TOKEN=password'],
  },

  // === DevOps CI/CD Lab ===
  'devops-cicd': {
    image: 'getlabs/lab-devops-cicd:1.0',
    label: 'DevOps CI/CD — Jenkins, GitLab Runner, ArgoCD, Docker, K8s',
    os: 'Ubuntu 22.04', category: 'bigdata', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab', runtime: 'sysbox-runc',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '512m',
  },

  // === Terraform / IaC Lab ===
  'terraform-lab': {
    image: 'getlabs/lab-terraform:1.0',
    label: 'Terraform + AWS/Azure/GCP CLIs — Infrastructure as Code',
    os: 'Ubuntu 22.04', category: 'bigdata', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '256m',
  },

  // === ELK Stack Lab ===
  'elk-stack': {
    image: 'getlabs/lab-elk-stack:1.0',
    label: 'ELK Stack — Elasticsearch, Logstash, Kibana, Filebeat',
    os: 'Ubuntu 22.04', category: 'bigdata', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '512m',
  },

  // === AI/ML Lab ===
  'ai-ml-lab': {
    image: 'getlabs/lab-ai-ml:1.0',
    label: 'AI/ML Lab — TensorFlow, PyTorch, HuggingFace, JupyterLab',
    os: 'Python 3.11', category: 'bigdata', vncPort: 8888, protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '512m',
  },

  // === Ansible Lab ===
  'ansible-lab': {
    image: 'getlabs/lab-ansible:1.0',
    label: 'Ansible Lab — Controller + 3 managed nodes (RHCE/EX294)',
    os: 'Ubuntu 22.04', category: 'bigdata', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab', runtime: 'sysbox-runc',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '256m',
  },

  // === Monitoring Lab ===
  'monitoring-lab': {
    image: 'getlabs/lab-monitoring:1.0',
    label: 'Monitoring Lab — Prometheus, Grafana, Alertmanager',
    os: 'Ubuntu 22.04', category: 'bigdata', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '256m',
  },

  // === Full-Stack Web Dev Lab ===
  'fullstack-lab': {
    image: 'getlabs/lab-fullstack:1.0',
    label: 'Full-Stack Lab — Node.js, React, Angular, MongoDB, Redis',
    os: 'Ubuntu 22.04', category: 'dev', vncPort: 7681, protocol: 'http',
    defaultUser: 'lab',
    env: ['LAB_PASSWORD=Welcome1234!'], shmSize: '256m',
  },

  // === Big Data / Streaming Labs ===
  // Single self-contained image with Kafka 3.7 (KRaft) + Spark 3.5 + MySQL 8 +
  // optional Cassandra 4.1 + JDK 17 + Python 3.10. Browser terminal via ttyd
  // on port 7681. See dockerfiles/lab-bigdata-workspace/ for Dockerfile, README,
  // and push.sh helper. The :1.0 tag is immutable — pin to it so an image
  // rebuild doesn't change behavior for in-progress training batches.
  // To use a different registry, change the prefix and run `dockerfiles/
  // lab-bigdata-workspace/push.sh` after re-tagging.
  // === Docker / Kubernetes Labs (Sysbox runtime — nested Docker/K8s) ===
  // These images run with sysbox-runc instead of default runc, which lets
  // students run Docker daemon, docker-compose, kind, k3s, kubeadm INSIDE
  // their container without --privileged. Requires sysbox installed on the
  // host: https://github.com/nestybox/sysbox
  //
  // Install on host (one-time):
  //   wget https://downloads.nestybox.com/sysbox/releases/v0.6.4/sysbox-ce_0.6.4-0.linux_amd64.deb
  //   sudo dpkg -i sysbox-ce_0.6.4-0.linux_amd64.deb
  //   sudo systemctl restart docker
  'docker-k8s-lab': {
    image: 'getlabs/lab-docker-k8s:1.0',
    label: 'Docker + Kubernetes Lab (nested containers)',
    os: 'Ubuntu 22.04',
    category: 'bigdata',
    vncPort: 7681,
    protocol: 'http',
    defaultUser: 'lab',
    runtime: 'sysbox-runc',    // <-- key: tells createContainer() to use sysbox
    env: [
      'ENABLE_SSH=true',
      'LAB_PASSWORD=Welcome1234!',
    ],
    shmSize: '512m',
  },
  'docker-lab-basic': {
    image: 'nestybox/ubuntu-jammy-systemd-docker:latest',
    label: 'Docker Lab — Lightweight (pre-built Sysbox image)',
    os: 'Ubuntu 22.04',
    category: 'bigdata',
    vncPort: 22,               // SSH only, no GUI
    protocol: 'ssh',
    defaultUser: 'root',
    runtime: 'sysbox-runc',
    env: [],
    shmSize: '256m',
  },

  // === Big Data / Streaming Labs ===
  'bigdata-workspace': {
    image: 'getlabs/lab-bigdata-workspace:1.0',
    label: 'Big Data Lab — Kafka, Spark, MySQL, JDK17, Python 3.10',
    os: 'Ubuntu 22.04',
    category: 'bigdata',
    vncPort: 7681,         // ttyd browser terminal
    protocol: 'http',
    defaultUser: 'lab',
    env: [
      'ENABLE_KAFKA=true',
      'ENABLE_SPARK=true',
      'ENABLE_CASSANDRA=false',
      'ENABLE_SSH=false',
      'ENABLE_JUPYTER=false',
      'LAB_PASSWORD=Welcome1234!',
    ],
    shmSize: '1gb',
  },
  'bigdata-workspace-cassandra': {
    image: 'getlabs/lab-bigdata-workspace:1.0',
    label: 'Big Data Lab — with Cassandra (heavier)',
    os: 'Ubuntu 22.04',
    category: 'bigdata',
    vncPort: 7681,
    protocol: 'http',
    defaultUser: 'lab',
    env: [
      'ENABLE_KAFKA=true',
      'ENABLE_SPARK=true',
      'ENABLE_CASSANDRA=true',
      'ENABLE_SSH=false',
      'ENABLE_JUPYTER=true',
      'LAB_PASSWORD=Welcome1234!',
    ],
    shmSize: '1gb',
  },
};

// Port allocation range for containers
let nextPort = parseInt(process.env.CONTAINER_PORT_START || '10000');
const MAX_PORT = parseInt(process.env.CONTAINER_PORT_END || '11000');

async function getNextAvailablePort() {
  // Collect ports from DB (both alive and dead — Docker may still hold them)
  const usedVncPorts = await Container.distinct('vncPort');
  const usedSshPorts = await Container.distinct('sshPort');
  const usedSet = new Set([...usedVncPorts, ...usedSshPorts]);

  // Also check Docker directly for host port bindings (catches orphan containers not in DB)
  try {
    const allContainers = await docker.listContainers({ all: true });
    for (const c of allContainers) {
      if (c.Ports) {
        for (const p of c.Ports) {
          if (p.PublicPort) usedSet.add(p.PublicPort);
        }
      }
    }
  } catch (err) {
    logger.warn(`Could not list Docker ports for collision check: ${err.message}`);
  }

  for (let port = nextPort; port < MAX_PORT; port++) {
    const sshPort = port + 5000;
    // Both the VNC port and SSH port must be free
    if (!usedSet.has(port) && !usedSet.has(sshPort)) return port;
  }
  // Wrap around — only reuse ports from deleted containers
  const deadPorts = await Container.distinct('vncPort', { isAlive: false });
  if (deadPorts.length) return deadPorts[0];
  return nextPort;
}

/**
 * Create a Docker container with Ubuntu GUI.
 * Uses auto-scaling Docker host pool when DOCKER_HOST_MODE=auto.
 */
async function createContainer({
  name, trainingName, organization, email, imageKey,
  cpus = 2, memory = 2048, allocatedHours = 100,
  rate = 5, azureEquivalentRate = 25, password = 'Welcome1234!',
  guacamole = false, expiresAt = null
}) {
  const imageConfig = CONTAINER_IMAGES[imageKey] || CONTAINER_IMAGES['ubuntu-xfce'];

  // Get Docker instance — auto-scales if needed
  const { docker: dockerClient, host: dockerHost } = await getDockerInstance(memory);
  const docker = dockerClient;
  if (!imageConfig || !imageConfig.image) {
    throw new Error(`Unknown container image key: "${imageKey}". Available: ${Object.keys(CONTAINER_IMAGES).join(', ')}`);
  }

  const vncPort = await getNextAvailablePort();
  const sshPort = vncPort + 5000; // SSH on offset port

  logger.info(`Creating container ${name} from ${imageConfig.image} on port ${vncPort}`);

  // Pull image if not present — auto-pulls from registry on first use
  try {
    await docker.getImage(imageConfig.image).inspect();
  } catch {
    logger.info(`Image ${imageConfig.image} not cached — pulling from registry...`);
    try {
      await new Promise((resolve, reject) => {
        docker.pull(imageConfig.image, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
      });
      logger.info(`Image ${imageConfig.image} pulled successfully`);
    } catch (pullErr) {
      throw new Error(`Failed to pull image "${imageConfig.image}": ${pullErr.message}. For custom getlabs/* images, build them first with: cd dockerfiles/${imageKey} && docker build -t ${imageConfig.image} .`);
    }
  }

  // Build env vars — merge image defaults with password override
  const envVars = [
    ...(imageConfig.env || []).map(e => {
      // Replace password placeholders with actual password
      if (e.includes('VNC_PW=')) return `VNC_PW=${password}`;
      if (e.includes('PASSWORD=')) return `PASSWORD=${password}`;
      if (e.includes('JUPYTER_TOKEN=')) return `JUPYTER_TOKEN=${password}`;
      return e;
    }),
    `RESOLUTION=1920x1080`,
    // Desktop containers need SUBFOLDER for reverse proxy subpath routing
    ...(imageConfig.vncPort === 3000 ? [`SUBFOLDER=/ws/${vncPort}/`] : []),
  ];

  // Parse shm_size
  const shmSizeBytes = imageConfig.shmSize
    ? (imageConfig.shmSize.includes('gb') ? parseInt(imageConfig.shmSize) * 1073741824 : parseInt(imageConfig.shmSize) * 1048576)
    : 536870912; // default 512MB

  // Build HostConfig — sysbox containers need different security settings
  const isSysbox = imageConfig.runtime === 'sysbox-runc';
  const hostConfig = {
    PortBindings: {
      // Bind to 127.0.0.1 on local host so ports are only reachable via Nginx proxy (HTTPS domain).
      // On remote Docker hosts, bind to 0.0.0.0 so the main Nginx can proxy to them.
      [`${imageConfig.vncPort}/tcp`]: [{ HostIp: dockerHost ? '0.0.0.0' : '127.0.0.1', HostPort: String(vncPort) }],
      '22/tcp': [{ HostIp: dockerHost ? '0.0.0.0' : '127.0.0.1', HostPort: String(sshPort) }],
    },
    Memory: memory * 1024 * 1024,
    NanoCpus: cpus * 1e9,
    ShmSize: shmSizeBytes,
    RestartPolicy: { Name: 'unless-stopped' },
  };

  if (isSysbox) {
    // Sysbox provides its own security isolation — don't set SecurityOpt
    // or it conflicts. The runtime flag tells Docker to use sysbox-runc.
    hostConfig.Runtime = 'sysbox-runc';
  } else {
    hostConfig.SecurityOpt = ['seccomp=unconfined']; // needed for some desktop images
  }

  // Create container
  const container = await docker.createContainer({
    Image: imageConfig.image,
    name: `lab-${name}`,
    Hostname: name,
    Env: envVars,
    ExposedPorts: {
      [`${imageConfig.vncPort}/tcp`]: {},
      '22/tcp': {},
    },
    HostConfig: hostConfig,
  });

  // Start it
  await container.start();
  const info = await container.inspect();
  const hostIp = process.env.CONTAINER_HOST_IP || 'localhost';
  const accessProtocol = imageConfig.protocol || 'http';
  const actualUsername = imageConfig.defaultUser || 'labuser';

  // Build access URL — always route through HTTPS domain proxy when available
  const accessDomain = process.env.CONTAINER_ACCESS_DOMAIN;
  const sslPortOffset = parseInt(process.env.CONTAINER_SSL_PORT_OFFSET || '10000');
  let accessUrl;
  if (accessDomain && accessProtocol === 'https') {
    // HTTPS containers (KasmWeb single apps) — Nginx SSL proxy on offset port
    accessUrl = `https://${accessDomain}:${vncPort + sslPortOffset}/`;
  } else if (accessDomain) {
    // All HTTP containers (Selkies Webtop, ttyd, etc.) — proxy through Nginx /ws/ path
    accessUrl = `https://${accessDomain}/ws/${vncPort}/`;
  } else {
    // Fallback only when no domain configured (local dev)
    accessUrl = `${accessProtocol}://${hostIp}:${vncPort}`;
  }

  // Save to DB — include Docker host info for remote access
  const containerDoc = new Container({
    name,
    containerId: info.Id,
    trainingName,
    email,
    organization,
    image: imageConfig.image,
    os: imageConfig.os,
    cpus,
    memory,
    vncPort,
    sshPort,
    password,
    username: actualUsername,
    hostIp,
    isRunning: true,
    isAlive: true,
    logs: [{ start: new Date() }],
    rate,
    azureEquivalentRate,
    quota: { total: allocatedHours, consumed: 0 },
    accessProtocol,
    type: 'container',
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    dockerHostId: dockerHost?._id || null,
    dockerHostIp: dockerHost?.publicIp || 'localhost',
    dockerHostPort: dockerHost?.dockerPort || 2376,
  });
  await containerDoc.save();

  // Update Docker host counters
  if (dockerHost) {
    await addContainerToHost(dockerHost._id, info.Id, name, memory);
  }

  // Update training mapping
  const existing = await Training.findOne({ name: trainingName, organization });
  if (existing) {
    existing.vmUserMapping.push({ vmName: name, userEmail: email });
    await existing.save();
  } else {
    await Training.create({
      name: trainingName,
      organization,
      vmUserMapping: [{ vmName: name, userEmail: email }],
      schedules: [],
    });
  }

  // Create user if needed
  const userExists = await User.findOne({ email });
  if (!userExists) {
    const newUser = new User({
      organization, email, name: email,
      password: 'Welcome1234!', userType: 'user', trainingName,
    });
    await newUser.save();
  }

  logger.info(`Container ${name} created: ${info.Id.slice(0, 12)} on port ${vncPort}`);

  return {
    name,
    containerId: info.Id,
    vncPort,
    sshPort,
    hostIp,
    accessUrl,
    username: actualUsername,
    password,
  };
}

/**
 * Stop a container.
 */
async function stopContainer(containerId) {
  let doc = await Container.findOne({ containerId });
  const dockerClient = doc ? getDockerForContainer(doc) : localDocker;
  const container = dockerClient.getContainer(containerId);
  await container.stop();

  doc = await Container.findOne({ containerId });
  if (doc) {
    doc.isRunning = false;
    // Update last log entry
    const lastLog = doc.logs[doc.logs.length - 1];
    if (lastLog && !lastLog.stop) {
      lastLog.stop = new Date();
      lastLog.duration = Math.floor((lastLog.stop - lastLog.start) / 1000);
      doc.duration = (doc.duration || 0) + lastLog.duration;
      doc.quota.consumed = Math.round((doc.duration / 3600) * 100) / 100;
    }
    await doc.save();
  }
  logger.info(`Container ${containerId.slice(0, 12)} stopped`);
}

/**
 * Start a stopped container.
 */
async function startContainer(containerId) {
  let doc = await Container.findOne({ containerId });
  const dockerClient = doc ? getDockerForContainer(doc) : localDocker;
  const container = dockerClient.getContainer(containerId);
  await container.start();

  doc = await Container.findOne({ containerId });
  if (doc) {
    doc.isRunning = true;
    doc.logs.push({ start: new Date() });
    await doc.save();
  }
  logger.info(`Container ${containerId.slice(0, 12)} started`);
}

/**
 * Delete a container permanently.
 */
async function deleteContainer(containerId) {
  const doc = await Container.findOne({ containerId });
  const dockerClient = doc ? getDockerForContainer(doc) : localDocker;

  try {
    const container = dockerClient.getContainer(containerId);
    try { await container.stop(); } catch {} // may already be stopped
    await container.remove({ force: true });
  } catch (err) {
    logger.error(`Docker remove error: ${err.message}`);
  }

  // Update Docker host counters
  if (doc?.dockerHostId) {
    await removeContainerFromHost(doc.dockerHostId, containerId, doc.memory || 2048);
  }
  if (doc) {
    doc.isAlive = false;
    doc.isRunning = false;
    doc.remarks = 'Deleted';
    await doc.save();
  }
  logger.info(`Container ${containerId.slice(0, 12)} deleted`);
}

/**
 * Get all containers for a training.
 */
async function getContainers(trainingName, organization) {
  return Container.find({ trainingName, ...(organization ? { organization } : {}) });
}

/**
 * Get available container images.
 */
function getAvailableImages() {
  return Object.entries(CONTAINER_IMAGES).map(([key, val]) => ({
    key,
    label: val.label,
    os: val.os,
    image: val.image,
    category: val.category || 'desktop',
  }));
}

/**
 * Cost comparison: container vs Azure VM.
 * Uses live Azure pricing + live exchange rate.
 */
async function getCostComparison(cpus, memoryMB) {
  let azureRate = 4.9; // fallback

  try {
    const { getVmPriceInr } = require('./azurePricing');
    // Map container resources to equivalent Azure VM
    let vmSize = 'Standard_B2s';
    if (cpus >= 4) vmSize = 'Standard_D4s_v3';
    else if (cpus >= 2 && memoryMB >= 8192) vmSize = 'Standard_D4s_v3';

    const price = await getVmPriceInr(vmSize, 'southindia', 'linux');
    azureRate = price.spot || price.onDemand || azureRate;
  } catch {}

  // Container infra cost: shared host, ~8-15 containers per Spot VM
  const containerRate = Math.max(0.5, Math.round(azureRate / 8 * 100) / 100);
  const savings = Math.round((azureRate - containerRate) * 100) / 100;
  const savingsPercent = azureRate > 0 ? Math.round((savings / azureRate) * 100) : 0;

  let exchangeRate = 85;
  try { exchangeRate = await require('./exchangeRate').getUsdToInr(); } catch {}

  return {
    azureRate,
    containerRate,
    savings,
    savingsPercent,
    monthlySavingsPerVm: Math.round(savings * 720),
    exchangeRate,
    priceSource: 'Azure Retail API + live USD/INR',
  };
}

/**
 * Pre-pull an image so it's cached before the first student deploys.
 * Returns { pulled: true, image, durationMs } or { pulled: false, error }.
 * If the image is already cached, returns immediately.
 */
async function prePullImage(imageKey) {
  const imageConfig = CONTAINER_IMAGES[imageKey];
  if (!imageConfig) return { pulled: false, error: `Unknown image key: ${imageKey}` };

  const imageName = imageConfig.image;
  const start = Date.now();

  // Check if already cached
  try {
    await docker.getImage(imageName).inspect();
    return { pulled: true, image: imageName, cached: true, durationMs: Date.now() - start };
  } catch {
    // Not cached — pull it
  }

  try {
    logger.info(`[pre-pull] Pulling ${imageName}...`);
    await new Promise((resolve, reject) => {
      docker.pull(imageName, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
      });
    });
    const durationMs = Date.now() - start;
    logger.info(`[pre-pull] ${imageName} pulled in ${Math.round(durationMs / 1000)}s`);
    return { pulled: true, image: imageName, cached: false, durationMs };
  } catch (err) {
    logger.error(`[pre-pull] Failed to pull ${imageName}: ${err.message}`);
    return { pulled: false, image: imageName, error: err.message };
  }
}

module.exports = {
  createContainer,
  stopContainer,
  startContainer,
  deleteContainer,
  getContainers,
  getAvailableImages,
  getCostComparison,
  prePullImage,
  CONTAINER_IMAGES,
  buildAccessUrl,
};
