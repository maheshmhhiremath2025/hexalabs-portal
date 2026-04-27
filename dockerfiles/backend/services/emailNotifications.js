// Customer-facing emails go through emailTemplate.js for consistent
// "Synergific Cloud Portal" branding (gradient header, sections, plain-text
// fallback). Ops emails (notifyOpsDeploySummary) stay plain-tabular since
// they're internal records, not customer-facing.
//
// Function signatures are preserved — callers in controllers/automations
// don't need to change. Internally each function is now ~15-30 lines: it
// builds a sections array and hands it to renderEmail().

const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const VM = require('../models/vm');
const User = require('../models/user');
const { logger } = require('../plugins/logger');
const { renderEmail, credentials, info, steps, warning, button, BRAND } = require('./emailTemplate');
const { quickStartFor } = require('../data/imageQuickStarts');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const FROM = `"${BRAND.name}" <${process.env.GMAIL_USER}>`;
// Always CC'd on EVERY email so we keep a central record.
const INTERNAL_CC = ['itops@synergificsoftware.com'];
const CC_RECIPIENTS = INTERNAL_CC.join(', ');

/**
 * Low-level send. Both `html` and `text` are sent so corporate gateways
 * that strip HTML still get a readable email.
 *
 * Accepts optional { cc } to override the default internal CC list
 * (e.g. to add an org admin).
 */
async function sendEmail(to, subject, html, text, opts = {}) {
  try {
    const cc = opts.cc != null ? opts.cc : CC_RECIPIENTS;
    await transporter.sendMail({ from: FROM, to, cc, subject, html, text });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
  }
}

/**
 * Look up admin emails for an organization. Used to route bulk-deploy
 * credential tables to the customer's own admin in addition to ops.
 * Returns [] on error or if no admin is registered.
 */
async function getOrgAdminEmails(organization) {
  if (!organization) return [];
  try {
    const admins = await User.find({ organization, userType: 'admin' })
      .select('email').lean();
    return admins.map(a => a.email).filter(Boolean);
  } catch (err) {
    logger.error(`getOrgAdminEmails(${organization}) failed: ${err.message}`);
    return [];
  }
}

/** Deduplicate + join an email list, stripping empties. */
function joinEmails(list) {
  const seen = new Set();
  return list
    .filter(e => e && typeof e === 'string')
    .map(e => e.trim())
    .filter(e => e && (seen.has(e.toLowerCase()) ? false : (seen.add(e.toLowerCase()), true)))
    .join(', ');
}

// ─── email deliverability heuristic ──────────────────────────────────────
//
// Bulk deploys frequently use placeholder emails (e.g. hyperv@g.com, the
// auto-generated userN@<org>.lab fallback). Sending welcomes to those is
// wasteful and can hurt our sending reputation. This function returns
// true only if the email looks real AND the domain has MX records.
//
// Returns false for: invalid syntax, known-fake domains (.lab, example.*,
// test.*, localhost, invalid.*), or a domain with no MX records.
//
// Per-domain result is cached for 10 min so 30 students with the same
// company domain trigger only one DNS call.

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
const BLOCK_DOMAINS = [
  /\.lab$/i, /^localhost$/i, /^example\./i, /^test\./i,
  /\.example$/i, /\.test$/i, /^invalid\./i, /\.invalid$/i,
];
const mxCache = new Map(); // domain -> { valid, expiresAt }
const MX_TTL_MS = 10 * 60 * 1000;

async function isLikelyDeliverable(email) {
  if (!email || typeof email !== 'string') return false;
  if (!EMAIL_RE.test(email)) return false;

  const domain = email.split('@')[1].toLowerCase();
  if (BLOCK_DOMAINS.some(re => re.test(domain))) return false;

  const cached = mxCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;

  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, rej) => setTimeout(() => rej(new Error('DNS timeout')), 3000)),
    ]);
    const valid = Array.isArray(mx) && mx.length > 0;
    mxCache.set(domain, { valid, expiresAt: Date.now() + MX_TTL_MS });
    return valid;
  } catch {
    // No MX record or DNS timed out — treat as undeliverable
    mxCache.set(domain, { valid: false, expiresAt: Date.now() + MX_TTL_MS });
    return false;
  }
}

// ─── 1. Self-service / generic instance-ready ────────────────────────────

async function notifyInstanceReady({ email, name, type, accessUrl, password, organization, trainingName }) {
  const isContainer = type === 'container';
  const subject = `Your ${isContainer ? 'workspace' : 'VM'} is ready — ${name}`;
  const sections = [
    credentials('Access', [
      { label: 'Instance', value: name, bold: true },
      ...(organization ? [{ label: 'Organization', value: organization }] : []),
      ...(trainingName ? [{ label: 'Training', value: trainingName }] : []),
      ...(accessUrl ? [{ label: 'Open URL', value: accessUrl, link: accessUrl }] : []),
      ...(password ? [{ label: 'Password', value: password, mono: true, bold: true }] : []),
    ]),
    ...(accessUrl ? [button('Open Desktop', accessUrl)] : []),
  ];

  const { html, text } = renderEmail({
    title: `Your ${isContainer ? 'workspace' : 'VM'} is ready`,
    badge: isContainer ? 'WORKSPACE' : 'VM',
    intro: `Hi,<br><br>Your ${isContainer ? 'container workspace' : 'virtual machine'} <strong>${name}</strong> is provisioned and ready to use.`,
    sections,
  });

  await sendEmail(email, subject, html, text);
}

// ─── 2. Quota warnings (80% / 95%) ───────────────────────────────────────

async function notifyQuotaLow({ email, name, consumed, total, organization }) {
  const pct = Math.round((consumed / total) * 100);
  const isCritical = pct >= 95;
  const subject = `Quota ${isCritical ? 'CRITICAL' : 'warning'}: ${name} at ${pct}%`;
  const barColor = isCritical ? '#ef4444' : '#f59e0b';

  const usageBar = `
    <div style="margin-top:8px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-bottom:4px;">
        <span>Used: <strong style="color:#111;">${consumed.toFixed(1)}h</strong></span>
        <span>Total: <strong style="color:#111;">${total}h</strong></span>
      </div>
      <div style="background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden;">
        <div style="background:${barColor};height:100%;width:${Math.min(100, pct)}%;"></div>
      </div>
    </div>`;

  const { html, text } = renderEmail({
    title: `Quota ${pct}% used`,
    badge: isCritical ? 'CRITICAL' : 'WARNING',
    intro: `Your instance <strong>${name}</strong> has consumed <strong>${pct}%</strong> of its allocated quota.`,
    sections: [
      info(`Usage on ${name}`, usageBar, isCritical ? 'red' : 'amber'),
      info('What to do', isCritical
          ? 'The lab will be paused or auto-stopped soon. Save your work and contact your administrator to extend the quota.'
          : 'You still have time. If you need more, contact your administrator to increase the quota.',
        'blue'),
    ],
  });

  await sendEmail(email, subject, html, text);
}

// ─── 3. Auto-shutdown notification ───────────────────────────────────────

async function notifyAutoShutdown({ email, name, idleMinutes, organization }) {
  const subject = `Auto-stopped: ${name} (idle ${idleMinutes} min)`;

  const { html, text } = renderEmail({
    title: 'Instance auto-stopped',
    badge: 'IDLE',
    intro: `Your instance <strong>${name}</strong> was automatically stopped after ${idleMinutes} minutes of inactivity. This saves cost while it's not in use.`,
    sections: [
      info('How to resume',
        `Open the Lab Console in <a href="${BRAND.portalUrl}" style="color:#2563eb;">${BRAND.portalUrl}</a> and click <strong>Start</strong>. Your data is preserved — the instance comes back exactly as you left it.`,
        'blue'),
      info('Want to disable auto-stop?',
        'Contact your administrator. They can change the idle timeout or turn off auto-shutdown for your instance from the VM Settings panel.',
        'gray'),
    ],
  });

  await sendEmail(email, subject, html, text);
}

// ─── 4. Quota cron (unchanged) ───────────────────────────────────────────

async function checkQuotaWarnings() {
  try {
    const vms = await VM.find({ isAlive: true, isRunning: true, 'quota.total': { $gt: 0 } });
    for (const vm of vms) {
      const pct = (vm.quota.consumed / vm.quota.total) * 100;
      if (pct >= 80 && pct < 95 && !vm.remarks?.includes('Quota80')) {
        await notifyQuotaLow({ email: vm.email, name: vm.name, consumed: vm.quota.consumed, total: vm.quota.total, organization: vm.organization });
        vm.remarks = (vm.remarks || '') + ' | Quota80';
        await vm.save();
      }
      if (pct >= 95 && !vm.remarks?.includes('Quota95')) {
        await notifyQuotaLow({ email: vm.email, name: vm.name, consumed: vm.quota.consumed, total: vm.quota.total, organization: vm.organization });
        vm.remarks = (vm.remarks || '') + ' | Quota95';
        await vm.save();
      }
    }
  } catch (err) {
    logger.error(`Quota warning check error: ${err.message}`);
  }
}

// ─── 5. Lab welcome (VM creation, image-aware) ───────────────────────────

async function notifyLabWelcomeEmail({
  email, name, accessUrl, password, organization, trainingName,
  imageKey, imageLabel, hostIp, sshPort, vncPort, expiresAt, cpus, memoryMb,
}) {
  const subject = `Welcome — ${trainingName || name} is ready`;
  const sections = [
    credentials('Step 1 — Log in to the training portal', [
      { label: 'Portal',   value: BRAND.portalUrl, link: BRAND.portalUrl },
      { label: 'Email',    value: email, mono: true },
      { label: 'Password', value: 'Welcome1234!', mono: true, bold: true },
    ]),
    credentials('Step 2 — Access your lab', [
      { label: 'Instance', value: name, bold: true },
      ...(accessUrl ? [{ label: 'Browser URL', value: accessUrl, link: accessUrl }] : []),
      { label: 'Username', value: 'lab', mono: true },
      { label: 'Password', value: password, mono: true, bold: true },
      ...(sshPort && hostIp ? [{ label: 'SSH', value: `ssh lab@${hostIp} -p ${sshPort}`, mono: true }] : []),
    ]),
    ...(imageLabel || cpus || memoryMb ? [
      info('Specs',
        [
          imageLabel && `Image: <strong>${imageLabel}</strong>`,
          cpus && `${cpus} vCPU`,
          memoryMb && (memoryMb >= 1024 ? `${(memoryMb/1024).toFixed(1)} GB RAM` : `${memoryMb} MB RAM`),
        ].filter(Boolean).join(' · '),
        'gray'),
    ] : []),
    ...quickStartFor(imageKey, { accessPassword: password }),
  ];

  const { html, text } = renderEmail({
    title: `Your lab is ready`,
    badge: 'LAB',
    intro: `Hi,<br><br>Your ${trainingName ? `<strong>${trainingName}</strong>` : 'training'} lab is provisioned. Below are your portal login and direct lab access.`,
    sections,
    expiry: expiresAt,
  });

  await sendEmail(email, subject, html, text);
}

// ─── 6. Sandbox welcome (cloud — AWS/Azure/GCP/OCI) ──────────────────────

async function notifySandboxWelcomeEmail({
  email, cloud, portalUrl, portalPassword,
  sandboxUsername, sandboxPassword, sandboxAccessUrl,
  region, expiresAt, templateName,
  allowedServices = [], blockedServices = [],
  compartmentName, resourceGroupName, projectId,
}) {
  const cloudShort = (cloud || '').toUpperCase();
  const cloudLong = { aws: 'Amazon Web Services', azure: 'Microsoft Azure', gcp: 'Google Cloud Platform', oci: 'Oracle Cloud' }[cloud] || cloudShort;
  const portalLink = portalUrl || BRAND.portalUrl;
  const subject = `${templateName || 'Cloud Lab'} — your ${cloudShort} sandbox is ready`;

  const cloudResource = compartmentName ? { label: 'Compartment', value: compartmentName, mono: true }
                       : resourceGroupName ? { label: 'Resource Group', value: resourceGroupName, mono: true }
                       : projectId ? { label: 'Project', value: projectId, mono: true } : null;

  const allowedHtml = allowedServices.length
    ? '<ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.6;">' +
      allowedServices.slice(0, 12).map(s => `<li>${s.service || s}${s.restrictions ? ` <span style="color:#9ca3af;">(${s.restrictions})</span>` : ''}</li>`).join('') +
      (allowedServices.length > 12 ? `<li style="color:#9ca3af;">…and ${allowedServices.length - 12} more</li>` : '') +
      '</ul>'
    : '';

  const blockedHtml = blockedServices.length
    ? '<ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.6;">' +
      blockedServices.slice(0, 8).map(s => `<li>${s.service || s}${s.reason ? ` <span style="color:#9ca3af;">— ${s.reason}</span>` : ''}</li>`).join('') +
      '</ul>'
    : '';

  const sections = [
    credentials('Step 1 — Log in to the training portal', [
      { label: 'Portal',   value: portalLink, link: portalLink },
      { label: 'Email',    value: email, mono: true },
      { label: 'Password', value: portalPassword || 'Welcome1234!', mono: true, bold: true },
    ]),
    credentials(`Step 2 — Open your ${cloudShort} console`, [
      ...(sandboxAccessUrl ? [{ label: 'Console URL', value: sandboxAccessUrl, link: sandboxAccessUrl }] : []),
      { label: 'Username', value: sandboxUsername, mono: true },
      { label: 'Password', value: sandboxPassword, mono: true, bold: true },
      ...(region ? [{ label: 'Region', value: region }] : []),
      ...(cloudResource ? [cloudResource] : []),
    ]),
    ...(allowedHtml ? [info('Allowed services', allowedHtml, 'green')] : []),
    ...(blockedHtml ? [info('Restricted services (cost control)', blockedHtml, 'amber')] : []),
  ];

  const { html, text } = renderEmail({
    title: `${cloudLong} sandbox ready`,
    badge: cloudShort,
    intro: `Hi,<br><br>Your <strong>${cloudLong}</strong> sandbox has been provisioned. Use the portal credentials to log in, then jump straight to the cloud console with the dedicated sandbox login below.`,
    sections,
    expiry: expiresAt,
  });

  await sendEmail(email, subject, html, text);
}

// ─── 7. Universal resource welcome (VM/workspace/RDS/ROSA/ARO) ───────────

async function notifyResourceWelcomeEmail({
  email, resourceType,
  portalPassword,
  accessUrl, accessUsername, accessPassword,
  resourceName, trainingName, organization, imageKey, imageLabel,
  cpus, memoryMb,
  expiresAt,
  hostIp, sshPort, vncPort,
  clusterName, namespace, consoleUrl,
  // New: permanent signed URL that opens the VM in Guacamole in-browser.
  // When supplied, the email has a prominent "Open in Browser" button and
  // skips the raw RDP/SSH step (still included as Option B for power users).
  openInBrowserUrl,
}) {
  const labels = {
    vm:                'Virtual Machine',
    workspace:         'Workspace',
    'windows-desktop': 'Windows Desktop',
    rosa:              'Red Hat OpenShift on AWS',
    aro:               'Azure Red Hat OpenShift',
  };
  const badges = { vm: 'VM', workspace: 'WORKSPACE', 'windows-desktop': 'WINDOWS', rosa: 'ROSA', aro: 'ARO' };
  const label = labels[resourceType] || 'Lab Resource';
  const badge = badges[resourceType] || 'LAB';
  const subject = `${trainingName || resourceName} — your ${label.toLowerCase()} is ready`;
  const isWindows = resourceType === 'windows-desktop';
  const isCluster = resourceType === 'rosa' || resourceType === 'aro';

  // Step 2 rows — what you need if you're NOT using the 1-click link
  let accessRows;
  if (isCluster) {
    accessRows = [
      ...(consoleUrl ? [{ label: 'Console URL', value: consoleUrl, link: consoleUrl }] : []),
      ...(clusterName ? [{ label: 'Cluster', value: clusterName }] : []),
      ...(namespace ? [{ label: 'Namespace', value: namespace, mono: true }] : []),
      { label: 'Username', value: accessUsername || '', mono: true },
      { label: 'Password', value: accessPassword || '', mono: true, bold: true },
    ];
  } else if (isWindows) {
    accessRows = [
      ...(hostIp ? [{ label: 'Host (IP)', value: hostIp, mono: true }] : []),
      { label: 'Port',     value: '3389 (RDP)', mono: true },
      { label: 'Username', value: accessUsername || 'labuser', mono: true },
      { label: 'Password', value: accessPassword || '', mono: true, bold: true },
    ];
  } else {
    accessRows = [
      ...(hostIp ? [{ label: 'Host (IP)', value: hostIp, mono: true }] : []),
      ...(sshPort ? [{ label: 'Port', value: `${sshPort} (SSH)`, mono: true }] : []),
      { label: 'Username', value: accessUsername || 'labuser', mono: true },
      { label: 'Password', value: accessPassword || '', mono: true, bold: true },
      ...(sshPort && hostIp ? [{ label: 'SSH command', value: `ssh ${accessUsername || 'labuser'}@${hostIp} -p ${sshPort}`, mono: true }] : []),
    ];
  }

  // How-to-connect steps — plain English, no HTML. `code` slot carries
  // the IP so it renders in monospace on a grey background.
  const howToSteps = [];
  if (!isCluster) {
    if (isWindows) {
      howToSteps.push(
        steps('Option B — Connect from a Mac (local RDP client)', [
          { text: "Install 'Microsoft Remote Desktop' from the Mac App Store." },
          { text: "Open the app and click 'Add PC'.", code: hostIp || '' },
          { text: "Paste the host IP into 'PC name'. Under 'User account', click 'Add user account' and enter the username + password shown above. Save." },
          { text: "Double-click the PC tile to start. Accept the certificate warning on first connect." },
        ]),
        steps('Option B — Connect from Windows (local RDP client)', [
          { text: "Press Win+R, type mstsc, press Enter to open Remote Desktop Connection." },
          { text: "In 'Computer', paste the host IP and click Connect.", code: hostIp || '' },
          { text: "When prompted, enter the username and password above." },
          { text: "Click Yes on the certificate warning. You're in." },
        ])
      );
    } else {
      // Linux VM
      howToSteps.push(
        steps('Option B — Connect via SSH (Mac / Linux / Windows)', [
          { text: "Open Terminal (Mac / Linux) or PowerShell (Windows)." },
          { text: "Run the SSH command:", code: `ssh ${accessUsername || 'labuser'}@${hostIp || 'HOST'}${sshPort && String(sshPort) !== '22' ? ` -p ${sshPort}` : ''}` },
          { text: "When prompted for the password, paste the one shown above." },
        ])
      );
    }
  }

  const sections = [
    credentials('Step 1 — Log in to the training portal', [
      { label: 'Portal',   value: BRAND.portalUrl, link: BRAND.portalUrl },
      { label: 'Email',    value: email, mono: true },
      { label: 'Password', value: portalPassword || 'Welcome1234!', mono: true, bold: true },
    ]),
    credentials(`Step 2 — ${label} credentials`, accessRows),
    // 1-click "Open in Browser" — only when we have a permanent signed URL
    ...(openInBrowserUrl ? [
      info('Option A — Open in browser (recommended)',
        `Click the button below to open this ${label.toLowerCase()} inside your browser via Guacamole. No RDP or SSH client required. Works on Mac, Windows, iPad, Chromebook — anywhere you have Chrome / Safari / Edge.`,
        'blue'),
      button('Open in browser', openInBrowserUrl),
    ] : []),
    ...howToSteps,
    ...(imageLabel || cpus || memoryMb ? [
      info('Specs',
        [
          imageLabel && `Image: ${imageLabel}`,
          cpus && `${cpus} vCPU`,
          memoryMb && (memoryMb >= 1024 ? `${(memoryMb/1024).toFixed(1)} GB RAM` : `${memoryMb} MB RAM`),
        ].filter(Boolean).join(' · '),
        'gray'),
    ] : []),
    ...quickStartFor(imageKey, { accessPassword }),
  ];

  const { html, text } = renderEmail({
    title: `Your ${label.toLowerCase()} is ready`,
    badge,
    intro: `Hi, your ${label.toLowerCase()}${resourceName ? ` <strong>${resourceName}</strong>` : ''}${trainingName ? ` for <strong>${trainingName}</strong>` : ''} is provisioned and ready. Log in to the portal with your email + password, or click the "Open in browser" button below to jump straight into the lab.`,
    sections,
    expiry: expiresAt,
  });

  await sendEmail(email, subject, html, text);
}

// ─── 7b. RDS lab ready (consolidated roster to org admin) ────────────────
//
// Sent once per RDS deployment (not per student). Includes the admin's
// portal login, the RDS host RDP details, and a table of all N student
// users with per-row "Open in browser" links (when Guacamole is enabled).

async function notifyRdsLabReady({
  adminEmail, trainingName, organization, hostIp,
  adminUsername, adminPassword,
  users,                      // [{ username, password, email?, openInBrowserUrl? }, ...]
  adminOpenInBrowserUrl,      // optional 1-click link for the admin/host
  expiresAt,
}) {
  const { rawHtml } = require('./emailTemplate');
  const totalUsers = Array.isArray(users) ? users.length : 0;

  function rosterHtml() {
    const rows = users.map(u => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;">${u.username}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;font-weight:600;">${u.password}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:12px;color:#6b7280;">${u.email || '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${u.openInBrowserUrl
          ? `<a href="${u.openInBrowserUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:6px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;">Open in browser</a>`
          : '<span style="color:#9ca3af;font-size:12px;">(portal only)</span>'}</td>
      </tr>`).join('');
    return `
      <div style="margin:20px 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Student roster — ${totalUsers} users</div>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">RDS User</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">RDS Password</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Portal Email</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Quick access</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px;font-size:12px;color:#6b7280;line-height:1.5;">
        All ${totalUsers} users connect to the <strong>same</strong> Windows host — Windows keeps each session isolated.
        Share each row with the matching trainee. Student portal logins all use password <strong>Welcome1234!</strong>.
      </div>`;
  }

  function rosterText() {
    const h = 'USER'.padEnd(14) + 'PASSWORD'.padEnd(18) + 'PORTAL EMAIL'.padEnd(30) + 'OPEN';
    const lines = users.map(u => u.username.padEnd(14) + u.password.padEnd(18) + (u.email || '—').padEnd(30) + (u.openInBrowserUrl || '(portal only)'));
    return ['Student roster', h, '-'.repeat(h.length), ...lines].join('\n');
  }

  const sections = [
    credentials('Step 1 — Portal admin login (for you)', [
      { label: 'Portal',   value: BRAND.portalUrl, link: BRAND.portalUrl },
      { label: 'Email',    value: adminEmail, mono: true },
      { label: 'Password', value: 'Welcome1234!', mono: true, bold: true },
    ]),
    credentials('Step 2 — RDS host (admin account, for setup)', [
      { label: 'Host (IP)', value: hostIp, mono: true },
      { label: 'Port',      value: '3389 (standard RDP)', mono: true },
      { label: 'Username',  value: adminUsername, mono: true },
      { label: 'Password',  value: adminPassword, mono: true, bold: true },
    ]),
    ...(adminOpenInBrowserUrl ? [button('Open admin session in browser', adminOpenInBrowserUrl)] : []),
    rawHtml(rosterHtml(), rosterText()),
    steps('Option A — One click (easiest)', [
      { text: "Share each row's 'Open in browser' link with the matching trainee. Their desktop opens in a new browser tab — no RDP client needed." },
      { text: "Works on Mac, Windows, iPad, Chromebook, anywhere with Chrome / Safari / Edge." },
    ]),
    steps('Option B — Local RDP client', [
      { text: "Mac: install 'Microsoft Remote Desktop' from the App Store. Add a PC with the host IP above, add a user account with the row's username and password." },
      { text: "Windows: press Win+R, type mstsc, press Enter. Computer = host IP. When prompted, enter the username + password from the row." },
    ]),
  ];

  const { html, text } = renderEmail({
    title: `Your RDS lab "${trainingName}" is ready`,
    badge: 'WINDOWS RDS',
    intro: `Hi, your Windows Server 2022 RDS lab <strong>${trainingName}</strong> is up. ${totalUsers} student${totalUsers === 1 ? '' : 's'} share the same Windows host — each gets an isolated session. Below: your admin portal login, the host RDP details, and a per-student roster with one-click "Open in browser" links you can distribute.`,
    sections,
    expiry: expiresAt,
  });

  await sendEmail(adminEmail, `Your RDS lab "${trainingName}" is ready`, html, text);
}

// ─── 7c. Ops alert — VM stop is stuck (worker crash-loop, queue jam) ─────
//
// Fired by idleShutdown when stopAttempts hits 3 for a single VM. Means
// something is wrong with the worker/queue — manual intervention needed.
// Sent once per stuck cycle (idleShutdown only fires alert on ==3, not
// >=3, and counter resets when VM actually stops via the reconciler).

async function notifyStuckStop({ vmName, organization, trainingName, resourceGroup, attempts, idleMinutes }) {
  const to = 'itops@synergificsoftware.com';
  const subject = `[OPS] VM stop stuck — ${vmName} (${attempts} attempts)`;
  const { html, text } = renderEmail({
    title: `VM stop is stuck`,
    badge: 'ALERT',
    intro: `The idle-shutdown automation tried to stop <strong>${vmName}</strong> ${attempts} times in a row but the VM is still running. Usually means the azure-stop-vm worker is crash-looping, the Bull queue is jammed, or Azure is refusing the deallocate call.`,
    sections: [
      credentials('VM details', [
        { label: 'Name',           value: vmName, mono: true },
        { label: 'Organization',   value: organization || '—' },
        { label: 'Training',       value: trainingName || '—' },
        { label: 'Resource group', value: resourceGroup || '—', mono: true },
        { label: 'Idle window',    value: `${idleMinutes || 15} min` },
        { label: 'Attempts',       value: String(attempts), bold: true },
      ]),
      steps('What to check', [
        { text: "docker ps --filter name=worker — all 10 replicas should be Up (healthy), not Restarting" },
        { text: "pm2 logs synergific-backend --err — look for recurring errors" },
        { text: "Azure portal: is the VM truly running or in a stuck state (e.g. deallocating for hours)?" },
        { text: "After fixing: db.vms.updateOne({name: '" + vmName + "'}, {$set: {stopAttempts: 0}}) to silence the alert and re-arm detection." },
      ]),
      warning(`This VM is still burning spot-rate cost while stuck. Manual stop via Azure portal is safe — the reconciler will catch up on DB state.`),
    ],
  });
  await sendEmail(to, subject, html, text);
  logger.warn(`[ops-alert] stuck-stop email sent: ${vmName} attempts=${attempts}`);
}

// ─── 8. Bulk deploy summary (TO: org admin; CC: internal + deployer) ─────
//
// Replaces the old "per-student welcome email" flow for BULK deploys, since
// most student emails are dummies. The org admin gets one consolidated
// roster they can distribute to learners directly.
//
// Columns are generic — both container and sandbox bulk deploys can share
// this renderer by providing their own `columns` config.

async function sendBulkDeploySummary({
  opsEmail, trainingName, organization,
  kindLabel,         // e.g. "Workspaces", "AWS Sandboxes"
  imageOrTemplate,   // e.g. "bigdata-workspace" or "AWS CLF-C02"
  columns,           // [{ key, label, mono?, link? }, ...]
  rows,              // array of objects matching column keys
  extraNote,         // optional footer paragraph
}) {
  const orgAdmins = await getOrgAdminEmails(organization);
  const toList = orgAdmins.length ? orgAdmins : [opsEmail].filter(Boolean);
  const to = joinEmails(toList);
  const cc = joinEmails([...INTERNAL_CC, opsEmail].filter(e => !toList.includes(e)));

  if (!to) {
    logger.warn(`sendBulkDeploySummary: no recipient for ${organization}/${trainingName}, skipping`);
    return;
  }

  const subject = `[${BRAND.name}] ${kindLabel} roster — ${trainingName} (${rows.length} seat${rows.length === 1 ? '' : 's'})`;

  // Plain-text — for forwarding or copying into tickets
  const txt = [
    `${BRAND.name} — ${kindLabel} Roster`,
    `Training:     ${trainingName}`,
    `Organization: ${organization}`,
    `Type:         ${imageOrTemplate || '—'}`,
    `Seats:        ${rows.length}`,
    '',
    rows.map((r, i) => {
      const line1 = `${(i + 1).toString().padStart(3)}. ` +
        columns.map(c => `${c.label}: ${r[c.key] ?? '—'}`).join('  ·  ');
      return line1;
    }).join('\n'),
    '',
    extraNote || '',
  ].filter(Boolean).join('\n');

  // HTML table
  const ths = ['#', ...columns.map(c => c.label)].map(h =>
    `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">${h}</th>`
  ).join('');

  const trs = rows.map((r, i) => {
    const tds = [`<td style="padding:6px 10px;font-size:12px;color:#6b7280;">${i + 1}</td>`,
      ...columns.map(c => {
        const v = r[c.key];
        if (v == null || v === '') return `<td style="padding:6px 10px;font-size:12px;">—</td>`;
        const styled = c.mono
          ? `<span style="font-family:monospace;">${escapeHtml(v)}</span>`
          : escapeHtml(v);
        const rendered = c.link && typeof v === 'string' && v.startsWith('http')
          ? `<a href="${escapeHtml(v)}" style="color:#2563eb;">${styled}</a>`
          : styled;
        return `<td style="padding:6px 10px;font-size:12px;">${rendered}</td>`;
      }),
    ].join('');
    return `<tr style="border-bottom:1px solid #f3f4f6;${i % 2 ? 'background:#f9fafb;' : ''}">${tds}</tr>`;
  }).join('');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:800px;margin:0 auto;">
      <div style="background:linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);padding:18px 22px;border-radius:6px 6px 0 0;">
        <div style="color:#fff;font-size:15px;font-weight:600;">Lab Roster Delivered</div>
        <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:3px;">${escapeHtml(trainingName || '')} · ${escapeHtml(organization || '')} · ${rows.length} ${kindLabel.toLowerCase()}${imageOrTemplate ? ' · ' + escapeHtml(imageOrTemplate) : ''}</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;padding:18px 22px;background:#fff;">
        <p style="font-size:13px;color:#374151;margin:0 0 14px;">
          The table below lists every ${kindLabel.slice(0, -1).toLowerCase()} provisioned for this training.
          Please share the individual credentials with each learner ${orgAdmins.length ? '— only the org admin and the Synergific ops team are on this email.' : '.'}
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f3f4f6;">${ths}</tr></thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
        ${extraNote ? `<p style="color:#6b7280;font-size:12px;margin:14px 0 0;">${escapeHtml(extraNote)}</p>` : ''}
        <p style="color:#9ca3af;font-size:11px;margin:14px 0 0;">
          Need help? Reply to this email. &nbsp;·&nbsp; ${BRAND.name} · ${BRAND.tagline}
        </p>
      </div>
    </div>`;

  await sendEmail(to, subject, html, txt, { cc });
}

// Legacy-friendly wrapper — containers bulk deploy.
// Signature compatible with the old `notifyOpsDeploySummary`, plus returns
// the new bulk-routed email instead.
async function notifyOpsDeploySummary({
  opsEmail, trainingName, organization, imageLabel,
  containers, // [{ name, email, accessUrl, password, sshPort }]
}) {
  return sendBulkDeploySummary({
    opsEmail, trainingName, organization,
    kindLabel: 'Workspaces',
    imageOrTemplate: imageLabel,
    columns: [
      { key: 'email',     label: 'Learner' },
      { key: 'name',      label: 'Instance', mono: true },
      { key: 'accessUrl', label: 'URL', link: true, mono: true },
      { key: 'password',  label: 'Password', mono: true },
      { key: 'sshPort',   label: 'SSH', mono: true },
    ],
    rows: containers,
  });
}

// New: sandbox bulk summary (AWS/Azure/GCP/OCI — parallel to containers).
async function notifySandboxBulkSummary({
  opsEmail, trainingName, organization, templateName, cloud,
  sandboxes, // [{ email, username, password, accessUrl, region, expiresAt }]
}) {
  const cloudShort = (cloud || '').toUpperCase();
  return sendBulkDeploySummary({
    opsEmail, trainingName, organization,
    kindLabel: cloudShort ? `${cloudShort} Sandboxes` : 'Sandboxes',
    imageOrTemplate: templateName,
    columns: [
      { key: 'email',     label: 'Learner' },
      { key: 'username',  label: 'Username', mono: true },
      { key: 'password',  label: 'Password', mono: true },
      { key: 'accessUrl', label: 'Console URL', link: true, mono: true },
      { key: 'region',    label: 'Region' },
    ],
    rows: sandboxes,
    extraNote: `All sandboxes auto-clean at their expiry. Learner activity is restricted to the allowed services on the template.`,
  });
}

// Small HTML escape used inside the bulk-summary builder.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Demo request emails (from public /open/demo-request form) ──────────
//
// Two emails per submission:
//   1. Confirmation to the requester — "thanks, we'll be in touch".
//   2. Notification to internal ops (itops) with full details.
//
// Both use the unified email template so a demo request reads like any
// other official Synergific email.

async function notifyDemoRequestConfirmation({ name, email, company, demoDate, preferredTiming }) {
  const subject = `We received your demo request — Synergific Cloud Portal`;

  const sections = [
    info('What happens next',
      `<strong>Within 24 business hours</strong> our team will email you to confirm the date + timing and send a calendar invite with a meeting link. If you asked for a date that is already full we'll suggest the nearest slot.`,
      'blue'),
    credentials('Your request summary', [
      { label: 'Name',          value: name },
      { label: 'Email',         value: email, mono: true },
      { label: 'Company',       value: company },
      ...(demoDate        ? [{ label: 'Preferred date', value: demoDate }] : []),
      ...(preferredTiming ? [{ label: 'Preferred time', value: preferredTiming }] : []),
    ]),
    info('Prepare for the demo',
      `Think about: how many students per batch, which certifications you deliver, any cloud-provider preferences (AWS / Azure / GCP / OCI), and whether you need white-label branding. We'll tailor the walkthrough to your actual workflow.`,
      'gray'),
  ];

  const { html, text } = renderEmail({
    title: 'Demo request received',
    badge: 'DEMO',
    intro: `Hi ${name.split(' ')[0] || 'there'},<br><br>Thanks for requesting a demo of Synergific Cloud Portal. We've got your details and one of our team will reach out shortly.`,
    sections,
  });

  await sendEmail(email, subject, html, text);
}

async function notifyDemoRequestOps({ name, email, company, demoDate, preferredTiming, ipAddress, userAgent }) {
  const subject = `[Synergific Ops] New demo request — ${company} (${name})`;
  const to = joinEmails(INTERNAL_CC);  // itops

  // Plain-text body — easy to forward / paste into CRM
  const text = [
    `New demo request from the public login page.`,
    '',
    `Name:             ${name}`,
    `Email:            ${email}`,
    `Company:          ${company}`,
    `Preferred date:   ${demoDate || '—'}`,
    `Preferred time:   ${preferredTiming || '—'}`,
    `IP:               ${ipAddress || '—'}`,
    `User-Agent:       ${userAgent || '—'}`,
    `Submitted at:     ${new Date().toISOString()}`,
    '',
    `Reply-to link:    mailto:${email}?subject=Re%3A%20Your%20Synergific%20demo%20request`,
  ].join('\n');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;">
      <div style="background:#11192a;padding:18px 22px;border-radius:6px 6px 0 0;">
        <div style="color:#fff;font-size:15px;font-weight:600;">[Ops] New demo request</div>
        <div style="color:#93c5fd;font-size:12px;margin-top:3px;">${company} · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;padding:18px 22px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;width:140px;">Name</td><td style="color:#111;font-weight:600;">${name}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Email</td><td style="color:#111;font-family:monospace;"><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Company</td><td style="color:#111;">${company}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Preferred date</td><td style="color:#111;">${demoDate || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Preferred time</td><td style="color:#111;">${preferredTiming || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">IP / UA</td><td style="color:#6b7280;font-size:11px;">${ipAddress || '—'}  ·  ${(userAgent || '').slice(0, 80)}</td></tr>
        </table>
        <div style="margin-top:16px;">
          <a href="mailto:${email}?subject=Re%3A%20Your%20Synergific%20demo%20request" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Reply to ${name.split(' ')[0]}</a>
        </div>
        <p style="color:#9ca3af;font-size:11px;margin:16px 0 0;">Stored in DemoRequest collection. Update status from the admin panel once you've reached out.</p>
      </div>
    </div>`;

  await sendEmail(to, subject, html, text, { cc: '' });  // no extra CC — TO already has both internal addresses
}

module.exports = {
  sendEmail,
  notifyInstanceReady,
  notifyQuotaLow,
  notifyAutoShutdown,
  checkQuotaWarnings,
  notifyLabWelcomeEmail,
  notifyOpsDeploySummary,
  notifySandboxWelcomeEmail,
  notifyResourceWelcomeEmail,
  notifyRdsLabReady,
  notifyStuckStop,
  // new in 2026-04-19 bulk-routing upgrade:
  notifySandboxBulkSummary,
  isLikelyDeliverable,
  getOrgAdminEmails,
  // new in 2026-04-20 demo-request flow:
  notifyDemoRequestConfirmation,
  notifyDemoRequestOps,
};
