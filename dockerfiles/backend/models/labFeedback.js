const mongoose = require('mongoose');

const labFeedbackSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  trainingName: { type: String, required: true, trim: true },
  organization: { type: String, trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  difficulty: { type: String, enum: ['too_easy', 'just_right', 'too_hard'] },
  contentQuality: { type: Number, min: 1, max: 5 },
  labEnvironment: { type: Number, min: 1, max: 5 },
  wouldRecommend: { type: Boolean },
  comments: { type: String, maxlength: 1000, trim: true },
  createdAt: { type: Date, default: Date.now },
});

labFeedbackSchema.index({ email: 1, trainingName: 1 }, { unique: true });
labFeedbackSchema.index({ trainingName: 1 });
labFeedbackSchema.index({ organization: 1 });

const LabFeedback = mongoose.model('LabFeedback', labFeedbackSchema);
module.exports = LabFeedback;
