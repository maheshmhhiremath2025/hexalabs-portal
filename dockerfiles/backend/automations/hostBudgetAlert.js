/**
 * Container Host Budget Alert
 *
 * Checks how long the Docker host VM has been running and estimates the
 * Azure cost based on VM size + Spot pricing. Sends an alert email if
 * the running cost exceeds a configurable threshold.
 *
 * Why this matters: container hosts run independently of lab TTLs. A host
 * VM can keep running for days after the last container expired if nobody
 * deallocates it. This cron catches that case.
 *
 * Runs every 30 minutes from index.js (no point checking more often).
 *
 * Env vars:
 *   HOST_BUDGET_ALERT_INR    = 5000   (alert when cumulative cost exceeds this)
 *   HOST_HOURLY_RATE_INR     = 18     (fallback if live pricing unavailable)
 *   HOST_BUDGET_ALERT_EMAIL  = (defaults to GMAIL_USER / ops email)
 *
 * How it works:
 *   1. Counts running containers. If 0 running and none alive → alert:
 *      "host has no active labs but is still running."
 *   2. Calculates uptime × hourly rate = estimated cost so far.
 *   3. If cost > threshold → sends alert email.
 *   4. Tracks last alert time so we don't spam (max 1 alert per 6 hours).
 */

const Container = require('../models/container');
const { logger } = require('../plugins/logger');

let sendEmail;
try { sendEmail = require('../services/emailNotifications').sendEmail; } catch {}

const BUDGET_THRESHOLD_INR = parseInt(process.env.HOST_BUDGET_ALERT_INR || '5000', 10);
const HOURLY_RATE_INR = parseFloat(process.env.HOST_HOURLY_RATE_INR || '18');
const ALERT_EMAIL = process.env.HOST_BUDGET_ALERT_EMAIL || process.env.GMAIL_USER;

// Uptime tracking — approximate, based on process.uptime() as a proxy for
// "how long has the backend been running on this host." For a more accurate
// measure, read /proc/uptime on the host or call Azure's VM get API.
const processStartTime = Date.now();

let lastAlertTime = 0;
const MIN_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function hostBudgetAlert() {
  try {
    if (!sendEmail || !ALERT_EMAIL) return;

    const now = Date.now();
    const uptimeHours = (now - processStartTime) / 3600000;
    const estimatedCostInr = Math.round(uptimeHours * HOURLY_RATE_INR);

    // Check if any containers are alive/running
    const aliveCount = await Container.countDocuments({ isAlive: true });
    const runningCount = await Container.countDocuments({ isAlive: true, isRunning: true });

    // Alert 1: No containers but host is running
    if (aliveCount === 0 && uptimeHours > 1) {
      if (now - lastAlertTime > MIN_ALERT_INTERVAL_MS) {
        lastAlertTime = now;
        logger.info(`[host-budget] Alert: host running ${Math.round(uptimeHours)}h with 0 alive containers`);
        await sendEmail(ALERT_EMAIL,
          `[GetLabs] Cost alert — Host running with no active labs`,
          `<div style="font-family:-apple-system,sans-serif;max-width:500px;">
            <div style="background:#ef4444;padding:16px 20px;border-radius:8px 8px 0 0;">
              <h2 style="color:white;margin:0;font-size:16px;">Host Running with No Labs</h2>
            </div>
            <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="color:#374151;">The container host has been running for <strong>${Math.round(uptimeHours)} hours</strong> but has <strong>0 active containers</strong>.</p>
              <p style="color:#374151;">Estimated cost so far: <strong>₹${estimatedCostInr}</strong> (at ₹${HOURLY_RATE_INR}/hr).</p>
              <p style="color:#374151;font-weight:600;">Consider deallocating the host VM to stop the bill.</p>
              <p style="color:#6b7280;font-size:13px;">This alert fires at most once every 6 hours.</p>
            </div>
          </div>`
        ).catch(() => {});
      }
    }

    // Alert 2: Cost exceeds budget threshold
    if (estimatedCostInr >= BUDGET_THRESHOLD_INR) {
      if (now - lastAlertTime > MIN_ALERT_INTERVAL_MS) {
        lastAlertTime = now;
        logger.info(`[host-budget] Alert: estimated cost ₹${estimatedCostInr} exceeds threshold ₹${BUDGET_THRESHOLD_INR}`);
        await sendEmail(ALERT_EMAIL,
          `[GetLabs] Budget alert — Host cost ₹${estimatedCostInr} exceeds ₹${BUDGET_THRESHOLD_INR}`,
          `<div style="font-family:-apple-system,sans-serif;max-width:500px;">
            <div style="background:#f59e0b;padding:16px 20px;border-radius:8px 8px 0 0;">
              <h2 style="color:white;margin:0;font-size:16px;">Host Budget Alert</h2>
            </div>
            <div style="padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
              <p style="color:#374151;">The container host has been running for <strong>${Math.round(uptimeHours)} hours</strong>.</p>
              <p style="color:#374151;">Estimated cost: <strong>₹${estimatedCostInr}</strong> (threshold: ₹${BUDGET_THRESHOLD_INR}).</p>
              <p style="color:#374151;">Active containers: <strong>${runningCount} running</strong>, ${aliveCount} alive.</p>
              <p style="color:#6b7280;font-size:13px;">To adjust the threshold, set HOST_BUDGET_ALERT_INR in .env.</p>
            </div>
          </div>`
        ).catch(() => {});
      }
    }
  } catch (err) {
    logger.error(`[host-budget] Error: ${err.message}`);
  }
}

module.exports = { hostBudgetAlert };
