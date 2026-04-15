const mongoose = require('mongoose');

const ociSandboxUserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    compartmentId: { type: String },
    compartmentName: { type: String },
    userId: { type: String },
    username: { type: String },
    password: { type: String },
    policyId: { type: String },
    region: { type: String, default: 'ap-hyderabad-1' },
    accessUrl: { type: String },
    duration: { type: Number },
    sandboxTtlHours: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },
    expiresAt: { type: Date },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxTemplate' },
    dailyCapHours: { type: Number, default: 12 },
    totalCapHours: { type: Number, default: 0 },
    usageSessions: [{
        startedAt: { type: Date, default: Date.now },
        ttlHours: { type: Number },
        templateSlug: { type: String },
    }],
    allowedServices: [{
        service: { type: String },
        category: { type: String },
        restrictions: { type: String },
    }],
    blockedServices: [{
        service: { type: String },
        reason: { type: String },
    }],
    status: { type: String, enum: ['active', 'expired', 'deleted'], default: 'active' },
    cleanupAttempts: { type: Number, default: 0 },
    cleanupError: { type: String },
    cleanupFailedAt: { type: Date },
    deletionStatus: { type: String, enum: ['none', 'deleting', 'failed'], default: 'none' },
}, { timestamps: true });

const OciSandboxUser = mongoose.model('ocisandboxuser', ociSandboxUserSchema);
module.exports = OciSandboxUser;
