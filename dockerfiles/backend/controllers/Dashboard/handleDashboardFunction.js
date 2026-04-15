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
    
    // Count VMs where quota exceeded (Azure)
    const azureQuotaExceeded = await VM.countDocuments({
      isAlive: true,  // Check if isAlive is true
      $expr: { $gte: ["$quota.consumed", "$quota.total"] }  // Check if consumed >= total
    });
    
    // Count Projects where budget exceeded (GCP)
    const gcpQuotaExceeded = await Project.countDocuments({
      $expr: { $gte: ["$consumed", "$budget"] }  // Check if consumed >= budget
    });
    
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
      projects: projects,
      gcpQuotaExceeded: gcpQuotaExceeded
    });
  } catch (error) {
    console.error('Error in handleDashboardFunction:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}

module.exports = { handleDashboardFunction };
