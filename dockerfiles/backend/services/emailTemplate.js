// Unified email template engine — used by ALL customer-facing emails.
//
// Goal: every customer email looks like it came from the same product.
// Brand is fixed (Synergific Cloud Portal) — we intentionally do NOT pull
// per-org branding here. Reason: emails go through Gmail and end up in
// reply chains, forwards, and screenshots; consistent brand identity
// across organizations protects ours.
//
// Public API:
//   renderEmail({ title, badge, intro, sections, expiry, footerNote })
//     → { html, text, subject? }   (subject only if you pass title; usually
//                                    the caller builds the subject themselves)
//
// All section helpers below produce the SAME visual rhythm (rounded card,
// pastel background, monospaced credentials). Adding a new section type?
// Add it here, not inline in a notify function — that's how this file
// got to 848 lines in the first place.

const BRAND = {
  name: 'Synergific Cloud Portal',
  tagline: 'Enterprise Cloud Training Labs',
  primary: '#2563eb',
  accent: '#1e40af',
  // Gradient used by the header
  headerGradient: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
  // Default support contact (visible in every email footer)
  supportEmail: 'itops@synergificsoftware.com',
  portalUrl: 'https://getlabs.cloud',
};

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

// ─── public render helpers ───────────────────────────────────────────────

/**
 * Render the full email — returns { html, text } so the caller can pass both
 * into nodemailer. Always include both: many corporate gateways strip HTML.
 *
 * @param title      string — large header text inside the gradient banner
 * @param badge      optional string — small uppercase pill above the title
 *                   (e.g. "VM", "WORKSPACE", "AWS SANDBOX")
 * @param intro      string — opening paragraph (1-2 lines)
 * @param sections   array of section objects, see helpers below
 * @param expiry     optional ISO/Date — renders the standard expiry banner
 * @param footerNote optional string — extra footer line (e.g. "Need help? Contact your trainer.")
 */
function renderEmail({ title, badge, intro, sections = [], expiry, footerNote }) {
  const html = [
    `<div style="font-family:${FONT};max-width:600px;margin:0 auto;background:#f9fafb;padding:20px 0;">`,
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">`,
    headerHtml(title, badge),
    `<div style="padding:24px;">`,
    intro ? `<div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:20px;">${intro}</div>` : '',
    sections.map(renderSectionHtml).join('\n'),
    expiry ? expiryHtml(expiry) : '',
    footerHtml(footerNote),
    `</div></div></div>`,
  ].join('');

  const text = [
    `${BRAND.name}`,
    `${'='.repeat(BRAND.name.length)}`,
    badge ? `[${badge}] ${title}` : title,
    '',
    intro ? stripHtml(intro) : '',
    '',
    sections.map(renderSectionText).filter(Boolean).join('\n\n'),
    expiry ? `\nLAB EXPIRES: ${formatExpiry(expiry)} IST\nAll resources auto-clean at this time. Save your work first.` : '',
    '',
    '— ',
    `${BRAND.name} · ${BRAND.tagline}`,
    `${BRAND.portalUrl}`,
    footerNote ? stripHtml(footerNote) : `Need help? Reply to this email or contact ${BRAND.supportEmail}.`,
  ].filter(Boolean).join('\n');

  return { html, text };
}

// ─── section builders (return objects; renderEmail compiles them) ────────

/** Credentials block: a list of {label, value, mono?, link?} rows. */
function credentials(title, rows) {
  return { type: 'credentials', title, rows };
}

/** Steps: a numbered list of strings (or {text, code?}). */
function steps(title, items) {
  return { type: 'steps', title, items };
}

/** Plain info paragraph in a colored card. */
function info(title, body, tone = 'blue') {
  return { type: 'info', title, body, tone };
}

/** Warning / caution card (yellow/amber). */
function warning(body) {
  return { type: 'warning', body };
}

/** Action button — links to a URL. Use sparingly (one per email). */
function button(label, url) {
  return { type: 'button', label, url };
}

/** Raw HTML escape hatch for image-specific quick-starts (kept for back-compat). */
function rawHtml(html, textFallback = '') {
  return { type: 'raw', html, text: textFallback };
}

// ─── internal renderers ──────────────────────────────────────────────────

function headerHtml(title, badge) {
  return `
    <div style="background:${BRAND.headerGradient};padding:32px 24px;text-align:center;">
      ${badge ? `<div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:4px 14px;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;color:#ffffff;letter-spacing:1.5px;">${escapeHtml(badge)}</span>
      </div>` : ''}
      <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">${escapeHtml(title)}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:6px;">${BRAND.name}</div>
    </div>`;
}

function expiryHtml(expiresAt) {
  return `
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <div style="font-size:13px;color:#92400e;">
        <strong>Lab Expires:</strong> ${escapeHtml(formatExpiry(expiresAt))} IST<br>
        <span style="font-size:12px;">All resources will be automatically cleaned up at this time. Save your work before expiry.</span>
      </div>
    </div>`;
}

function footerHtml(extra) {
  return `
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px;text-align:center;">
      <div style="font-size:12px;color:#9ca3af;line-height:1.6;">
        ${extra ? `${escapeHtml(extra)}<br>` : ''}
        Need help? Reply to this email or contact <a href="mailto:${BRAND.supportEmail}" style="color:#2563eb;">${BRAND.supportEmail}</a>.<br>
        <strong style="color:#374151;">${BRAND.name}</strong> · ${BRAND.tagline}
      </div>
    </div>`;
}

const TONES = {
  blue:   { bg: '#eff6ff', border: '#bfdbfe', title: '#1e40af' },
  green:  { bg: '#f0fdf4', border: '#bbf7d0', title: '#166534' },
  purple: { bg: '#fdf4ff', border: '#e9d5ff', title: '#7e22ce' },
  amber:  { bg: '#fefce8', border: '#fde68a', title: '#a16207' },
  red:    { bg: '#fef2f2', border: '#fecaca', title: '#991b1b' },
  gray:   { bg: '#f9fafb', border: '#e5e7eb', title: '#374151' },
};

function renderSectionHtml(s) {
  switch (s.type) {
    case 'credentials': return credentialsHtml(s);
    case 'steps':       return stepsHtml(s);
    case 'info':        return infoHtml(s);
    case 'warning':     return warningHtml(s);
    case 'button':      return buttonHtml(s);
    case 'raw':         return s.html || '';
    default:            return '';
  }
}

function renderSectionText(s) {
  switch (s.type) {
    case 'credentials': return credentialsText(s);
    case 'steps':       return stepsText(s);
    case 'info':        return `--- ${s.title} ---\n${stripHtml(s.body)}`;
    case 'warning':     return `! ${stripHtml(s.body)}`;
    case 'button':      return `${s.label}: ${s.url}`;
    case 'raw':         return s.text || '';
    default:            return '';
  }
}

function credentialsHtml({ title, rows }) {
  const tone = TONES.blue;
  const tableRows = rows.map(r => `
    <tr>
      <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(r.label)}</td>
      <td style="padding:6px 0;font-size:13px;color:#111;${r.mono ? 'font-family:monospace;' : ''}${r.bold ? 'font-weight:600;' : ''}">
        ${r.link ? `<a href="${escapeAttr(r.link)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(r.value)}</a>` : escapeHtml(r.value)}
      </td>
    </tr>`).join('');
  return `
    <div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;padding:16px;margin-bottom:16px;">
      ${title ? `<div style="font-weight:600;color:${tone.title};font-size:14px;margin-bottom:10px;">${escapeHtml(title)}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;">${tableRows}</table>
    </div>`;
}

function credentialsText({ title, rows }) {
  return [
    title ? `--- ${title} ---` : '',
    ...rows.map(r => `${r.label.padEnd(14)}: ${r.value}${r.link && r.link !== r.value ? ` (${r.link})` : ''}`),
  ].filter(Boolean).join('\n');
}

function stepsHtml({ title, items }) {
  const tone = TONES.gray;
  const lis = items.map((it, i) => {
    const text = typeof it === 'string' ? it : it.text;
    const code = typeof it === 'object' ? it.code : null;
    return `
      <li style="margin-bottom:8px;font-size:13px;color:#374151;line-height:1.5;">
        ${escapeHtml(text)}
        ${code ? `<div style="font-family:monospace;font-size:12px;background:#f8fafc;padding:8px 10px;border-radius:6px;margin-top:4px;color:#374151;">${escapeHtml(code)}</div>` : ''}
      </li>`;
  }).join('');
  return `
    <div style="background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;padding:16px;margin-bottom:16px;">
      ${title ? `<div style="font-weight:600;color:${tone.title};font-size:14px;margin-bottom:10px;">${escapeHtml(title)}</div>` : ''}
      <ol style="margin:0;padding-left:20px;">${lis}</ol>
    </div>`;
}

function stepsText({ title, items }) {
  return [
    title ? `--- ${title} ---` : '',
    ...items.map((it, i) => {
      const text = typeof it === 'string' ? it : it.text;
      const code = typeof it === 'object' ? it.code : null;
      return `${i + 1}. ${text}${code ? `\n   $ ${code}` : ''}`;
    }),
  ].filter(Boolean).join('\n');
}

function infoHtml({ title, body, tone }) {
  const t = TONES[tone] || TONES.blue;
  return `
    <div style="background:${t.bg};border:1px solid ${t.border};border-radius:8px;padding:16px;margin-bottom:16px;">
      ${title ? `<div style="font-weight:600;color:${t.title};font-size:14px;margin-bottom:8px;">${escapeHtml(title)}</div>` : ''}
      <div style="font-size:13px;color:#374151;line-height:1.6;">${body}</div>
    </div>`;
}

function warningHtml({ body }) {
  const t = TONES.amber;
  return `
    <div style="background:${t.bg};border:1px solid ${t.border};border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <div style="font-size:13px;color:${t.title};">${body}</div>
    </div>`;
}

function buttonHtml({ label, url }) {
  return `
    <div style="text-align:center;margin:20px 0;">
      <a href="${escapeAttr(url)}" style="display:inline-block;background:${BRAND.primary};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(label)}</a>
    </div>`;
}

// ─── small utils ─────────────────────────────────────────────────────────

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  if (s == null) return '';
  return String(s).replace(/"/g, '&quot;');
}

function stripHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

function formatExpiry(d) {
  return new Date(d).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  });
}

module.exports = {
  BRAND,
  renderEmail,
  // section helpers
  credentials, steps, info, warning, button, rawHtml,
  // exposed for callers that need them (image-specific quick starts etc.)
  escapeHtml, formatExpiry,
};
