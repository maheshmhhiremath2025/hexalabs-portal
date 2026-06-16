// Audit log for quota mutations. Created 2026-06-06.
// Every successful inc/dec/set against a VM appends one document.
const mongoose = require('mongoose');

const quotaHistorySchema = new mongoose.Schema({
  trainingName: { type: String, required: true, index: true },
  vmName:       { type: String, default: null, index: true },  // null = training-wide bulk
  organization: { type: String, default: null },
  mode:         { type: String, enum: ['inc', 'dec', 'set'], required: true },
  // Pre/post snapshots in MINUTES (storage unit for quota.total).
  prevTotalMin: { type: Number, default: 0 },
  newTotalMin:  { type: Number, default: 0 },
  // Convenience field — the human meaning of the operation in hours.
  // For 'inc' / 'dec' this is the signed delta; for 'set' it's the new value.
  deltaHours:   { type: Number, default: 0 },
  scope:        { type: String, enum: ['single', 'bulk'], default: 'single' },
  affectedVms:  { type: Number, default: 1 },  // for bulk ops
  byEmail:      { type: String, default: null },
  byUserType:   { type: String, default: null },
  reason:       { type: String, default: '' },
}, { timestamps: true });

quotaHistorySchema.index({ trainingName: 1, createdAt: -1 });

module.exports = mongoose.models.quotahistory || mongoose.model('quotahistory', quotaHistorySchema);
