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
  // When true, the captured image has KasmVNC on port 6901 (HTTPS). The
  // VM deploy worker will open 6901 in the NSG and the portal's
  // "Open in browser" will point at https://<publicIp>:6901 directly —
  // no Guacamole hop required.
  kasmVnc: {
    type: Boolean,
    default: false,
  },
  creation: {
    type: creationSchema,
    required: true,
  },
  display: {
    type: displaySchema,
    required: true,
  },
}, { timestamps: true });

const Templates = mongoose.model('Templates', templatesSchema);

module.exports = Templates;
