// VM-created email — one email per training (bulk create), sent to the
// admin who deployed it. Shows a roster table (one row per VM) with per-row
// "Open in browser" link (signed, permanent — verified + fresh Guac token
// minted by backend's GET /open/:conn route on click).

const crypto = require('crypto');
const { renderEmail, steps, rawHtml, credentials, info, BRAND } = require('../../services/emailTemplate');

const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://getlabs.cloud').replace(/\/+$/, '');
const GUAC_LINK_SECRET = process.env.GUACAMOLE_LINK_SECRET
  || process.env.GUACAMOLE_USER_SECRET
  || process.env.GUACAMOLE_ADMIN_PASS
  || 'guacadmin';

// MUST match the signing in backend/services/guacamoleService.js
function signOpenLink(connName) {
  return crypto.createHmac('sha256', GUAC_LINK_SECRET).update(String(connName)).digest('hex').slice(0, 32);
}
function buildOpenInBrowserUrl(connName) {
  return `${APP_BASE_URL}/open/${encodeURIComponent(connName)}?sig=${signOpenLink(connName)}`;
}

function vmTableHtml(vms) {
  const rows = vms.map(vm => {
    const openUrl = vm.guacamole !== false ? buildOpenInBrowserUrl(vm.name) : null;
    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;">${vm.name || ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${vm.email || '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;">${vm.publicIp || vm.ip || '—'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;">${vm.adminUsername || 'labuser'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:13px;color:#111827;font-weight:600;">${vm.adminPass || 'Welcome1234!'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${openUrl
        ? `<a href="${openUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:6px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;">Open in browser</a>`
        : '<span style="color:#9ca3af;font-size:12px;">(portal only)</span>'}</td>
    </tr>`;
  }).join('');
  return `
    <div style="margin:20px 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">VM roster — ${vms.length} machine${vms.length === 1 ? '' : 's'}</div>
    <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">VM</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Assigned email</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Public IP</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">User</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Password</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Quick access</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function vmTableText(vms) {
  const h = 'VM'.padEnd(18) + 'EMAIL'.padEnd(26) + 'IP'.padEnd(18) + 'USER'.padEnd(12) + 'PASSWORD'.padEnd(18) + 'OPEN';
  const lines = vms.map(vm =>
    (vm.name || '').padEnd(18) +
    (vm.email || '—').padEnd(26) +
    (vm.publicIp || vm.ip || '—').padEnd(18) +
    (vm.adminUsername || 'labuser').padEnd(12) +
    (vm.adminPass || 'Welcome1234!').padEnd(18) +
    (vm.guacamole !== false ? buildOpenInBrowserUrl(vm.name) : '(portal only)')
  );
  return [h, '-'.repeat(h.length), ...lines].join('\n');
}

const generateEmail = (vms, customer) => {
  const count = (vms || []).length;
  const single = count === 1;
  const firstVm = vms?.[0] || {};
  const looksLinux = !(firstVm.os || '').toLowerCase().includes('windows');

  // Admin portal address (we don't know each student's portal password,
  // so direct admin to the portal and show Welcome1234! default).
  const sections = [
    credentials('Step 1 — Portal login (for the student)', [
      { label: 'Portal',   value: `${BRAND.portalUrl}/login`, link: `${BRAND.portalUrl}/login` },
      { label: 'Email',    value: "(each student's assigned email — see table below)" },
      { label: 'Password', value: 'Welcome1234!', mono: true, bold: true },
    ]),
    rawHtml(vmTableHtml(vms || []), vmTableText(vms || [])),
    info('Option A — One click (easiest)',
      "Click the blue 'Open in browser' button on any row to jump straight into that VM's desktop inside your browser — no SSH or RDP client needed. Works on Mac, Windows, iPad, Chromebook.",
      'blue'),
    steps('Option B — Local client',
      looksLinux
        ? [
            { text: "SSH from Terminal (Mac / Linux) or PowerShell (Windows):", code: `ssh ${firstVm.adminUsername || 'labuser'}@${firstVm.publicIp || 'HOST'}` },
            { text: "Paste the row's password when prompted." },
          ]
        : [
            { text: "Mac: install 'Microsoft Remote Desktop' from the App Store. Add PC → paste the row's Public IP. Under 'User account' use the row's user + password." },
            { text: "Windows: press Win+R, type mstsc, Enter. Computer = row's Public IP. Enter user + password when prompted." },
          ]
    ),
    steps('Getting started', [
      { text: `Log into the portal at ${BRAND.portalUrl}/login using the student's email + password.` },
      { text: "Open 'Lab Console' to see live status, start/stop, and quick actions." },
      { text: `Need help? Reply to this email or write to ${BRAND.supportEmail}.` },
    ]),
  ];

  const { html: renderedHtml, text: renderedText } = renderEmail({
    title: single ? 'Your lab is ready' : `Your ${count} labs are ready`,
    badge: 'VM',
    intro: `Hi ${customer || 'there'}, the virtual machine${single ? '' : 's'} you requested ${single ? 'is' : 'are'} up and running on Synergific Cloud Portal. Share each row of the table below with the assigned student. The "Open in browser" button is a permanent one-click link — never expires, always works.`,
    sections,
  });

  return {
    subject: single
      ? `Your lab is ready — ${BRAND.name}`
      : `Your ${count} labs are ready — ${BRAND.name}`,
    body: renderedHtml,
    text: renderedText,
  };
};

module.exports = { generateEmail };
