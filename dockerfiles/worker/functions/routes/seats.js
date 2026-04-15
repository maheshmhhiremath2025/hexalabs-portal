// routes/seats.js
const express = require('express');
const router = express.Router();
const Queue = require('bull');
const VM = require('../models/vm');

const redis = { redis: { host: process.env.REDIS_HOST || 'redis', port: 6379 } };
const startQueue = new Queue('vm-start', redis);
const stopQueue  = new Queue('vm-stop',  redis);

// START
router.post('/:name/start', async (req, res) => {
  const vm = await VM.findOne({ name: req.params.name }, 'name resourceGroup').lean();
  if (!vm) return res.status(404).json({ ok:false, error:'VM not found' });
  await startQueue.add({ name: vm.name });
  res.json({ ok:true, message:'Start queued (recreate from latest snapshot)' });
});

// STOP
router.post('/:name/stop', async (req, res) => {
  const vm = await VM.findOne({ name: req.params.name }, 'name resourceGroup').lean();
  if (!vm) return res.status(404).json({ ok:false, error:'VM not found' });
  await stopQueue.add({ name: vm.name, resourceGroup: vm.resourceGroup });
  res.json({ ok:true, message:'Stop queued (snapshot + delete VM; keep NIC/IP/NSG)' });
});

module.exports = router;
