const Organization = require('./../../models/organization');
const Templates = require('./../../models/templates');
const Training = require('./../../models/training');
const VM = require('./../../models/vm');
const User = require('./../../models/user');
const Project = require('./../../models/project');

async function handleDashboardFunction(req, res) {
  try {
    // Fetch general statistics
    const organization = await Organization.countDocuments();
    const users = await User.countDocuments();
    const trainings = await Training.countDocuments();
    const invoicePending = await Training.countDocuments({ status: "deleted" });

    // Fetch Azure and GCP statistics
    const projects = await Project.countDocuments();
    const templates = await Templates.countDocuments();
    const vms = await VM.countDocuments();
    
    // Count VMs where quota exceeded (Azure) + return who, for the home-page alert
    const azureQuotaExceededDocs = await VM.find(
      { isAlive: true, $expr: { $gte: ["$quota.consumed", "$quota.total"] } },
      { vmName: 1, email: 1, organization: 1, trainingName: 1, quota: 1, _id: 0 }
    ).limit(20).lean();
    const azureQuotaExceeded = azureQuotaExceededDocs.length;
    const azureQuotaExceededList = azureQuotaExceededDocs.map(d => ({
      vmName: d.vmName,
      email: d.email,
      organization: d.organization,
      trainingName: d.trainingName,
      consumed: d?.quota?.consumed || 0,
      total: d?.quota?.total || 0,
    }));
    
    // Count Projects where budget exceeded (GCP) + return who
    const gcpQuotaExceededDocs = await Project.find(
      { $expr: { $gte: ["$consumed", "$budget"] } },
      { projectName: 1, projectId: 1, email: 1, organization: 1, trainingName: 1, consumed: 1, budget: 1, _id: 0 }
    ).limit(20).lean();
    const gcpQuotaExceeded = gcpQuotaExceededDocs.length;
    
    // Count unique GCP training names
    const gcpTraining = await Project.aggregate([
      {
        $group: {
          _id: "$trainingName",  // Group by trainingName to find unique values
        }
      },
      {
        $count: "uniqueTrainingCount"  // Count the number of unique trainingNames
      }
    ]);

    // Ensure uniqueTrainingCount is properly initialized
    const uniqueTrainingCount = gcpTraining.length > 0 ? gcpTraining[0].uniqueTrainingCount : 0;

    // Rough storage estimate — Azure managed-disk footprint for alive VMs plus
    // captured template snapshots. Defaults: Windows OS disk 127 GiB,
    // Linux 30 GiB, template snapshot 40 GiB. No Azure API calls; gives
    // superadmin a realistic TB figure on the dashboard.
    const osBuckets = await VM.aggregate([
      { $match: { isAlive: true } },
      { $group: { _id: { $toLower: { $ifNull: ['$os', 'linux'] } }, count: { $sum: 1 } } },
    ]);
    let windowsVms = 0, linuxVms = 0;
    for (const b of osBuckets) {
      if (String(b._id).startsWith('win')) windowsVms += b.count;
      else linuxVms += b.count;
    }
    const storageEstimateGB = windowsVms * 127 + linuxVms * 30 + templates * 40;

    // Send the JSON response
    res.json({
      organization: organization,
      users: users,
      azureTraining: trainings,
      gcpTraining: uniqueTrainingCount,
      templates: templates,
      virtualMachines: vms,
      invoicePending: invoicePending,
      azureQuotaExceeded: azureQuotaExceeded,
      azureQuotaExceededList: azureQuotaExceededList,
      projects: projects,
      gcpQuotaExceeded: gcpQuotaExceeded,
      gcpQuotaExceededList: gcpQuotaExceededDocs,
      storage: {
        estimateGB: storageEstimateGB,
        windowsVms,
        linuxVms,
        templates,
      },
    });
  } catch (error) {
    console.error('Error in handleDashboardFunction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

module.exports = { handleDashboardFunction };
