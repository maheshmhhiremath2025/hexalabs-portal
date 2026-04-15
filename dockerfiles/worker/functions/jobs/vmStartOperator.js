// /usr/src/app/functions/jobs/vmStartOperator.js
const { createVirtualMachineFromLatestSnapshot } = require('../vmcreation/azure'); // <-- fixed path
const VM = require('../../models/vm');

module.exports = async function vmStartOperator(job) {
  const { name } = job.data;
  if (!name) throw new Error('vmStartOperator: missing job.data.name');

  const q = { name };
  const vmDoc = await VM.findOne(q, 'name resourceGroup template').lean();
  if (!vmDoc) throw new Error(`Seat not found: ${name}`);

  const t = vmDoc.template || {};
  const template = {
    resourceGroup: vmDoc.resourceGroup,
    location: t.location,
    vmSize: t.vmSize,
    osType: t.osType || 'Windows',
    tags: Object.assign({}, t.tags || {}, { seatId: vmDoc.name }),
    nicName: `${vmDoc.name}-nic`
  };

  await createVirtualMachineFromLatestSnapshot(vmDoc.name, template);

  await VM.updateOne(q, {
    $set: { isRunning: true, remarks: 'Recreated from latest OS snapshot' },
    $push: { logs: { start: new Date() } }
  });

  return true;
};
