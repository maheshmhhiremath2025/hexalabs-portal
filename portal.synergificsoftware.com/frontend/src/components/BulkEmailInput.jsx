import React, { useRef, useState } from 'react';
import { extractEmailsFromText, isValidEmail } from '../utils/csvEmailParser';

/**
 * BulkEmailInput — textarea with CSV/file upload support.
 *
 * Props:
 *   value        — string, newline-separated emails (controlled)
 *   onChange      — fn(newValue: string)
 *   rows         — textarea rows (default 4)
 *   placeholder  — textarea placeholder
 *   label        — label text (optional, rendered above)
 */
export default function BulkEmailInput({
  value,
  onChange,
  rows = 4,
  placeholder = 'user1@company.com\nuser2@company.com',
  label,
}) {
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null); // { valid, invalid } | null

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const raw = extractEmailsFromText(text);

      // Deduplicate (case-insensitive) and merge with existing
      const existing = (value || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      const seen = new Set(existing.map(em => em.toLowerCase()));
      const newEmails = [];
      for (const em of raw) {
        const key = em.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          newEmails.push(em);
        }
      }

      const valid = newEmails.filter(em => isValidEmail(em));
      const invalid = newEmails.filter(em => !isValidEmail(em));

      const merged = [...existing, ...valid].join('\n');
      onChange(merged);
      setStatus({ valid: valid.length, invalid: invalid.length });

      // Clear the file input so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleClear = () => {
    onChange('');
    setStatus(null);
  };

  const emailCount = (value || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean).length;

  return (
    <div>
      {label && (
        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
          {label}
        </label>
      )}

      <textarea
        value={value}
        onChange={(e) => { onChange(e.target.value); setStatus(null); }}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono"
      />

      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
        >
          Upload CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.xlsx"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {emailCount > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
          >
            Clear All
          </button>
        )}

        {emailCount > 0 && (
          <span className="text-xs text-gray-500">
            {emailCount} email{emailCount !== 1 ? 's' : ''} entered
          </span>
        )}

        {status && (
          <span className="text-xs">
            {status.valid > 0 && (
              <span className="text-green-700">{status.valid} valid email{status.valid !== 1 ? 's' : ''} loaded</span>
            )}
            {status.valid > 0 && status.invalid > 0 && <span className="text-gray-400 mx-1">|</span>}
            {status.invalid > 0 && (
              <span className="text-amber-600">{status.invalid} invalid email{status.invalid !== 1 ? 's' : ''} skipped</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
