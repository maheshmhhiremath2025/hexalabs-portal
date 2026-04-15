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
  trainingName: {type: String, required: true},
  email: {type: String, required: true},
  logs: { type: [logSchema], default: [] },
  duration: {type: Number},
  guacamole: {type: Boolean, required: true, default: false},
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
  kasmVnc: { type: Boolean, default: false },              // KasmVNC installed (fast browser access)
  autoShutdown: { type: Boolean, default: false },        // Auto-stop when idle
  idleMinutes: { type: Number, default: 15 },              // Minutes of idle before shutdown
  lastActivityAt: { type: Date, default: Date.now },       // Last known activity timestamp
  hybridBenefit: { type: Boolean, default: false },        // Azure Hybrid Benefit (Windows)
  // Lab expiry — auto-delete VM + all resources when expired
  expiresAt: { type: Date },                               // When this VM should be auto-deleted
  expiryWarningEmailSent: { type: Boolean, default: false }, // Warning sent before expiry
  extendedCount: { type: Number, default: 0 },              // How many times expiry was extended
}, { timestamps: true });

const VM = mongoose.model('VM', vmSchema);

module.exports = VM;
