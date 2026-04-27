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
  meshCentral: { type: Boolean, default: false },              // MeshCentral agent (Windows browser desktop)
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
  hasXrdp: { type: Boolean, default: false },              // xrdp+xfce installed — prefer RDP desktop over SSH for Linux
  autoShutdown: { type: Boolean, default: false },        // Auto-stop when idle
  idleMinutes: { type: Number, default: 15 },              // Minutes of idle before shutdown
  lastActivityAt: { type: Date, default: Date.now },       // Last known activity timestamp
  hybridBenefit: { type: Boolean, default: false },        // Azure Hybrid Benefit (Windows)
  // Lab expiry — auto-delete VM + all resources when expired
  expiresAt: { type: Date },                               // When this VM should be auto-deleted
  expiryWarningEmailSent: { type: Boolean, default: false }, // Warning sent before expiry
  extendedCount: { type: Number, default: 0 },              // How many times expiry was extended
  // Stuck-stop detection: incremented each time idleShutdown tries to stop
  // the VM. Reset to 0 when the reconciler sees it actually stopped. An
  // ops alert fires the moment this hits 3 (worker crash-loop, queue jam,
  // etc. — the exact failure mode we hit on 2026-04-21).
  stopAttempts: { type: Number, default: 0 },

  // VM is in the middle of a stop sequence (deallocate -> snapshot -> delete VM
  // -> delete disk) while this date is in the future. Start endpoint refuses
  // during this window to avoid the start<->stop race that deletes a freshly
  // started VM.
  stoppingUntil: { type: Date, default: null },

  // Last Bull queue job failure for this VM. Set by the worker's
  // `on('failed')` hook; cleared by `on('completed')`. Surfaced on the VM
  // row in the Lab Console so operators see *why* a start/stop silently
  // didn't happen — no more "clicked and nothing moved" debugging.
  lastOpError: { type: String },
  lastOpErrorQueue: { type: String },
  lastOpErrorAt: { type: Date },
}, { timestamps: true });

const VM = mongoose.model('VM', vmSchema);

module.exports = VM;
