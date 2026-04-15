const mongoose = require('mongoose');

const hostContainerSchema = new mongoose.Schema({
  containerId: { type: String },
  name: { type: String },
  memoryMb: { type: Number, default: 0 },
}, { _id: false });

const dockerHostSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },   // e.g. 'docker-host-1'
  provider: { type: String, enum: ['azure', 'oci', 'local'], default: 'azure' },
  vmName: { type: String },                                // Azure VM name
  resourceGroup: { type: String },                         // Azure RG name
  publicIp: { type: String },                              // for Docker TCP access
  privateIp: { type: String },
  dockerPort: { type: Number, default: 2376 },
  status: {
    type: String,
    enum: ['provisioning', 'ready', 'busy', 'idle', 'terminating', 'terminated'],
    default: 'provisioning',
  },
  vmSize: { type: String, default: 'Standard_B4ms' },
  totalMemoryMb: { type: Number, default: 16384 },
  usedMemoryMb: { type: Number, default: 0 },
  maxContainers: { type: Number, default: 30 },
  currentContainers: { type: Number, default: 0 },
  containers: { type: [hostContainerSchema], default: [] },
  region: { type: String, default: 'southindia' },
  spotInstance: { type: Boolean, default: true },
  costPerHour: { type: Number },                           // INR
  lastActivityAt: { type: Date },
  idleSince: { type: Date },
  provisionedAt: { type: Date },
  terminatedAt: { type: Date },
  createdBy: { type: String },
}, { timestamps: true });

dockerHostSchema.index({ status: 1 });
dockerHostSchema.index({ provider: 1, status: 1 });

const DockerHost = mongoose.model('DockerHost', dockerHostSchema);
module.exports = DockerHost;
