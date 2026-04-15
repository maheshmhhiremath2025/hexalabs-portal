const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tier: { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'starter' },
  priceMonthly: { type: Number, required: true },       // INR/month

  // Container labs
  containerHours: { type: Number, default: 0 },          // Monthly container compute hours
  maxContainers: { type: Number, default: 0 },            // Max simultaneous containers
  containerResources: {
    cpus: { type: Number, default: 2 },
    memory: { type: Number, default: 4096 },
  },
  allowedContainerImages: [String],                       // Empty = all allowed

  // Cloud sandboxes
  sandboxCredits: {
    azure: { type: Number, default: 0 },                   // Sandbox sessions/month
    aws: { type: Number, default: 0 },
    gcp: { type: Number, default: 0 },
  },
  sandboxTtlHours: { type: Number, default: 2 },          // Per-sandbox TTL
  sandboxBudgetInr: { type: Number, default: 200 },        // Budget cap per sandbox

  // VM access (premium)
  vmHours: { type: Number, default: 0 },                   // Monthly VM hours
  maxVms: { type: Number, default: 0 },

  // Features
  features: [String],
  highlights: [String],                                     // Short selling points for pricing page
  badge: { type: String },                                  // "Popular", "Best Value", etc.

  // Guided labs
  guidedLabsIncluded: { type: Boolean, default: false },
  guidedLabLimit: { type: Number, default: 0 },            // 0 = unlimited if included

  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

const Plan = mongoose.model('Plan', planSchema);
module.exports = Plan;
