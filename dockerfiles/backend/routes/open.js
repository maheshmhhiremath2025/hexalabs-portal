const express = require("express")
const router = express.Router();
const {handleCloudFunction} = require('./../controllers/gcp/handleCloudFunction');
const { handleGcpLogs } = require("../controllers/gcp/handleGcpLogs");
const { logger } = require('../plugins/logger');
const DemoRequest = require('../models/demoRequest');
const { notifyDemoRequestConfirmation, notifyDemoRequestOps } = require('../services/emailNotifications');

router.post("/cloudFunction", handleCloudFunction)
router.get("/gcpLogs", handleGcpLogs)

// ─── Public demo-request form (from the login page 'Book demo' modal) ──
// Accepts: { name, email, company, demoDate?, preferredTiming? }
// Saves to DemoRequest collection + sends:
//   1. Confirmation email to the requester
//   2. Notification email to vinay + itops
// Rate-limited per IP: max 3 submissions per hour (prevents spam).

const demoRateMap = new Map();  // ip -> { count, firstAt }
const DEMO_RATE_LIMIT = 3;
const DEMO_RATE_WINDOW_MS = 60 * 60 * 1000;

router.post('/demo-request', async (req, res) => {
  try {
    const { name, email, company, demoDate, preferredTiming } = req.body || {};

    // Validation — keep tight so garbage doesn't reach ops inbox
    if (!name || !email || !company) {
      return res.status(400).json({ message: 'Name, email and company are required.' });
    }
    if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (String(name).length > 100 || String(company).length > 200) {
      return res.status(400).json({ message: 'Name or company is too long.' });
    }

    // Simple per-IP rate limit — forgive existing users, block spammers
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = demoRateMap.get(ip) || { count: 0, firstAt: now };
    if (now - rec.firstAt > DEMO_RATE_WINDOW_MS) { rec.count = 0; rec.firstAt = now; }
    rec.count += 1;
    demoRateMap.set(ip, rec);
    if (rec.count > DEMO_RATE_LIMIT) {
      return res.status(429).json({ message: 'Too many demo requests from this address. Please try again in an hour.' });
    }

    // Persist — sales ops will query this collection
    const userAgent = req.get('user-agent') || '';
    const saved = await DemoRequest.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      company: String(company).trim(),
      demoDate: String(demoDate || '').trim(),
      preferredTiming: String(preferredTiming || '').trim(),
      ipAddress: ip,
      userAgent: userAgent.slice(0, 500),
    });

    logger.info(`[demo-request] new submission: ${saved.email} (${saved.company}) id=${saved._id}`);

    // Fire both emails in parallel — don't block the HTTP response on them
    Promise.all([
      notifyDemoRequestConfirmation({ name: saved.name, email: saved.email, company: saved.company, demoDate: saved.demoDate, preferredTiming: saved.preferredTiming }),
      notifyDemoRequestOps({ name: saved.name, email: saved.email, company: saved.company, demoDate: saved.demoDate, preferredTiming: saved.preferredTiming, ipAddress: ip, userAgent }),
    ]).catch(e => logger.error(`[demo-request] email send failed: ${e.message}`));

    return res.status(201).json({ message: 'Request received. Check your email for confirmation.' });
  } catch (err) {
    logger.error(`[demo-request] error: ${err.message}`);
    return res.status(500).json({ message: 'Something went wrong. Please email itops@synergificsoftware.com directly.' });
  }
});

// Public branding — no auth required (used by login page)
router.get("/branding/:organization", async (req, res) => {
  try {
    const Organization = require('../models/organization');
    const org = await Organization.findOne(
      { organization: req.params.organization },
      { branding: 1, organization: 1 }
    ).collation({ locale: 'en', strength: 2 });
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    res.json({ branding: org.branding || {}, organization: org.organization });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router

