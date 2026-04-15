const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  name: { type: String, required: true },          // e.g. "Production API Key"
  key: { type: String, required: true, unique: true },
  hashedKey: { type: String, required: true },      // SHA256 hash for lookup
  ownerEmail: { type: String, required: true },
  organization: { type: String },
  permissions: {
    containers: { type: Boolean, default: true },
    sandboxes: { type: Boolean, default: true },
    vms: { type: Boolean, default: false },
    analytics: { type: Boolean, default: false },
  },
  rateLimit: { type: Number, default: 100 },        // Requests per minute
  lastUsedAt: { type: Date },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Static method to generate a new API key
apiKeySchema.statics.generateKey = function () {
  const key = `glabs_${crypto.randomBytes(32).toString('hex')}`;
  const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hashedKey };
};

// Static method to find by key
apiKeySchema.statics.findByKey = function (key) {
  const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
  return this.findOne({ hashedKey, isActive: true });
};

const ApiKey = mongoose.model('ApiKey', apiKeySchema);
module.exports = ApiKey;
