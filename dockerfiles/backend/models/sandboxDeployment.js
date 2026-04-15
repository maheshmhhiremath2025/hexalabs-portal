const mongoose = require('mongoose');

/**
 * SandboxDeployment
 *
 * A record of a single sandbox instance provisioned from a SandboxTemplate
 * via POST /sandbox-templates/:slug/deploy.
 *
 * Why a new collection (and not reuse `awsuser`):
 *   - awsuser has a UNIQUE index on email; template deploys create many
 *     sandboxes under the same ops email (batch deploy for 25 trainees).
 *   - awsuser is keyed by email with a nested sandbox[] array — doesn't fit
 *     the "one row per deployment with own credentials" pattern needed here.
 *   - Keeping it separate leaves the existing admin-managed AWS flow untouched.
 *
 * Credentials: stored plaintext to match the existing awsuser pattern. This
 * is a known security concern in the broader codebase; fixing it (encryption
 * or secret manager) is a separate cleanup not in scope here.
 *
 * Cleanup: `expiresAt` is set at creation from template.sandboxConfig.ttlHours.
 * A follow-up task should extend automations/awsSandbox.js (and the Azure/GCP
 * equivalents) to also drain records from this collection when they expire.
 */

const sandboxDeploymentSchema = new mongoose.Schema({
  // Template this was deployed from
  templateId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxTemplate', required: true },
  templateSlug: { type: String, required: true, index: true },
  templateName: { type: String },

  // Which cloud
  cloud: { type: String, enum: ['aws', 'azure', 'gcp'], required: true },

  // Who deployed (ops email from req.user)
  deployedBy: { type: String, required: true, index: true },

  // Credentials — plaintext, matches existing awsuser pattern
  username: { type: String },
  password: { type: String },

  // How to reach the sandbox
  accessUrl: { type: String },
  region:    { type: String },

  // Budget + TTL from the template
  ttlHours:  { type: Number, default: 4 },
  budgetInr: { type: Number, default: 200 },
  expiresAt: { type: Date, index: true },

  // Cloud-specific fields (sparse — only populated for the relevant cloud)
  aws: {
    iamUsername: { type: String },
  },
  azure: {
    resourceGroupName: { type: String },
    portalUrl: { type: String },
    objectId: { type: String },
  },
  gcp: {
    projectId: { type: String },
  },

  // Lifecycle
  state: {
    type: String,
    enum: ['active', 'expired', 'deleted', 'failed'],
    default: 'active',
    index: true,
  },
  deletedAt: { type: Date },
  statusMessage: { type: String },
  warningEmailSent: { type: Boolean, default: false }, // 30-min-before-expiry email sent
}, { timestamps: true });

sandboxDeploymentSchema.index({ templateSlug: 1, deployedBy: 1, state: 1, createdAt: -1 });

module.exports = mongoose.model('SandboxDeployment', sandboxDeploymentSchema);
