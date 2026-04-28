const mongoose = require('mongoose');

const stepProgressSchema = new mongoose.Schema({
  stepId: { type: mongoose.Schema.Types.ObjectId, required: true },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  verifyMethod: { type: String, enum: ['manual', 'auto'] },
  verifyOutput: { type: String },
  hintViewed: { type: Boolean, default: false },
}, { _id: false });

const labProgressSchema = new mongoose.Schema({
  guidedLabId: { type: mongoose.Schema.Types.ObjectId, ref: 'GuidedLab', required: true },
  trainingName: { type: String, required: true },
  userEmail: { type: String, required: true },
  steps: [stepProgressSchema],
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
}, { timestamps: true });

labProgressSchema.index({ guidedLabId: 1, trainingName: 1, userEmail: 1 }, { unique: true });

const LabProgress = mongoose.model('LabProgress', labProgressSchema);
module.exports = LabProgress;
