/**
 * /b2b/courses routes
 *
 * Mount: app.use('/b2b/courses', restrictToLoggedinUserOnly, require('./routes/b2bCourses'))
 *
 * Uses multer memory storage so PDFs are never written to disk — they
 * flow: request → buffer → pdf-parse → LLM → discard.
 */

const express = require('express');
const router = express.Router();

// Lazy-load multer so the server still boots if the dep hasn't been
// installed yet. If a request hits /analyze without multer, we return a
// clear 500 instead of crashing at startup.
let upload;
try {
  const multer = require('multer');
  upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  });
} catch (e) {
  upload = null;
}

const uploadMiddleware = (req, res, next) => {
  if (!upload) {
    return res.status(500).json({
      error: 'multer is not installed on the backend. Run: npm install multer',
    });
  }
  return upload.single('file')(req, res, next);
};

const {
  handleAnalyze,
  handleList,
  handleGet,
  handleOverride,
  handleGenerateTemplate,
  handleDelete,
} = require('../controllers/b2bCourses');

router.post('/analyze', uploadMiddleware, handleAnalyze);
router.get('/', handleList);
router.get('/:id', handleGet);
router.patch('/:id/override', handleOverride);
router.post('/:id/generate-template', handleGenerateTemplate);
router.delete('/:id', handleDelete);

/**
 * GET /b2b/courses/:id/pdf
 * Download the analysis as a PDF report.
 */
router.get('/:id/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = await require('../models/courseAnalysis').findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const analysis = doc.overrides?.analysis || doc.analysis;
    const isContainer = analysis?.recommendedDeployment === 'container_lab';

    const pdf = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    pdf.on('data', c => chunks.push(c));
    pdf.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="analysis-${doc._id}.pdf"`);
      res.send(buffer);
    });

    const blue = '#2563eb';
    const dark = '#111827';
    const gray = '#6b7280';

    // Header
    pdf.fontSize(10).fillColor(gray).text('Synergific Cloud Portal', 50, 50);
    pdf.fontSize(10).fillColor(gray).text(`Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, 50, 50, { align: 'right' });

    pdf.moveDown(2);
    pdf.fontSize(20).fillColor(dark).text('Course Analysis Report', { align: 'center' });
    pdf.moveDown(0.3);
    pdf.fontSize(11).fillColor(gray).text(analysis?.courseName || doc.originalFilename, { align: 'center' });

    // Meta
    pdf.moveDown(1.5);
    const meta = [
      ['Customer', doc.customerName || '—'],
      ['Type', isContainer ? 'Container Lab' : 'Cloud Sandbox'],
      ['Provider', analysis?.detectedProvider?.toUpperCase() || '—'],
      ['Seats', String(doc.seats || 1)],
      ['TTL', `${doc.requestedTtlHours || 4} hours`],
      ['Total Lab Hours', `${analysis?.totalHours || 0}h`],
      ['Difficulty', analysis?.difficulty || '—'],
      ['File', doc.originalFilename],
      ['Status', doc.status],
    ];
    if (doc.cost?.perSeatInr) meta.push(['Per Seat Cost', `₹${doc.cost.perSeatInr}`]);
    if (doc.cost?.totalInr) meta.push(['Total Quote', `₹${doc.cost.totalInr} (${doc.cost.marginPercent}% margin)`]);

    meta.forEach(([label, value]) => {
      pdf.fontSize(9).fillColor(gray).text(label + ':', 50, pdf.y, { continued: true, width: 120 });
      pdf.fontSize(9).fillColor(dark).text('  ' + value);
    });

    // Feasibility
    if (doc.feasibility) {
      pdf.moveDown(1);
      pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).strokeColor('#e5e7eb').stroke();
      pdf.moveDown(0.5);
      pdf.fontSize(13).fillColor(dark).text('Feasibility');
      pdf.moveDown(0.3);
      pdf.fontSize(10).fillColor(blue).text(`Verdict: ${doc.feasibility.verdict?.toUpperCase()}`);

      if (doc.feasibility.supported?.length) {
        pdf.moveDown(0.5);
        pdf.fontSize(9).fillColor(gray).text(`Supported (${doc.feasibility.supported.length}): ${doc.feasibility.supported.map(s => s.service).join(', ')}`);
      }
      if (doc.feasibility.needsReview?.length) {
        pdf.fontSize(9).fillColor('#d97706').text(`Needs Review (${doc.feasibility.needsReview.length}): ${doc.feasibility.needsReview.map(s => s.service).join(', ')}`);
      }
      if (doc.feasibility.unsupported?.length) {
        pdf.fontSize(9).fillColor('#dc2626').text(`Unsupported (${doc.feasibility.unsupported.length}): ${doc.feasibility.unsupported.map(s => s.service).join(', ')}`);
      }
      if (doc.feasibility.riskFlags?.length) {
        pdf.moveDown(0.3);
        doc.feasibility.riskFlags.forEach(f => pdf.fontSize(8).fillColor('#92400e').text(`⚠ ${f}`));
      }
    }

    // Container lab details
    if (isContainer && analysis?.containerLab) {
      const cl = analysis.containerLab;
      pdf.moveDown(1);
      pdf.fontSize(13).fillColor(dark).text('Container Lab Recommendation');
      pdf.moveDown(0.3);
      if (cl.recommendedImageKey) pdf.fontSize(9).fillColor(dark).text(`Recommended Image: ${cl.recommendedImageKey}`);
      if (cl.resourcesPerSeat) {
        pdf.fontSize(9).fillColor(gray).text(`Per Seat: ${cl.resourcesPerSeat.vcpu || '—'} vCPU, ${cl.resourcesPerSeat.memoryGb || '—'} GB RAM, ${cl.resourcesPerSeat.storageGb || '—'} GB disk`);
      }
      if (cl.estimatedSavingsVsVmPercent) pdf.fontSize(9).fillColor('#059669').text(`Estimated savings vs VM: ~${cl.estimatedSavingsVsVmPercent}%`);
      if (cl.proposedStack?.length) {
        pdf.moveDown(0.3);
        pdf.fontSize(9).fillColor(gray).text('Proposed Stack:');
        cl.proposedStack.forEach(s => pdf.fontSize(8).fillColor(dark).text(`  • ${s.component} — ${s.purpose}`));
      }
    }

    // Modules
    if (analysis?.modules?.length) {
      pdf.moveDown(1);
      pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).strokeColor('#e5e7eb').stroke();
      pdf.moveDown(0.5);
      pdf.fontSize(13).fillColor(dark).text(`Modules (${analysis.modules.length})`);
      pdf.moveDown(0.3);

      analysis.modules.forEach((m, i) => {
        if (pdf.y > 700) pdf.addPage();
        pdf.fontSize(9).fillColor(dark).text(`${i + 1}. ${m.name} — ${m.hours || 0}h`);
        if (m.services?.length) {
          pdf.fontSize(8).fillColor(gray).text(`   Services: ${m.services.map(s => s.name).join(', ')}`);
        }
      });
    }

    // Cost breakdown
    if (doc.cost?.breakdown?.length) {
      pdf.moveDown(1);
      pdf.moveTo(50, pdf.y).lineTo(545, pdf.y).strokeColor('#e5e7eb').stroke();
      pdf.moveDown(0.5);
      pdf.fontSize(13).fillColor(dark).text('Cost Breakdown');
      pdf.moveDown(0.3);
      doc.cost.breakdown.forEach(b => {
        pdf.fontSize(8).fillColor(dark).text(`${b.service} (${b.module}) — ${b.hours}h × ₹${b.rate}/hr = ₹${b.subtotal}`);
      });
    }

    // Footer
    pdf.moveDown(2);
    pdf.fontSize(8).fillColor(gray).text('This report was auto-generated by Synergific Cloud Portal.', { align: 'center' });

    pdf.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
