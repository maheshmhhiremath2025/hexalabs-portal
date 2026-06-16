/**
 * Workshop controller — backend handlers for trainer-built templates.
 *
 * All routes under this controller are gated by WORKSHOP_ENABLED=true env flag.
 * Kill switch: set WORKSHOP_ENABLED=false + pm2 reload synergific-backend → all
 * workshop endpoints return 404. Existing portal flows untouched either way.
 */
const queues = require('./newQueues');
const VM = require('../models/vm');
const { logger } = require('./../plugins/logger');
const awsDcvNginx = require('../services/awsDcvNginx');

// ---------- Static catalog (Phase 4) ----------
// Two Linux+DCV bases baked in Phase 2. Sizes match the mockup's grid.

const BASES = [
  {
    id: 'ubuntu22',
    name: 'Ubuntu 22.04 LTS',
    description: 'XFCE desktop + DCV. Lightweight (~6 GB at rest).',
    amiId: 'ami-01a66b4549ccee268',
    os: 'Linux',
  },
  {
    id: 'rocky9',
    name: 'Rocky Linux 9',
    description: 'GNOME Server + DCV. Full RHEL-compatible stack.',
    amiId: 'ami-0461aecc70199915d',
    os: 'Linux',
  },
  {
    id: 'windows2022',
    name: 'Windows Server 2022',
    description: 'Lightweight Win Server + DCV + full Hexalabs optimization pack.',
    amiId: 'ami-0b2773c1fcb40c465',
    os: 'Windows',
  },
];

const SIZES = [
  { id: 't3.medium',   vcpu: 2,  ramGB: 4,  pricePerDay: 45 },
  { id: 'm5.large',    vcpu: 2,  ramGB: 8,  pricePerDay: 65 },
  { id: 'm5.xlarge',   vcpu: 4,  ramGB: 16, pricePerDay: 110 },
  { id: 'm5.2xlarge',  vcpu: 8,  ramGB: 32, pricePerDay: 230 },
  { id: 'm5.4xlarge',  vcpu: 16, ramGB: 64, pricePerDay: 430 },
];

const MIN_DISK_GB = 30;
const MAX_DISK_GB = 500;
const DEFAULT_DISK_GB = 30;  // matches lightest Windows base AMI footprint

// ---------- Helpers ----------

function isWorkshopRole(req) {
  const t = req.user?.userType;
  return t === 'superadmin' || t === 'admin';
}

function rand4() {
  return Math.random().toString(36).slice(2, 6);
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

function buildVmName(email, targetTemplateName) {
  const prefix = slugify((email || '').split('@')[0]).slice(0, 12) || 'wks';
  const target = slugify(targetTemplateName) || 'build';
  return `${prefix}-${target}-${rand4()}`.slice(0, 56);
}

function findBase(baseId) { return BASES.find(b => b.id === baseId); }
function findSize(sizeId) { return SIZES.find(s => s.id === sizeId); }

// ---------- Handlers ----------

async function handleGetCatalog(req, res) {
  res.json({
    bases: BASES,
    sizes: SIZES,
    diskRange: { min: MIN_DISK_GB, max: MAX_DISK_GB, default: DEFAULT_DISK_GB },
  });
}

async function handleListMyBuilds(req, res) {
  const email = req.user?.email;
  if (!email) return res.status(401).json({ message: 'Auth required' });
  const filter = req.user?.userType === 'superadmin'
    ? { isBuildVM: true }
    : { isBuildVM: true, templateBuildOf: email };
  const builds = await VM.find(filter)
    .select('name templateBuildOf targetTemplateName publicIp dcvPort isRunning isAlive remarks vmSize createdAt logs')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ builds });
}

async function handleBuild(req, res) {
  try {
    if (!isWorkshopRole(req)) return res.status(403).json({ message: 'Admin or superadmin required' });
    const { baseId, sizeId, diskSizeGB, targetTemplateName } = req.body;
    const email = req.user?.email;
    if (!email) return res.status(401).json({ message: 'Auth required' });
    if (!targetTemplateName || targetTemplateName.length < 3) {
      return res.status(400).json({ message: 'targetTemplateName required (≥3 chars)' });
    }
    const base = findBase(baseId);
    const size = findSize(sizeId);
    if (!base) return res.status(400).json({ message: `Unknown baseId: ${baseId}` });
    if (!size) return res.status(400).json({ message: `Unknown sizeId: ${sizeId}` });
    const disk = Math.min(Math.max(Number(diskSizeGB || DEFAULT_DISK_GB), MIN_DISK_GB), MAX_DISK_GB);

    // Cap per trainer: max 5 active build VMs (per the no-runaway rule from the spec)
    const activeCount = await VM.countDocuments({ isBuildVM: true, templateBuildOf: email, isAlive: true });
    if (activeCount >= 5) {
      return res.status(429).json({ message: `Build VM cap reached (${activeCount}/5). Delete or snapshot an existing build first.` });
    }

    const vmName = buildVmName(email, targetTemplateName);
    const dcvPort = await awsDcvNginx.allocateFreePort();

    // Create build VM doc — uses additive Phase 1 schema fields.
    await VM.create({
      name: vmName,
      email,
      organization: req.user?.organization || 'workshop',
      trainingName: 'workshop',
      templateName: base.id,
      vmSize: size.id,
      cloud: 'aws',
      dcv: true,
      dcvPort,
      isBuildVM: true,
      templateBuildOf: email,
      targetTemplateName,
      isRunning: false,
      isAlive: true,
      remarks: 'Queued',
      adminUsername: 'labuser',
      adminPass: 'Welcome1234!',
      os: base.os,
      rate: 0,
      quota: { total: 10000, consumed: 0 }, // generous default; trainer-scoped
      publicIp: 'pending',
      resourceGroup: 'pending',
      logs: [],
    });

    await queues['aws-workshop-build'].add({
      vmName, email,
      organization: req.user?.organization || 'workshop',
      baseAmi: base.amiId,
      instanceType: size.id,
      diskSizeGB: disk,
      targetTemplateName,
      dcvPort,
    }, { jobId: `wks-build-${vmName}-${Date.now()}` });

    logger.info(`[workshop] ${email} queued build ${vmName} (${base.id}, ${size.id}, ${disk}GB)`);
    res.json({ vmName, dcvPort, message: 'Build queued' });
  } catch (err) {
    logger.error(`[workshop] handleBuild error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

async function handleResize(req, res) {
  try {
    if (!isWorkshopRole(req)) return res.status(403).json({ message: 'Admin or superadmin required' });
    const vmName = req.params.vmName;
    const { sizeId } = req.body;
    const size = findSize(sizeId);
    if (!size) return res.status(400).json({ message: `Unknown sizeId: ${sizeId}` });

    const vm = await VM.findOne({ name: vmName, isBuildVM: true });
    if (!vm) return res.status(404).json({ message: 'Build VM not found' });
    if (vm.templateBuildOf !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Not your build VM' });
    }

    await queues['aws-workshop-resize'].add({ vmName, newInstanceType: size.id });
    res.json({ message: 'Resize queued' });
  } catch (err) {
    logger.error(`[workshop] handleResize error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

async function handleGrowDisk(req, res) {
  try {
    if (!isWorkshopRole(req)) return res.status(403).json({ message: 'Admin or superadmin required' });
    const vmName = req.params.vmName;
    const { newSizeGB } = req.body;
    const size = Number(newSizeGB);
    if (!size || size < MIN_DISK_GB || size > MAX_DISK_GB) {
      return res.status(400).json({ message: `newSizeGB must be ${MIN_DISK_GB}-${MAX_DISK_GB}` });
    }
    const vm = await VM.findOne({ name: vmName, isBuildVM: true });
    if (!vm) return res.status(404).json({ message: 'Build VM not found' });
    if (vm.templateBuildOf !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Not your build VM' });
    }
    await queues['aws-workshop-grow-disk'].add({ vmName, newSizeGB: size });
    res.json({ message: `Disk grow queued → ${size} GB` });
  } catch (err) {
    logger.error(`[workshop] handleGrowDisk error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

async function handleSnapshot(req, res) {
  try {
    if (!isWorkshopRole(req)) return res.status(403).json({ message: 'Admin or superadmin required' });
    const vmName = req.params.vmName;
    const { templateName, description, visibility } = req.body;
    if (!templateName || templateName.length < 3) {
      return res.status(400).json({ message: 'templateName required (≥3 chars)' });
    }
    const allowedVis = ['private', 'org', 'global'];
    const vis = allowedVis.includes(visibility) ? visibility : 'private';
    const vm = await VM.findOne({ name: vmName, isBuildVM: true });
    if (!vm) return res.status(404).json({ message: 'Build VM not found' });
    if (vm.templateBuildOf !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Not your build VM' });
    }
    await queues['aws-workshop-snapshot'].add({
      vmName, templateName, description: description || '',
      visibility: vis, email: req.user.email,
    });
    res.json({ message: `Snapshot queued — template ${templateName}` });
  } catch (err) {
    logger.error(`[workshop] handleSnapshot error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

async function handleDelete(req, res) {
  try {
    if (!isWorkshopRole(req)) return res.status(403).json({ message: 'Admin or superadmin required' });
    const vmName = req.params.vmName;
    const vm = await VM.findOne({ name: vmName, isBuildVM: true });
    if (!vm) return res.status(404).json({ message: 'Build VM not found' });
    if (vm.templateBuildOf !== req.user.email && req.user.userType !== 'superadmin') {
      return res.status(403).json({ message: 'Not your build VM' });
    }
    // Reuse existing aws-delete-vm queue for actual cleanup (terminate instance + clean nginx)
    await queues['aws-delete-vm'].add({ vmName, email: vm.email, trainingName: vm.trainingName });
    res.json({ message: 'Delete queued' });
  } catch (err) {
    logger.error(`[workshop] handleDelete error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
}

module.exports = {
  handleGetCatalog, handleListMyBuilds, handleBuild,
  handleResize, handleGrowDisk, handleSnapshot, handleDelete,
};
