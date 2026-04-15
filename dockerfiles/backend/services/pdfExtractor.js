/**
 * PDF Text Extractor
 *
 * Thin wrapper around pdf-parse. Takes a PDF buffer (from multer memory
 * storage), returns extracted text + page count. Collapses excessive
 * whitespace so the LLM gets cleaner input.
 */

const { logger } = require('../plugins/logger');

async function extractPdfText(buffer) {
  // Lazy require so the backend still boots if pdf-parse isn't installed yet.
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    throw new Error('pdf-parse is not installed. Run: npm install pdf-parse');
  }

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('extractPdfText expects a Buffer');
  }

  const data = await pdfParse(buffer);
  const rawText = (data.text || '').trim();

  // Collapse runs of whitespace; drop very short lines that are usually page
  // numbers or headers/footers.
  const cleaned = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 2)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');

  logger.info(`[pdfExtractor] extracted ${cleaned.length} chars from ${data.numpages} pages`);

  return {
    text: cleaned,
    pageCount: data.numpages || 0,
    rawLength: rawText.length,
  };
}

module.exports = { extractPdfText };
