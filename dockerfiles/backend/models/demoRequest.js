const mongoose = require('mongoose');

// Demo requests submitted from the public login page's "Book demo" modal.
// Kept in a separate collection so sales ops can query / export without
// polluting the users collection.

const demoRequestSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  email:           { type: String, required: true, trim: true, lowercase: true },
  company:         { type: String, required: true, trim: true },
  demoDate:        { type: String, trim: true },         // YYYY-MM-DD from the date input
  preferredTiming: { type: String, trim: true },         // free-text slot (e.g. "10am-11am IST")
  source:          { type: String, default: 'login-modal' },
  ipAddress:       { type: String },
  userAgent:       { type: String },
  status:          { type: String, enum: ['new', 'contacted', 'scheduled', 'completed', 'dropped'], default: 'new' },
  notes:           { type: String, default: '' },
}, { timestamps: true });

demoRequestSchema.index({ createdAt: -1 });
demoRequestSchema.index({ email: 1 });

module.exports = mongoose.model('DemoRequest', demoRequestSchema);
