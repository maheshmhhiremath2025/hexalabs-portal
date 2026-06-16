/**
 * Container Idle Auto-Stop
 *
 * Mirrors the VM idle shutdown automation (automations/idleShutdown.js) but
 * for Docker containers. Runs every 5 minutes from index.js.
 *
 * How it works:
 *   1. Finds all running containers with autoShutdown enabled
 *   2. Checks Docker stats for each — if CPU < threshold for idleMinutes,
 *      the container is considered idle
 *   3. Stops idle containers (docker stop) and marks isRunning=false in DB
 *   4. Sends notification email to the student
 *   5. Student clicks "Start" in Lab Console → container resumes in 2-3s
 *
 * Docker CPU check is LOCAL (no cloud API call) — much faster and cheaper
 * than the VM idle check which calls Azure Monitor. We use dockerode to
 * read /containers/{id}/stats in one-shot mode.
 *
 * Configuration per container (set at deploy time):
 *   autoShutdown: true/false    (default: false for backward compat)
 *   idleMinutes: 30             (default: 30 min of < 3% CPU = idle)
 */

const Container = require('../models/container');
const { logger } = require('../plugins/logger');
const { getDockerForContainer } = require('../services/containerService');

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

const DEFAULT_IDLE_MINUTES = 30;
// KasmVNC + window-manager + compositor daemons idle around 4-8% CPU
// in workspace containers. Active user sessions spike to 20-40%+. 15%
// sits cleanly between the two — below it = "nobody's driving",
// above = "user is doing something". Tunable via env.
const CPU_IDLE_THRESHOLD = Number(process.env.CONTAINER_CPU_IDLE_THRESHOLD) || 15;

/**
 * Get current CPU usage % for a container via Docker stats (one-shot).
 * Returns null if the container isn't running or stats unavailable.
 */
async function getContainerCpuPercent(doc) {
  try {
    const container = getDockerForContainer(doc).getContainer(doc.containerId);
    const stats = await container.stats({ stream: false });

    // Docker stats returns a zero-timestamp + empty cpu_stats for STOPPED
    // containers (no throw). We must return null so the drift-fix branch
    // in the caller reconciles Mongo isRunning=false. Without this guard,
    // the deltas below are 0, cpuPercent returns 0, and we never escape.
    if (!stats || !stats.read || stats.read.startsWith('0001-01-01')
        || !stats.cpu_stats || !stats.cpu_stats.cpu_usage
        || stats.cpu_stats.cpu_usage.total_usage === undefined) {
      return null;
    }

    // Docker stats CPU calculation (same formula as `docker stats` CLI)
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;

    if (systemDelta > 0 && cpuDelta >= 0) {
      return (cpuDelta / systemDelta) * numCpus * 100;
    }
    return 0;
  } catch (err) {
    // Container might not be running or might not exist
    return null;
  }
}

/**
 * Main checker — runs every 5 minutes.
 */
async function containerIdleShutdown() {
  try {
    const containers = await Container.find({
      isAlive: true,
      isRunning: true,
      autoShutdown: true,
    });

    if (containers.length === 0) return;

    const now = new Date();
    const summary = { checked: containers.length, idleMarked: 0, stopped: 0, active: 0, unreachable: 0 };

    for (const c of containers) {
      const idleMinutes = c.idleMinutes || DEFAULT_IDLE_MINUTES;

      // Get current CPU
      const cpuPercent = await getContainerCpuPercent(c);
      if (cpuPercent === null) {
        // CPU stats unavailable. Two causes:
        //   (a) container is actually stopped on docker — Mongo isRunning=true is stale (drift)
        //   (b) docker daemon unreachable — defer
        // Distinguish with a lightweight inspect; if docker says not running, fix Mongo.
        try {
          const insp = await getDockerForContainer(c).getContainer(c.containerId).inspect();
          const dockerStatus = insp && insp.State && insp.State.Status;
          if (dockerStatus && dockerStatus !== 'running') {
            // Drift detected — close the open log entry against actual FinishedAt so usage
            // report reflects reality, then mark Mongo isRunning=false.
            const stopAt = (insp.State && insp.State.FinishedAt && insp.State.FinishedAt !== '0001-01-01T00:00:00Z')
              ? new Date(insp.State.FinishedAt)
              : new Date();
            const lastLog = c.logs[c.logs.length - 1];
            if (lastLog && !lastLog.stop) {
              lastLog.stop = stopAt;
              lastLog.duration = Math.max(0, Math.floor((stopAt - new Date(lastLog.start)) / 60000));
              c.duration = (c.duration || 0) + lastLog.duration;
              if (c.quota) c.quota.consumed = Math.round((c.duration / 60) * 100) / 100;
            }
            c.isRunning = false;
            c.idleSince = null;
            c.remarks = (c.remarks || '') + ` | Drift-corrected (docker=${dockerStatus})`;
            await c.save();
            summary.driftFixed = (summary.driftFixed || 0) + 1;
            logger.warn(`[container-idle] Drift fix ${c.name}: docker=${dockerStatus} but Mongo isRunning=true → set false`);
            continue;
          }
        } catch (err) {
          // Inspect failed — host or container truly unreachable. Don't touch Mongo.
        }
        summary.unreachable++;
        continue;
      }

      if (cpuPercent < CPU_IDLE_THRESHOLD) {
        // CPU is below threshold. Check if it's BEEN idle long enough.
        // We track idle start time in a lightweight field: idleSince.
        if (!c.idleSince) {
          // First time we see it idle — mark the start, don't stop yet
          c.idleSince = now;
          await c.save();
          summary.idleMarked++;
          continue;
        }

        const idleDurationMs = now - new Date(c.idleSince);
        const idleDurationMins = idleDurationMs / 60000;

        if (idleDurationMins >= idleMinutes) {
          summary.stopped++;
          // Container has been idle for longer than the threshold — stop it
          logger.info(`[container-idle] Stopping idle container ${c.name} (idle ${Math.round(idleDurationMins)}m, threshold ${idleMinutes}m, CPU ${cpuPercent.toFixed(1)}%)`);

          try {
            const container = getDockerForContainer(c).getContainer(c.containerId);
            await container.stop();
          } catch (err) {
            logger.error(`[container-idle] Docker stop failed for ${c.name}: ${err.message}`);
          }

          c.isRunning = false;
          c.idleSince = null;

          // Update last log entry
          const lastLog = c.logs[c.logs.length - 1];
          if (lastLog && !lastLog.stop) {
            lastLog.stop = now;
            lastLog.duration = Math.floor((now - new Date(lastLog.start)) / 60000);
            c.duration = (c.duration || 0) + lastLog.duration;
            c.quota.consumed = Math.round((c.duration / 60) * 100) / 100;
          }
          c.remarks = (c.remarks || '') + ` | Auto-stopped (idle ${Math.round(idleDurationMins)}m)`;
          await c.save();

          // Email the student
          if (sendEmail && c.email) {
            sendEmail(c.email,
              `[GetLabs] Lab paused — ${c.name} (idle for ${Math.round(idleDurationMins)} min)`,
              `<div style="font-family:-apple-system,sans-serif;max-width:500px;">
                <div style="background:#6b7280;padding:16px 20px;border-radius:8px 8px 0 0;">
                  <h2 style="color:white;margin:0;font-size:16px;">Lab Paused — Idle Timeout</h2>
                </div>
                <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
                  <p style="color:#374151;">Your lab <strong>${c.name}</strong> was automatically paused because it was idle for ${Math.round(idleDurationMins)} minutes.</p>
                  <p style="color:#374151;">Don't worry — your work is saved. Click <strong>"Start"</strong> in the Lab Console to resume in a few seconds.</p>
                  <p style="color:#6b7280;font-size:13px;">This saves resources while you're away. The idle timeout is ${idleMinutes} minutes.</p>
                </div>
              </div>`
            ).catch(() => {});
          }

          logger.info(`[container-idle] Container ${c.name} stopped (idle ${Math.round(idleDurationMins)}m)`);
        }
        // else: idle but not long enough yet — keep waiting
      } else {
        // Container is active — reset idle timer
        summary.active++;
        if (c.idleSince) {
          c.idleSince = null;
          await c.save();
        }
      }
    }
    logger.info(`[container-idle] cycle: checked=${summary.checked} active=${summary.active} idleMarked=${summary.idleMarked} stopped=${summary.stopped} driftFixed=${summary.driftFixed||0} unreachable=${summary.unreachable} threshold=${CPU_IDLE_THRESHOLD}%`);
  } catch (err) {
    logger.error(`[container-idle] Fatal: ${err.message}`);
  }
}

module.exports = { containerIdleShutdown };
