const { logger } = require('./../plugins/logger');
const AroCluster = require('./../models/aroCluster');
const aroService = require('./../services/aroService');
const { notifyResourceWelcomeEmail } = require('./../services/emailNotifications');

// ---------------------------------------------------------------------------
// Create a new ARO cluster
// ---------------------------------------------------------------------------
async function handleCreateCluster(req, res) {
  const { userType, email } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const { name, region, workerNodes, workerVmSize, version, trainingName, organization, expiresAt } = req.body;
    if (!name) {
      return res.status(400).send('Cluster name is required');
    }

    // Check for duplicate name
    const existing = await AroCluster.findOne({ name, status: { $nin: ['deleted', 'failed'] } });
    if (existing) {
      return res.status(409).send(`Cluster with name "${name}" already exists`);
    }

    // Provision via service
    const result = await aroService.createAroCluster({
      name,
      region: region || 'southindia',
      workerNodes: workerNodes || 3,
      workerVmSize: workerVmSize || 'Standard_D4s_v3',
      version: version || '4.14',
      expiresAt,
    });

    // Persist to DB
    const cluster = await AroCluster.create({
      ...result,
      trainingName: trainingName || '',
      organization: organization || '',
      createdBy: email,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    logger.info(`[aro] Cluster created by ${email}: ${name} (${cluster.clusterId})`);
    return res.status(201).json(cluster);
  } catch (error) {
    logger.error(`[aro] handleCreateCluster error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// List all ARO clusters
// ---------------------------------------------------------------------------
async function handleGetClusters(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const clusters = await AroCluster.find({ status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(clusters);
  } catch (error) {
    logger.error(`[aro] handleGetClusters error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// Get single cluster details
// ---------------------------------------------------------------------------
async function handleGetCluster(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const cluster = await AroCluster.findById(req.params.id).lean();
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }

    return res.status(200).json(cluster);
  } catch (error) {
    logger.error(`[aro] handleGetCluster error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// Bulk add students to a cluster
// ---------------------------------------------------------------------------
async function handleAddStudents(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const { emails } = req.body;
    const clusterId = req.params.id;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).send('emails array is required');
    }

    const cluster = await AroCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }
    if (cluster.status !== 'ready' && cluster.status !== 'provisioning') {
      return res.status(400).send(`Cluster is in "${cluster.status}" state -- cannot add students`);
    }

    const results = [];
    const errors = [];

    for (const email of emails) {
      // Skip duplicates
      const alreadyExists = cluster.students.find(s => s.email === email && s.status === 'active');
      if (alreadyExists) {
        errors.push({ email, error: 'Student already exists in this cluster' });
        continue;
      }

      try {
        const student = await aroService.addStudentToCluster({
          apiUrl: cluster.apiUrl,
          adminUsername: cluster.adminUsername,
          adminPassword: cluster.adminPassword,
          studentEmail: email,
          consoleUrl: cluster.consoleUrl,
        });

        cluster.students.push({
          email: student.email,
          namespace: student.namespace,
          username: student.username,
          password: student.password,
          role: student.role,
          status: student.status,
          createdAt: student.createdAt,
        });

        results.push(student);
      } catch (err) {
        logger.error(`[aro] Failed to add student ${email}: ${err.message}`);
        errors.push({ email, error: err.message });
      }
    }

    await cluster.save();
    logger.info(`[aro] Added ${results.length} students to cluster ${cluster.name}, ${errors.length} errors`);

    // Send welcome emails to successfully added students (non-blocking)
    for (const student of results) {
      notifyResourceWelcomeEmail({
        email: student.email,
        resourceType: 'aro',
        portalPassword: 'Welcome1234!',
        accessUsername: student.username,
        accessPassword: student.password,
        resourceName: cluster.name,
        trainingName: cluster.trainingName || cluster.name,
        organization: cluster.organization,
        expiresAt: cluster.expiresAt || null,
        clusterName: cluster.name,
        namespace: student.namespace,
        consoleUrl: cluster.consoleUrl,
      }).catch(e => logger.error(`[aro] Welcome email failed for ${student.email}: ${e.message}`));
    }

    return res.status(200).json({ added: results, errors });
  } catch (error) {
    logger.error(`[aro] handleAddStudents error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// Remove a student from a cluster
// ---------------------------------------------------------------------------
async function handleRemoveStudent(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const { id, email } = req.params;
    const cluster = await AroCluster.findById(id);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }

    const student = cluster.students.find(s => s.email === email && s.status === 'active');
    if (!student) {
      return res.status(404).send('Student not found in this cluster');
    }

    // Remove from OpenShift
    await aroService.removeStudentFromCluster({
      apiUrl: cluster.apiUrl,
      adminUsername: cluster.adminUsername,
      adminPassword: cluster.adminPassword,
      namespace: student.namespace,
      username: student.username,
    });

    student.status = 'deleted';
    await cluster.save();

    logger.info(`[aro] Removed student ${email} from cluster ${cluster.name}`);
    return res.status(200).json({ message: `Student ${email} removed from cluster` });
  } catch (error) {
    logger.error(`[aro] handleRemoveStudent error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// Delete an entire cluster
// ---------------------------------------------------------------------------
async function handleDeleteCluster(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const cluster = await AroCluster.findById(req.params.id);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }
    if (cluster.status === 'deleted') {
      return res.status(400).send('Cluster is already deleted');
    }

    // Remove all active student namespaces first
    for (const student of cluster.students) {
      if (student.status === 'active') {
        try {
          await aroService.removeStudentFromCluster({
            apiUrl: cluster.apiUrl,
            adminUsername: cluster.adminUsername,
            adminPassword: cluster.adminPassword,
            namespace: student.namespace,
            username: student.username,
          });
          student.status = 'deleted';
        } catch (err) {
          logger.error(`[aro] Failed to remove student ${student.email} during cluster delete: ${err.message}`);
        }
      }
    }

    // Delete the cluster itself
    await aroService.deleteAroCluster(cluster.resourceGroup, cluster.name);
    cluster.status = 'deleting';
    await cluster.save();

    logger.info(`[aro] Cluster deletion initiated: ${cluster.name} by ${req.user.email}`);
    return res.status(200).json({ message: `Cluster ${cluster.name} deletion initiated` });
  } catch (error) {
    logger.error(`[aro] handleDeleteCluster error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// Scale cluster worker nodes
// ---------------------------------------------------------------------------
async function handleScaleCluster(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized -- admin access required');
    }

    const { workerNodes } = req.body;
    if (workerNodes === undefined || workerNodes < 0) {
      return res.status(400).send('workerNodes is required and must be >= 0');
    }

    const cluster = await AroCluster.findById(req.params.id);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }
    if (cluster.status !== 'ready') {
      return res.status(400).send(`Cluster is in "${cluster.status}" state -- cannot scale`);
    }

    const previousNodes = cluster.workerNodes;
    await aroService.scaleAroCluster(cluster.resourceGroup, cluster.name, workerNodes);

    cluster.workerNodes = workerNodes;
    cluster.status = 'scaling';
    cluster.estimatedHourlyCostInr = await aroService.estimateHourlyCost(workerNodes, cluster.workerVmSize);
    await cluster.save();

    logger.info(`[aro] Cluster ${cluster.name} scaled from ${previousNodes} to ${workerNodes} workers by ${req.user.email}`);
    return res.status(200).json({
      message: `Cluster scaled from ${previousNodes} to ${workerNodes} workers`,
      estimatedHourlyCostInr: cluster.estimatedHourlyCostInr,
    });
  } catch (error) {
    logger.error(`[aro] handleScaleCluster error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

module.exports = {
  handleCreateCluster,
  handleGetClusters,
  handleGetCluster,
  handleAddStudents,
  handleRemoveStudent,
  handleDeleteCluster,
  handleScaleCluster,
};
