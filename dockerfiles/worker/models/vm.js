const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  start: { type: Date, required: true },
  stop: { type: Date, default: null },
  duration: { type: Number, default: 0 }, // Duration in seconds
}, { _id: false });

const quotaSchema = new mongoose.Schema({
  total: { type: Number, required: true },
  consumed: { type: Number, default: 0 },
}, { _id: false });

const vmSchema = new mongoose.Schema({
  name: { type: String, required: true },
  templateName: { type: String },
  trainingName: { type: String, required: true },
  email: { type: String, required: true },
  logs: { type: [logSchema], default: [] },
  duration: { type: Number },
  guacamole: { type: Boolean, required: true, default: false },
  rate: { type: Number, required: true },
  isRunning: { type: Boolean, required: true, default: false },
  os: { type: String, required: true },
  resourceGroup: { type: String, required: true },
  publicIp: { type: String, required: true },
  adminPass: { type: String, required: true },
  adminUsername: { type: String, required: true },
  isAlive: { type: Boolean, required: true, default: true },
  quota: { type: quotaSchema, required: true },
  remarks: { type: String, default: 'Alive' },
  kasmVnc: { type: Boolean, default: false },
  // Linux VMs that have xrdp+xfce baked in — backend uses this to register a
  // second Guacamole RDP connection (<vmName>-desktop) so the student can
  // pick Terminal or Desktop from the Guac home page.
  hasXrdp: { type: Boolean, default: false },
  autoShutdown: { type: Boolean, default: false },
  idleMinutes: { type: Number, default: 15 },
  lastActivityAt: { type: Date, default: Date.now },
  hybridBenefit: { type: Boolean, default: false },
  expiresAt: { type: Date },
  expiryWarningEmailSent: { type: Boolean, default: false },
  extendedCount: { type: Number, default: 0 },
  location: { type: String },
  vmSize: { type: String },
  organization: { type: String },
  // Mirror of the backend field — so worker's updateOne({stopAttempts:0})
  // isn't silently dropped by Mongoose strict-mode on this schema.
  stopAttempts: { type: Number, default: 0 },
}, { timestamps: true });

const VM = mongoose.model('VM', vmSchema);

module.exports = VM;
