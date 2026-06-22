// Lab Console — godeploy-style left-panel + right-iframe wrapper
// New 2026-06-09 — surface VM creds, lab guide, timer, notes in one console
const express = require('express');
const router = express.Router();
const VM = require('../models/vm');
const User = require('../models/user');
const Template = require('../models/templates');
const queues = require('../controllers/newQueues');
const { getVmAccessUrl } = require('../services/guacamoleService');
const { logger } = require('../plugins/logger');

// Look up a VM the requester is allowed to see.
async function findVmForUser(req, vmName) {
  const role = req.user?.userType;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const filter = { name: vmName };
  if (!isAdmin) filter.email = req.user.email;
  return VM.findOne(filter).lean();
}

// Build per-VM lab guide content. For now we point at the in-VM HTML guide and
// also include a basic checklist; future versions read per-template markdown
// from /labs/<template-name>/guide.md stored on the portal.
function guideFor(templateName) {
  const map = {
    'syntex-guidedlab': {
      title: 'Microsoft Syntex — Guided Lab',
      summary: '9-module hands-on covering models, content assembly, taxonomy, REST API.',
      sections: [
        { num: 1, title: 'Intro to Syntex',         note: 'Set up Syntex + Create a content center' },
        { num: 2, title: 'Build Syntex Models',     note: 'Unstructured / Freeform / Structured' },
        { num: 3, title: 'Manage Syntex Models',    note: 'Prebuilt Invoices + Receipts; retention + sensitivity labels' },
        { num: 4, title: 'Content Assembly',        note: 'Modern templates + Power Automate' },
        { num: 5, title: 'Content Processing',      note: 'Rules, annotations, content query' },
        { num: 6, title: 'Taxonomy',                note: 'SKOS import; PnP PowerShell alternative' },
        { num: 7, title: 'Adoption',                note: 'Scenarios, value calculator' },
        { num: 8, title: 'Solutions & Templates',   note: 'Contracts management lab' },
        { num: 9, title: 'Extensibility (REST API)',note: 'Postman + PowerShell hands-on' },
      ],
      inVmPath: 'file:///C:/SyntexLabs/sidepanel/index.html',
    },
  };
  return map[templateName] || {
    title: templateName || 'Lab',
    summary: 'Open the lab guide on the VM Desktop, or click GUIDE for the live walk-through.',
    sections: [],
    inVmPath: null,
  };
}

// GET /lab/session/:vmName — everything the Lab Console page needs in one round-trip
router.get('/session/:vmName', async (req, res) => {
  try {
    const vm = await findVmForUser(req, req.params.vmName);
    if (!vm) return res.status(404).json({ message: 'VM not found or not yours' });

    // Time remaining = min(quota.total - consumed*60 in minutes, expiresAt - now)
    const totalMin     = vm.quota?.total || 0;
    const consumedMin  = Math.round((vm.quota?.consumed || 0) * 60);
    const quotaMinLeft = Math.max(0, totalMin - consumedMin);
    let timeLeftSec    = quotaMinLeft * 60;
    if (vm.expiresAt) {
      const expSec = Math.max(0, Math.floor((new Date(vm.expiresAt).getTime() - Date.now()) / 1000));
      timeLeftSec  = Math.min(timeLeftSec, expSec);
    }

    // Portal creds for the requester (used by the cohort)
    const portalUser = await User.findOne({ email: vm.email }, 'email organization trainingName').lean();

    // Browser-access URL (Guacamole / KasmVNC / DCV)
    let accessUrl = null;
    if (vm.dcv && vm.publicIp) {
      // NICE DCV web client (AWS path) — direct HTTPS to instance on 8443
      if (vm.dcvPort) {
        accessUrl = 'https://portal.labsoncloud.online:' + vm.dcvPort + '/?username=' + encodeURIComponent(vm.adminUsername || 'labuser') + '&password=' + encodeURIComponent(vm.adminPass || '') + '&autoconnect=true';
      } else {
        // Pre-Phase-4 fallback for any legacy DCV VM without dcvPort yet
        accessUrl = 'https://' + vm.publicIp + ':8443/?username=' + encodeURIComponent(vm.adminUsername || 'labuser') + '&password=' + encodeURIComponent(vm.adminPass || '') + '&autoconnect=true';
      }
    }
    if (!accessUrl) try {
      const result = await getVmAccessUrl({
        vmName:       vm.name,
        publicIp:     vm.publicIp,
        adminUsername:vm.adminUsername,
        adminPassword:vm.adminPass,
        os:           vm.os,
        useVnc:       !!vm.kasmVnc,
        vncPort:      vm.vncPort || 6901,
        xrdp:         !!vm.hasXrdp,
      });
      accessUrl = result?.accessUrl || null;
    } catch (e) { logger.warn('[labConsole] getVmAccessUrl failed: ' + e.message); }

    // Lab guide — choose by template
    const guide = guideFor(vm.templateName);

    return res.json({
      vm: {
        name: vm.name, publicIp: vm.publicIp, os: vm.os,
        isRunning: vm.isRunning, isAlive: vm.isAlive,
        organization: vm.organization, trainingName: vm.trainingName,
        templateName: vm.templateName,
        expiresAt: vm.expiresAt, notes: vm.notes || '',
      },
      creds: {
        vm: { username: vm.adminUsername, password: vm.adminPass },
        portal: { username: vm.email, password: 'Welcome1234!' },
      },
      timer: { totalSec: totalMin * 60, leftSec: timeLeftSec },
      guide,
      accessUrl,
      prerequisites: { status: vm.isAlive ? 'Successfully Deployed' : 'Provisioning' },
    });
  } catch (err) {
    logger.error('[labConsole] session: ' + err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /lab/session/:vmName/notes — debounced save from the side-panel
router.post('/session/:vmName/notes', express.json(), async (req, res) => {
  try {
    const vm = await findVmForUser(req, req.params.vmName);
    if (!vm) return res.status(404).json({ message: 'VM not found or not yours' });
    const notes = (req.body?.notes || '').toString().slice(0, 16384);
    await VM.updateOne({ _id: vm._id }, { $set: { notes } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /lab/session/:vmName/end — queue stop via the portal flow
router.post('/session/:vmName/end', async (req, res) => {
  try {
    const vm = await findVmForUser(req, req.params.vmName);
    if (!vm) return res.status(404).json({ message: 'VM not found or not yours' });
    const stopQueue = vm.cloud === 'aws' ? 'aws-stop-vm' : 'azure-stop-vm';
    await queues[stopQueue].add({ vmName: vm.name, email: vm.email, trainingName: vm.trainingName });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
