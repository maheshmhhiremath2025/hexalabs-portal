// VM-created email — uses the unified emailTemplate.js so every customer
// email has the same brand identity. Replaces the previous hand-rolled
// HTML blob with sections: credentials table + quick-start steps.

const { renderEmail, steps, rawHtml, BRAND } = require('../../services/emailTemplate');

function vmTableHtml(vms) {
  const rows = vms.map(vm => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#111827;">${vm.name || ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${vm.email || ''}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#111827;">${vm.publicIp || vm.ip || '-'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#111827;">${vm.adminUsername || 'labuser'}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,monospace;font-size:13px;color:#111827;">${vm.adminPass || 'Welcome1234!'}</td>
    </tr>`).join('');
  return `
    <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">VM</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Email</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Public IP</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">User</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;">Password</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function vmTableText(vms) {
  const header = 'VM'.padEnd(18) + 'EMAIL'.padEnd(28) + 'PUBLIC IP'.padEnd(18) + 'USER'.padEnd(14) + 'PASSWORD';
  const lines = vms.map(vm =>
    (vm.name || '').padEnd(18) +
    (vm.email || '').padEnd(28) +
    (vm.publicIp || vm.ip || '-').padEnd(18) +
    (vm.adminUsername || 'labuser').padEnd(14) +
    (vm.adminPass || 'Welcome1234!')
  );
  return [header, '-'.repeat(header.length), ...lines].join('\n');
}

const generateEmail = (vms, customer) => {
  const count = (vms || []).length;
  const single = count === 1;

  const html = vmTableHtml(vms || []);
  const text = vmTableText(vms || []);

  const { html: renderedHtml, text: renderedText } = renderEmail({
    title: single ? 'Your lab is ready' : `Your ${count} labs are ready`,
    badge: 'VM',
    intro: `Hi ${customer || 'there'}, the virtual machine${single ? '' : 's'} you requested ${single ? 'is' : 'are'} up and running on Synergific Cloud Portal. Credentials are below — keep this email private.`,
    sections: [
      rawHtml(html, text),
      steps('Getting started', [
        { text: `Log into the portal at ${BRAND.portalUrl}/login using your email + password.` },
        { text: `Open "Lab Console" — your VM${single ? '' : 's'} are listed with live status and quick actions.` },
        { text: `Connect via SSH / RDP with the credentials above, or click "Open in browser" for an in-browser desktop (where available).` },
        { text: `Need help? Reply to this email or write to ${BRAND.supportEmail}.` },
      ]),
    ],
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
