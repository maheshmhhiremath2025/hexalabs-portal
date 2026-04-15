const mongoose = require('mongoose');

const vmCostBreakdownSchema = new mongoose.Schema({
  vmName: { type: String, required: true },
  compute: { type: Number, default: 0 },       // VM compute cost
  osDisk: { type: Number, default: 0 },         // OS disk cost
  dataDisk: { type: Number, default: 0 },        // Data disk cost
  networking: { type: Number, default: 0 },      // NIC + Public IP + NSG
  snapshots: { type: Number, default: 0 },       // Snapshot storage
  other: { type: Number, default: 0 },           // Any uncategorized
  total: { type: Number, default: 0 },           // Sum of all above
}, { _id: false });

const labCostSchema = new mongoose.Schema({
  trainingName: { type: String, required: true },
  organization: { type: String, required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  vmCosts: [vmCostBreakdownSchema],
  totalAzureCost: { type: Number, default: 0 },   // Actual Azure spend
  totalBilledAmount: { type: Number, default: 0 }, // What we charge (rate * duration)
  profit: { type: Number, default: 0 },            // billedAmount - azureCost
  currency: { type: String, default: 'INR' },
  vmCount: { type: Number, default: 0 },
  lastSyncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

labCostSchema.index({ trainingName: 1, organization: 1, periodStart: 1 });
labCostSchema.index({ organization: 1 });

const LabCost = mongoose.model('LabCost', labCostSchema);

module.exports = LabCost;
