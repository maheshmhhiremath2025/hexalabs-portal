const mongoose = require('mongoose');

const customImageSchema = new mongoose.Schema({
  name: { type: String, required: true },                // Display name
  key: { type: String, required: true, unique: true },    // Unique key for selection
  image: { type: String, required: true },                // Docker image URI (e.g. myregistry/myimage:tag)
  description: { type: String },
  category: { type: String, default: 'custom' },          // custom, desktop, dev, etc.
  os: { type: String, default: 'Linux' },
  port: { type: Number, default: 3000 },                  // Internal port to expose
  protocol: { type: String, enum: ['http', 'https'], default: 'http' },
  envVars: [{ key: String, value: String }],              // Custom env vars
  screenshotUrl: { type: String },                         // Optional preview image URL for the template card
  defaultUser: { type: String },                           // Default username for the image
  shmSize: { type: String, default: '512m' },
  // Access control
  createdBy: { type: String, required: true },             // Email of who uploaded
  organization: { type: String },
  isPublic: { type: Boolean, default: false },             // Available to all users?
  allowedEmails: [String],                                 // Specific users who can use this
  allowedTeams: [String],                                  // Team slugs
  // Resource defaults
  defaultCpus: { type: Number, default: 2 },
  defaultMemory: { type: Number, default: 4096 },
  // Status
  isActive: { type: Boolean, default: true },
  isPulled: { type: Boolean, default: false },             // Has been pre-pulled on server
}, { timestamps: true });

const CustomImage = mongoose.model('CustomImage', customImageSchema);
module.exports = CustomImage;
