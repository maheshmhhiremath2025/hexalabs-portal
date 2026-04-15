const mongoose = require('mongoose');

const vmUserMappingSchema = new mongoose.Schema({
  vmName: { type: String },
  userEmail: { type: String },
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
  date: { type: Date },
  time: { type: String },
  action: { type: String },
  status: { type: String, default: 'pending' },
}, { _id: true });

const trainingsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    default: "active"
  },
  restrictLogin: {
    type: String,
    default: "inactive"
  },
  organization: {
    type: String,
    required: true,
  },
  vmUserMapping: {
    type: [vmUserMappingSchema],
    required: true,
  },
  schedules: {
    type: [scheduleSchema],
    required: true,
  },
  ports: { type: [Number], default: [] },
}, { timestamps: true });

const Training = mongoose.model('Training', trainingsSchema);

module.exports = Training;
