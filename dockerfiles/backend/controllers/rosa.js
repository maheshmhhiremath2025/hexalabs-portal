const { logger } = require('./../plugins/logger');
const RosaCluster = require('./../models/rosaCluster');
const rosaService = require('./../services/rosaService');
const { notifyResourceWelcomeEmail } = require('./../services/emailNotifications');

// ---------------------------------------------------------------------------
// Create a new ROSA cluster
// ---------------------------------------------------------------------------
async function handleCreateCluster(req, res) {
  const { userType, email } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized — admin access required');
    }

    const { name, region, workerNodes, workerInstanceType, version, trainingName, organization, expiresAt } = req.body;
    if (!name) {
      return res.status(400).send('Cluster name is required');
    }

    // Check for duplicate name
    const existing = await RosaCluster.findOne({ name, status: { $nin: ['deleted', 'failed'] } });
    if (existing) {
      return res.status(409).send(`Cluster with name "${name}" already exists`);
    }

    // Provision via service
    const result = await rosaService.createRosaCluster({
      name,
      region: region || 'ap-south-1',
      workerNodes: workerNodes || 3,
      workerInstanceType: workerInstanceType || 'm5.xlarge',
      version: version || '4.14',
      expiresAt,
    });

    // Persist to DB
    const cluster = await RosaCluster.create({
      ...result,
      trainingName: trainingName || '',
      organization: organization || '',
      createdBy: email,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    logger.info(`[rosa] Cluster created by ${email}: ${name} (${cluster.clusterId})`);
    return res.status(201).json(cluster);
  } catch (error) {
    logger.error(`[rosa] handleCreateCluster error: ${error.message}`);
    return res.status(500).send('Internal server error');
  }
}

// ---------------------------------------------------------------------------
// List all ROSA clusters
// ---------------------------------------------------------------------------
async function handleGetClusters(req, res) {
  const { userType } = req.user;
  try {
    if (userType !== 'superadmin') {
      return res.status(403).send('Unauthorized — admin access required');
    }

    const clusters = await RosaCluster.find({ status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(clusters);
  } catch (error) {
    logger.error(`[rosa] handleGetClusters error: ${error.message}`);
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
      return res.status(403).send('Unauthorized — admin access required');
    }

    const cluster = await RosaCluster.findById(req.params.id).lean();
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }

    return res.status(200).json(cluster);
  } catch (error) {
    logger.error(`[rosa] handleGetCluster error: ${error.message}`);
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
      return res.status(403).send('Unauthorized — admin access required');
    }

    const { emails } = req.body;
    const clusterId = req.params.id;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).send('emails array is required');
    }

    const cluster = await RosaCluster.findById(clusterId);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }
    if (cluster.status !== 'ready' && cluster.status !== 'provisioning') {
      return res.status(400).send(`Cluster is in "${cluster.status}" state — cannot add students`);
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
        const student = await rosaService.addStudentToCluster({
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
        logger.error(`[rosa] Failed to add student ${email}: ${err.message}`);
        errors.push({ email, error: err.message });
      }
    }

    await cluster.save();
    logger.info(`[rosa] Added ${results.length} students to cluster ${cluster.name}, ${errors.length} errors`);

    // Send welcome emails to successfully added students (non-blocking)
    for (const student of results) {
      notifyResourceWelcomeEmail({
        email: student.email,
        resourceType: 'rosa',
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
      }).catch(e => logger.error(`[rosa] Welcome email failed for ${student.email}: ${e.message}`));
    }

    return res.status(200).json({ added: results, errors });
  } catch (error) {
    logger.error(`[rosa] handleAddStudents error: ${error.message}`);
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
      return res.status(403).send('Unauthorized — admin access required');
    }

    const { id, email } = req.params;
    const cluster = await RosaCluster.findById(id);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }

    const student = cluster.students.find(s => s.email === email && s.status === 'active');
    if (!student) {
      return res.status(404).send('Student not found in this cluster');
    }

    // Remove from OpenShift
    await rosaService.removeStudentFromCluster({
      apiUrl: cluster.apiUrl,
      adminUsername: cluster.adminUsername,
      adminPassword: cluster.adminPassword,
      namespace: student.namespace,
      username: student.username,
    });

    student.status = 'deleted';
    await cluster.save();

    logger.info(`[rosa] Removed student ${email} from cluster ${cluster.name}`);
    return res.status(200).json({ message: `Student ${email} removed from cluster` });
  } catch (error) {
    logger.error(`[rosa] handleRemoveStudent error: ${error.message}`);
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
      return res.status(403).send('Unauthorized — admin access required');
    }

    const cluster = await RosaCluster.findById(req.params.id);
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
          await rosaService.removeStudentFromCluster({
            apiUrl: cluster.apiUrl,
            adminUsername: cluster.adminUsername,
            adminPassword: cluster.adminPassword,
            namespace: student.namespace,
            username: student.username,
          });
          student.status = 'deleted';
        } catch (err) {
          logger.error(`[rosa] Failed to remove student ${student.email} during cluster delete: ${err.message}`);
        }
      }
    }

    // Delete the cluster itself
    await rosaService.deleteRosaCluster(cluster.clusterId, cluster.name);
    cluster.status = 'deleting';
    await cluster.save();

    logger.info(`[rosa] Cluster deletion initiated: ${cluster.name} by ${req.user.email}`);
    return res.status(200).json({ message: `Cluster ${cluster.name} deletion initiated` });
  } catch (error) {
    logger.error(`[rosa] handleDeleteCluster error: ${error.message}`);
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
      return res.status(403).send('Unauthorized — admin access required');
    }

    const { workerNodes } = req.body;
    if (workerNodes === undefined || workerNodes < 0) {
      return res.status(400).send('workerNodes is required and must be >= 0');
    }

    const cluster = await RosaCluster.findById(req.params.id);
    if (!cluster) {
      return res.status(404).send('Cluster not found');
    }
    if (cluster.status !== 'ready') {
      return res.status(400).send(`Cluster is in "${cluster.status}" state — cannot scale`);
    }

    const previousNodes = cluster.workerNodes;
    await rosaService.scaleCluster(cluster.clusterId, cluster.name, workerNodes);

    cluster.workerNodes = workerNodes;
    cluster.status = 'scaling';
    cluster.estimatedHourlyCostInr = await rosaService.estimateHourlyCost(workerNodes, cluster.workerInstanceType);
    await cluster.save();

    logger.info(`[rosa] Cluster ${cluster.name} scaled from ${previousNodes} to ${workerNodes} workers by ${req.user.email}`);
    return res.status(200).json({
      message: `Cluster scaled from ${previousNodes} to ${workerNodes} workers`,
      estimatedHourlyCostInr: cluster.estimatedHourlyCostInr,
    });
  } catch (error) {
    logger.error(`[rosa] handleScaleCluster error: ${error.message}`);
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
