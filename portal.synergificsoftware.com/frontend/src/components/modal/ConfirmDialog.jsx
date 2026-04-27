import React from 'react';
import { FaExclamationTriangle, FaTimes } from 'react-icons/fa';

// Simple confirmation modal — replaces window.confirm() for destructive
// actions. Usage: pass open, title, message, confirmLabel, onConfirm, onClose.
export function ConfirmDialog({
  open, title = 'Confirm', message, confirmLabel = 'Confirm',
  tone = 'red',                 // 'red' | 'blue'
  loading = false,
  onConfirm, onClose,
}) {
  if (!open) return null;
  const btnBg = tone === 'red'
    ? 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500'
    : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500';
  const iconColor = tone === 'red' ? 'text-rose-600 bg-rose-100' : 'text-blue-600 bg-blue-100';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
         onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4 p-5">
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${iconColor}`}>
            <FaExclamationTriangle />
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <FaTimes />
              </button>
            </div>
            <div className="mt-2 text-sm text-slate-600 leading-relaxed">{message}</div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors disabled:opacity-60 ${btnBg}`}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
