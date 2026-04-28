const { ComputeManagementClient } = require('@azure/arm-compute');
const { DefaultAzureCredential } = require('@azure/identity');
const VM = require('../models/vm');
const Container = require('../models/container');
const Docker = require('dockerode');
const { logger } = require('../plugins/logger');

const subscriptionId = process.env.SUBSCRIPTION_ID;

// ─── Run a verification command on a VM or Container ────────────────────
// Detects whether the instance is a container or Azure VM and routes accordingly.

async function runVerifyCommand(instanceName, command, timeoutSec = 30) {
  // First try container (most common for guided labs)
  const container = await Container.findOne({ name: instanceName }).lean();
  if (container) {
    return runContainerCommand(container, command, timeoutSec);
  }

  // Fallback to Azure VM
  const vm = await VM.findOne({ name: instanceName }).lean();
  if (vm) {
    return runAzureVmCommand(vm, instanceName, command);
  }

  throw new Error(`Instance ${instanceName} not found (checked both containers and VMs)`);
}

// ─── Run command inside a Docker container via exec ─────────────────────

async function runContainerCommand(container, command, timeoutSec = 30) {
  if (!container.isRunning) throw new Error(`Container ${container.name} is not running`);
  if (!container.containerId) throw new Error(`Container ${container.name} has no Docker container ID`);

  // Use same Docker connection logic as containerService:
  // Remote hosts connect via TCP, local containers use Docker socket
  const docker = (container.dockerHostIp && container.dockerHostIp !== 'localhost')
    ? new Docker({ host: container.dockerHostIp, port: container.dockerHostPort || 2376 })
    : new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

  try {
    const dockerContainer = docker.getContainer(container.containerId);

    const exec = await dockerContainer.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    // Collect output with timeout
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command timed out after ${timeoutSec}s`));
      }, timeoutSec * 1000);

      // Dockerode multiplexes stdout/stderr into a single stream
      // Use demuxStream to separate them
      const stdoutStream = { write: (chunk) => { stdout += chunk.toString(); } };
      const stderrStream = { write: (chunk) => { stderr += chunk.toString(); } };
      docker.modem.demuxStream(stream, stdoutStream, stderrStream);

      stream.on('end', () => {
        clearTimeout(timer);
        resolve({ stdout, stderr });
      });
      stream.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Get exit code
    const inspectData = await exec.inspect();
    const exitCode = inspectData.ExitCode ?? (stderr && !stdout ? 1 : 0);

    const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');
    logger.info(`[lab-verify] container ${container.name}: command="${command}" exit=${exitCode} → ${output.slice(0, 200)}`);

    return { output, exitCode };
  } catch (err) {
    logger.error(`[lab-verify] container ${container.name} exec failed: ${err.message}`);
    throw new Error(`Container exec failed: ${err.message}`);
  }
}

// ─── Run command on an Azure VM via RunCommand API ──────────────────────

async function runAzureVmCommand(vm, vmName, command) {
  if (!vm.isRunning) throw new Error(`VM ${vmName} is not running`);

  const credential = new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  const isWindows = (vm.os || '').toLowerCase().includes('windows');
  const commandId = isWindows ? 'RunPowerShellScript' : 'RunShellScript';

  try {
    const result = await computeClient.virtualMachines.beginRunCommandAndWait(
      vm.resourceGroup, vmName,
      { commandId, script: [command] }
    );

    const stdout = result.value?.[0]?.message || '';
    const stderr = result.value?.[1]?.message || '';
    const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');

    logger.info(`[lab-verify] ${vmName}: command="${command}" → ${output.slice(0, 200)}`);

    return {
      output,
      exitCode: stderr && !stdout ? 1 : 0,
    };
  } catch (err) {
    logger.error(`[lab-verify] ${vmName} RunCommand failed: ${err.message}`);
    throw new Error(`RunCommand failed: ${err.message}`);
  }
}

module.exports = { runVerifyCommand };
