const mongoose = require('mongoose');

const sandboxuserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
    },
    userId: {
        type: String,
        required: true
    },
    duration: {
        type: Number
    },
    credits: {
        total: {
            type: Number,
        },
        consumed: {
            type: Number,
        }
    },
    sandboxTtlHours: { type: Number, default: 4 },    // Configurable TTL per user
    maxConcurrentSandboxes: { type: Number, default: 3 },
    sandbox: [
        {
            resourceGroupName: { type: String },
            location: { type: String },
            createdTime: { type: Date },
            deleteTime: { type: Date },
            expiresAt: { type: Date },
            warningEmailSent: { type: Boolean, default: false },
            estimatedCost: { type: Number, default: 0 },
            status: { type: String, enum: ['provisioning', 'ready', 'expired', 'failed'], default: 'provisioning' },
            accessUrl: { type: String },       // e.g. https://portal.azure.com
            credentials: {
                username: { type: String },
                password: { type: String },
            },
            restrictions: {
                allowedVmSizes: [String],
                budgetCap: { type: Number },
                blockedServices: [String],
            },
            templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxTemplate' },
            allowedServices: [{ service: String, category: String, restrictions: String }],
            blockedServices: [{ service: String, reason: String }],
        }
    ],
    dailyCapHours: { type: Number, default: 12 },
    totalCapHours: { type: Number, default: 0 },
    usageSessions: [{
        startedAt: { type: Date, default: Date.now },
        ttlHours: { type: Number },
        templateSlug: { type: String },
    }],
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    cleanupAttempts: { type: Number, default: 0 },
    cleanupError: { type: String },
    cleanupFailedAt: { type: Date },
    deletionStatus: { type: String, enum: ['none', 'deleting', 'failed'], default: 'none' },
},
    { timestamps: true })

const SandboxUser = mongoose.model('sandboxuser', sandboxuserSchema)

module.exports = SandboxUser