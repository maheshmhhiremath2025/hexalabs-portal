const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  role: { type: [String], default: [] },
  budget: { type: Number, default: 0 },
});
const logSchema = new mongoose.Schema({
  operation: {type: String},
  time: { type: Date, required: true }
}, { _id: false });

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  trainingName: { type: String, required: true },
  billingStatus: { type: Boolean, required: true, default: true },
  logs: { type: [logSchema], default: [] },
  autoClean: { type: Number, default: 0 },
  lastClean: { type: Date, default: null },
  isAlive: { type: Boolean, required: true, default: true },
  organization: { type: String, required: true },
  users: { type: [userSchema], required: true },
  budget: {type: Number, default: 0},
  consumed: {type: Number, default: 0},
}, { timestamps: true });

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;
