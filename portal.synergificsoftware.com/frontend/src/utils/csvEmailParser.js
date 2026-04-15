const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
const EMAIL_HEADERS = ['email', 'e-mail', 'mail', 'emailaddress', 'email_address'];

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Extract emails from CSV/text content.
 * Looks for columns named "email", "Email", etc., or falls back to the first column.
 * Returns an array of raw email strings (not yet validated).
 */
export function extractEmailsFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const firstRow = parseCSVLine(lines[0]);
  let emailColIndex = -1;

  for (let i = 0; i < firstRow.length; i++) {
    const normalized = firstRow[i].toLowerCase().replace(/[\s_-]/g, '');
    if (EMAIL_HEADERS.includes(normalized)) {
      emailColIndex = i;
      break;
    }
  }

  let dataStart = 0;
  if (emailColIndex >= 0) {
    dataStart = 1;
  } else {
    emailColIndex = 0;
    if (!EMAIL_RE.test(firstRow[0])) {
      dataStart = 1;
    }
  }

  const emails = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const val = (cols[emailColIndex] || '').trim();
    if (val) emails.push(val);
  }
  return emails;
}

/**
 * Validate a single email string.
 */
export function isValidEmail(email) {
  return EMAIL_RE.test(String(email).toLowerCase());
}

/**
 * Read a File object and return parsed emails via a callback.
 * callback receives { valid: string[], invalid: string[], validCount: number, invalidCount: number }
 */
export function parseEmailFile(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const raw = extractEmailsFromText(e.target.result);
    const valid = raw.filter(em => isValidEmail(em));
    const invalid = raw.filter(em => !isValidEmail(em));
    callback({ valid, invalid, validCount: valid.length, invalidCount: invalid.length });
  };
  reader.readAsText(file);
}
