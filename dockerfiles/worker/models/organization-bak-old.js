const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now, // Default to current date
  },
  particular: {
    type: String,
  },
  payment: {
    type: Number,
    default: 0, // Default payment to 0 if not provided
  },
  invoice: {
    type: Number,
    default: 0, // Default invoice to 0 if not provided
  },
  id: {
    type: String,
    required: true, // Every transaction should have an ID
    unique: true, // Ensure uniqueness
  }
});

const legalSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true, // Organization name is required
  },
  gst: {
    type: String,
  },
  limit: {
    type: Number,
    default: 0, // Default limit to 0 if not provided
  },
  balance: {
    type: Number,
    default: 0, // Default balance to 0 if not provided
  },
  invoice: {
    type: Number,
    default: 0,
  },
  payment: {
    type: Number,
    default: 0,
  }
});

const organizationSchema = new mongoose.Schema(
  {
    organization: {
      type: String,
      required: true,
      unique: true, // Ensure each organization is unique
      index: true, // Faster lookups
    },
    templates: {
      type: [String], // Enforce array of strings
      default: [], // Default to empty array
    },
    legal: {
      type: legalSchema, // Embedded legal schema
    },
    transactions: {
      type: [transactionSchema], // Array of transaction schemas
      default: [], // Default to empty array
    }
  },
  { timestamps: true }
);

const Organization = mongoose.model('organizations', organizationSchema);

module.exports = Organization;
