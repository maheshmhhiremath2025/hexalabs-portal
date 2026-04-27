const { createRdsServer, getRdsCostComparison, RDS_VM_SIZES } = require('../services/rdsService');
const { logger } = require('../plugins/logger');
const { notifyRdsLabReady, notifyOpsDeploySummary } = require('../services/emailNotifications');
const { buildOpenInBrowserUrl } = require('../services/guacamoleService');

const rdsJobs = new Map();

async function handleCreateRds(req, res) {
  try {
    if (req.user.userType !== 'superadmin' && req.user.userType !== 'admin')
      return res.status(403).json({ message: 'Forbidden' });

    let { trainingName, organization, vmSize = 'medium', userCount = 10, emails = [], resourceGroup, location, vnet, allocatedHours = 100, autoShutdown = false, idleMinutes = 15, expiresAt } = req.body;

    // Enforce max users per VM size
    const maxUsers = RDS_VM_SIZES[vmSize]?.maxUsers || 30;
    if (userCount > maxUsers) userCount = maxUsers;
    if (!trainingName || !organization) return res.status(400).json({ message: 'trainingName and organization required' });

    const sizeConfig = RDS_VM_SIZES[vmSize] || RDS_VM_SIZES['medium'];
    const jobId = `rds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    rdsJobs.set(jobId, {
      status: 'running',
      phase: 'Creating Windows Server VM...',
      totalSteps: 5, // IP + NSG + NIC + VM + RDS setup
      completedSteps: 0,
      startedAt: Date.now(),
    });

    res.json({ jobId, userCount, vmSize: sizeConfig.vmSize, message: 'RDS deployment started' });

    // Background
    (async () => {
      const job = rdsJobs.get(jobId);
      try {
        job.phase = 'Provisioning Windows Server VM (Spot)...';
        const result = await createRdsServer({
          trainingName, organization, vmSize, userCount, emails, resourceGroup, location, vnet,
          allocatedHours, autoShutdown, idleMinutes, expiresAt,
        });
        job.completedSteps = 4;
        job.status = 'done';
        job.phase = 'Complete';
        job.result = result;
        job.finishedAt = Date.now();
        job.duration = Math.round((job.finishedAt - job.startedAt) / 1000);

        // Single consolidated email to the admin who submitted the request
        // (one roster, per-row "Open in browser" link, Mac/Windows guide).
        if (result.users?.length) {
          const adminEmail = req.user?.email;
          if (adminEmail) {
            const vmName = result.serverName;
            notifyRdsLabReady({
              adminEmail,
              trainingName,
              organization,
              hostIp: result.publicIp,
              adminUsername: result.adminUsername,
              adminPassword: result.adminPassword,
              adminOpenInBrowserUrl: buildOpenInBrowserUrl(null, vmName),
              users: result.users.map(u => ({
                username: u.username,
                password: u.password,
                email: u.email,
                openInBrowserUrl: buildOpenInBrowserUrl(null, `${vmName}-${u.username}`),
              })),
              expiresAt: expiresAt || null,
            }).catch(e => logger.error(`RDS lab-ready email failed for ${adminEmail}: ${e.message}`));
          }

          // Ops summary (internal record) — keep plain tabular format
          if (adminEmail) {
            notifyOpsDeploySummary({
              opsEmail: adminEmail,
              trainingName,
              organization,
              imageLabel: `Windows RDS · ${result.vmSize} · ${result.userCount} users`,
              containers: result.users.map(u => ({
                name: u.username,
                email: u.email,
                accessUrl: `rdp://${result.publicIp}`,
                password: u.password,
                sshPort: '3389 (RDP)',
              })),
            }).catch(e => logger.error(`RDS ops summary email failed: ${e.message}`));
          }
        }
      } catch (err) {
        job.status = 'failed';
        job.phase = `Error: ${err.message}`;
        logger.error(`RDS deploy failed: ${err.message}`);
      }
      setTimeout(() => rdsJobs.delete(jobId), 10 * 60 * 1000);
    })();
  } catch (err) {
    logger.error(`RDS create error: ${err.message}`);
    res.status(500).json({ message: 'Failed to start RDS deployment' });
  }
}

async function handleRdsDeployStatus(req, res) {
  const job = rdsJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job not found' });
  res.json({
    status: job.status, phase: job.phase,
    totalSteps: job.totalSteps, completedSteps: job.completedSteps,
    progress: Math.round((job.completedSteps / job.totalSteps) * 100),
    result: job.status === 'done' ? job.result : null,
    duration: job.duration || Math.round((Date.now() - job.startedAt) / 1000),
  });
}

async function handleRdsCostCompare(req, res) {
  const users = parseInt(req.query.users || '10');
  const vmSize = req.query.vmSize || 'medium';
  res.json(await getRdsCostComparison(users, vmSize));
}

async function handleGetRdsOptions(req, res) {
  res.json({ vmSizes: RDS_VM_SIZES });
}

module.exports = { handleCreateRds, handleRdsDeployStatus, handleRdsCostCompare, handleGetRdsOptions };
