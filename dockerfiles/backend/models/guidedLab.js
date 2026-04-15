const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },  // Markdown supported
  hint: { type: String },
  verifyType: { type: String, enum: ['manual', 'auto', 'none'], default: 'manual' },
  verifyCommand: { type: String },  // For auto-verify (e.g. check if resource exists)
}, { _id: true });

const guidedLabSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  cloud: { type: String, enum: ['azure', 'aws', 'gcp', 'container'], required: true },
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  duration: { type: Number, default: 30 },   // Estimated minutes
  category: { type: String },                 // e.g. "Compute", "Storage", "Networking", "Security"
  tags: [String],
  icon: { type: String },                     // Icon name or emoji
  // What's needed
  requiresSandbox: { type: Boolean, default: true },
  sandboxConfig: {
    ttlHours: { type: Number, default: 2 },
    budgetInr: { type: Number, default: 200 },
  },
  containerImage: { type: String },            // If cloud='container', which image to deploy
  // Steps
  steps: [stepSchema],
  // Tier access
  minTier: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

const GuidedLab = mongoose.model('GuidedLab', guidedLabSchema);
module.exports = GuidedLab;
