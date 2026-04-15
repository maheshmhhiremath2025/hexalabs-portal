/**
 * Seed script: Cisco ACI / Data Center Lab template + course analysis
 *
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/userdb node scripts/seed-cisco-aci-template.js
 *
 * After building the golden image on Azure, update GOLDEN_IMAGE_ID below
 * with the actual Azure image resource ID.
 */

const mongoose = require('mongoose');
const Templates = require('../models/templates');

// ── Replace this after capturing the golden image on Azure ──
const GOLDEN_IMAGE_ID = '/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Compute/images/cisco-aci-lab-golden';

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');
  console.log('Connected to MongoDB');

  // ── 1. Azure VM Template (for admin CreateVM page) ──
  const templateName = 'Cisco ACI Lab — Eve-ng + APIC Simulator';
  const existing = await Templates.findOne({ name: templateName });

  if (existing) {
    console.log(`Template "${templateName}" already exists — updating imageId`);
    existing.creation.imageId = GOLDEN_IMAGE_ID;
    await existing.save();
  } else {
    await Templates.create({
      name: templateName,
      rate: 22, // ₹22/hr (D8s_v5 spot ~₹18 + margin)
      creation: {
        resourceGroup: 'cisco-aci-labs',
        vmSize: 'Standard_D8s_v5',   // 8 vCPU / 32 GB — nested virt
        imageId: GOLDEN_IMAGE_ID,
        location: 'southindia',
        os: 'linux',
      },
      display: {
        cpu: '8 vCPU',
        memory: '32 GB',
        os: 'Ubuntu 22.04 + Eve-ng + APIC Sim',
        storage: '128 GB Premium SSD',
        disk: 'P10',
      },
    });
    console.log(`✅ Template "${templateName}" created`);
  }

  // ── 2. Course Analysis entry (for B2B Course Analysis page) ──
  let CourseAnalysis;
  try {
    CourseAnalysis = require('../models/courseAnalysis');
  } catch {
    console.log('CourseAnalysis model not found — skipping analysis entry');
    await mongoose.disconnect();
    return;
  }

  const analysisName = 'Cisco ACI Data Center Training';
  const existingAnalysis = await CourseAnalysis.findOne({ name: analysisName });

  if (existingAnalysis) {
    console.log(`Analysis "${analysisName}" already exists — skipping`);
  } else {
    await CourseAnalysis.create({
      originalFilename: 'cisco-aci-dc-training-labs.xlsx',
      uploadedBy: 'admin@getlabs.cloud',
      customerName: 'Demo Customer',
      status: 'analyzed',
      forceType: 'cloud_sandbox',
      providerHint: 'azure',
      seats: 10,
      requestedTtlHours: 40,

      // AI analysis output
      analysis: {
        detectedProvider: 'azure',
        courseName: analysisName,
        description: 'Cisco ACI Data Center training covering VXLAN (multicast + BGP EVPN), APIC fabric management, access policies, EPG deployment, contracts, L2/L3 outs, service graphs, and VMM integration. Requires Eve-ng with NX-OS 9000v images and Cisco APIC Simulator.',
        difficulty: 'advanced',
        totalHours: 32,
        recommendedDeployment: 'cloud_sandbox',
        modules: [
          { name: 'Multicast-based VXLAN', hours: 4, services: [{ name: 'azure-vm', usage: 'D8s_v5 with nested virt for Eve-ng + NX-OS 9000v' }] },
          { name: 'BGP EVPN VXLAN', hours: 4, services: [{ name: 'azure-vm', usage: 'D8s_v5 with nested virt for Eve-ng + NX-OS 9000v' }] },
          { name: 'Fabric Discovery', hours: 2, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'Logical Constructs', hours: 2, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'Access Policies', hours: 3, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'EPG Deployment', hours: 3, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'Contracts', hours: 3, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'L2out / L3out', hours: 4, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'Service Graph', hours: 3, services: [{ name: 'azure-vm', usage: 'APIC Simulator' }] },
          { name: 'VMM Integration', hours: 4, services: [{ name: 'azure-vm', usage: 'APIC Simulator + vCenter' }] },
        ],
        specialRequirements: [
          'Nested virtualization (KVM) required for Eve-ng and APIC Simulator',
          'Cisco NX-OS 9000v images (licensed)',
          'Cisco APIC Simulator OVA (licensed)',
          'vCenter for VMM Integration lab (optional)',
        ],
      },

      // Cloud feasibility
      feasibility: {
        verdict: 'feasible',
        supported: [
          { service: 'Azure Virtual Machines (D8s_v5)', category: 'compute', riskTier: 'low', reason: 'D-series v5 supports nested virtualization' },
          { service: 'Azure Managed Disks (P10)', category: 'storage', riskTier: 'low', reason: '128 GB SSD for NX-OS + APIC images' },
          { service: 'Azure VNet', category: 'networking', riskTier: 'low', reason: 'Standard virtual network for lab access' },
        ],
        needsReview: [
          { service: 'Cisco NX-OS Images', category: 'licensing', riskTier: 'medium', reason: 'Licensed images must be pre-loaded on golden image' },
          { service: 'APIC Simulator', category: 'licensing', riskTier: 'medium', reason: 'Licensed OVA must be pre-loaded on golden image' },
        ],
        unsupported: [],
        riskFlags: [
          'VMM Integration lab requires vCenter (additional 8 GB RAM per student)',
        ],
      },

      // Container feasibility — NOT suitable
      containerFeasibility: {
        canDeploy: false,
        reason: 'Eve-ng and APIC Simulator require nested virtualization (KVM/QEMU) which is not available in Docker containers. These tools run VMs inside the host, requiring hardware-level CPU virtualization extensions (VT-x/AMD-V).',
        matchedImages: [],
      },

      // Cost estimate
      cost: {
        perSeatInr: 880,      // ₹22/hr × 40 hrs
        totalInr: 8800,        // 10 seats
        marginPercent: 75,
        baselineSeatInr: 50,
        breakdown: [
          { module: 'Eve-ng Labs (VXLAN)', service: 'D8s_v5 Spot VM', hours: 8, rate: 22, subtotal: 176 },
          { module: 'APIC Simulator Labs', service: 'D8s_v5 Spot VM', hours: 24, rate: 22, subtotal: 528 },
          { module: 'VMM Integration', service: 'D8s_v5 Spot VM', hours: 4, rate: 22, subtotal: 88 },
          { module: 'Storage + Network', service: 'P10 SSD + VNet', hours: 40, rate: 2.2, subtotal: 88 },
        ],
      },

      generatedTemplateName: templateName,
    });
    console.log(`✅ Course analysis "${analysisName}" created`);
  }

  await mongoose.disconnect();
  console.log('Done');
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
