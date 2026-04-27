import React, { useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';

// Edit-template modal — non-destructive fields only.
// Name + imageId stay immutable (renaming would orphan VMs that reference
// templateName). Admins change rate, kasmVnc, hasXrdp here.
export function EditTemplateModal({ open, template, onClose, onSave }) {
  const [rate, setRate] = useState('');
  const [kasmVnc, setKasmVnc] = useState(false);
  const [hasXrdp, setHasXrdp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && template) {
      setRate(String(template.rate ?? ''));
      setKasmVnc(!!template.kasmVnc);
      setHasXrdp(!!template.hasXrdp);
    }
  }, [open, template]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave({
        name: template.name,
        rate: rate === '' ? undefined : Number(rate),
        kasmVnc,
        hasXrdp,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
         onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Edit template</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-mono">{template?.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><FaTimes /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500">
            Name and underlying Azure image are immutable — renaming would break VMs
            that reference this template. Delete + recreate instead.
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rate (₹/hour)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-1 text-xs text-slate-500">Per-VM-hour cost charged to the org.</p>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={kasmVnc}
                onChange={(e) => setKasmVnc(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">KasmVNC installed</div>
                <div className="text-xs text-slate-500">Browser-access goes direct to KasmVNC on port 6901 (GPU-accelerated, no Guacamole hop).</div>
              </div>
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={hasXrdp}
                onChange={(e) => setHasXrdp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900">xrdp + XFCE installed</div>
                <div className="text-xs text-slate-500">Linux VMs get both SSH (terminal) and RDP-desktop connections in Guacamole.</div>
              </div>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-60">
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditTemplateModal;
