const mongoose = require('mongoose');

const gcpSandboxSchema = new mongoose.Schema({
    projectId: { type: String },
    projectName: { type: String },
    createdTime: { type: Date },
    deleteTime: { type: Date },
    warningEmailSent: { type: Boolean, default: false },
    estimatedCost: { type: Number, default: 0 },
    billingEnabled: { type: Boolean, default: false },
    // Shared project support
    isShared: { type: Boolean, default: false },
    sharedUsers: [{ type: String }],  // emails of users sharing this project
    maxUsers: { type: Number, default: 5 },
    // Template-based deployment fields
    templateId: { type: String },
    expiresAt: { type: Date },
    allowedServices: [{ service: String, category: String, restrictions: String }],
    blockedServices: [{ service: String, reason: String }],
    // Path 3 resource-recycle progress (populated by gcp-reset-project worker)
    reset: {
        status: { type: String, enum: ['idle','queued','resetting','ready','failed'], default: 'ready' },
        currentPhase: { type: String, default: '' },
        currentStep:  { type: String, default: '' },
        completed:    { type: Number, default: 0 },
        total:        { type: Number, default: 0 },
        percent:      { type: Number, default: 0 },
        startedAt:    { type: Date },
        finishedAt:   { type: Date },
        lastError:    { type: String },
        log:          [{ ts: Date, phase: String, step: String, ok: Boolean, message: String }],
    },
}, { _id: true });

const gcpSandboxUserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    googleEmail: { type: String },  // User's Google account email
    persistentProjectId: { type: String, default: null },  // long-lived project for resource-recycle (Path 3)
    duration: { type: Number },
    sandboxTtlHours: { type: Number, default: 4 },
    credits: { total: { type: Number, default: 1 }, consumed: { type: Number, default: 0 } },
    maxConcurrentSandboxes: { type: Number, default: 2 },
    sandbox: [gcpSandboxSchema],
    budgetLimit: { type: Number, default: 500 },  // INR budget per sandbox
    dailyCapHours: { type: Number, default: 12 },
    totalCapHours: { type: Number, default: 0 },
    usageSessions: [{
        startedAt: { type: Date, default: Date.now },
        ttlHours: { type: Number },
        templateSlug: { type: String },
    }],
    startDate: { type: Date },
    endDate: { type: Date },
    cleanupAttempts: { type: Number, default: 0 },
    cleanupError: { type: String },
    cleanupFailedAt: { type: Date },
    deletionStatus: { type: String, enum: ['none', 'deleting', 'failed'], default: 'none' },
    batchExpiresAt: { type: Date, default: null },
    organization: { type: String, index: true },
}, { timestamps: true });

const GcpSandboxUser = mongoose.model('gcpsandboxuser', gcpSandboxUserSchema);
module.exports = GcpSandboxUser;
