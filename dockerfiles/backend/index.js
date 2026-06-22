const express = require('express');
const { logger } = require('./plugins/logger');
const cookieParser = require('cookie-parser');
const { connectMongoDB } = require('./connection')
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config()

// Prevent unhandled Redis/Bull errors from crashing the entire backend.
// Redis may not be running in local dev — that's OK, queues just won't work.
process.on('unhandledRejection', (err) => {
  if (err?.message?.includes('maxRetriesPerRequest') || err?.message?.includes('ECONNREFUSED')) {
    logger.warn(`Redis/Bull connection failed (Redis not running?): ${err.message}`);
  } else {
    logger.error(`Unhandled rejection: ${err?.message || err}`);
  }
});
const { scheduleChecker, quotaChecker } = require('./automations/azure')
const { syncAllTrainingCosts } = require('./services/azureCostService')
const { getCostCenter } = require('./services/costCenterService')
const { idleShutdownChecker } = require('./automations/idleShutdown')
const { quotaEnforcer } = require('./automations/quotaEnforcer')
const { gcpSandboxCleanup } = require('./automations/gcpSandbox')
const { batchExpiryCheck } = require('./automations/batchExpiry')
const { sandboxResourceCleanup } = require('./automations/sandboxResourceCleanup')
const { awsCleanup } = require('./automations/awsSandbox')
const { ociSandboxCleanup } = require('./automations/ociSandbox')
const { labExpiryChecker } = require('./automations/labExpiry')
const { sandboxDeploymentCleanup } = require('./automations/sandboxDeploymentCleanup')
const { containerIdleShutdown } = require('./automations/containerIdleShutdown')
const { nightPause } = require('./automations/nightPause')
const { dockerHostScaler } = require('./automations/dockerHostScaler')
const { vmStateReconciler } = require('./automations/vmStateReconciler')
const awsDcvNginx = require('./services/awsDcvNginx')
const { rebuildFromDb: rebuildNginxUpstreams } = require('./services/nginxUpstreamManager')
const { hostBudgetAlert } = require('./automations/hostBudgetAlert')
const { orphanCleanupJob } = require('./automations/orphanCleanup')
const { azureOrphanSweeper, azureSandboxRgSweeper } = require('./automations/azureOrphanSweeper')
const { rosaCleanup } = require('./automations/rosaCleanup')
const { aroCleanup } = require('./automations/aroCleanup')
const { spotEvictionHandler } = require('./automations/spotEvictionHandler')
const { vmAutoRestart } = require('./automations/vmAutoRestart')
const { checkQuotaWarnings } = require('./services/emailNotifications')

// Variables
const app = express();
const PORT = process.env.PORT || 8001;
const userRoute = require('./routes/user');
const adminRoute = require('./routes/admin');
const azureRoute = require('./routes/azure');
const gcpRoute = require("./routes/gcp");
const openRoute = require('./routes/open')
const sandboxRoute = require('./routes/sandbox')
const awsRoute = require('./routes/aws')
const containerRoute = require('./routes/containers')
const rdsRoute = require('./routes/rds')
const gcpSandboxRoute = require('./routes/gcpSandbox')
const teamRoute = require('./routes/team')
const customImageRoute = require('./routes/customImage')
const publicApiRoute = require('./routes/publicApi')
const selfserviceRoute = require('./routes/selfservice')
const ociSandboxRoute = require('./routes/ociSandbox')
const kasmProxyRoute = require('./routes/kasmProxy')
const b2bCoursesRoute = require('./routes/b2bCourses')
const rosaRoute = require('./routes/rosa')
const aroRoute = require('./routes/aro')
const guidedLabRoute = require('./routes/guidedLab')

const { restrictToLoggedinUserOnly, checkAuth } = require('./middlewares/auth');
const { azureSandbox } = require('./automations/azureSandbox');

const corsOptions = {
  origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,https://hsdf.hexalabs.online,https://portal.labsoncloud.online,https://www.cloudportal.co.in,https://www.hexalabs.online,https://portal.labsoncloud.online').split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// KasmVNC reverse-proxy — MUST be mounted before express.json() so
// request bodies (especially WebSocket upgrades) flow through untouched.
app.use('/kasm', kasmProxyRoute);

//middlewares
app.use(express.json());
// Catch malformed JSON bodies before they bubble up as unhandled exceptions
// and crash the process. Without this, a single bad request (bot, scanner, or
// buggy client sending invalid JSON) takes down the whole server. PM2 was
// restarting the backend ~45×/day because of this.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ message: 'Invalid JSON in request body' });
  }
  next(err);
});
app.set('trust proxy', true);
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const status = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
  const code = status === 'healthy' ? 200 : 503;
  res.status(code).json({ status, uptime: process.uptime() });
});

//routers
app.use("/branding", require("./routes/branding"));
app.use("/user", checkAuth, userRoute);
app.use("/admin", restrictToLoggedinUserOnly, adminRoute);
app.use("/azure", restrictToLoggedinUserOnly, azureRoute);
app.use("/gcp", restrictToLoggedinUserOnly, gcpRoute);
app.use("/sandbox", restrictToLoggedinUserOnly, sandboxRoute);
app.use("/aws", restrictToLoggedinUserOnly, awsRoute);
app.use("/open", openRoute);
app.use("/selfservice", selfserviceRoute);
app.use("/containers", restrictToLoggedinUserOnly, containerRoute);
app.use("/rds", restrictToLoggedinUserOnly, rdsRoute);
app.use("/gcp-sandbox", restrictToLoggedinUserOnly, gcpSandboxRoute);
app.use("/teams", teamRoute);
app.use("/custom-images", restrictToLoggedinUserOnly, customImageRoute);
app.use("/api", publicApiRoute);
app.use("/sandbox-templates", require('./routes/sandboxTemplate'));
app.use("/workshop", restrictToLoggedinUserOnly, require('./routes/workshop'));  // gated by WORKSHOP_ENABLED env
app.use("/b2b/courses", restrictToLoggedinUserOnly, b2bCoursesRoute);
app.use("/oci-sandbox", restrictToLoggedinUserOnly, ociSandboxRoute);
app.use("/rosa", restrictToLoggedinUserOnly, rosaRoute);
app.use("/aro", restrictToLoggedinUserOnly, aroRoute);
app.use("/guided-labs", restrictToLoggedinUserOnly, guidedLabRoute);
const labConsoleRoute = require("./routes/labConsole");
app.use("/lab", restrictToLoggedinUserOnly, labConsoleRoute);

// Connect to MongoDB, then start cron jobs and server
connectMongoDB(process.env.MONGO_URI || 'mongodb://mongodb:27017/userdb')
  .then(async () => {
    logger.info('MongoDB connected successfully');

    // Startup sanity check — if the VM collection is empty, we're almost
    // certainly pointing at the wrong database (the exact failure mode
    // from the 2026-04-21 incident: worker was on "cloudportal" while
    // backend wrote to "userdb"). Refuse to start so the operator sees
    // the crash loop immediately. Override with SKIP_VM_COUNT_CHECK=1.
    try {
      const VM = require('./models/vm');
      const n = await VM.countDocuments({});
      if (n === 0 && process.env.SKIP_VM_COUNT_CHECK !== '1') {
        logger.error(
          'STARTUP SANITY FAILED: VM collection is empty. Likely wrong Mongo ' +
          'database. Refusing to serve traffic. Set SKIP_VM_COUNT_CHECK=1 ' +
          'to bypass (fresh install only).'
        );
        process.exit(1);
      }
      logger.info(`[startup] ${n} VMs visible — Mongo looks healthy`);
    } catch (e) {
      logger.error(`[startup] VM count check errored (non-fatal): ${e.message}`);
    }

    // Scheduled tasks - run every minute. Each function is async; adding
    // .catch() so a failure in one doesn't silently swallow the error or crash the process.
    // In-flight guards prevent overlap when a slow run hasn't finished by the next tick
    // (the original code happily re-entered, leading to e.g. 6 azureSandbox iterations
    // running concurrently and racing on the same sandbox docs).
    let azureCleanupRunning = false;
    let gcpCleanupRunning = false;
    let awsCleanupRunning = false;
    let ociCleanupRunning = false;
    let deployCleanupRunning = false;
    // Every-minute block — only lightweight checkers that NEED minute granularity
    // (class start/stop windows, quota tracking, lab expiry alerts).
    cron.schedule('* * * * *', () => {
      logger.info('Running scheduled tasks...');
      scheduleChecker().catch(err => logger.error(`scheduleChecker failed: ${err.message}`));
      quotaChecker().catch(err => logger.error(`quotaChecker failed: ${err.message}`));
      labExpiryChecker().catch(err => logger.error(`labExpiryChecker failed: ${err.message}`));
    });

    // Every-10-min block — sandbox cleanups across all 4 clouds + sandbox deployment
    // cleanup. Split out from the per-minute block on 2026-05-23 because each cleanup
    // forks aws/az/gcloud CLI subprocesses that were causing chronic 100% CPU on prod
    // (the 4-cloud × every-minute × ~30s-per-pass storm). Cleanup lag is bounded to
    // ~10 min worst case — acceptable trade-off vs CPU saturation.
    cron.schedule("*/15 * * * *", () => {
      logger.info('Running 10-min sandbox cleanups...');

      (async () => {
        if (azureCleanupRunning) { logger.warn('skip azureSandbox — previous still running'); return; }
        azureCleanupRunning = true;
        try { await azureSandbox(); }
        catch (err) { logger.error(`azureSandbox cleanup failed: ${err.message}`); }
        finally { azureCleanupRunning = false; }
      })();

      (async () => {
        if (gcpCleanupRunning) { logger.warn('skip gcpSandboxCleanup — previous still running'); return; }
        gcpCleanupRunning = true;
        try { await gcpSandboxCleanup(); }
        catch (err) { logger.error(`gcpSandboxCleanup failed: ${err.message}`); }
        finally { gcpCleanupRunning = false; }
      })();

      (async () => {
        if (awsCleanupRunning) { logger.warn('skip awsCleanup — previous still running'); return; }
        awsCleanupRunning = true;
        try { await awsCleanup(); }
        catch (err) { logger.error(`awsCleanup failed: ${err.message}`); }
        finally { awsCleanupRunning = false; }
      })();

      (async () => {
        if (ociCleanupRunning) { logger.warn('skip ociSandboxCleanup — previous still running'); return; }
        ociCleanupRunning = true;
        try { await ociSandboxCleanup(); }
        catch (err) { logger.error(`ociSandboxCleanup failed: ${err.message}`); }
        finally { ociCleanupRunning = false; }
      })();

      (async () => {
        if (deployCleanupRunning) { logger.warn('skip sandboxDeploymentCleanup — previous still running'); return; }
        deployCleanupRunning = true;
        try { await sandboxDeploymentCleanup(); }
        catch (err) { logger.error(`sandboxDeploymentCleanup failed: ${err.message}`); }
        finally { deployCleanupRunning = false; }
      })();
    });

    // AWS DCV nginx upstream sync — runs at startup + every 30s. Keeps
    // /etc/nginx/conf.d/dcv-vms.conf in sync with Mongo. Cheap idempotent
    // serialize+reload; per-VM block writes are coalesced via withLock().
    awsDcvNginx.rebuildFromDb().catch(err => logger.error(`awsDcvNginx initial: ${err.message}`));
    cron.schedule('*/30 * * * * *', () => {
      awsDcvNginx.rebuildFromDb().catch(err => logger.error(`awsDcvNginx cron: ${err.message}`));
    });

    // Idle VM shutdown check - every 5 minutes
    cron.schedule("*/5 * * * *", () => {
      logger.info('Checking for idle VMs + containers...');
      idleShutdownChecker().catch(err => {
        logger.error(`Idle shutdown check failed: ${err.message}`);
      });
      quotaEnforcer().catch(err => {
        logger.error(`Quota enforcer failed: ${err.message}`);
      });
      containerIdleShutdown().catch(err => {
        logger.error(`Container idle shutdown failed: ${err.message}`);
      });
      rosaCleanup().catch(err => {
        logger.error(`ROSA cluster cleanup failed: ${err.message}`);
      });
      aroCleanup().catch(err => {
        logger.error(`ARO cluster cleanup failed: ${err.message}`);
      });
      dockerHostScaler().catch(err => {
        logger.error(`Docker host scaler failed: ${err.message}`);
      });
      vmStateReconciler().catch(err => {
        logger.error(`VM state reconciler failed: ${err.message}`);
      });
      spotEvictionHandler().catch(err => {
        logger.error(`Spot eviction handler failed: ${err.message}`);
      });
    });

    // VM auto-restart — every 30 seconds, restarts always-on training VMs
    // that are deallocated/stopped on Azure (Spot evictions, external stops, etc.)
    cron.schedule("*/30 * * * * *", () => {
      vmAutoRestart().catch(err => {
        logger.error(`VM auto-restart failed: ${err.message}`);
      });
    });

    // Night auto-pause - check every minute (acts only at PAUSE_HOUR/RESUME_HOUR)
    cron.schedule('* * * * *', () => {
      nightPause().catch(err => {
        logger.error(`Night pause failed: ${err.message}`);
      });
    });

    // Quota warning emails + host budget alerts - every 30 minutes
    // Batch expiry — destroy IAM users + DB records after batchExpiresAt date.
    // Runs every 10 min, separate from per-session TTL cleanup.
    cron.schedule("*/15 * * * *", () => {
      batchExpiryCheck().catch(err => logger.error(`batchExpiryCheck failed: ${err.message}`));
    });

    // Per-template sandbox resource cleanup — runs at 3 PM + 5 PM IST.
    // (09:30 UTC + 11:30 UTC, since the cron runs in UTC and IST = UTC+5:30.)
    // Sweeps each active sandbox user's RG for templates listed in
    // automations/sandboxResourceCleanup.js → CLEANUP_TEMPLATE_SLUGS.
    // NOTE: previously '30 9,12 * * *' = 3 PM + 6 PM IST, contradicting the
    // databricks-sweep.timer (09:30 + 11:30 UTC) and the template description.
    // Reconciled to 3+5 PM IST so cron, systemd timer, and template description
    // all agree (audit P1-13).
    cron.schedule('30 9,11 * * *', () => {
      sandboxResourceCleanup().catch(err => logger.error(`sandboxResourceCleanup failed: ${err.message}`));
    });

    cron.schedule('*/30 * * * *', () => {
      checkQuotaWarnings().catch(err => {
        logger.error(`Quota warning check failed: ${err.message}`);
      });
      hostBudgetAlert().catch(err => {
        logger.error(`Host budget alert failed: ${err.message}`);
      });
    });

    // Orphan resource cleanup - every Sunday at 2 AM IST (20:30 UTC Saturday)
    cron.schedule('30 20 * * 6', () => {
      logger.info('Running weekly orphan resource cleanup...');
      orphanCleanupJob().catch(err => {
        logger.error(`Orphan cleanup failed: ${err.message}`);
      });
    });

    // Azure orphan sweep — daily at 03:30 UTC (09:00 IST), after the morning
    // schedule-start cycle finishes. DETECTION-ONLY by default; set
    // AZURE_SWEEPER_AUTO_DELETE=true to enable cleanup.
    // Catches: Azure VMs left running when the portal-side admin UI deleted
    // a Training doc without deep-cleaning Azure (root cause of the 52-VM
    // orphan incident on 2026-05-20).
    cron.schedule('30 3 * * *', () => {
      logger.info('Running daily Azure orphan sweep...');
      azureOrphanSweeper().catch(err => {
        logger.error(`Azure orphan sweeper failed: ${err.message}`);
      });
      azureSandboxRgSweeper().catch(err => {
        logger.error(`Azure sandbox-RG sweeper failed: ${err.message}`);
      });
    });

    // Azure cost sync - every 6 hours
    cron.schedule('0 */6 * * *', () => {
      logger.info('Running Azure cost sync...');
      syncAllTrainingCosts().catch(err => {
        logger.error(`Azure cost sync failed: ${err.message}`);
      });
    });

    // Cost Center cache warmer — hourly for "this month" (fast),
    // and once at 02:00 IST for the slow long-range views (~4-15 min).
    cron.schedule('5 * * * *', () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      getCostCenter({ from: monthStart.toISOString(), to: now.toISOString(), force: true })
        .catch(err => logger.error(`Cost Center this-month warm failed: ${err.message}`));
    });

    cron.schedule('30 20 * * *', async () => {  // 20:30 UTC = 02:00 IST
      logger.info('[costCenter] nightly long-range warm starting...');
      const now = new Date();
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      const ranges = [
        { label: 'last-month',  from: lastMonthStart, to: lastMonthEnd },
        { label: 'last-quarter',from: new Date(now.getTime() - 90 * 86400000), to: now },
        { label: '6m',          from: new Date(now.getTime() - 180 * 86400000), to: now },
        { label: '1y',          from: new Date(now.getTime() - 364 * 86400000), to: now },
      ];
      for (const r of ranges) {
        try {
          await getCostCenter({ from: r.from.toISOString(), to: r.to.toISOString(), force: true });
          logger.info(`[costCenter] warmed ${r.label}`);
        } catch (err) { logger.error(`[costCenter] ${r.label} warm failed: ${err.message}`); }
      }
    });

    // Rebuild Nginx upstream map from DB (crash recovery)
    rebuildNginxUpstreams().catch(err => logger.error(`Nginx upstream rebuild failed: ${err.message}`));

    // Initial run of scheduled tasks
    logger.info('Initial run of scheduled tasks...');
    scheduleChecker().catch(err => logger.error(`Initial scheduleChecker failed: ${err.message}`));
    quotaChecker().catch(err => logger.error(`Initial quotaChecker failed: ${err.message}`));
    azureSandbox().catch(err => logger.error(`Initial azureSandbox cleanup failed: ${err.message}`));
    gcpSandboxCleanup().catch(err => logger.error(`Initial gcpSandboxCleanup failed: ${err.message}`));
    awsCleanup().catch(err => logger.error(`Initial awsCleanup failed: ${err.message}`));
    ociSandboxCleanup().catch(err => logger.error(`Initial ociSandboxCleanup failed: ${err.message}`));
  })
  .catch((err) => {
    logger.error(`MongoDB connection failed: ${err.message}`);
  });

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
