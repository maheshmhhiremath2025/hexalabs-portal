// Customer-facing emails go through emailTemplate.js for consistent
// "Synergific Cloud Portal" branding (gradient header, sections, plain-text
// fallback). Ops emails (notifyOpsDeploySummary) stay plain-tabular since
// they're internal records, not customer-facing.
//
// Function signatures are preserved — callers in controllers/automations
// don't need to change. Internally each function is now ~15-30 lines: it
// builds a sections array and hands it to renderEmail().

const nodemailer = require('nodemailer');
const VM = require('../models/vm');
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
const CC_RECIPIENTS = 'itops@synergificsoftware.com, vinay.chandra@synergificsoftware.com';

/**
 * Low-level send. Both `html` and `text` are sent so corporate gateways
 * that strip HTML still get a readable email.
 */
async function sendEmail(to, subject, html, text) {
  try {
    await transporter.sendMail({ from: FROM, to, cc: CC_RECIPIENTS, subject, html, text });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email failed to ${to}: ${err.message}`);
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

  // Step 2 — resource-specific access details
  let accessRows;
  if (resourceType === 'rosa' || resourceType === 'aro') {
    accessRows = [
      ...(consoleUrl ? [{ label: 'Console URL', value: consoleUrl, link: consoleUrl }] : []),
      ...(clusterName ? [{ label: 'Cluster', value: clusterName }] : []),
      ...(namespace ? [{ label: 'Namespace', value: namespace, mono: true }] : []),
      { label: 'Username', value: accessUsername || '', mono: true },
      { label: 'Password', value: accessPassword || '', mono: true, bold: true },
    ];
  } else {
    accessRows = [
      ...(accessUrl ? [{ label: 'Open URL', value: accessUrl, link: accessUrl }] : []),
      { label: 'Username', value: accessUsername || 'lab', mono: true },
      { label: 'Password', value: accessPassword || '', mono: true, bold: true },
      ...(sshPort && hostIp ? [{ label: 'SSH', value: `ssh ${accessUsername || 'lab'}@${hostIp} -p ${sshPort}`, mono: true }] : []),
    ];
  }

  const sections = [
    credentials('Step 1 — Log in to the training portal', [
      { label: 'Portal',   value: BRAND.portalUrl, link: BRAND.portalUrl },
      { label: 'Email',    value: email, mono: true },
      { label: 'Password', value: portalPassword || 'Welcome1234!', mono: true, bold: true },
    ]),
    credentials(`Step 2 — Access your ${label}`, accessRows),
    ...(imageLabel || cpus || memoryMb ? [
      info('Specs',
        [
          imageLabel && `Image: <strong>${imageLabel}</strong>`,
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
    intro: `Hi,<br><br>Your ${label.toLowerCase()}${resourceName ? ` <strong>${resourceName}</strong>` : ''} has been provisioned${trainingName ? ` for <strong>${trainingName}</strong>` : ''}. Use the portal to log in, then access the lab directly with the credentials below.`,
    sections,
    expiry: expiresAt,
  });

  await sendEmail(email, subject, html, text);
}

// ─── 8. Ops deploy summary (internal — kept plain-tabular intentionally) ─

async function notifyOpsDeploySummary({
  opsEmail, trainingName, organization, imageLabel,
  containers, // [{ name, email, accessUrl, password, sshPort }]
}) {
  const subject = `[Ops] Deploy complete — ${trainingName} (${containers.length} seat${containers.length === 1 ? '' : 's'})`;

  // Plain-text body — meant for forwarding to support tickets
  const txtRows = containers.map((c, i) =>
    `${(i + 1).toString().padStart(3)}. ${(c.email || '—').padEnd(34)} ${c.accessUrl || ''}\n     pw: ${c.password}${c.sshPort ? `   ssh-port: ${c.sshPort}` : ''}`
  ).join('\n');
  const text = [
    `${BRAND.name} — Ops Deploy Summary`,
    `Training:     ${trainingName}`,
    `Organization: ${organization}`,
    `Image:        ${imageLabel || '—'}`,
    `Seats:        ${containers.length}`,
    '',
    txtRows,
  ].join('\n');

  // Compact HTML table
  const tableRows = containers.map((c, i) => `
    <tr style="border-bottom:1px solid #f3f4f6;${i % 2 ? 'background:#f9fafb;' : ''}">
      <td style="padding:6px 10px;font-size:12px;color:#6b7280;">${i + 1}</td>
      <td style="padding:6px 10px;font-size:12px;">${c.email || '—'}</td>
      <td style="padding:6px 10px;font-size:12px;"><a href="${c.accessUrl || '#'}" style="color:#2563eb;">${c.accessUrl || '—'}</a></td>
      <td style="padding:6px 10px;font-size:12px;font-family:monospace;">${c.password}</td>
      <td style="padding:6px 10px;font-size:12px;font-family:monospace;">${c.sshPort || '—'}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:740px;margin:0 auto;">
      <div style="background:#11192a;padding:16px 20px;border-radius:6px 6px 0 0;">
        <div style="color:#fff;font-size:15px;font-weight:600;">[Ops] Batch Deploy Complete</div>
        <div style="color:#93c5fd;font-size:12px;margin-top:2px;">${trainingName} · ${organization} · ${containers.length} seats · ${imageLabel || ''}</div>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px;padding:16px 20px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">#</th>
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">Student</th>
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">URL</th>
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">Password</th>
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#6b7280;">SSH</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p style="color:#9ca3af;font-size:11px;margin:14px 0 0;">Welcome emails sent to each student email above.</p>
      </div>
    </div>`;

  await sendEmail(opsEmail, subject, html, text);
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
};
