// jobs/batchFullPurgeSeatOperator.js
const { FullPurgeSeat } = require('../functions/vmdeletion/azureFullPurge');
const VM = require('../models/vm');

// if you already have a Guac remover, use it; else stub
async function removeGuacConnection(vmName) {
  // TODO: call your existing Guac removal here
  return true;
}

module.exports = async (job) => {
  const { resourceGroup, vmName } = job.data;

  // 1) Azure cleanup
  await FullPurgeSeat(resourceGroup, vmName);

  // 2) Guacamole cleanup
  try { await removeGuacConnection(vmName); } catch {}

  // 3) App data cleanup (VM doc, logs, etc.)
  try { await VM.deleteOne({ name: vmName }); } catch {}
  // If you keep a separate Logs collection, delete here too
  // try { await Logs.deleteMany({ vmName }); } catch {}

  return true;
};
