const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  email: { type: String, required: true },
  namespace: { type: String },
  username: { type: String },
  password: { type: String },
  role: { type: String, default: 'edit' },
  status: { type: String, enum: ['active', 'expired', 'deleted'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const aroClusterSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  clusterId: { type: String },
  resourceGroup: { type: String },
  region: { type: String, default: 'southindia' },
  version: { type: String, default: '4.14' },
  vnetName: { type: String },
  masterSubnet: { type: String },
  workerSubnet: { type: String },
  workerNodes: { type: Number, default: 3 },
  workerVmSize: { type: String, default: 'Standard_D4s_v3' },
  status: {
    type: String,
    enum: ['provisioning', 'ready', 'scaling', 'deleting', 'deleted', 'failed'],
    default: 'provisioning',
  },
  consoleUrl: { type: String },
  apiUrl: { type: String },
  adminUsername: { type: String, default: 'cluster-admin' },
  adminPassword: { type: String },
  provisionStartedAt: { type: Date },
  provisionCompletedAt: { type: Date },
  estimatedHourlyCostInr: { type: Number },
  totalCostInr: { type: Number, default: 0 },
  trainingName: { type: String },
  organization: { type: String },
  createdBy: { type: String },
  expiresAt: { type: Date },
  cleanupAttempts: { type: Number, default: 0 },
  cleanupError: { type: String },
  cleanupFailedAt: { type: Date },
  students: [studentSchema],
}, { timestamps: true });

const AroCluster = mongoose.model('AroCluster', aroClusterSchema);

module.exports = AroCluster;
