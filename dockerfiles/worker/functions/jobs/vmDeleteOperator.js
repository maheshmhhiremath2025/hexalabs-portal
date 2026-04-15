// /usr/src/app/functions/jobs/vmDeleteOperator.js
const VM = require('../../models/vm');
const { DeleteVMandResources } = require('../vmdeletion/azure'); // <-- fixed path

module.exports = async function vmDeleteOperator(job) {
  const { name, resourceGroup } = job.data || {};
  if (!name || !resourceGroup) throw new Error('vmDeleteOperator: missing name/resourceGroup');

  try {
    const doc = await VM.findOne({ name }, 'isRunning logs duration');
    if (doc && doc.isRunning) {
      const idx = (doc.logs || []).findIndex(l => !l.stop);
      if (idx >= 0) doc.logs[idx].stop = new Date();
      const startTime = doc.logs[idx]?.start ? new Date(doc.logs[idx].start) : null;
      const minutes = startTime ? Math.ceil((Date.now() - startTime.getTime()) / 60000) : 0;

      await VM.updateOne({ name }, {
        $set: { isRunning: false, remarks: 'Stopped (snapshot+delete VM)', duration: (doc.duration || 0) + minutes },
        $push: { logs: { stop: new Date() } }
      });
    }
  } catch (e) {
    console.warn('[STOP] Bookkeeping warn:', e.message || e);
  }

  await DeleteVMandResources(name, resourceGroup);
  return true;
};
