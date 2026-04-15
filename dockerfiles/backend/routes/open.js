const express = require("express")
const router = express.Router();
const {handleCloudFunction} = require('./../controllers/gcp/handleCloudFunction');
const { handleGcpLogs } = require("../controllers/gcp/handleGcpLogs");

router.post("/cloudFunction", handleCloudFunction)
router.get("/gcpLogs", handleGcpLogs)

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

