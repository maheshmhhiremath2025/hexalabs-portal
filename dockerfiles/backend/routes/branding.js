const express = require('express');
const router = express.Router();
const Organization = require('../models/organization');

// In-memory cache (host -> branding) with 60s TTL.
// Branding rarely changes; this saves a Mongo hit on every page load.
const cache = new Map();
const TTL_MS = 60 * 1000;

const CANONICAL_HOSTS = new Set([
  'hexalabs.online',
  'www.hexalabs.online',
  'hsdf.hexalabs.online',
  'hexalabs.online',
  'www.hexalabs.online',
  'localhost',
]);

const DEFAULT_BRANDING = {
  logoUrl: '/logo/logo.png',
  primaryColor: '#2563eb',
  accentColor: '#1e40af',
  companyName: 'Hexalabs',
  faviconUrl: '/favicon.ico',
  loginBanner: 'Welcome to Hexalabs Cloud Portal',
  supportEmail: 'labs@hexalabs.online',
  supportPhone: '',
  organization: null,
  customDomain: null,
};

// Unauthenticated — returns branding by host. Safe to be public.
router.get('/by-host', async (req, res) => {
  try {
    const host = (req.query.host || req.get('host') || '').toLowerCase().split(':')[0];
    if (!host || CANONICAL_HOSTS.has(host)) {
      return res.json(DEFAULT_BRANDING);
    }
    const cached = cache.get(host);
    if (cached && cached.expires > Date.now()) return res.json(cached.value);
    const org = await Organization.findOne({ customDomain: host }).lean();
    if (!org || !org.branding) {
      const value = { ...DEFAULT_BRANDING, organization: null };
      cache.set(host, { value, expires: Date.now() + TTL_MS });
      return res.json(value);
    }
    const value = {
      ...DEFAULT_BRANDING,
      ...org.branding,
      organization: org.organization,
      customDomain: org.customDomain,
    };
    cache.set(host, { value, expires: Date.now() + TTL_MS });
    res.json(value);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load branding' });
  }
});

module.exports = router;
