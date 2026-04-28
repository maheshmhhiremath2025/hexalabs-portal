const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },  // Markdown supported
  hint: { type: String },
  verifyType: { type: String, enum: ['manual', 'auto', 'none'], default: 'manual' },
  verifyCommand: { type: String },  // For auto-verify (e.g. check if resource exists)
  verifyExpectedOutput: { type: String },  // regex or substring to match against command output
  verifyTimeout: { type: Number, default: 30 },  // seconds to wait for command
  troubleshooting: [{
    issue: { type: String, required: true },
    solution: { type: String, required: true },
  }],
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
  containerConfig: {
    cpus: { type: Number, default: 2 },
    memory: { type: Number, default: 2048 },  // MB
  },
  vmTemplateName: { type: String },            // For azure labs: template name e.g. "ubuntu-22"
  // Steps
  steps: [stepSchema],
  // Tier access
  minTier: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
  createdBy: { type: String },
  labTroubleshooting: [{
    issue: { type: String, required: true },
    solution: { type: String, required: true },
    category: { type: String },
  }],
  aiGenerated: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  assignedOrgs: { type: [String], default: [] },  // empty = default/visible to all orgs
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

const GuidedLab = mongoose.model('GuidedLab', guidedLabSchema);
module.exports = GuidedLab;
