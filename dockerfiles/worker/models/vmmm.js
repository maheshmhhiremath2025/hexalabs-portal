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
  location: { type: String },
  organization: { type: String },
}, { timestamps: true });

const VM = mongoose.model('VM', vmSchema);

module.exports = VM;
