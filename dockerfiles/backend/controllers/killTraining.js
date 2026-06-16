const VM = require('./../models/vm');
const Container = require('./../models/container');
const Training = require('./../models/training');
const { logger } = require('./../plugins/logger');
const queues = require('./newQueues');

// Container service for Docker cleanup
let containerService;
try { containerService = require('../services/containerService'); } catch {}

// AVD service for host pool cleanup
let avdService;
try { avdService = require('../services/avdService'); } catch {}

/**
 * GET /azure/killTraining?trainingName=xxx&preview=true
 * Preview what will be deleted (no actual deletion).
 */
async function handlePreviewKill(req, res) {
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName required' });
    try {
        const vms = await VM.find({ trainingName, isAlive: true }, 'remarks');
        const containers = await Container.find({ trainingName, isAlive: true });
        const azureVms = vms.filter(v => !v.remarks?.includes('RDS'));
        const rdsServers = vms.filter(v => v.remarks?.includes('RDS Server'));
        const rdsSessions = vms.filter(v => v.remarks?.includes('RDS session'));

        res.json({
            trainingName,
            azureVms: azureVms.length,
            rdsServers: rdsServers.length,
            rdsSessions: rdsSessions.length,
            containers: containers.length,
            total: azureVms.length + rdsServers.length + rdsSessions.length + containers.length,
        });
    } catch (err) {
        res.status(500).json({ message: 'Preview failed' });
    }
}

async function handleKillTraining(req, res) {
    const { trainingName } = req.query;
    if (!trainingName) return res.status(400).json({ message: 'trainingName required' });

    const results = { azureVms: 0, rdsServers: 0, rdsSessions: 0, containers: 0, avd: 0, errors: [] };

    try {
        // 1. Kill Azure VMs (individual + RDS servers)
        const vms = await VM.find({ trainingName, isAlive: true }, "name resourceGroup guacamole remarks");

        for (const vm of vms) {
            try {
                const isRdsSession = vm.remarks?.includes('RDS session');
                const isRdsServer = vm.remarks?.includes('RDS Server');

                if (isRdsSession) {
                    // RDS session entries — just mark as dead, parent server deletion handles Azure cleanup
                    await VM.findByIdAndUpdate(vm._id, { isAlive: false, isRunning: false, remarks: 'Purged' });
                    results.rdsSessions++;
                } else {
                    // Regular VM or RDS server — queue Azure resource deletion
                    await queues['azure-delete-vm'].add(vm);
                    await VM.findByIdAndUpdate(vm._id, { isAlive: false, isRunning: false, remarks: 'Purged' });
                    if (isRdsServer) results.rdsServers++;
                    else results.azureVms++;
                }
            } catch (err) {
                results.errors.push(`VM ${vm.name}: ${err.message}`);
                logger.error(`Purge error for VM ${vm.name}: ${err.message}`);
            }
        }

        // 2. Kill Docker containers
        const containers = await Container.find({ trainingName, isAlive: true });

        for (const c of containers) {
            try {
                if (containerService) {
                    await containerService.deleteContainer(c.containerId);
                } else {
                    await Container.findByIdAndUpdate(c._id, { isAlive: false, isRunning: false, remarks: 'Purged' });
                }
                results.containers++;
            } catch (err) {
                // Container may already be gone from Docker — just mark dead in DB
                await Container.findByIdAndUpdate(c._id, { isAlive: false, isRunning: false, remarks: 'Purged' });
                results.containers++;
                logger.error(`Container purge error ${c.name}: ${err.message}`);
            }
        }

        // 3. Kill AVD host pools (if any matching this training name)
        if (avdService) {
            try {
                const poolName = `hp-${trainingName}`.slice(0, 64);
                await avdService.deleteHostPool(poolName, trainingName);
                results.avd++;
            } catch {
                // No AVD pool for this training — ignore
            }
        }

        // 4. Update training status
        await Training.findOneAndUpdate({ name: trainingName }, {
            status: "deleted",
            schedules: [],
            ports: [],
        });

        const total = results.azureVms + results.rdsServers + results.rdsSessions + results.containers + results.avd;
        logger.info(`Purged training ${trainingName}: ${total} resources (${results.azureVms} VMs, ${results.rdsServers} RDS servers, ${results.rdsSessions} RDS sessions, ${results.containers} containers, ${results.avd} AVD pools)`);

        res.status(200).json({
            message: `Training ${trainingName} purged: ${total} resources cleaned up`,
            details: results,
        });
    } catch (error) {
        logger.error(`Error purging training ${trainingName}: ${error.message}`);
        res.status(500).json({ message: "Purge failed" });
    }
}

module.exports = { handleKillTraining, handlePreviewKill };
