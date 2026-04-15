/**
 * Night / Weekend Auto-Pause
 *
 * Stops all running containers (and optionally VMs) during off-hours to
 * save hosting costs. Resumes them before the next working session.
 *
 * Default schedule (IST):
 *   PAUSE:  10:00 PM (22:00) every day
 *   RESUME:  7:00 AM (07:00) every day
 *
 * This saves 37.5% of daily compute (9 off-hours out of 24) for a
 * typical training that runs 9 AM - 6 PM with a 1-hour buffer on
 * each side.
 *
 * How it works:
 *   - Runs every minute from the main cron
 *   - Checks the current IST hour against PAUSE_HOUR and RESUME_HOUR
 *   - At PAUSE_HOUR: stops all running containers, logs who was stopped
 *   - At RESUME_HOUR: restarts all containers that were night-paused
 *   - Only acts on containers with nightPause=true (default true for
 *     new deploys, can be disabled per-training for 24/7 courses)
 *   - Does NOT touch containers that were manually stopped by the student
 *     (checks for the 'night-paused' remark to distinguish)
 *
 * Env vars:
 *   NIGHT_PAUSE_HOUR    = 22  (10 PM IST — when to stop)
 *   NIGHT_RESUME_HOUR   = 7   (7 AM IST — when to restart)
 *   NIGHT_PAUSE_ENABLED = true (global kill switch)
 */

const Docker = require('dockerode');
const Container = require('../models/container');
const { logger } = require('../plugins/logger');

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

const PAUSE_HOUR = parseInt(process.env.NIGHT_PAUSE_HOUR || '22', 10);   // 10 PM IST
const RESUME_HOUR = parseInt(process.env.NIGHT_RESUME_HOUR || '7', 10);  // 7 AM IST
const ENABLED = (process.env.NIGHT_PAUSE_ENABLED || 'true') !== 'false';

// Track whether we already ran the pause/resume this hour so we don't
// re-run on every cron tick within the same hour.
let lastPauseHour = -1;
let lastResumeHour = -1;

async function nightPause() {
  if (!ENABLED) return;

  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istHour = (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 1 : 0)) % 24;
  const istMinute = (now.getUTCMinutes() + 30) % 60;

  // --- PAUSE (10 PM IST) ---
  if (istHour === PAUSE_HOUR && istMinute < 5 && lastPauseHour !== istHour) {
    lastPauseHour = istHour;
    logger.info(`[night-pause] 🌙 Night pause triggered at ${istHour}:${String(istMinute).padStart(2, '0')} IST`);

    const running = await Container.find({
      isAlive: true,
      isRunning: true,
    });

    // Filter: only pause containers that don't have explicit 24/7 flag
    const toPause = running.filter(c => {
      // Skip if the container was deployed with nightPause explicitly disabled
      // (we check for the absence of a 'no-night-pause' remark)
      if (c.remarks && c.remarks.includes('no-night-pause')) return false;
      return true;
    });

    if (toPause.length === 0) {
      logger.info('[night-pause] No containers to pause');
      return;
    }

    let paused = 0;
    for (const c of toPause) {
      try {
        const container = docker.getContainer(c.containerId);
        await container.stop();

        c.isRunning = false;
        // Tag with 'night-paused' so we know to resume it in the morning
        // (vs a container the student manually stopped)
        if (!c.remarks?.includes('night-paused')) {
          c.remarks = (c.remarks || '').replace(/ \| night-paused/g, '') + ' | night-paused';
        }
        // Update log
        const lastLog = c.logs[c.logs.length - 1];
        if (lastLog && !lastLog.stop) {
          lastLog.stop = now;
          lastLog.duration = Math.floor((now - new Date(lastLog.start)) / 1000);
          c.duration = (c.duration || 0) + lastLog.duration;
          c.quota.consumed = Math.round((c.duration / 3600) * 100) / 100;
        }
        await c.save();
        paused++;
      } catch (err) {
        logger.error(`[night-pause] Failed to pause ${c.name}: ${err.message}`);
      }
    }

    logger.info(`[night-pause] Paused ${paused}/${toPause.length} containers for the night`);

    // Notify ops (one summary, not per-student)
    if (sendEmail && process.env.GMAIL_USER) {
      sendEmail(process.env.GMAIL_USER,
        `[GetLabs] Night pause — ${paused} containers stopped`,
        `<p>${paused} containers were automatically stopped at ${PAUSE_HOUR}:00 IST to save costs.</p>
         <p>They will auto-resume at ${RESUME_HOUR}:00 IST.</p>
         <p>Containers: ${toPause.map(c => c.name).join(', ')}</p>`
      ).catch(() => {});
    }
  }

  // --- RESUME (7 AM IST) ---
  if (istHour === RESUME_HOUR && istMinute < 5 && lastResumeHour !== istHour) {
    lastResumeHour = istHour;
    logger.info(`[night-pause] ☀️ Morning resume triggered at ${istHour}:${String(istMinute).padStart(2, '0')} IST`);

    // Find containers that were night-paused (not manually stopped)
    const nightPaused = await Container.find({
      isAlive: true,
      isRunning: false,
      remarks: /night-paused/,
    });

    if (nightPaused.length === 0) {
      logger.info('[night-pause] No containers to resume');
      return;
    }

    let resumed = 0;
    for (const c of nightPaused) {
      try {
        const container = docker.getContainer(c.containerId);
        await container.start();

        c.isRunning = true;
        c.remarks = (c.remarks || '').replace(/ \| night-paused/g, '');
        c.logs.push({ start: new Date() });
        c.idleSince = null; // reset idle timer
        await c.save();
        resumed++;
      } catch (err) {
        logger.error(`[night-pause] Failed to resume ${c.name}: ${err.message}`);
      }
    }

    logger.info(`[night-pause] Resumed ${resumed}/${nightPaused.length} containers`);

    // Notify ops
    if (sendEmail && process.env.GMAIL_USER) {
      sendEmail(process.env.GMAIL_USER,
        `[GetLabs] Morning resume — ${resumed} containers restarted`,
        `<p>${resumed} containers were automatically restarted at ${RESUME_HOUR}:00 IST.</p>
         <p>All labs are ready for the day.</p>`
      ).catch(() => {});
    }
  }
}

module.exports = { nightPause };
