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
        totalSeconds: 0,
        sessions: 0,
        firstLogin: null,
        lastActivity: null,
        resources: [],
        instances: [],
      };
    }
    const s = studentMap[email];
    s.totalSeconds += inst.duration || 0;
    s.sessions += (inst.logs || []).length;
    s.instances.push({
      name: inst.name,
      type: inst.type === 'container' ? 'Container' : 'VM',
      os: inst.os || inst.image || '—',
      duration: inst.duration || 0,
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

  const students = Object.values(studentMap).sort((a, b) => b.totalSeconds - a.totalSeconds);
  const totalHours = students.reduce((s, st) => s + st.totalSeconds, 0) / 3600;
  const activeStudents = students.filter(s => s.totalSeconds > 0).length;

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

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const blue = '#2563eb';
    const gray = '#6b7280';
    const dark = '#111827';

    // Header
    doc.fontSize(10).fillColor(gray).text('GetLabs Cloud Portal', 50, 50);
    doc.fontSize(10).fillColor(gray).text(`Generated: ${data.generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 50, 50, { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(22).fillColor(dark).text('Lab Activity Report', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor(gray).text(`${data.trainingName} — ${data.organization}`, { align: 'center' });

    // Summary strip
    doc.moveDown(1.5);
    const summaryY = doc.y;
    doc.fontSize(9).fillColor(gray);

    const cols = [
      { label: 'STUDENTS', value: String(data.totalStudents) },
      { label: 'ACTIVE', value: String(data.activeStudents) },
      { label: 'TOTAL HOURS', value: `${data.totalHours}h` },
      { label: 'ENGAGEMENT', value: data.totalStudents > 0 ? `${Math.round(data.activeStudents / data.totalStudents * 100)}%` : '—' },
    ];

    const colWidth = 120;
    const startX = 50 + (doc.page.width - 100 - colWidth * cols.length) / 2;
    cols.forEach((col, i) => {
      const x = startX + i * colWidth;
      doc.fontSize(8).fillColor(gray).text(col.label, x, summaryY, { width: colWidth });
      doc.fontSize(16).fillColor(dark).text(col.value, x, summaryY + 12, { width: colWidth });
    });

    doc.y = summaryY + 45;

    // Divider
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown(1);

    // Student table header
    const tableTop = doc.y;
    doc.fontSize(8).fillColor(gray);
    doc.text('STUDENT', 50, tableTop, { width: 180 });
    doc.text('HOURS', 240, tableTop, { width: 60, align: 'right' });
    doc.text('SESSIONS', 310, tableTop, { width: 60, align: 'right' });
    doc.text('FIRST LOGIN', 380, tableTop, { width: 90 });
    doc.text('STATUS', 480, tableTop, { width: 60, align: 'right' });

    doc.moveTo(50, tableTop + 14).lineTo(doc.page.width - 50, tableTop + 14).strokeColor('#e5e7eb').stroke();

    let rowY = tableTop + 20;
    for (const student of data.students) {
      if (rowY > doc.page.height - 100) {
        doc.addPage();
        rowY = 50;
      }

      const hours = Math.round(student.totalSeconds / 3600 * 10) / 10;
      const status = hours > 0 ? 'Active' : 'No login';
      const statusColor = hours > 0 ? '#059669' : '#ef4444';
      const firstLogin = student.firstLogin
        ? student.firstLogin.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : '—';

      doc.fontSize(9).fillColor(dark).text(student.email, 50, rowY, { width: 180 });
      doc.fontSize(9).fillColor(dark).text(`${hours}h`, 240, rowY, { width: 60, align: 'right' });
      doc.fontSize(9).fillColor(dark).text(String(student.sessions), 310, rowY, { width: 60, align: 'right' });
      doc.fontSize(9).fillColor(gray).text(firstLogin, 380, rowY, { width: 90 });
      doc.fontSize(8).fillColor(statusColor).text(status, 480, rowY, { width: 60, align: 'right' });

      rowY += 18;
    }

    if (data.students.length === 0) {
      doc.fontSize(10).fillColor(gray).text('No student data available for this training.', 50, rowY + 10);
    }

    // Footer
    doc.moveDown(3);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e5e7eb').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor(gray).text(
      `This report was auto-generated from actual lab usage data recorded by GetLabs Cloud Portal. No manual input or self-reporting.`,
      50, doc.y, { width: doc.page.width - 100, align: 'center' }
    );

    // --- PAGE 2+: Individual certificates (one per active student) ---
    const activeStudents = data.students.filter(s => s.totalSeconds > 0);

    for (const student of activeStudents) {
      doc.addPage();
      const hours = Math.round(student.totalSeconds / 3600 * 10) / 10;
      const certId = `CERT-${data.generatedAt.getFullYear()}-${data.trainingName.slice(0, 6).toUpperCase()}-${student.email.slice(0, 4).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Border
      doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).strokeColor('#d1d5db').lineWidth(1).stroke();
      doc.rect(35, 35, doc.page.width - 70, doc.page.height - 70).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

      // Title
      doc.moveDown(4);
      doc.fontSize(10).fillColor(blue).text('GETLABS CLOUD PORTAL', { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(24).fillColor(dark).text('Certificate of Lab Completion', { align: 'center' });

      // Horizontal rule
      doc.moveDown(1);
      const ruleY = doc.y;
      doc.moveTo(150, ruleY).lineTo(doc.page.width - 150, ruleY).strokeColor(blue).lineWidth(2).stroke();

      doc.moveDown(2);
      doc.fontSize(11).fillColor(gray).text('This certifies that', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(20).fillColor(dark).text(student.email, { align: 'center' });

      doc.moveDown(1);
      doc.fontSize(11).fillColor(gray).text(
        `successfully completed ${hours} hours of hands-on lab work`,
        { align: 'center' }
      );

      // Details table
      doc.moveDown(2);
      const detailX = 170;
      const labelX = detailX;
      const valueX = detailX + 110;
      let dY = doc.y;

      const details = [
        ['Training:', data.trainingName],
        ['Organization:', data.organization],
        ['Lab hours:', `${hours} hours across ${student.sessions} sessions`],
        ['Period:', student.firstLogin && student.lastActivity
          ? `${student.firstLogin.toLocaleDateString('en-IN', { dateStyle: 'medium' })} — ${student.lastActivity.toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
          : '—'],
        ['Platform:', 'GetLabs Cloud Portal'],
      ];

      for (const [label, value] of details) {
        doc.fontSize(10).fillColor(gray).text(label, labelX, dY, { width: 100, align: 'right' });
        doc.fontSize(10).fillColor(dark).text(value, valueX, dY, { width: 250 });
        dY += 18;
      }

      // Certificate ID + date
      doc.moveDown(4);
      doc.fontSize(8).fillColor(gray).text(`Certificate ID: ${certId}`, { align: 'center' });
      doc.fontSize(8).fillColor(gray).text(`Issued: ${data.generatedAt.toLocaleDateString('en-IN', { dateStyle: 'long' })}`, { align: 'center' });

      // Signature line
      doc.moveDown(3);
      const sigY = doc.y;
      doc.moveTo(doc.page.width / 2 - 80, sigY).lineTo(doc.page.width / 2 + 80, sigY).strokeColor('#9ca3af').lineWidth(0.5).stroke();
      doc.fontSize(9).fillColor(gray).text('GetLabs Cloud Portal', doc.page.width / 2 - 80, sigY + 5, { width: 160, align: 'center' });
    }

    doc.end();
  });
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
      studentMap[email] = { email, resources: [], totalSeconds: 0, totalCost: 0 };
    }
    const s = studentMap[email];
    const hours = (inst.duration || 0) / 3600;
    const cost = hours * (inst.rate || 0);
    s.totalSeconds += inst.duration || 0;
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
  const totalHoursConsumed = allInstances.reduce((sum, i) => sum + (i.duration || 0), 0) / 3600;
  const totalSellingCost = allInstances.reduce((sum, i) => sum + ((i.duration || 0) / 3600) * (i.rate || 0), 0);

  // Infrastructure cost estimate (containers have azureEquivalentRate)
  let totalInfraCost = 0;
  for (const c of containers) {
    const hrs = (c.duration || 0) / 3600;
    // Container infra cost is roughly the rate itself (small margin containers)
    // If azureEquivalentRate is set, it shows what Azure would have cost
    totalInfraCost += hrs * (c.rate || 0) * 0.6; // approximate 60% cost-of-goods
  }
  for (const v of vms) {
    const hrs = (v.duration || 0) / 3600;
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
      .text('Synergific Cloud Portal', 50, 25, { width: contentWidth });
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
      'Generated by Synergific Cloud Portal',
      50, rowY, { width: contentWidth, align: 'center' }
    );

    doc.end();
  });
}

module.exports = { getTrainingActivity, generateReportPDF, generateUsageReport };
