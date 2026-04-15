const k8s = require('@kubernetes/client-node');
const Container = require('../models/container');
const Training = require('../models/training');
const User = require('../models/user');
const { logger } = require('../plugins/logger');

const NAMESPACE = process.env.K8S_NAMESPACE || 'lab-containers';
const LABS_DOMAIN = process.env.LABS_DOMAIN || 'labs.getlabs.cloud';

// K8s client setup
const kc = new k8s.KubeConfig();
if (process.env.K8S_IN_CLUSTER === 'true') {
  kc.loadFromCluster(); // When running inside AKS
} else {
  kc.loadFromDefault(); // Uses ~/.kube/config locally
}
const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const networkApi = kc.makeApiClient(k8s.NetworkingV1Api);

// Image catalog (same as containerService but with K8s resource defaults)
const K8S_IMAGES = {
  'ubuntu-xfce': { image: 'linuxserver/webtop:ubuntu-xfce', port: 3000, label: 'Ubuntu Desktop (XFCE)', os: 'Ubuntu', category: 'desktop', requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
  'ubuntu-kde': { image: 'linuxserver/webtop:ubuntu-kde', port: 3000, label: 'Ubuntu Desktop (KDE)', os: 'Ubuntu', category: 'desktop', requests: { cpu: '500m', memory: '2Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
  'alpine-xfce': { image: 'linuxserver/webtop:alpine-xfce', port: 3000, label: 'Alpine Desktop (Ultra Light)', os: 'Alpine', category: 'desktop', requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '1000m', memory: '2Gi' } },
  'kali-desktop': { image: 'kasmweb/kali-rolling-desktop:1.16.0', port: 6901, label: 'Kali Linux Desktop', os: 'Kali', category: 'security', requests: { cpu: '500m', memory: '2Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
  'vscode': { image: 'codercom/code-server:latest', port: 8080, label: 'VS Code Server', os: 'VS Code', category: 'dev', requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '1000m', memory: '2Gi' } },
  'jupyter': { image: 'jupyter/scipy-notebook:latest', port: 8888, label: 'Jupyter Notebook', os: 'Jupyter', category: 'dev', requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2000m', memory: '4Gi' } },
};

// Resource presets: what we offer vs what K8s actually allocates
const RESOURCE_PRESETS = {
  'small':  { requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '1000m', memory: '2Gi' }, label: '1 CPU / 2 GB' },
  'medium': { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '2000m', memory: '4Gi' }, label: '2 CPU / 4 GB' },
  'large':  { requests: { cpu: '1000m', memory: '2Gi' }, limits: { cpu: '4000m', memory: '8Gi' }, label: '4 CPU / 8 GB' },
};

/**
 * Create a lab pod + service + ingress rule in K8s.
 */
async function createK8sLab({ name, trainingName, organization, email, imageKey = 'ubuntu-xfce', preset = 'medium', allocatedHours = 100, rate = 4, azureEquivalentRate = 25, password = 'Welcome1234!' }) {
  const imageConfig = K8S_IMAGES[imageKey] || K8S_IMAGES['ubuntu-xfce'];
  const resources = RESOURCE_PRESETS[preset] || RESOURCE_PRESETS['medium'];
  const podName = `lab-${name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const svcName = `${podName}-svc`;
  const hostname = `${podName}.${LABS_DOMAIN}`; // e.g. lab-training1-c1.labs.getlabs.cloud

  logger.info(`Creating K8s lab ${podName} (${imageConfig.image}) for ${email}`);

  // 1. Create Pod
  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: {
        app: 'lab-desktop',
        'lab-name': podName,
        training: trainingName,
        organization: organization,
      },
    },
    spec: {
      nodeSelector: { 'kubernetes.azure.com/scalesetpriority': 'spot' },
      tolerations: [{
        key: 'kubernetes.azure.com/scalesetpriority',
        operator: 'Equal',
        value: 'spot',
        effect: 'NoSchedule',
      }],
      containers: [{
        name: 'desktop',
        image: imageConfig.image,
        ports: [{ containerPort: imageConfig.port, name: 'vnc' }],
        env: [
          { name: 'PUID', value: '1000' },
          { name: 'PGID', value: '1000' },
          { name: 'TZ', value: 'Asia/Kolkata' },
          { name: 'VNC_PW', value: password },
          { name: 'PASSWORD', value: password },
        ],
        resources: {
          requests: resources.requests,
          limits: resources.limits,
        },
        volumeMounts: [{ name: 'shm', mountPath: '/dev/shm' }],
        readinessProbe: { httpGet: { path: '/', port: imageConfig.port }, initialDelaySeconds: 10, periodSeconds: 5 },
      }],
      volumes: [{ name: 'shm', emptyDir: { medium: 'Memory', sizeLimit: '1Gi' } }],
      restartPolicy: 'Always',
      terminationGracePeriodSeconds: 10,
    },
  };

  await coreApi.createNamespacedPod({ namespace: NAMESPACE, body: pod });

  // 2. Create Service
  const svc = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: svcName, namespace: NAMESPACE, labels: { app: 'lab-desktop', 'lab-name': podName } },
    spec: {
      type: 'ClusterIP',
      selector: { 'lab-name': podName },
      ports: [{ port: 80, targetPort: imageConfig.port, name: 'vnc' }],
    },
  };

  await coreApi.createNamespacedService({ namespace: NAMESPACE, body: svc });

  // 3. Create/Update Ingress rule
  try {
    const ingress = await networkApi.readNamespacedIngress({ name: 'lab-ingress', namespace: NAMESPACE });
    const rules = ingress.spec.rules || [];
    rules.push({
      host: hostname,
      http: {
        paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: svcName, port: { number: 80 } } },
        }],
      },
    });
    ingress.spec.rules = rules;
    await networkApi.replaceNamespacedIngress({ name: 'lab-ingress', namespace: NAMESPACE, body: ingress });
  } catch {
    // Ingress doesn't exist yet — create it
    const ingress = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'lab-ingress',
        namespace: NAMESPACE,
        annotations: {
          'nginx.ingress.kubernetes.io/proxy-read-timeout': '3600',
          'nginx.ingress.kubernetes.io/proxy-send-timeout': '3600',
          'nginx.ingress.kubernetes.io/proxy-http-version': '1.1',
          'nginx.ingress.kubernetes.io/configuration-snippet': 'proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";',
        },
      },
      spec: {
        ingressClassName: 'nginx',
        rules: [{
          host: hostname,
          http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: svcName, port: { number: 80 } } } }] },
        }],
      },
    };
    await networkApi.createNamespacedIngress({ namespace: NAMESPACE, body: ingress });
  }

  // 4. Save to MongoDB
  const containerDoc = new Container({
    name,
    containerId: podName, // K8s pod name as ID
    trainingName,
    email,
    organization,
    image: imageConfig.image,
    os: imageConfig.os,
    cpus: parseInt(resources.limits.cpu) / 1000 || 2,
    memory: parseInt(resources.limits.memory) || 4096,
    vncPort: 443, // HTTPS via ingress
    hostIp: hostname,
    password,
    username: 'labuser',
    isRunning: true,
    isAlive: true,
    logs: [{ start: new Date() }],
    rate,
    azureEquivalentRate,
    quota: { total: allocatedHours, consumed: 0 },
    type: 'container',
  });
  await containerDoc.save();

  // 5. Update training
  const existing = await Training.findOne({ name: trainingName, organization });
  if (existing) {
    existing.vmUserMapping.push({ vmName: name, userEmail: email });
    await existing.save();
  } else {
    await Training.create({ name: trainingName, organization, vmUserMapping: [{ vmName: name, userEmail: email }], schedules: [] });
  }

  // 6. Create user if needed
  if (!(await User.findOne({ email }))) {
    const newUser = new User({ organization, email, name: email, password: 'Welcome1234!', userType: 'user', trainingName });
    await newUser.save();
  }

  logger.info(`K8s lab ${podName} created: https://${hostname}`);

  return { name, podName, hostname, accessUrl: `https://${hostname}`, password };
}

/**
 * Delete a lab pod + service + ingress rule.
 */
async function deleteK8sLab(podName) {
  const svcName = `${podName}-svc`;
  try { await coreApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE }); } catch (e) { logger.error(`Pod delete: ${e.message}`); }
  try { await coreApi.deleteNamespacedService({ name: svcName, namespace: NAMESPACE }); } catch (e) { logger.error(`Svc delete: ${e.message}`); }

  // Remove ingress rule
  try {
    const ingress = await networkApi.readNamespacedIngress({ name: 'lab-ingress', namespace: NAMESPACE });
    ingress.spec.rules = (ingress.spec.rules || []).filter(r => !r.host.startsWith(podName));
    await networkApi.replaceNamespacedIngress({ name: 'lab-ingress', namespace: NAMESPACE, body: ingress });
  } catch {}

  await Container.findOneAndUpdate({ containerId: podName }, { isAlive: false, isRunning: false, remarks: 'Deleted' });
  logger.info(`K8s lab ${podName} deleted`);
}

/**
 * Get cluster capacity and usage stats.
 */
async function getClusterStats() {
  try {
    const nodes = await coreApi.listNode();
    const pods = await coreApi.listNamespacedPod({ namespace: NAMESPACE });

    const spotNodes = nodes.items.filter(n => n.metadata.labels?.['kubernetes.azure.com/scalesetpriority'] === 'spot');
    const labPods = pods.items.filter(p => p.metadata.labels?.app === 'lab-desktop');
    const runningPods = labPods.filter(p => p.status.phase === 'Running');

    // Calculate total allocatable resources
    let totalCpu = 0, totalMem = 0;
    spotNodes.forEach(n => {
      totalCpu += parseInt(n.status.allocatable.cpu) || 0;
      totalMem += parseInt(n.status.allocatable.memory) / 1048576 || 0; // MB
    });

    return {
      nodes: { total: nodes.items.length, spot: spotNodes.length },
      pods: { total: labPods.length, running: runningPods.length },
      capacity: { cpuCores: totalCpu, memoryMB: Math.round(totalMem) },
      estimatedMaxPods: Math.floor(totalCpu * 5), // ~0.5 CPU per pod = 5 pods per core
    };
  } catch (err) {
    logger.error(`Cluster stats error: ${err.message}`);
    return null;
  }
}

module.exports = { createK8sLab, deleteK8sLab, getClusterStats, K8S_IMAGES, RESOURCE_PRESETS };
