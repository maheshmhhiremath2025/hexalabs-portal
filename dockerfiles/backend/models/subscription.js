const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  email: { type: String, required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  planName: { type: String, required: true },
  planTier: { type: String },
  status: { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'pending' },

  // Container quota
  containerHoursTotal: { type: Number, default: 0 },
  containerHoursUsed: { type: Number, default: 0 },
  maxContainers: { type: Number, default: 0 },
  activeContainers: { type: Number, default: 0 },

  // Sandbox quota
  sandboxCredits: {
    azure: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
    aws: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
    gcp: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
  },
  sandboxTtlHours: { type: Number, default: 2 },
  sandboxBudgetInr: { type: Number, default: 200 },

  // VM quota (premium plans)
  vmHoursTotal: { type: Number, default: 0 },
  vmHoursUsed: { type: Number, default: 0 },
  maxVms: { type: Number, default: 0 },

  // Guided labs
  guidedLabsCompleted: { type: Number, default: 0 },
  guidedLabLimit: { type: Number, default: 0 },

  // Billing
  amountPaid: { type: Number, default: 0 },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },

  // Period
  startsAt: { type: Date },
  expiresAt: { type: Date },
}, { timestamps: true });

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ email: 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
