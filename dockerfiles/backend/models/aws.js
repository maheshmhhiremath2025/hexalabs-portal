const mongoose = require('mongoose');

const awsSandboxSchema = new mongoose.Schema({
    name: { type: String },
    region: { type: String, default: 'ap-south-1' },
    createdTime: { type: Date },
    deleteTime: { type: Date },
    warningEmailSent: { type: Boolean, default: false },
    estimatedCost: { type: Number, default: 0 },
}, { _id: true });

const awsuserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    password: { type: String, required: true },
    accessUrl: { type: String },
    region: { type: String },
    duration: { type: Number },
    sandboxTtlHours: { type: Number, default: 4 },
    credits: { total: { type: Number, default: 1 }, consumed: { type: Number, default: 0 } },
    sandbox: [awsSandboxSchema],
    startDate: { type: Date },
    endDate: { type: Date },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxTemplate' },
    expiresAt: { type: Date },
    allowedServices: [{
        service: { type: String },
        category: { type: String },
        actions: [String],
        restrictions: { type: String },
    }],
    blockedServices: [{
        service: { type: String },
        reason: { type: String },
    }],
    dailyCapHours: { type: Number, default: 12 },
    totalCapHours: { type: Number, default: 0 },
    usageSessions: [{
        startedAt: { type: Date, default: Date.now },
        ttlHours: { type: Number },
        templateSlug: { type: String },
    }],
    cleanupAttempts: { type: Number, default: 0 },
    cleanupError: { type: String },
    cleanupFailedAt: { type: Date },
    deletionStatus: { type: String, enum: ['none', 'deleting', 'failed'], default: 'none' },
},
    { timestamps: true })

const awsUser = mongoose.model('awsuser', awsuserSchema)

module.exports = awsUser