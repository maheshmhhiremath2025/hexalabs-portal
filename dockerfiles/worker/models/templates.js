const mongoose = require('mongoose');

const creationSchema = new mongoose.Schema({
  resourceGroup: { type: String },
  vmSize: { type: String },
  imageId: { type: String },
  location: { type: String },
  os: { type: String },
  vnet: { type: String },
  licence: { type: String },
  planPublisher: { type: String },
  product: { type: String },
  version: { type: String },
  official: { type: Boolean },
  zone: { type: String },
}, { _id: false });

const displaySchema = new mongoose.Schema({
  cpu: { type: String },
  memory: { type: String },
  os: { type: String },
  storage: { type: String },
  disk: { type: String },
}, { _id: false });

const templatesSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  rate: {
    type: Number,
    required: true,
  },
  creation: {
    type: creationSchema,
    required: true,
  },
  display: {
    type: displaySchema,
    required: true,
  },
  // Workload routing policy — added 2026-06-10.
  // requiredBackend pins the deploy to one cloud tier; accessProtocol drives the
  // Open-in-Browser flow; nestedVirt marks templates that need nested-virt-capable
  // SKUs (Azure Dsv5/Edsv5 or Forge bare-metal — NOT AWS Spot non-metal).
  requiredBackend: { type: String, enum: ['azure','aws','forge','auto'], default: 'auto' },
  accessProtocol:  { type: String, enum: ['dcv','guacamole','rdp','kasm','kasmvnc','ssh','auto'], default: 'auto' },
  nestedVirt:      { type: Boolean, default: false },
  // Workshop (trainer-built templates) — added 2026-06-10. Phase 1, additive only.
  // isTrainerBuilt=true distinguishes from Synergific-curated templates.
  // visibility controls who can deploy. Defaults make new fields invisible to existing reads.
  createdBy:        { type: String, default: null },           // trainer email
  isTrainerBuilt:   { type: Boolean, default: false },
  visibility:       { type: String, default: 'private' },      // private | org | global
  sourceBuildVm:    { type: String, default: null },           // audit: which build VM produced this
}, { timestamps: true });

const Templates = mongoose.model('Templates', templatesSchema);

module.exports = Templates;
