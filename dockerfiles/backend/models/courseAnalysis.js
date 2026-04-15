const mongoose = require('mongoose');

/**
 * CourseAnalysis
 *
 * A record of an ops-uploaded course PDF, its LLM-extracted analysis,
 * feasibility verdict, cost estimate, and (once the deal is locked) a
 * reference to the SandboxTemplate generated from it.
 *
 * Lifecycle:
 *   pending -> analyzing -> analyzed
 *                        -> failed
 *   analyzed -> template_generated  (on deal lock)
 */

const serviceUsageSchema = new mongoose.Schema({
  name: { type: String, required: true },        // lowercase short name, e.g. "ec2"
  usage: { type: String },                        // free-text usage note from analyzer
}, { _id: false });

const moduleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  hours: { type: Number, default: 0 },            // hands-on lab hours (not theory)
  services: [serviceUsageSchema],
  notes: { type: String },
}, { _id: false });

const analysisSchema = new mongoose.Schema({
  detectedProvider: { type: String, enum: ['aws', 'azure', 'gcp', 'multi'] },
  courseName: { type: String },
  description: { type: String },
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'] },
  totalHours: { type: Number, default: 0 },
  modules: [moduleSchema],
  specialRequirements: [String],                  // e.g. "GPU", "multi-region", "bare-metal"

  // Deployment classification — added in the container-lab extension.
  // 'cloud_sandbox' = customer needs real Azure/AWS/GCP accounts (existing flow).
  // 'container_lab' = customer is asking for VMs preloaded with software (Kafka,
  //                   Spark, etc.) — should be containerized instead of cloud
  //                   accounts. Triggers a different UI/output path.
  recommendedDeployment: {
    type: String,
    enum: ['cloud_sandbox', 'container_lab'],
    default: 'cloud_sandbox',
  },

  // Populated only when recommendedDeployment === 'container_lab'.
  containerLab: {
    requestedVmSpec: {
      vcpu: String,           // free-text from the PDF, e.g. "4-8 vCPUs"
      ramGb: String,          // e.g. "16-32 GB"
      storageGb: String,      // e.g. "200-300 GB SSD"
      os: String,             // e.g. "Ubuntu 22.04 LTS"
      software: [String],     // e.g. ["Kafka", "Spark", "MySQL", "Cassandra"]
    },
    recommendedImageKey: String,    // catalog key in containerService.js, e.g. 'bigdata-workspace'
    recommendedImageLabel: String,
    proposedStack: [{
      component: String,
      purpose: String,
      preInstalled: { type: Boolean, default: true },
    }],
    resourcesPerSeat: {
      vcpu: Number,
      memoryGb: Number,
      storageGb: Number,
    },
    estimatedSavingsVsVmPercent: Number,    // e.g. 60 means 60% cheaper than the requested VM
    notes: String,
  },
}, { _id: false });

const feasibilityEntrySchema = new mongoose.Schema({
  service: { type: String },
  reason: { type: String },
  category: { type: String },
  riskTier: { type: String },
}, { _id: false });

const feasibilitySchema = new mongoose.Schema({
  verdict: {
    type: String,
    enum: ['feasible', 'partial', 'needs_review', 'infeasible'],
  },
  supported: [feasibilityEntrySchema],
  needsReview: [feasibilityEntrySchema],
  unsupported: [feasibilityEntrySchema],
  riskFlags: [String],
}, { _id: false });

const costBreakdownSchema = new mongoose.Schema({
  module: { type: String },
  service: { type: String },
  hours: { type: Number },
  rate: { type: Number },                         // INR per hour
  subtotal: { type: Number },                     // INR
}, { _id: false });

const costSchema = new mongoose.Schema({
  perSeatInr: { type: Number, default: 0 },
  totalInr: { type: Number, default: 0 },
  breakdown: [costBreakdownSchema],
  marginPercent: { type: Number, default: 40 },
  baselineSeatInr: { type: Number, default: 0 }, // flat per-seat overhead (IAM, CloudTrail etc.)
  currency: { type: String, default: 'INR' },
}, { _id: false });

const courseAnalysisSchema = new mongoose.Schema({
  // Upload
  originalFilename: { type: String, required: true },
  uploadedBy: { type: String, required: true },   // email
  customerName: { type: String },                  // optional: "AcmeCorp"
  pageCount: { type: Number },
  rawTextPreview: { type: String },                // first ~2000 chars only (full text not stored)

  // Request context
  seats: { type: Number, default: 1 },
  providerHint: { type: String, enum: ['aws', 'azure', 'gcp', 'auto'], default: 'auto' },
  requestedTtlHours: { type: Number, default: 4 },
  requestedMarginPercent: { type: Number, default: 40 },
  forceType: { type: String, enum: ['cloud_sandbox', 'container_lab'] },  // ops-forced classification

  // Outputs
  analysis: analysisSchema,
  feasibility: feasibilitySchema,           // used for cloud_sandbox path (cloud-services check)
  containerFeasibility: { type: mongoose.Schema.Types.Mixed }, // used for container_lab path
  cost: costSchema,

  // Ops overrides (optional — mirrors analysis shape for manual tweaks before approval)
  overrides: { type: mongoose.Schema.Types.Mixed },

  // Lifecycle
  status: {
    type: String,
    enum: ['pending', 'analyzing', 'analyzed', 'failed', 'template_generated'],
    default: 'pending',
  },
  statusMessage: { type: String },

  // Linked artifacts
  generatedTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SandboxTemplate' },
  generatedTemplateSlug: { type: String }, // used by frontend to deep-link to /courses/:slug
  generatedTemplateName: { type: String },
}, { timestamps: true });

courseAnalysisSchema.index({ uploadedBy: 1, createdAt: -1 });
courseAnalysisSchema.index({ status: 1 });

module.exports = mongoose.model('CourseAnalysis', courseAnalysisSchema);
