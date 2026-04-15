// backend/models/organization.js
const mongoose = require('mongoose');

const transactionItemSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    description: { type: String, trim: true },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);

const transactionCustomerSchema = new mongoose.Schema(
  {
    name: String,
    company: String,
    email: String,
    phone: String,
    gstin: String,
    pan: String,
    state: String,
    pincode: String,
    address: String,
    shippingAddress: String
  },
  { _id: false }
);

const transactionGstSchema = new mongoose.Schema(
  {
    baseAmount: Number,
    gstAmount: Number,
    totalAmount: Number,
    // accept 18 or "18%" safely
    gstPercentage: mongoose.Schema.Types.Mixed
  },
  { _id: false }
);

const paidInvoiceSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    particular: { type: String }
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    particular: { type: String },
    payment: { type: Number, default: 0 },
    invoice: { type: Number, default: 0 },

    // do not use unique inside array subdocs
    id: { type: String, required: true, index: true },

    // persist full invoice data so Accounts PDF matches email
    items: [transactionItemSchema],
    customerDetails: transactionCustomerSchema,
    gstDetails: transactionGstSchema,

    // payments allocation
    paidInvoices: [paidInvoiceSchema]
  },
  { _id: false }
);

const legalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    gst: String,
    address: String,
    email: String,
    pan: String,
    limit: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    invoice: { type: Number, default: 0 },
    payment: { type: Number, default: 0 }
  },
  { _id: false }
);

const brandingSchema = new mongoose.Schema(
  {
    logoUrl: { type: String, trim: true },
    primaryColor: { type: String, default: '#2563eb', trim: true },
    accentColor: { type: String, default: '#1e40af', trim: true },
    companyName: { type: String, trim: true },
    faviconUrl: { type: String, trim: true },
    loginBanner: { type: String, trim: true },
    supportEmail: { type: String, trim: true },
    supportPhone: { type: String, trim: true },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema(
  {
    organization: {
      type: String,
      required: true,
      trim: true,
      // IMPORTANT: do NOT set `lowercase: true`
      // Keep the original casing exactly as provided by the user.
    },
    templates: { type: [String], default: [] },
    legal: legalSchema,
    transactions: { type: [transactionSchema], default: [] },
    branding: brandingSchema,
  },
  { timestamps: true }
);

// Case-insensitive UNIQUE index on "organization"
// (strength: 2 => case-insensitive; still preserves original casing in stored value)
organizationSchema.index(
  { organization: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

module.exports = mongoose.model('Organization', organizationSchema);
