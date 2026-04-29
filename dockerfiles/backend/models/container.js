const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  start: { type: Date, required: true },
  stop: { type: Date, default: null },
  duration: { type: Number, default: 0 },
}, { _id: false });

const quotaSchema = new mongoose.Schema({
  total: { type: Number, required: true },
  consumed: { type: Number, default: 0 },
}, { _id: false });

const containerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  containerId: { type: String },             // Docker container ID
  trainingName: { type: String, required: true },
  email: { type: String, required: true },
  organization: { type: String, required: true },
  image: { type: String, required: true },    // Docker image name
  os: { type: String, default: 'Linux' },
  // Resource limits
  cpus: { type: Number, default: 2 },         // CPU cores
  memory: { type: Number, default: 2048 },     // MB
  disk: { type: Number, default: 20 },         // GB
  // Access
  vncPort: { type: Number },                   // noVNC web port
  sshPort: { type: Number },                   // SSH port (if exposed)
  extraPorts: [{
    containerPort: { type: Number, required: true },
    hostPort: { type: Number, required: true },
    label: { type: String, required: true },
    _id: false,
  }],
  vncLabel: { type: String, default: null },   // Label for primary port (e.g. 'Terminal', 'JupyterLab')
  password: { type: String, required: true },
  username: { type: String, default: 'labuser' },
  // Host info
  hostIp: { type: String },                    // Host machine IP
  // State
  isRunning: { type: Boolean, default: false },
  isAlive: { type: Boolean, default: true },
  logs: { type: [logSchema], default: [] },
  duration: { type: Number, default: 0 },
  rate: { type: Number, required: true },       // INR per hour (much lower than Azure)
  quota: { type: quotaSchema, required: true },
  remarks: { type: String, default: 'Alive' },
  // Cost tracking
  azureEquivalentRate: { type: Number },        // What this would cost on Azure
  accessProtocol: { type: String, default: 'http' }, // 'http' or 'https'
  type: { type: String, default: 'container' }, // 'container' vs 'vm'
  // Lab expiry
  expiresAt: { type: Date },
  expiryWarningEmailSent: { type: Boolean, default: false },
  extendedCount: { type: Number, default: 0 },
  // Idle auto-stop (container equivalent of VM idle shutdown)
  autoShutdown: { type: Boolean, default: true },
  idleMinutes: { type: Number, default: 30 },
  idleSince: { type: Date, default: null },
  // Docker host info (for auto-scaling pool)
  dockerHostId: { type: mongoose.Schema.Types.ObjectId, ref: 'DockerHost' },
  dockerHostIp: { type: String, default: 'localhost' },
  dockerHostPort: { type: Number, default: 2376 },
}, { timestamps: true });

containerSchema.index({ trainingName: 1, organization: 1 });
containerSchema.index({ containerId: 1 });

const Container = mongoose.model('Container', containerSchema);
module.exports = Container;
