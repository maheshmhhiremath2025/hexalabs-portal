require('dotenv').config();
const mongoose = require('mongoose');
const SandboxTemplate = require('../models/sandboxTemplate');

const ociTemplates = [
  // =============================================
  // OCI Standard Lab
  // =============================================
  {
    name: 'OCI Standard Lab',
    slug: 'oci-standard-lab',
    cloud: 'oci',
    certificationLevel: 'associate',
    description: 'General-purpose Oracle Cloud sandbox with core services for OCI fundamentals training',

    sandboxConfig: {
      ttlHours: 4,
      budgetInr: 200,
      region: 'ap-mumbai-1',
    },

    allowedServices: [
      // Compute
      { service: 'compute', category: 'Compute', restrictions: 'VM.Standard.E2.1.Micro, VM.Standard.A1.Flex — always free eligible' },
      // Storage
      { service: 'block-volume', category: 'Storage', restrictions: '50 GB free' },
      { service: 'object-storage', category: 'Storage', restrictions: '10 GB free' },
      // Networking
      { service: 'vcn', category: 'Networking', restrictions: '2 VCNs max' },
      { service: 'load-balancer', category: 'Networking', restrictions: 'flexible, 10 Mbps free' },
      // Database
      { service: 'autonomous-database', category: 'Database', restrictions: 'always free — 1 OCPU, 20 GB' },
      // Developer Tools
      { service: 'cloud-shell', category: 'Developer Tools', restrictions: 'free, built-in terminal' },
      { service: 'functions', category: 'Developer Tools', restrictions: 'serverless, 2M invocations free' },
      { service: 'api-gateway', category: 'Developer Tools', restrictions: 'free tier' },
      // Observability
      { service: 'monitoring', category: 'Observability', restrictions: 'free tier' },
      { service: 'logging', category: 'Observability', restrictions: 'free tier' },
      // Identity
      { service: 'iam', category: 'Identity', restrictions: 'identity management' },
    ],

    blockedServices: [
      { service: 'exadata', reason: 'Extremely expensive' },
      { service: 'bare-metal', reason: 'Cost control' },
      { service: 'gpu-instances', reason: 'Cost control' },
      { service: 'fastconnect', reason: 'Not applicable to labs' },
      { service: 'data-science', reason: 'GPU-backed, expensive' },
      { service: 'goldengate', reason: 'Enterprise-only' },
    ],

    isActive: true,
    sortOrder: 10,
  },

  // =============================================
  // OCI DevOps Lab
  // =============================================
  {
    name: 'OCI DevOps Lab',
    slug: 'oci-devops-lab',
    cloud: 'oci',
    certificationLevel: 'professional',
    description: 'OCI sandbox with container, DevOps, and Kubernetes services',

    sandboxConfig: {
      ttlHours: 8,
      budgetInr: 500,
      region: 'ap-mumbai-1',
    },

    allowedServices: [
      // Compute
      { service: 'compute', category: 'Compute', restrictions: 'VM.Standard.E2.1, VM.Standard.A1.Flex' },
      // Containers
      { service: 'container-instances', category: 'Containers', restrictions: 'serverless containers' },
      { service: 'oke', category: 'Containers', restrictions: '1 cluster, 3 nodes max' },
      { service: 'ocir', category: 'Containers', restrictions: 'Container Registry — 500 MB' },
      // DevOps
      { service: 'devops-service', category: 'DevOps', restrictions: 'build pipelines, deploy pipelines' },
      // Developer Tools
      { service: 'functions', category: 'Developer Tools' },
      { service: 'api-gateway', category: 'Developer Tools' },
      { service: 'cloud-shell', category: 'Developer Tools' },
      { service: 'resource-manager', category: 'Developer Tools', restrictions: 'Terraform' },
      // Storage
      { service: 'object-storage', category: 'Storage', restrictions: '20 GB' },
      // Networking
      { service: 'vcn', category: 'Networking' },
      // Observability
      { service: 'monitoring', category: 'Observability' },
      { service: 'logging', category: 'Observability' },
    ],

    blockedServices: [
      { service: 'exadata', reason: 'Extremely expensive' },
      { service: 'bare-metal', reason: 'Cost control' },
      { service: 'gpu-instances', reason: 'Cost control' },
      { service: 'data-science', reason: 'GPU-backed, expensive' },
    ],

    isActive: true,
    sortOrder: 11,
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');
    console.log('Connected to MongoDB');

    for (const tpl of ociTemplates) {
      const result = await SandboxTemplate.findOneAndUpdate(
        { slug: tpl.slug },
        tpl,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      console.log(`Upserted: ${result.name} (${result.slug})`);
    }

    console.log('OCI sandbox templates seeded successfully');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
