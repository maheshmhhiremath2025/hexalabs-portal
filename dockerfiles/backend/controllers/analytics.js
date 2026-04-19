const VM = require('../models/vm');
const Container = require('../models/container');
const Training = require('../models/training');
const Organization = require('../models/organization');
const User = require('../models/user');
const { logger } = require('../plugins/logger');

/**
 * GET /admin/analytics/overview
 * Top-level business metrics for superadmin.
 */
async function handleAnalyticsOverview(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });

    const [
      totalVMs, runningVMs, totalContainers, runningContainers,
      totalTrainings, totalOrgs, totalUsers,
      vmStats, containerStats, orgRevenue
    ] = await Promise.all([
      VM.countDocuments({ isAlive: true }),
      VM.countDocuments({ isAlive: true, isRunning: true }),
      Container.countDocuments({ isAlive: true }),
      Container.countDocuments({ isAlive: true, isRunning: true }),
      Training.countDocuments(),
      Organization.countDocuments(),
      User.countDocuments(),

      // VM usage aggregation
      VM.aggregate([
        { $match: { isAlive: true } },
        { $group: {
          _id: null,
          totalDuration: { $sum: '$duration' },
          totalRevenue: { $sum: { $multiply: [{ $divide: ['$duration', 3600] }, '$rate'] } },
          avgQuotaUsed: { $avg: { $cond: [{ $gt: ['$quota.total', 0] }, { $divide: ['$quota.consumed', '$quota.total'] }, 0] } },
        }},
      ]),

      // Container savings
      Container.aggregate([
        { $match: { isAlive: true } },
        { $group: {
          _id: null,
          totalDuration: { $sum: '$duration' },
          containerCost: { $sum: { $multiply: [{ $divide: ['$duration', 3600] }, '$rate'] } },
          azureEquivalent: { $sum: { $multiply: [{ $divide: ['$duration', 3600] }, { $ifNull: ['$azureEquivalentRate', 25] }] } },
        }},
      ]),

      // Revenue per org
      Organization.aggregate([
        { $unwind: { path: '$transactions', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: '$organization',
          totalInvoice: { $sum: { $ifNull: ['$transactions.invoice', 0] } },
          totalPayment: { $sum: { $ifNull: ['$transactions.payment', 0] } },
        }},
        { $sort: { totalInvoice: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const vmData = vmStats[0] || { totalDuration: 0, totalRevenue: 0, avgQuotaUsed: 0 };
    const contData = containerStats[0] || { totalDuration: 0, containerCost: 0, azureEquivalent: 0 };
    const containerSavings = contData.azureEquivalent - contData.containerCost;

    res.json({
      instances: {
        vms: { total: totalVMs, running: runningVMs },
        containers: { total: totalContainers, running: runningContainers },
      },
      usage: {
        totalRuntimeHours: Math.round((vmData.totalDuration + contData.totalDuration) / 3600),
        vmRuntimeHours: Math.round(vmData.totalDuration / 3600),
        containerRuntimeHours: Math.round(contData.totalDuration / 3600),
        avgQuotaUtilization: Math.round(vmData.avgQuotaUsed * 100),
      },
      revenue: {
        vmRevenue: Math.round(vmData.totalRevenue),
        containerRevenue: Math.round(contData.containerCost),
        totalRevenue: Math.round(vmData.totalRevenue + contData.containerCost),
        containerSavings: Math.round(containerSavings),
      },
      counts: {
        trainings: totalTrainings,
        organizations: totalOrgs,
        users: totalUsers,
      },
      topOrganizations: orgRevenue,
    });
  } catch (err) {
    logger.error(`Analytics overview error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
}

/**
 * GET /admin/analytics/customers
 * Per-customer usage and revenue breakdown.
 */
async function handleCustomerAnalytics(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });

    const customers = await Training.aggregate([
      {
        $lookup: {
          from: 'vms',
          localField: 'name',
          foreignField: 'trainingName',
          as: 'vms',
        },
      },
      {
        $lookup: {
          from: 'containers',
          localField: 'name',
          foreignField: 'trainingName',
          as: 'containers',
        },
      },
      {
        $group: {
          _id: '$organization',
          labs: { $sum: 1 },
          vmCount: { $sum: { $size: '$vms' } },
          containerCount: { $sum: { $size: '$containers' } },
          totalVmDuration: { $sum: { $sum: '$vms.duration' } },
          totalContainerDuration: { $sum: { $sum: '$containers.duration' } },
          vmRevenue: { $sum: { $sum: { $map: { input: '$vms', as: 'v', in: { $multiply: [{ $divide: ['$$v.duration', 3600] }, '$$v.rate'] } } } } },
          containerRevenue: { $sum: { $sum: { $map: { input: '$containers', as: 'c', in: { $multiply: [{ $divide: ['$$c.duration', 3600] }, '$$c.rate'] } } } } },
          runningVms: { $sum: { $size: { $filter: { input: '$vms', cond: { $eq: ['$$this.isRunning', true] } } } } },
          runningContainers: { $sum: { $size: { $filter: { input: '$containers', cond: { $eq: ['$$this.isRunning', true] } } } } },
          idleVms: { $sum: { $size: { $filter: { input: '$vms', cond: { $and: [{ $eq: ['$$this.isRunning', true] }, { $eq: ['$$this.autoShutdown', false] }] } } } } },
        },
      },
      { $sort: { vmRevenue: -1 } },
    ]);

    res.json(customers.map(c => ({
      organization: c._id,
      labs: c.labs,
      instances: { vms: c.vmCount, containers: c.containerCount, running: c.runningVms + c.runningContainers },
      runtimeHours: Math.round((c.totalVmDuration + c.totalContainerDuration) / 3600),
      revenue: Math.round(c.vmRevenue + c.containerRevenue),
      vmRevenue: Math.round(c.vmRevenue),
      containerRevenue: Math.round(c.containerRevenue),
      idleVms: c.idleVms,
    })));
  } catch (err) {
    logger.error(`Customer analytics error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch customer analytics' });
  }
}

/**
 * GET /admin/analytics/idle
 * VMs that are running but potentially wasting money (no autoShutdown).
 */
async function handleIdleAnalytics(req, res) {
  try {
    if (req.user.userType !== 'superadmin') return res.status(403).json({ message: 'Forbidden' });

    // VMs running without auto-shutdown = potential waste
    const idleRisk = await VM.find({
      isAlive: true,
      isRunning: true,
      autoShutdown: { $ne: true },
    }).select('name trainingName organization rate duration quota').sort({ rate: -1 });

    const totalWastePerHour = idleRisk.reduce((sum, vm) => sum + (vm.rate || 0), 0);

    res.json({
      count: idleRisk.length,
      totalWastePerHour,
      totalWastePerDay: totalWastePerHour * 24,
      totalWastePerMonth: totalWastePerHour * 720,
      vms: idleRisk.map(vm => ({
        name: vm.name,
        training: vm.trainingName,
        organization: vm.organization,
        rate: vm.rate,
        runtimeHours: Math.round((vm.duration || 0) / 3600),
        quotaUsed: vm.quota?.total > 0 ? Math.round((vm.quota.consumed / vm.quota.total) * 100) : 0,
      })),
    });
  } catch (err) {
    logger.error(`Idle analytics error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch idle analytics' });
  }
}

/**
 * GET /admin/analytics/students
 * Per-student usage breakdown. Filterable by trainingName and/or organization.
 * Returns one row per email aggregating VMs + containers.
 */
async function handleStudentAnalytics(req, res) {
  try {
    const { userType } = req.user || {};
    if (userType !== 'superadmin' && userType !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const match = { isAlive: true };
    if (req.query.trainingName) match.trainingName = req.query.trainingName;
    if (req.query.organization && userType !== 'admin') {
      // superadmin can scope to any org; admin is implicitly scoped to their own
      match.organization = req.query.organization;
    }
    if (userType === 'admin' && req.user.organization) {
      match.organization = req.user.organization;
    }

    const aggrPipeline = [
      { $match: match },
      {
        $group: {
          _id: '$email',
          trainings: { $addToSet: '$trainingName' },
          instanceCount: { $sum: 1 },
          runningCount: { $sum: { $cond: ['$isRunning', 1, 0] } },
          totalDuration: { $sum: { $ifNull: ['$duration', 0] } },
          totalCost: { $sum: { $multiply: [{ $divide: [{ $ifNull: ['$duration', 0] }, 3600] }, { $ifNull: ['$rate', 0] }] } },
          firstSeen: { $min: '$createdAt' },
          lastSeen: { $max: '$updatedAt' },
        },
      },
    ];

    const [vmRows, contRows] = await Promise.all([
      VM.aggregate(aggrPipeline),
      Container.aggregate(aggrPipeline),
    ]);

    // Merge by email
    const byEmail = new Map();
    const seed = (email) => {
      if (!byEmail.has(email)) {
        byEmail.set(email, {
          email,
          trainings: new Set(),
          vmInstances: 0, vmRunning: 0, vmHours: 0, vmCost: 0,
          containerInstances: 0, containerRunning: 0, containerHours: 0, containerCost: 0,
          firstSeen: null, lastSeen: null,
        });
      }
      return byEmail.get(email);
    };

    for (const r of vmRows) {
      const row = seed(r._id);
      (r.trainings || []).forEach(t => row.trainings.add(t));
      row.vmInstances += r.instanceCount;
      row.vmRunning += r.runningCount;
      row.vmHours += Math.round((r.totalDuration || 0) / 3600);
      row.vmCost += Math.round(r.totalCost || 0);
      if (r.firstSeen && (!row.firstSeen || r.firstSeen < row.firstSeen)) row.firstSeen = r.firstSeen;
      if (r.lastSeen && (!row.lastSeen || r.lastSeen > row.lastSeen)) row.lastSeen = r.lastSeen;
    }
    for (const r of contRows) {
      const row = seed(r._id);
      (r.trainings || []).forEach(t => row.trainings.add(t));
      row.containerInstances += r.instanceCount;
      row.containerRunning += r.runningCount;
      row.containerHours += Math.round((r.totalDuration || 0) / 3600);
      row.containerCost += Math.round(r.totalCost || 0);
      if (r.firstSeen && (!row.firstSeen || r.firstSeen < row.firstSeen)) row.firstSeen = r.firstSeen;
      if (r.lastSeen && (!row.lastSeen || r.lastSeen > row.lastSeen)) row.lastSeen = r.lastSeen;
    }

    const students = Array.from(byEmail.values())
      .map(s => ({
        ...s,
        trainings: Array.from(s.trainings),
        totalInstances: s.vmInstances + s.containerInstances,
        totalRunning: s.vmRunning + s.containerRunning,
        totalHours: s.vmHours + s.containerHours,
        totalCost: s.vmCost + s.containerCost,
        // Engagement signal: students with > 0 hours but no recent activity in 7 days
        isStale: s.lastSeen && ((Date.now() - new Date(s.lastSeen).getTime()) > 7 * 24 * 3600 * 1000) && s.totalRunning === 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    res.json({
      total: students.length,
      filter: { trainingName: match.trainingName || null, organization: match.organization || null },
      students,
    });
  } catch (err) {
    logger.error(`Student analytics error: ${err.message}`);
    res.status(500).json({ message: 'Failed to fetch student analytics' });
  }
}

module.exports = { handleAnalyticsOverview, handleCustomerAnalytics, handleIdleAnalytics, handleStudentAnalytics };
