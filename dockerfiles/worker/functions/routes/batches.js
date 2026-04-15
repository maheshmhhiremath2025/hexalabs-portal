// routes/batches.js
const express = require('express');
const router = express.Router();

const VM = require('../models/vm');
const fullPurgeSeat = require('../jobs/batchFullPurgeSeatOperator');

// End Batch — purge all seats in batchId
router.post('/:batchId/purge', async (req, res) => {
  try {
    const { batchId } = req.params;

    const seats = await VM.find({ trainingName: batchId }, 'name resourceGroup').lean();
    if (!seats.length) return res.json({ ok: true, message: 'No seats to purge for this batch' });

    for (const s of seats) {
      await fullPurgeSeat({ data: { resourceGroup: s.resourceGroup, vmName: s.name } });
    }
    return res.json({ ok: true, message: `Batch ${batchId} fully purged`, count: seats.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || e });
  }
});

module.exports = router;
