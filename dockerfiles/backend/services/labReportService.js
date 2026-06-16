/**
 * Lab Activity Report + Certificate Generator
 *
 * On-demand — generates a PDF report for a training batch when ops requests
 * it. Not shown by default; ops clicks "Export Report" in Lab Console only
 * when a customer asks for proof of lab usage.
 *
 * Data sources (all already in the DB — no new tracking needed):
 *   - VM model: duration, logs[{start,stop}], quota.consumed, email, os
 *   - Container model: duration, logs[{start,stop}], quota.consumed, email, image
 *   - Training model: name, organization, vmUserMapping
 *
 * Output: a PDF buffer (returned to the caller, which can pipe it to res)
 */

const PDFDocument = require('pdfkit');
const VM = require('../models/vm');
const Container = require('../models/container');
const Training = require('../models/training');
const { logger } = require('../plugins/logger');

// Minimum lab time (minutes) to count a learner as having COMPLETED the lab — gates
// the participant-table pill, the engagement %, the top-tile count, AND the cert page.
// Single source of truth: keep all four in sync.
const MIN_CERT_MINUTES = 5;

// Live-corrected duration helper — vm.duration only updates on stop, so for
// currently-running VMs we add the time since the latest log entry opened to
// keep certificate hours honest before the lab actually ends.
function getEffectiveDuration(inst) {
  let total = inst.duration || 0; // minutes
  if (inst.isRunning && inst.logs && inst.logs.length) {
    const lastLog = inst.logs[inst.logs.length - 1];
    if (lastLog.start && !lastLog.stop) {
      const liveMinutes = Math.floor((Date.now() - new Date(lastLog.start).getTime()) / 60000);
      total += Math.max(0, liveMinutes);
    }
  }
  return total;
}

// Returns true if getEffectiveDuration relied on a long-open log entry — i.e.
// the duration includes >4h of live wall-clock time on top of the recorded
// duration field. Almost always means a missed stop event (host crash, Spot
// eviction, snapshot+delete without log closure). Reports should mark such
// rows as estimated so consumers know the number is a lower bound estimate. /* estimated-flag-2026-05-27 */
function isDurationEstimated(inst) {
  if (!inst.isRunning || !inst.logs || !inst.logs.length) return false;
  const last = inst.logs[inst.logs.length - 1];
  if (!last.start || last.stop) return false;
  const liveMinutes = Math.floor((Date.now() - new Date(last.start).getTime()) / 60000);
  return liveMinutes > 240; // > 4h open
}


/**
 * Gather activity data for a training batch.
 */
async function getTrainingActivity(trainingName, organization) {
  const [vms, containers, training] = await Promise.all([
    VM.find({ trainingName, ...(organization ? { organization } : {}) }).lean(),
    Container.find({ trainingName, ...(organization ? { organization } : {}) }).lean(),
    Training.findOne({ name: trainingName, ...(organization ? { organization } : {}) }).lean(),
  ]);

  const allInstances = [...vms, ...containers];

  // Per-student aggregation
  const studentMap = {};
  for (const inst of allInstances) {
    const email = inst.email || 'unknown';
    if (!studentMap[email]) {
      studentMap[email] = {
        email,
        totalMinutes: 0,
        sessions: 0,
        firstLogin: null,
        lastActivity: null,
        resources: [],
        instances: [],
      };
    }
    const s = studentMap[email];
    s.totalMinutes += getEffectiveDuration(inst);
    s.sessions += (inst.logs || []).length;
    s.instances.push({
      name: inst.name,
      type: inst.type === 'container' ? 'Container' : 'VM',
      os: inst.os || inst.image || '—',
      duration: getEffectiveDuration(inst), estimated: isDurationEstimated(inst), /* estimated-wire-2026-05-27 */
      isAlive: inst.isAlive,
    });

    // Track first/last activity
    for (const log of inst.logs || []) {
      if (log.start) {
        const start = new Date(log.start);
        if (!s.firstLogin || start < s.firstLogin) s.firstLogin = start;
        if (!s.lastActivity || start > s.lastActivity) s.lastActivity = start;
      }
      if (log.stop) {
        const stop = new Date(log.stop);
        if (!s.lastActivity || stop > s.lastActivity) s.lastActivity = stop;
      }
    }
  }

  const students = Object.values(studentMap).sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalHours = students.reduce((s, st) => s + st.totalMinutes, 0) / 60;
  const activeStudents = students.filter(s => s.totalMinutes >= MIN_CERT_MINUTES).length;

  return {
    trainingName,
    organization: organization || training?.organization || '—',
    totalStudents: students.length,
    activeStudents,
    totalHours: Math.round(totalHours * 10) / 10,
    students,
    generatedAt: new Date(),
  };
}

/**
 * Generate a PDF report buffer for a training.
 */
async function generateReportPDF(trainingName, organization) {
  const data = await getTrainingActivity(trainingName, organization);
  const branding = await loadBranding(data.organization);
  const directorName = await loadDirectorName(data.organization);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Lab Activity Report — ${data.trainingName}`,
        Author: branding.companyName,
        Subject: `Lab usage report and certificates for ${data.trainingName}`,
        Keywords: 'lab,training,report,certificate'
      }
    });
    // Register handwritten signature font (Caveat — Google Fonts, OFL).
    // Falls back to Times-Italic on disk-read error so render never fails.
    let SIG_FONT = 'Times-Italic';
    try {
      const path = require('path');
      const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'Caveat.ttf');
      doc.registerFont('Signature', fontPath);
      SIG_FONT = 'Signature';
    } catch (e) {
      logger.warn(`[labReport] Signature font load failed: ${e.message}`);
    }
    const INK_BLUE = '#1e3a8a';

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PRIMARY = branding.primaryColor;
    const ACCENT = branding.accentColor || PRIMARY;
    const COMPANY = branding.companyName;
    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const MARGIN_X = 50;

    // Soft palette derived from PRIMARY
    const INK = '#0f172a';        // slate-900
    const MUTED = '#64748b';      // slate-500
    const LINE = '#e2e8f0';       // slate-200
    const ZEBRA = '#f8fafc';      // slate-50
    const SUCCESS = '#10b981';
    const DANGER = '#ef4444';
    const TILE_BG = tintHex(PRIMARY, 0.12);
    const HEADER_TEXT = '#ffffff';

    // ====== PAGE 1: Activity Report ======
    // Top color band
    doc.rect(0, 0, PAGE_W, 90).fill(PRIMARY);
    // Subtle accent stripe under band
    doc.rect(0, 90, PAGE_W, 4).fill(ACCENT);

    // Company name on band, top-left
    doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(11)
      .text(COMPANY.toUpperCase(), MARGIN_X, 28, { width: PAGE_W - MARGIN_X * 2, characterSpacing: 1.2 });
    // Date on band, top-right
    doc.fillColor(HEADER_TEXT).font('Helvetica').fontSize(9)
      .text(`Generated ${data.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' })} IST`,
        MARGIN_X, 28, { width: PAGE_W - MARGIN_X * 2, align: 'right' });

    // Hero title on band
    doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(22)
      .text('Lab Activity Report', MARGIN_X, 50, { width: PAGE_W - MARGIN_X * 2 });

    // Training subtitle below band
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
      .text(data.trainingName, MARGIN_X, 115);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
      .text(`Training program · ${data.totalStudents} learners · Auto-generated from live usage data`,
        MARGIN_X, 132);

    // ===== Summary tiles row =====
    const tilesY = 165;
    const tilesH = 70;
    const gap = 12;
    const tileW = (PAGE_W - MARGIN_X * 2 - gap * 3) / 4;
    const tiles = [
      { label: 'LEARNERS', value: String(data.totalStudents) },
      { label: 'COMPLETED', value: String(data.activeStudents) },
      { label: 'HOURS LOGGED', value: `${data.totalHours}` },
      {
        label: 'ENGAGEMENT',
        value: data.totalStudents > 0
          ? `${Math.round(data.activeStudents / data.totalStudents * 100)}%`
          : '—'
      },
    ];
    // Multi-color tile palette: customer brand → emerald → violet → amber
    const tilePalette = [
      { stripe: PRIMARY,   bg: tintHex(PRIMARY,   0.10), num: darkenHex(PRIMARY, 0.20) },
      { stripe: '#10B981', bg: tintHex('#10B981', 0.12), num: '#047857' },
      { stripe: '#7C3AED', bg: tintHex('#7C3AED', 0.10), num: '#5B21B6' },
      { stripe: '#F59E0B', bg: tintHex('#F59E0B', 0.14), num: '#B45309' },
    ];
    tiles.forEach((t, i) => {
      const x = MARGIN_X + i * (tileW + gap);
      const c = tilePalette[i];
      // Card background
      doc.roundedRect(x, tilesY, tileW, tilesH, 8).fill(c.bg);
      // Left accent stripe (4px wide, full height) — gives the multi-color rhythm
      doc.rect(x, tilesY, 4, tilesH).fill(c.stripe);
      // Big number in accent dark variant for readability
      doc.fillColor(c.num).font('Helvetica-Bold').fontSize(26)
        .text(t.value, x + 4, tilesY + 14, { width: tileW - 4, align: 'center' });
      // Label below
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
        .text(t.label, x + 4, tilesY + 50, { width: tileW - 4, align: 'center', characterSpacing: 1.5 });
    });

    // ===== Participants table =====
    let y = tilesY + tilesH + 30;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text('Participants', MARGIN_X, y);
    // Accent underline beneath the section heading
    doc.rect(MARGIN_X, y + 19, 30, 2.5).fill(PRIMARY);
    y += 28;

    const col = {
      learner: { x: MARGIN_X + 12, w: 180 },
      hours:   { x: MARGIN_X + 200, w: 50, align: 'right' },
      sessions:{ x: MARGIN_X + 260, w: 60, align: 'right' },
      first:   { x: MARGIN_X + 335, w: 65 },
      status:  { x: MARGIN_X + 410, w: 75, align: 'right' },
    };
    const rowH = 24;

    // Table header bar
    doc.rect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, rowH).fill(PRIMARY);
    doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(8.5);
    const hY = y + 8;
    doc.text('LEARNER',     col.learner.x, hY, { width: col.learner.w, characterSpacing: 1 });
    doc.text('HOURS',       col.hours.x, hY,   { width: col.hours.w, align: col.hours.align, characterSpacing: 1 });
    doc.text('SESSIONS',    col.sessions.x, hY,{ width: col.sessions.w, align: col.sessions.align, characterSpacing: 1 });
    doc.text('FIRST LOGIN', col.first.x, hY,   { width: col.first.w, characterSpacing: 1 });
    doc.text('STATUS',      col.status.x, hY,  { width: col.status.w, align: col.status.align, characterSpacing: 1 });
    y += rowH;

    if (data.students.length === 0) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10)
        .text('No learners recorded for this training yet.', MARGIN_X, y + 16, { width: PAGE_W - MARGIN_X * 2, align: 'center' });
    }

    data.students.forEach((s, i) => {
      // Page break for long rosters
      if (y > PAGE_H - 90) {
        doc.addPage();
        y = MARGIN_X + 10;
      }
      // Zebra
      if (i % 2 === 0) {
        doc.rect(MARGIN_X, y, PAGE_W - MARGIN_X * 2, rowH).fill(ZEBRA);
      }
      const hours = Math.round(s.totalMinutes / 60 * 10) / 10;
      const isActive = s.totalMinutes >= MIN_CERT_MINUTES;
      const firstLogin = s.firstLogin
        ? s.firstLogin.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : '—';

      const cellY = y + 8;
      doc.font('Helvetica').fontSize(9.5).fillColor(INK)
        .text(s.email, col.learner.x, cellY, { width: col.learner.w, ellipsis: true });
      doc.fillColor(INK).font('Helvetica-Bold')
        .text(`${hours}h`, col.hours.x, cellY, { width: col.hours.w, align: col.hours.align });
      doc.fillColor(INK).font('Helvetica')
        .text(String(s.sessions), col.sessions.x, cellY, { width: col.sessions.w, align: col.sessions.align });
      doc.fillColor(MUTED)
        .text(firstLogin, col.first.x, cellY, { width: col.first.w });

      // Status pill
      const pillW = 65;
      const pillH = 14;
      const pillX = col.status.x + col.status.w - pillW;
      const pillY = cellY - 1;
      doc.roundedRect(pillX, pillY, pillW, pillH, 7)
        .fill(isActive ? tintHex(SUCCESS, 0.20) : tintHex(DANGER, 0.16));
      doc.fillColor(isActive ? SUCCESS : DANGER).font('Helvetica-Bold').fontSize(7.5)
        .text(isActive ? 'COMPLETED' : 'NO LOGIN', pillX, pillY + 4, { width: pillW, align: 'center', characterSpacing: 0.4 });
      // Bottom border
      doc.moveTo(MARGIN_X, y + rowH).lineTo(PAGE_W - MARGIN_X, y + rowH).strokeColor(LINE).lineWidth(0.5).stroke();
      y += rowH;
    });

    // ===== Page 1 footnote =====
    if (y < PAGE_H - 110) y = PAGE_H - 110;
    doc.moveTo(MARGIN_X, y).lineTo(PAGE_W - MARGIN_X, y).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8.5)
      .text('This report is generated from actual lab usage telemetry — VM uptime, login events, and per-session durations recorded by the platform. No manual input or self-reporting.',
        MARGIN_X, y + 8, { width: PAGE_W - MARGIN_X * 2, align: 'center' });

    // ====== Certificates (one per active learner) ======
    const activeLearners = data.students.filter(s => s.totalMinutes >= MIN_CERT_MINUTES);
    activeLearners.forEach((s) => {
      doc.addPage();
      const hours = Math.round(s.totalMinutes / 60 * 10) / 10;
      const certId = `CERT-${data.generatedAt.getFullYear()}-${data.trainingName.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g,'')}-${(s.email.split('@')[0] || 'X').slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const learnerName = formatLearnerName(s.email);

      // Outer + inner ornate border
      doc.lineWidth(2.5).strokeColor(PRIMARY).rect(28, 28, PAGE_W - 56, PAGE_H - 56).stroke();
      doc.lineWidth(0.7).strokeColor(ACCENT).rect(36, 36, PAGE_W - 72, PAGE_H - 72).stroke();

      // Decorative corner accents (small filled triangles)
      const cornerSize = 18;
      const corners = [
        [28, 28], [PAGE_W - 28 - cornerSize, 28],
        [28, PAGE_H - 28 - cornerSize], [PAGE_W - 28 - cornerSize, PAGE_H - 28 - cornerSize]
      ];
      corners.forEach(([cx, cy], idx) => {
        doc.save();
        doc.fillColor(PRIMARY).rect(cx, cy, cornerSize, cornerSize).fill();
        doc.fillColor('#ffffff').rect(cx + 4, cy + 4, cornerSize - 8, cornerSize - 8).fill();
        doc.restore();
      });

      // Watermark — diagonal companyName running corner-to-corner (very low opacity)
      doc.save();
      doc.opacity(0.05);
      doc.rotate(-30, { origin: [PAGE_W / 2, PAGE_H / 2] });
      doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(95)
        .text(COMPANY.split(' ')[0].toUpperCase(), 0, PAGE_H / 2 - 50, { width: PAGE_W, align: 'center', characterSpacing: 6 });
      doc.opacity(1).restore();

      // Top eyebrow: company + small accent line
      doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(10)
        .text(COMPANY.toUpperCase(), 50, 90, { width: PAGE_W - 100, align: 'center', characterSpacing: 2 });
      const eybY = 110;
      doc.moveTo(PAGE_W / 2 - 30, eybY).lineTo(PAGE_W / 2 + 30, eybY).strokeColor(ACCENT).lineWidth(1.2).stroke();

      // Title
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(28)
        .text('Certificate of Lab Completion', 50, 135, { width: PAGE_W - 100, align: 'center' });

      // "This is to certify that"
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(12)
        .text('This is to certify that', 50, 200, { width: PAGE_W - 100, align: 'center' });

      // Learner name — display
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(32)
        .text(learnerName, 50, 225, { width: PAGE_W - 100, align: 'center' });

      // Underline under name
      const nameUnderlineY = 268;
      doc.moveTo(PAGE_W / 2 - 110, nameUnderlineY).lineTo(PAGE_W / 2 + 110, nameUnderlineY)
        .strokeColor(ACCENT).lineWidth(0.8).stroke();

      // Body
      doc.fillColor(INK).font('Helvetica').fontSize(12)
        .text(`has successfully completed ${hours} hours of hands-on lab work`,
          50, 290, { width: PAGE_W - 100, align: 'center' });
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(11)
        .text(`as part of the ${data.trainingName} program`,
          50, 312, { width: PAGE_W - 100, align: 'center' });

      // Details table — centered
      const detailsY = 360;
      const labelX = PAGE_W / 2 - 140;
      const valueX = PAGE_W / 2 + 10;
      const details = [
        ['Program', data.trainingName],
        ['Sessions', `${s.sessions} login session${s.sessions === 1 ? '' : 's'}`],
        ['Period', s.firstLogin && s.lastActivity
          ? `${s.firstLogin.toLocaleDateString('en-IN', { dateStyle: 'medium' })}  →  ${s.lastActivity.toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
          : '—'],
        ['Total Hours', `${hours} hours`],
      ];
      details.forEach(([k, v], idx) => {
        const dY = detailsY + idx * 22;
        doc.fillColor(MUTED).font('Helvetica').fontSize(10)
          .text(k, labelX - 130, dY, { width: 140, align: 'right' });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(11)
          .text(v, valueX - 130, dY, { width: 280 });
      });

      // Signature row
      const sigY = PAGE_H - 130;
      const sigW = 180;
      const sigLeft = PAGE_W / 2 - sigW - 20;
      const sigRight = PAGE_W / 2 + 20;
      // Lines
      doc.moveTo(sigLeft, sigY).lineTo(sigLeft + sigW, sigY).strokeColor(MUTED).lineWidth(0.5).stroke();
      doc.moveTo(sigRight, sigY).lineTo(sigRight + sigW, sigY).strokeColor(MUTED).lineWidth(0.5).stroke();
      // Labels
      // Cursive signature above the LAB DIRECTOR line — uses the org's admin name
      if (directorName) {
        doc.save();
        doc.translate(sigLeft + sigW / 2, sigY - 8);
        doc.rotate(-6);
        doc.fillColor(INK_BLUE).font(SIG_FONT).fontSize(34)
          .text(directorName, -sigW / 2, -28, { width: sigW, align: 'center' });
        doc.restore();
      }
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text('LAB DIRECTOR', sigLeft, sigY + 6, { width: sigW, align: 'center', characterSpacing: 1 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(directorName ? `${directorName} · ${COMPANY}` : COMPANY, sigLeft, sigY + 20, { width: sigW, align: 'center' });
      // Hand-written-style date above the DATE ISSUED line
      doc.save();
      doc.translate(sigRight + sigW / 2, sigY - 8);
      doc.rotate(-4);
      doc.fillColor(INK_BLUE).font(SIG_FONT).fontSize(28)
        .text(data.generatedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), -sigW / 2, -22, { width: sigW, align: 'center' });
      doc.restore();
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text('DATE ISSUED', sigRight, sigY + 6, { width: sigW, align: 'center', characterSpacing: 1 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(data.generatedAt.toLocaleDateString('en-IN', { dateStyle: 'long' }), sigRight, sigY + 20, { width: sigW, align: 'center' });

      // Cert ID strip at bottom
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
        .text(`Certificate ID  ·  ${certId}`, 50, PAGE_H - 60, { width: PAGE_W - 100, align: 'center', characterSpacing: 1 });
    });

    // ====== Page numbers + global footer (after all pages exist) ======
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const pn = `Page ${i + 1} of ${range.count}`;
      const conf = `Confidential  ·  ${COMPANY}`;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
        .text(pn, MARGIN_X, PAGE_H - 25, { width: PAGE_W - MARGIN_X * 2, align: 'left' });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
        .text(conf, MARGIN_X, PAGE_H - 25, { width: PAGE_W - MARGIN_X * 2, align: 'right' });
    }

    doc.end();
  });
}

// ===== branding & helpers =====
async function loadBranding(orgName) {
  // Neutral defaults — explicitly NOT Synergific-branded so non-whitelabeled
  // customers don't get any vendor logo or color leaking in.
  const defaults = {
    primaryColor: '#0078D4',  // Microsoft Azure Blue
    accentColor: '#50E6FF',   // Azure light
    companyName: orgName || 'Cloud Lab Platform',
  };
  if (!orgName) return defaults;
  try {
    const Organization = require('../models/organization');
    const org = await Organization.findOne({ organization: orgName }).lean();
    const b = org?.branding || {};
    return {
      primaryColor: b.primaryColor || defaults.primaryColor,
      accentColor: b.accentColor || defaults.accentColor,
      companyName: b.companyName || orgName,
    };
  } catch (e) {
    return defaults;
  }
}

async function loadDirectorName(orgName) {
  if (!orgName) return null;
  try {
    const User = require('../models/user');
    const u = await User.findOne({
      organization: orgName,
      userType: { $in: ['admin', 'superadmin'] }
    }).sort({ createdAt: 1 }).lean();
    if (!u) return null;
    if (u.name && u.name.trim()) return titleCase(u.name);
    return titleCase((u.email || '').split('@')[0] || '');
  } catch (e) {
    return null;
  }
}

function titleCase(s) {
  return (s || '').replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function darkenHex(hex, factor) {
  // Mix the given hex color toward black. factor=0 returns the original color,
  // factor=1 returns black. Used to derive a darker text tone for tile numbers
  // so they read clearly against the light tint background.
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return '#0f172a';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = c => Math.round(c * (1 - factor));
  const hh = n => n.toString(16).padStart(2, '0');
  return '#' + hh(mix(r)) + hh(mix(g)) + hh(mix(b));
}

function tintHex(hex, alpha) {
  // Mix the given hex color with white. PDFKit doesn't honor rgba() strings,
  // so we simulate a tint by interpolating toward #ffffff. alpha=opacity of the
  // color (0=full white, 1=full color).
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return '#f1f5f9';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = c => Math.round(c * alpha + 255 * (1 - alpha));
  const hh = n => n.toString(16).padStart(2, '0');
  return '#' + hh(mix(r)) + hh(mix(g)) + hh(mix(b));
}

function formatLearnerName(email) {
  const local = (email || '').split('@')[0] || email || 'Learner';
  // Replace separators with spaces and title-case each token
  return local.replace(/[._-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

/**
 * Gather detailed usage data for a B2B usage report.
 * Includes cost, utilization, and per-student resource breakdown.
 */
async function getUsageReportData(trainingName, organization) {
  const [vms, containers, training] = await Promise.all([
    VM.find({ trainingName, ...(organization ? { organization } : {}) }).lean(),
    Container.find({ trainingName, ...(organization ? { organization } : {}) }).lean(),
    Training.findOne({ name: trainingName, ...(organization ? { organization } : {}) }).lean(),
  ]);

  const orgName = organization || training?.organization || '--';

  // Date range from all logs
  let earliestDate = null;
  let latestDate = null;
  const allInstances = [...vms, ...containers];

  for (const inst of allInstances) {
    for (const log of inst.logs || []) {
      if (log.start) {
        const d = new Date(log.start);
        if (!earliestDate || d < earliestDate) earliestDate = d;
        if (!latestDate || d > latestDate) latestDate = d;
      }
      if (log.stop) {
        const d = new Date(log.stop);
        if (!latestDate || d > latestDate) latestDate = d;
      }
    }
  }

  // Per-student aggregation with cost
  const studentMap = {};
  for (const inst of allInstances) {
    const email = inst.email || 'unknown';
    if (!studentMap[email]) {
      studentMap[email] = { email, resources: [], totalMinutes: 0, totalCost: 0 };
    }
    const s = studentMap[email];
    const hours = getEffectiveDuration(inst) / 60;
    const cost = hours * (inst.rate || 0);
    s.totalMinutes += getEffectiveDuration(inst);
    s.totalCost += cost;

    const isContainer = inst.type === 'container';
    s.resources.push({
      type: isContainer ? 'Container' : 'VM',
      imageOrTemplate: inst.image || inst.os || '--',
      hours: Math.round(hours * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      rate: inst.rate || 0,
      status: inst.isAlive ? (inst.isRunning ? 'Running' : 'Stopped') : 'Terminated',
      quotaTotal: inst.quota?.total || 0,
      quotaConsumed: inst.quota?.consumed || 0,
    });
  }

  const students = Object.values(studentMap).sort((a, b) => b.totalCost - a.totalCost);

  // Totals
  const totalVMs = vms.length;
  const totalContainers = containers.length;
  const totalHoursConsumed = allInstances.reduce((sum, i) => sum + getEffectiveDuration(i), 0) / 60;
  const totalSellingCost = allInstances.reduce((sum, i) => sum + (getEffectiveDuration(i) / 60) * (i.rate || 0), 0);

  // Infrastructure cost estimate (containers have azureEquivalentRate)
  let totalInfraCost = 0;
  for (const c of containers) {
    const hrs = getEffectiveDuration(c) / 60;
    // Container infra cost is roughly the rate itself (small margin containers)
    // If azureEquivalentRate is set, it shows what Azure would have cost
    totalInfraCost += hrs * (c.rate || 0) * 0.6; // approximate 60% cost-of-goods
  }
  for (const v of vms) {
    const hrs = getEffectiveDuration(v) / 60;
    totalInfraCost += hrs * (v.rate || 0) * 0.7; // approximate 70% cost-of-goods for VMs
  }

  // Utilization metrics
  const totalAllocatedHours = allInstances.reduce((sum, i) => sum + ((i.quota?.total || 0)), 0);
  const totalConsumedQuota = allInstances.reduce((sum, i) => sum + ((i.quota?.consumed || 0)), 0);
  const avgUtilization = totalAllocatedHours > 0
    ? Math.round((totalConsumedQuota / totalAllocatedHours) * 100)
    : 0;
  const idlePct = Math.max(0, 100 - avgUtilization);

  // Peak usage times (hour-of-day histogram)
  const hourBuckets = new Array(24).fill(0);
  for (const inst of allInstances) {
    for (const log of inst.logs || []) {
      if (log.start) {
        const h = new Date(log.start).getHours();
        hourBuckets[h]++;
      }
    }
  }
  const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
  const peakTimeLabel = `${peakHour}:00 - ${(peakHour + 1) % 24}:00`;

  return {
    trainingName,
    organization: orgName,
    dateRange: {
      from: earliestDate,
      to: latestDate,
    },
    generatedAt: new Date(),
    summary: {
      totalStudents: students.length,
      totalVMs,
      totalContainers,
      totalHoursConsumed: Math.round(totalHoursConsumed * 10) / 10,
      totalCost: Math.round(totalSellingCost * 100) / 100,
    },
    students,
    utilization: {
      avgUtilizationPct: avgUtilization,
      idlePct,
      peakTime: peakTimeLabel,
      hourBuckets,
    },
    costBreakdown: {
      infrastructureCost: Math.round(totalInfraCost * 100) / 100,
      sellingPrice: Math.round(totalSellingCost * 100) / 100,
      margin: Math.round((totalSellingCost - totalInfraCost) * 100) / 100,
      marginPct: totalSellingCost > 0
        ? Math.round(((totalSellingCost - totalInfraCost) / totalSellingCost) * 100)
        : 0,
    },
  };
}

/**
 * Generate a professional B2B Usage Report PDF.
 */
async function generateUsageReport(trainingName, organization) {
  const data = await getUsageReportData(trainingName, organization);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const blue = '#2563eb';
    const darkBlue = '#1e40af';
    const gray = '#6b7280';
    const dark = '#111827';
    const lightGray = '#f3f4f6';
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 100;

    // ====== HEADER ======
    doc.rect(0, 0, pageWidth, 80).fill(darkBlue);
    doc.fontSize(18).fillColor('#ffffff')
      .text('Hexalabs Cloud Portal', 50, 25, { width: contentWidth });
    doc.fontSize(10).fillColor('#93c5fd')
      .text('Lab Usage Report', 50, 48, { width: contentWidth });

    // ====== REPORT METADATA ======
    doc.y = 100;
    doc.fontSize(9).fillColor(gray);

    const metaStartX = 50;
    const metaValueX = 160;
    let metaY = 100;

    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--';

    const metaRows = [
      ['Training Name:', data.trainingName],
      ['Organization:', data.organization],
      ['Date Range:', `${formatDate(data.dateRange.from)} to ${formatDate(data.dateRange.to)}`],
      ['Generated On:', data.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'],
    ];

    for (const [label, value] of metaRows) {
      doc.fontSize(9).fillColor(gray).text(label, metaStartX, metaY, { width: 100 });
      doc.fontSize(9).fillColor(dark).text(value, metaValueX, metaY, { width: 300 });
      metaY += 16;
    }

    // ====== SUMMARY SECTION ======
    doc.y = metaY + 10;
    doc.moveTo(50, doc.y).lineTo(pageWidth - 50, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.y += 10;

    doc.fontSize(12).fillColor(dark).text('Summary', 50, doc.y);
    doc.y += 20;

    const summaryY = doc.y;
    const summaryItems = [
      { label: 'STUDENTS', value: String(data.summary.totalStudents) },
      { label: 'VMs', value: String(data.summary.totalVMs) },
      { label: 'CONTAINERS', value: String(data.summary.totalContainers) },
      { label: 'HOURS USED', value: `${data.summary.totalHoursConsumed}h` },
      { label: 'TOTAL COST', value: `INR ${data.summary.totalCost.toLocaleString('en-IN')}` },
    ];

    const sColW = contentWidth / summaryItems.length;
    summaryItems.forEach((item, i) => {
      const x = 50 + i * sColW;
      // Background box
      doc.rect(x, summaryY - 5, sColW - 8, 40).fill(lightGray);
      doc.fontSize(7).fillColor(gray).text(item.label, x + 8, summaryY, { width: sColW - 16 });
      doc.fontSize(14).fillColor(dark).text(item.value, x + 8, summaryY + 12, { width: sColW - 16 });
    });

    doc.y = summaryY + 50;

    // ====== PER-STUDENT TABLE ======
    doc.moveTo(50, doc.y).lineTo(pageWidth - 50, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.y += 10;
    doc.fontSize(12).fillColor(dark).text('Per-Student Resource Breakdown', 50, doc.y);
    doc.y += 20;

    // Table columns: Email | Type | Image | Hours | Cost (INR) | Status
    const tCols = [
      { label: 'STUDENT', x: 50, w: 130 },
      { label: 'TYPE', x: 182, w: 55 },
      { label: 'IMAGE / TEMPLATE', x: 239, w: 100 },
      { label: 'HOURS', x: 341, w: 45 },
      { label: 'COST (INR)', x: 388, w: 65 },
      { label: 'STATUS', x: 455, w: 85 },
    ];

    // Table header
    const thY = doc.y;
    doc.rect(50, thY - 3, contentWidth, 16).fill('#f9fafb');
    for (const col of tCols) {
      doc.fontSize(7).fillColor(gray).text(col.label, col.x, thY, { width: col.w });
    }
    doc.moveTo(50, thY + 13).lineTo(pageWidth - 50, thY + 13).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    let rowY = thY + 18;

    for (const student of data.students) {
      for (let ri = 0; ri < student.resources.length; ri++) {
        const r = student.resources[ri];

        if (rowY > doc.page.height - 100) {
          doc.addPage();
          rowY = 50;
          // Repeat header on new page
          doc.rect(50, rowY - 3, contentWidth, 16).fill('#f9fafb');
          for (const col of tCols) {
            doc.fontSize(7).fillColor(gray).text(col.label, col.x, rowY, { width: col.w });
          }
          doc.moveTo(50, rowY + 13).lineTo(pageWidth - 50, rowY + 13).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
          rowY += 18;
        }

        // Show email only on first resource row for each student
        const emailText = ri === 0 ? student.email : '';
        doc.fontSize(8).fillColor(dark).text(emailText, tCols[0].x, rowY, { width: tCols[0].w, ellipsis: true });
        doc.fontSize(8).fillColor(r.type === 'Container' ? blue : '#7c3aed').text(r.type, tCols[1].x, rowY, { width: tCols[1].w });
        doc.fontSize(7).fillColor(gray).text(r.imageOrTemplate, tCols[2].x, rowY, { width: tCols[2].w, ellipsis: true });
        doc.fontSize(8).fillColor(dark).text(`${r.hours}h`, tCols[3].x, rowY, { width: tCols[3].w, align: 'right' });
        doc.fontSize(8).fillColor(dark).text(r.cost.toLocaleString('en-IN'), tCols[4].x, rowY, { width: tCols[4].w, align: 'right' });

        const statusColor = r.status === 'Running' ? '#059669' : r.status === 'Stopped' ? '#d97706' : '#ef4444';
        doc.fontSize(7).fillColor(statusColor).text(r.status, tCols[5].x, rowY, { width: tCols[5].w });

        rowY += 15;
      }
      // Thin separator between students
      doc.moveTo(50, rowY - 2).lineTo(pageWidth - 50, rowY - 2).strokeColor('#f3f4f6').lineWidth(0.3).stroke();
    }

    if (data.students.length === 0) {
      doc.fontSize(10).fillColor(gray).text('No student data available for this training.', 50, rowY + 5);
      rowY += 25;
    }

    // ====== UTILIZATION SECTION ======
    // Check if we need a new page
    if (rowY > doc.page.height - 200) {
      doc.addPage();
      rowY = 50;
    }

    rowY += 10;
    doc.moveTo(50, rowY).lineTo(pageWidth - 50, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    rowY += 10;
    doc.fontSize(12).fillColor(dark).text('Utilization', 50, rowY);
    rowY += 22;

    // Utilization metrics in boxes
    const utilItems = [
      { label: 'AVG UTILIZATION', value: `${data.utilization.avgUtilizationPct}%` },
      { label: 'IDLE TIME', value: `${data.utilization.idlePct}%` },
      { label: 'PEAK USAGE TIME', value: data.utilization.peakTime },
    ];

    const uColW = contentWidth / utilItems.length;
    utilItems.forEach((item, i) => {
      const x = 50 + i * uColW;
      doc.rect(x, rowY - 3, uColW - 8, 38).fill(lightGray);
      doc.fontSize(7).fillColor(gray).text(item.label, x + 8, rowY, { width: uColW - 16 });
      doc.fontSize(13).fillColor(dark).text(item.value, x + 8, rowY + 12, { width: uColW - 16 });
    });

    rowY += 50;

    // Hour-of-day bar chart (simple text-based)
    doc.fontSize(9).fillColor(dark).text('Sessions by Hour of Day', 50, rowY);
    rowY += 14;

    const maxBucket = Math.max(...data.utilization.hourBuckets, 1);
    const barMaxWidth = 200;
    for (let h = 0; h < 24; h++) {
      const count = data.utilization.hourBuckets[h];
      if (count === 0) continue; // skip empty hours to save space

      if (rowY > doc.page.height - 80) {
        doc.addPage();
        rowY = 50;
      }

      const barW = Math.max(1, (count / maxBucket) * barMaxWidth);
      doc.fontSize(7).fillColor(gray).text(`${String(h).padStart(2, '0')}:00`, 50, rowY, { width: 35 });
      doc.rect(90, rowY, barW, 8).fill(blue);
      doc.fontSize(7).fillColor(gray).text(String(count), 90 + barW + 5, rowY, { width: 30 });
      rowY += 12;
    }

    // ====== COST BREAKDOWN ======
    rowY += 10;
    if (rowY > doc.page.height - 140) {
      doc.addPage();
      rowY = 50;
    }

    doc.moveTo(50, rowY).lineTo(pageWidth - 50, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    rowY += 10;
    doc.fontSize(12).fillColor(dark).text('Cost Breakdown', 50, rowY);
    rowY += 22;

    const costItems = [
      { label: 'INFRA COST (EST.)', value: `INR ${data.costBreakdown.infrastructureCost.toLocaleString('en-IN')}` },
      { label: 'SELLING PRICE', value: `INR ${data.costBreakdown.sellingPrice.toLocaleString('en-IN')}` },
      { label: 'MARGIN', value: `INR ${data.costBreakdown.margin.toLocaleString('en-IN')} (${data.costBreakdown.marginPct}%)` },
    ];

    const cColW = contentWidth / costItems.length;
    costItems.forEach((item, i) => {
      const x = 50 + i * cColW;
      doc.rect(x, rowY - 3, cColW - 8, 38).fill(lightGray);
      doc.fontSize(7).fillColor(gray).text(item.label, x + 8, rowY, { width: cColW - 16 });
      doc.fontSize(12).fillColor(dark).text(item.value, x + 8, rowY + 12, { width: cColW - 16 });
    });

    rowY += 55;

    // ====== FOOTER ======
    if (rowY > doc.page.height - 60) {
      doc.addPage();
      rowY = doc.page.height - 80;
    }
    doc.moveTo(50, rowY).lineTo(pageWidth - 50, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    rowY += 8;
    doc.fontSize(8).fillColor(gray).text(
      'Generated by Hexalabs Cloud Portal',
      50, rowY, { width: contentWidth, align: 'center' }
    );

    doc.end();
  });
}

module.exports = { getTrainingActivity, generateReportPDF, generateUsageReport };
