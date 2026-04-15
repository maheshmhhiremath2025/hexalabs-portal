const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  email: { type: String, required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
  // Per-member usage tracking
  containerHoursUsed: { type: Number, default: 0 },
  sandboxesUsed: { azure: { type: Number, default: 0 }, aws: { type: Number, default: 0 }, gcp: { type: Number, default: 0 } },
}, { _id: false });

const teamSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  ownerEmail: { type: String, required: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  members: [memberSchema],
  maxMembers: { type: Number, default: 20 },
  // Shared quota (from subscription)
  sharedQuota: {
    containerHoursTotal: { type: Number, default: 0 },
    containerHoursUsed: { type: Number, default: 0 },
    sandboxCredits: {
      azure: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
      aws: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
      gcp: { total: { type: Number, default: 0 }, used: { type: Number, default: 0 } },
    },
  },
  settings: {
    allowMemberContainers: { type: Boolean, default: true },
    allowMemberSandboxes: { type: Boolean, default: true },
    maxContainersPerMember: { type: Number, default: 3 },
    maxSandboxesPerMember: { type: Number, default: 2 },
  },
}, { timestamps: true });

teamSchema.index({ ownerEmail: 1 });
teamSchema.index({ 'members.email': 1 });

const Team = mongoose.model('Team', teamSchema);
module.exports = Team;
