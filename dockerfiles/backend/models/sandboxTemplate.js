const mongoose = require('mongoose');

const labModuleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  domain: { type: String },                    // Exam domain (e.g. "Cloud Concepts")
  domainWeight: { type: Number },               // % of exam (e.g. 24)
  duration: { type: Number, default: 30 },      // Estimated minutes
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  description: { type: String },
  steps: [{
    order: { type: Number },
    title: { type: String },
    description: { type: String },
    service: { type: String },                   // Primary AWS/Azure/GCP service used
    hint: { type: String },
  }],
}, { _id: true });

const sandboxTemplateSchema = new mongoose.Schema({
  // Course info
  name: { type: String, required: true },        // e.g. "AWS Cloud Practitioner (CLF-C02)"
  slug: { type: String, required: true, unique: true },
  cloud: { type: String, enum: ['aws', 'azure', 'gcp', 'oci'], required: true },
  certificationCode: { type: String },           // e.g. "CLF-C02"
  certificationLevel: { type: String, enum: ['foundational', 'associate', 'professional', 'specialty'] },
  description: { type: String },
  icon: { type: String },
  examDomains: [{
    name: { type: String },
    weight: { type: Number },                    // % of exam
  }],

  // Sandbox configuration
  sandboxConfig: {
    ttlHours: { type: Number, default: 4 },
    budgetInr: { type: Number, default: 200 },
    region: { type: String },                    // Default region
    dailyCapHours: { type: Number, default: 12 },   // Max hours per student per day
    totalCapHours: { type: Number, default: 0 },     // Max total hours per engagement (0 = unlimited)
    maxInstances: { type: Number, default: 1 },      // Max concurrent EC2/VM instances per student
    useConnectAccount: { type: Boolean, default: false }, // Use US AWS account for Connect templates
    connectAccountId: { type: String },              // US AWS account ID
    connectRegion: { type: String },                 // Region for Connect (us-east-1)
    enforceOwnerTag: { type: Boolean, default: false }, // If true, IAM policy forces CreatedBy=${aws:username} tag on m2/appstream creates (for cleanup)
  },

  // Service permissions
  allowedServices: [{
    service: { type: String },                   // e.g. "ec2", "s3", "lambda"
    category: { type: String },                  // e.g. "Compute", "Storage"
    actions: [String],                           // Specific actions allowed (empty = all actions for service)
    restrictions: { type: String },              // e.g. "t2/t3 only", "max 50GB"
  }],

  blockedServices: [{
    service: { type: String },
    reason: { type: String },                    // Why blocked
  }],

  // Instance restrictions (for compute)
  allowedInstanceTypes: {
    aws: [String],                               // e.g. ["t2.micro", "t3.small"]
    azure: [String],
    gcp: [String],
  },

  // Auto-generated IAM/RBAC policy
  iamPolicy: { type: mongoose.Schema.Types.Mixed }, // Generated JSON policy document
  policyInitiativeId: { type: String }, // Azure Policy Set Definition ID (for pre-built initiatives)
  customRoleId: { type: String }, // Azure custom role definition ID (replaces default Contributor)

  // Guided labs for this course
  labs: [labModuleSchema],

  // Metadata
  isActive: { type: Boolean, default: true },
  createdBy: { type: String },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

const SandboxTemplate = mongoose.model('SandboxTemplate', sandboxTemplateSchema);
module.exports = SandboxTemplate;
