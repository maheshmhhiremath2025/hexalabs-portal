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
const { idleShutdownChecker } = require('./automations/idleShutdown')
const { gcpSandboxCleanup } = require('./automations/gcpSandbox')
const { awsCleanup } = require('./automations/awsSandbox')
const { ociSandboxCleanup } = require('./automations/ociSandbox')
const { labExpiryChecker } = require('./automations/labExpiry')
const { sandboxDeploymentCleanup } = require('./automations/sandboxDeploymentCleanup')
const { containerIdleShutdown } = require('./automations/containerIdleShutdown')
const { nightPause } = require('./automations/nightPause')
const { rosaCleanup } = require('./automations/rosaCleanup')
const { aroCleanup } = require('./automations/aroCleanup')
const { dockerHostScaler } = require('./automations/dockerHostScaler')
const { hostBudgetAlert } = require('./automations/hostBudgetAlert')
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
const b2bCoursesRoute = require('./routes/b2bCourses')
const ociSandboxRoute = require('./routes/ociSandbox')
const rosaRoute = require('./routes/rosa')
const aroRoute = require('./routes/aro')

const { restrictToLoggedinUserOnly, checkAuth } = require('./middlewares/auth');
const { azureSandbox } = require('./automations/azureSandbox');

const corsOptions = {
  origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,https://portal.synergificsoftware.com,https://www.cloudportal.co.in,https://www.getlabs.cloud,https://getlabs.cloud').split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

//middlewares
app.use(express.json());
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
app.use("/b2b/courses", restrictToLoggedinUserOnly, b2bCoursesRoute);
app.use("/oci-sandbox", restrictToLoggedinUserOnly, ociSandboxRoute);
app.use("/rosa", restrictToLoggedinUserOnly, rosaRoute);
app.use("/aro", restrictToLoggedinUserOnly, aroRoute);

// Connect to MongoDB, then start cron jobs and server
connectMongoDB(process.env.MONGO_URI || 'mongodb://mongodb:27017/userdb')
  .then(() => {
    logger.info('MongoDB connected successfully');

    // Scheduled tasks - run every minute. Each function is async; adding
    // .catch() so a failure in one doesn't silently swallow the error or crash the process.
    cron.schedule('* * * * *', () => {
      logger.info('Running scheduled tasks...');
      scheduleChecker().catch(err => logger.error(`scheduleChecker failed: ${err.message}`));
      quotaChecker().catch(err => logger.error(`quotaChecker failed: ${err.message}`));
      azureSandbox().catch(err => logger.error(`azureSandbox cleanup failed: ${err.message}`));
      gcpSandboxCleanup().catch(err => logger.error(`gcpSandboxCleanup failed: ${err.message}`));
      awsCleanup().catch(err => logger.error(`awsCleanup failed: ${err.message}`));
      ociSandboxCleanup().catch(err => logger.error(`ociSandboxCleanup failed: ${err.message}`));
      labExpiryChecker().catch(err => logger.error(`labExpiryChecker failed: ${err.message}`));
      sandboxDeploymentCleanup().catch(err => logger.error(`sandboxDeploymentCleanup failed: ${err.message}`));
    });

    // Idle VM shutdown check - every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      logger.info('Checking for idle VMs + containers...');
      idleShutdownChecker().catch(err => {
        logger.error(`Idle shutdown check failed: ${err.message}`);
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
    });

    // Night auto-pause - check every minute (acts only at PAUSE_HOUR/RESUME_HOUR)
    cron.schedule('* * * * *', () => {
      nightPause().catch(err => {
        logger.error(`Night pause failed: ${err.message}`);
      });
    });

    // Quota warning emails + host budget alerts - every 30 minutes
    cron.schedule('*/30 * * * *', () => {
      checkQuotaWarnings().catch(err => {
        logger.error(`Quota warning check failed: ${err.message}`);
      });
      hostBudgetAlert().catch(err => {
        logger.error(`Host budget alert failed: ${err.message}`);
      });
    });

    // Azure cost sync - every 6 hours
    cron.schedule('0 */6 * * *', () => {
      logger.info('Running Azure cost sync...');
      syncAllTrainingCosts().catch(err => {
        logger.error(`Azure cost sync failed: ${err.message}`);
      });
    });

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
