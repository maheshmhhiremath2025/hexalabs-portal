const mongoose = require('mongoose');

const vmUserMappingSchema = new mongoose.Schema({
  vmName: { type: String },
  userEmail: { type: String },
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
  date: { type: Date },
  time: { type: String },
  action: { type: String },
  status: { type: String, default: 'pending' },
  scope: { 
    type: String, 
    enum: ['entire', 'specific'],
    default: 'entire'
  },
  targetVMs: [{ type: String }]
}, { _id: true });

const trainingsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    default: "active"
  },
  restrictLogin: {
    type: Boolean,
    default: false
  },
  organization: {
    type: String,
    required: true,
  },
  vmUserMapping: {
    type: [vmUserMappingSchema],
    required: true,
  },
  schedules: {
    type: [scheduleSchema],
    required: true,
  },
  // Stored as strings so we can keep both single ports ("80") and
  // ranges ("4000-5000"). Legacy numeric values still cast cleanly.
  ports: { type: [String], default: [] },
  // Lab expiry — auto-purge entire training when expired
  expiresAt: { type: Date },
  expiryWarningEmailSent: { type: Boolean, default: false },
  guidedLabId: { type: mongoose.Schema.Types.ObjectId, ref: 'GuidedLab' },
}, { timestamps: true });

const Training = mongoose.model('Training', trainingsSchema);

module.exports = Training;