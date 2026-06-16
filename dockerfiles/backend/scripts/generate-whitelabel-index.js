#!/usr/bin/env node
/**
 * Pre-bake an index.html per whitelabel domain with branding inlined as
 * window.__BRANDING__. nginx serves the per-domain file; React reads the
 * global synchronously, never needs a cross-origin API call for branding.
 *
 * Run after: any branding change in the Organization collection,
 * AND after every frontend rebuild (bundle hash changes).
 *
 *   node scripts/generate-whitelabel-index.js          # regenerate all
 *   node scripts/generate-whitelabel-index.js azatech  # one tenant by slug
 */
require('dotenv').config({ path: '/root/synergific-portal/dockerfiles/backend/.env' });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Organization = require('/root/synergific-portal/dockerfiles/backend/models/organization');

const CANONICAL_DIST = '/opt/getlabs/portal.synergificsoftware.com/frontend/dist';
const WHITELABEL_ROOT = '/var/www/whitelabel';

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''); }

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const onlySlug = process.argv[2] || null;

  const filter = { customDomain: { $exists: true, $ne: '' } };
  const orgs = (await Organization.find(filter).lean())
    .filter(o => !onlySlug || slugify(o.organization) === onlySlug.toLowerCase());

  if (!orgs.length) { console.log('no whitelabel orgs match'); process.exit(1); }

  const canonicalHtml = fs.readFileSync(path.join(CANONICAL_DIST, 'index.html'), 'utf8');

  for (const org of orgs) {
    const b = org.branding || {};
    const branding = {
      logoUrl: b.logoUrl || '',
      primaryColor: b.primaryColor || '#2563eb',
      accentColor: b.accentColor || '#1e40af',
      companyName: b.companyName || org.organization,
      faviconUrl: b.faviconUrl || '',
      loginBanner: b.loginBanner || '',
      supportEmail: b.supportEmail || '',
      supportPhone: b.supportPhone || '',
      organization: org.organization,
      customDomain: org.customDomain,
    };

    const injected = canonicalHtml.replace(
      '<head>',
      '<head>\n    <script>window.__BRANDING__=' + JSON.stringify(branding).replace(/</g, '\\u003c') + ';</script>'
    );

    const slug = slugify(org.organization);
    const outDir = path.join(WHITELABEL_ROOT, slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), injected);
    console.log('wrote ' + outDir + '/index.html  (' + org.customDomain + ' → ' + branding.companyName + ')');
  }
  await mongoose.disconnect();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
