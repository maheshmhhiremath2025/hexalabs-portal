import React, { useEffect, useState, useCallback, useMemo } from 'react';
import apiCaller from '../services/apiCaller';
import { cloudLabelFor } from '../utils/cloudLabels';
import {
  FaDesktop, FaKey, FaUser, FaWifi, FaPlay, FaPowerOff, FaCamera,
  FaServer, FaSearch, FaCopy, FaCheck, FaExternalLinkAlt, FaDocker, FaTrash, FaClock, FaEye
} from 'react-icons/fa';
import { FaArrowsSpin, FaDownload } from 'react-icons/fa6';

/* ===== Toast Hook ===== */
const useToast = () => {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
  }, []);
  const clear = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return { toast, show, clear };
};

/* ===== Toast Component ===== */
const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
        toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
      }`}>
        {toast.message}
        <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">&times;</button>
      </div>
    </div>
  );
};

/* ===== Progress Toast ===== */
const ProgressBar = ({ progress, status, operation, label, elapsedSec, onCancel }) => (
  <div className="fixed top-4 right-4 z-50 bg-white rounded-lg border border-gray-200 shadow-xl p-4 w-80">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-semibold text-gray-800">
        {operation === 'start' ? `Starting ${label || 'instances'}…` : operation === 'stop' ? `Stopping ${label || 'instances'}…` : 'Processing…'}
      </span>
      <span className="text-xs font-medium text-gray-500 tabular-nums">{progress}%</span>
    </div>
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${operation === 'start' ? 'bg-green-500' : operation === 'stop' ? 'bg-red-500' : 'bg-blue-500'}`}
        style={{ width: `${progress}%` }}
      />
    </div>
    <div className="flex items-center justify-between mt-1.5">
      <p className="text-xs text-gray-500">{status}</p>
      {elapsedSec != null && <p className="text-[10px] text-gray-400 tabular-nums">{elapsedSec}s elapsed</p>}
    </div>
    {onCancel && (
      <button onClick={onCancel} className="mt-2 text-[11px] text-gray-500 hover:text-gray-700 underline">
        Dismiss
      </button>
    )}
  </div>
);

/* ===== CSV Helpers ===== */
const escapeCsv = (v) => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const vmsToCsv = (vms) => {
  const h = ['Name','OS','Username','Password','Public IP','Running','Quota Consumed','Quota Total','Resource Group','Guacamole'];
  const rows = vms.map(vm => [vm.name, vm.os||vm.osType||'', vm.adminUsername, vm.adminPass, vm.publicIp, vm.isRunning?'Yes':'No', vm?.quota?.consumed??'', vm?.quota?.total??'', vm.resourceGroup??'', vm.guacamole?'Yes':'No'].map(escapeCsv).join(','));
  return [h.map(escapeCsv).join(','), ...rows].join('\n');
};
const downloadCsv = (fn, csv) => { const b = new Blob([csv], {type:'text/csv'}); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href=u; a.download=fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); };

/* ===== Sort Helpers ===== */
const extractNumbers = (name) => { const m = (name || '').match(/(\d+)-(\d+)/); if (m) return { a: +m[1], b: +m[2] }; const s = (name || '').match(/\d+/); return { a: s ? +s[0] : 0, b: 0 }; };
const naturalCompare = (a, b) => { const an = extractNumbers(a), bn = extractNumbers(b); return an.a !== bn.a ? an.a - bn.a : an.b - bn.b; };
// Default sort = by natural name (preserves existing behaviour). Pass a `key`+`dir` to override.
const sortVms = (vms, key = 'name', dir = 'asc') => {
  const arr = [...(vms || [])];
  const mult = dir === 'desc' ? -1 : 1;
  const getQ = (v) => v?.quota?.total > 0 ? ((v.quota.consumed * 60) / v.quota.total) : 0;
  const getExp = (v) => v?.expiresAt ? new Date(v.expiresAt).getTime() : Infinity;
  const getStatus = (v) => v?.isRunning ? 1 : 0;
  arr.sort((a, b) => {
    let r = 0;
    if (key === 'name')      r = naturalCompare(a.name, b.name);
    else if (key === 'os')   r = (a.os || a.osType || '').localeCompare(b.os || b.osType || '');
    else if (key === 'ip')   r = (a.publicIp || '').localeCompare(b.publicIp || '');
    else if (key === 'status') r = getStatus(b) - getStatus(a); // running first
    else if (key === 'expires') r = getExp(a) - getExp(b);
    else if (key === 'quota')   r = getQ(b) - getQ(a); // highest usage first
    else r = naturalCompare(a.name, b.name);
    return r * mult;
  });
  return arr;
};

/* ===== Smart-search parser ─ chip-aware ────────────────────────────────────
 * Accepts free text + `key:value` chips. Recognised keys:
 *   status:running|stopped
 *   expires:<2h | >2h | today | expired
 *   email:foo
 *   os:windows|linux
 *   quota:>80 | <50
 * Anything without `:` becomes a free-text filter against name/email/IP/OS.
 * ===========================================================================*/
const parseQuery = (raw) => {
  const tokens = (raw || '').trim().split(/\s+/).filter(Boolean);
  const chips = []; const free = [];
  for (const t of tokens) {
    const idx = t.indexOf(':');
    if (idx > 0) chips.push({ key: t.slice(0, idx).toLowerCase(), val: t.slice(idx + 1) });
    else free.push(t.toLowerCase());
  }
  return { chips, free };
};
const matchQuery = (vm, q) => {
  const { chips, free } = q;
  for (const f of free) {
    const hay = [vm.name, vm.os, vm.osType, vm.email, vm.publicIp, vm.adminUsername].join(' ').toLowerCase();
    if (!hay.includes(f)) return false;
  }
  for (const c of chips) {
    const v = (c.val || '').toLowerCase();
    if (c.key === 'status') {
      if (v === 'running' && !vm.isRunning) return false;
      if (v === 'stopped' && vm.isRunning) return false;
    } else if (c.key === 'expires') {
      const exp = vm.expiresAt ? new Date(vm.expiresAt) : null;
      const mins = exp ? (exp - new Date()) / 60000 : Infinity;
      if (v === 'expired' && mins > 0) return false;
      if (v === 'today' && (mins < 0 || mins > 1440)) return false;
      const m = v.match(/^([<>])(\d+)([hm]?)$/);
      if (m) {
        const op = m[1]; const n = +m[2]; const unit = m[3] || 'h';
        const cmp = unit === 'm' ? mins : mins / 60;
        if (op === '<' && !(cmp < n)) return false;
        if (op === '>' && !(cmp > n)) return false;
      }
    } else if (c.key === 'email') {
      if (!(vm.email || '').toLowerCase().includes(v)) return false;
    } else if (c.key === 'os') {
      if (!((vm.os || vm.osType || '').toLowerCase().includes(v))) return false;
    } else if (c.key === 'quota') {
      const pct = vm?.quota?.total > 0 ? ((vm.quota.consumed * 60) / vm.quota.total) * 100 : 0;
      const m = v.match(/^([<>])(\d+)$/);
      if (m) { const op = m[1]; const n = +m[2]; if (op === '<' && !(pct < n)) return false; if (op === '>' && !(pct > n)) return false; }
    }
  }
  return true;
};

/* ===== Azure SKU → human-readable specs (2026-06-06) =====
 * Customer-facing label translation: "Standard_E32s_v5" → "32 vCPU · 256 GB RAM".
 * - Explicit overrides for SKUs with irregular RAM (B-series, M-series).
 * - Family-based fallback for the long tail (D=4, E=8, F=2 GB per vCPU, etc.).
 * - Returns null when the SKU can't be parsed — caller falls back to raw label.
 * Storage is intentionally omitted: the OS disk + data disks are attached
 * resources, not implied by the SKU. */
const SKU_OVERRIDES = {
  'standard_b1s':  { vcpu: 1, ram: 1 },
  'standard_b1ms': { vcpu: 1, ram: 2 },
  'standard_b2s':  { vcpu: 2, ram: 4 },
  'standard_b2ms': { vcpu: 2, ram: 8 },
  'standard_b4ms': { vcpu: 4, ram: 16 },
  'standard_b8ms': { vcpu: 8, ram: 32 },
  'standard_b12ms':{ vcpu: 12, ram: 48 },
  'standard_b16ms':{ vcpu: 16, ram: 64 },
  'standard_b20ms':{ vcpu: 20, ram: 80 },
};
const FAMILY_RAM_PER_VCPU = {
  d: 4, da: 4, das: 4, dc: 4, dd: 4, dds: 4, ds: 4, dads: 4,
  e: 8, ea: 8, eas: 8, ec: 8, ed: 8, eds: 8, es: 8, eads: 8,
  f: 2, fs: 2, fas: 2,
  l: 8, ls: 8,
  m: 28, ms: 28,
  nc: 7, nd: 7, nv: 7,
};
const parseAzureSku = (sku) => {
  if (!sku) return null;
  const k = sku.toLowerCase();
  if (SKU_OVERRIDES[k]) return SKU_OVERRIDES[k];
  const m = sku.match(/^(?:standard_)?([a-z]+?)(\d+)([a-z]*)(?:_v\d+)?$/i);
  if (!m) return null;
  const familyKey = m[1].toLowerCase();
  const vcpu = parseInt(m[2], 10);
  const perVcpu = FAMILY_RAM_PER_VCPU[familyKey];
  if (!perVcpu || !vcpu) return null;
  return { vcpu, ram: vcpu * perVcpu };
};
const formatSpecs = (sku) => {
  const s = parseAzureSku(sku);
  return s ? `${s.vcpu} vCPU · ${s.ram} GB RAM` : null;
};

/* ===== Quota color band (#4) ===== */
const quotaBand = (pct) => pct >= 85 ? 'high' : pct >= 60 ? 'mid' : 'low';
const quotaColors = {
  low:  { text: 'text-green-600',  fill: 'bg-green-500',  ring: 'ring-green-200' },
  mid:  { text: 'text-amber-600',  fill: 'bg-amber-500',  ring: 'ring-amber-200' },
  high: { text: 'text-red-600',    fill: 'bg-red-500',    ring: 'ring-red-200'  },
};

/* ===== Copyable Cell ===== */
const CopyCell = ({ icon: Icon, value, iconColor = 'text-gray-400' }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(String(value || '')); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  if (!value) return <span className="text-gray-300">-</span>;
  return (
    <div className="flex items-center gap-2 group">
      <Icon className={`w-3 h-3 ${iconColor} flex-shrink-0`} />
      <span className="truncate max-w-[140px] text-gray-700">{value}</span>
      <button onClick={copy} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5" title="Copy">
        {copied ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5 text-gray-400 hover:text-gray-600" />}
      </button>
    </div>
  );
};

// `stoppingUntil` is set by the backend when a Stop is queued (whether the user
// clicked Stop or auto-shutdown queued one). Until 90s elapse the Start button is
// "cooling down" — a Start request would be refused by the backend with a 409.
// We surface this on the row so users see the countdown instead of clicking and
// getting an error toast.
const stoppingSecondsLeft = (vm) => {
  if (!vm?.stoppingUntil) return 0;
  return Math.max(0, Math.ceil((new Date(vm.stoppingUntil) - Date.now()) / 1000));
};

/* ===== VM Row ===== */
const VmRow = ({ vm, onSelect, onLaunch, onCapture, onDelete, onShadow, onResetPassword, onOpenDrawer, onSaveExpiry, showCapture, isSuperAdmin, disabled, transition, isAdmin, density = 'compact' }) => {
  // Unit-mismatch fix 2026-06-04: quota.consumed is HOURS, quota.total is MINUTES.
  // Convert consumed to minutes (×60) before dividing or the bar shows 1/60th of reality
  // (e.g. 165h used of 9900 min cap rendered as 2% instead of 100%).
  const pct = vm?.quota?.total > 0 ? Math.min(100, ((vm.quota.consumed * 60) / vm.quota.total) * 100) : 0;
  const band = quotaBand(pct);
  const qc = quotaColors[band];
  const consumedH = vm?.quota?.consumed ?? 0;
  const totalH = vm?.quota?.total ? vm.quota.total / 60 : 0;
  // `transition` is "start" or "stop" while a request is in flight for this VM
  // and the DB hasn't caught up yet. We show a pulsing amber chip so users
  // understand that Stop → [Stopping] → Running (or Start → [Starting]) is in
  // progress, instead of thinking nothing happened.
  const isStarting = transition === 'start' && !vm.isRunning;
  const isStopping = transition === 'stop' && vm.isRunning;

  // #7 inline expiry edit state
  const [editingExp, setEditingExp] = useState(false);
  const [expDraft, setExpDraft] = useState('');
  const startEditExp = (e) => {
    e.stopPropagation();
    if (!isSuperAdmin && !isAdmin) return;
    const exp = vm.expiresAt ? new Date(vm.expiresAt) : new Date();
    setExpDraft(new Date(exp.getTime() - exp.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setEditingExp(true);
  };
  const commitExp = async () => { setEditingExp(false); if (expDraft) await onSaveExpiry(vm, expDraft); };

  const rowClick = (e) => {
    if (e.target.closest('input,button,a,select,.no-row-click')) return;
    onOpenDrawer && onOpenDrawer(vm);
  };

  const padY = density === 'comfy' ? 'py-3.5' : 'py-2.5';

  return (
    <tr
      onClick={rowClick}
      className={`border-b border-gray-100 hover:bg-gray-50/60 transition-colors cursor-pointer ${vm.selected ? 'bg-rose-50/40' : ''}`}
      style={{ boxShadow: `inset 0 -2px 0 0 var(--row-bar-status-${vm.isRunning ? 'on' : 'off'})` }}
    >
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={vm.selected} onChange={() => onSelect(vm._id)} disabled={disabled}
          className="w-3.5 h-3.5 text-rose-600 rounded border-gray-300 focus:ring-rose-500" />
      </td>
      <td className={`px-3 ${padY}`}>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${vm.isRunning ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-gray-900 truncate max-w-[180px]">{vm.name}</span>
            {(() => {
              const lbl = cloudLabelFor(vm.cloud || 'azure', isSuperAdmin ? 'superadmin' : (isAdmin ? 'admin' : 'user'));
              return (
                <span title={lbl.sub} className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold rounded border ${lbl.chipClass}`}>
                  {lbl.codename.replace('Hexalabs ', '')}
                </span>
              );
            })()}
            {vm.email && <span className="text-[10px] text-gray-400 truncate max-w-[180px]">{vm.email}</span>}
          </div>
          {vm.type === 'container' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600 uppercase">
              <FaDocker className="w-2 h-2" /> Workspace
            </span>
          )}
        </div>
      </td>
      <td className={`px-3 ${padY} text-gray-600`}>{vm.os || vm.osType || '-'}</td>
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}><CopyCell icon={FaUser} value={vm.adminUsername} /></td>
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}><CopyCell icon={FaKey} value={vm.adminPass} /></td>
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}><CopyCell icon={FaWifi} value={vm.publicIp} iconColor="text-blue-400" /></td>
      <td className={`px-3 ${padY}`}>
        {isStarting || isStopping ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {isStarting ? 'Starting…' : 'Stopping…'}
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
            vm.isRunning ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${vm.isRunning ? 'bg-green-500' : 'bg-gray-400'}`} />
            {vm.isRunning ? 'Running' : 'Stopped'}
          </span>
        )}
        {/* Recent queue-job failure — written by the worker's on('failed') hook
            and cleared on completion. Only show if within the last 10 min so
            old errors don't haunt the row forever. */}
        {vm.lastOpError && vm.lastOpErrorAt &&
         (Date.now() - new Date(vm.lastOpErrorAt).getTime()) < 10 * 60 * 1000 && (
          <div
            className="mt-1 text-[10px] leading-tight text-rose-600 max-w-[200px] truncate"
            title={`${vm.lastOpErrorQueue || 'job'}: ${vm.lastOpError}`}
          >
            ⚠ {vm.lastOpError.length > 60 ? vm.lastOpError.slice(0, 60) + '…' : vm.lastOpError}
          </div>
        )}
        {/* Cooldown pill: VM is mid-stop sequence; Start is refused by the
            backend until this counter hits 0. Re-renders every 1s via the
            existing `tick` interval. */}
        {stoppingSecondsLeft(vm) > 0 && (
          <div
            className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200"
            title="VM is completing its stop sequence (deallocate → snapshot → delete VM → delete disk). Start will be available once this finishes."
          >
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
            Stopping… {stoppingSecondsLeft(vm)}s
          </div>
        )}
        {/* progress-remarks-chip: server-driven progress hint. Worker writes
            remarks like "Snapshotting…" / "Terminating…" / "Rehydrating…"
            (trailing ellipsis = still in progress). Once the op completes
            the worker overwrites with a terminal value (no ellipsis) and
            this chip disappears automatically. */}
        {vm.remarks && (vm.remarks.endsWith('…') || vm.remarks.endsWith('...')) && (
          <div
            className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
            title="Background operation in progress"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            {vm.remarks}
          </div>
        )}
      </td>
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}>
        {editingExp ? (
          <div className="flex items-center gap-1">
            <input type="datetime-local" value={expDraft} onChange={e => setExpDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitExp(); if (e.key === 'Escape') setEditingExp(false); }}
              autoFocus
              className="text-[11px] border border-rose-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-rose-200" />
            <button onClick={commitExp} className="p-0.5 text-green-600 hover:bg-green-50 rounded"><FaCheck className="w-3 h-3"/></button>
          </div>
        ) : vm.expiresAt ? (() => {
          const exp = new Date(vm.expiresAt);
          const now = new Date();
          const diff = exp - now;
          const expired = diff <= 0;
          const minsLeft = Math.max(0, Math.round(diff / 60000));
          const hrsLeft = Math.floor(minsLeft / 60);
          const daysLeft = Math.floor(hrsLeft / 24);
          const isUrgent = minsLeft <= 60;
          const editable = isSuperAdmin || isAdmin;
          return (
            <div onClick={editable ? startEditExp : undefined}
              className={`${editable ? 'cursor-text hover:bg-rose-50 hover:outline hover:outline-1 hover:outline-dashed hover:outline-rose-300' : ''} rounded px-1 py-0.5 -mx-1 transition-colors`}
              title={editable ? 'Click to edit' : ''}>
              <div className={`text-[11px] font-medium ${expired ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-gray-700'}`}>
                {exp.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              <div className={`text-[10px] ${expired ? 'text-red-500 font-semibold' : isUrgent ? 'text-amber-500 font-semibold' : 'text-gray-400'}`}>
                {expired ? 'Expired' : daysLeft > 0 ? `${daysLeft}d ${hrsLeft % 24}h left` : hrsLeft > 0 ? `${hrsLeft}h ${minsLeft % 60}m left` : `${minsLeft}m left`}
              </div>
            </div>
          );
        })() : (
          (isSuperAdmin || isAdmin) ? (
            <button onClick={startEditExp} className="text-[10px] text-gray-400 hover:text-rose-600 px-1 py-0.5 rounded hover:bg-rose-50">+ set expiry</button>
          ) : <span className="text-[11px] text-gray-300">—</span>
        )}
      </td>
      <td className={`px-3 ${padY}`}>
        <div className="min-w-[110px]" title={`${consumedH.toFixed(2)}h used of ${totalH.toFixed(0)}h cap · ${pct.toFixed(1)}% · ${band === 'high' ? 'critical — auto-stop imminent' : band === 'mid' ? 'monitor usage' : 'healthy'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[11px] font-bold tabular-nums ${qc.text}`}>{pct.toFixed(0)}%</span>
            <span className="text-[9px] text-gray-400 tabular-nums">{consumedH.toFixed(0)} / {totalH.toFixed(0)}h</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${qc.fill} transition-all`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </td>
      <td className={`px-3 ${padY} no-row-click`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 justify-end">
          {vm.type === 'container' ? (
            <a href={vm.accessUrl} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 pointer-events-none'
              }`}>
              <FaDesktop className="w-2.5 h-2.5" />
              Open Desktop
            </a>
          ) : (
            <>
              {showCapture && (
                <button onClick={() => onCapture(vm.name)} disabled={vm.isRunning || disabled}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30 transition-colors" title="Snapshot">
                  <FaCamera className="w-3 h-3" />
                </button>
              )}
              {(vm.guacamole || vm.dcv) && (
                <button onClick={() => onLaunch(vm)} disabled={!vm.isRunning || disabled}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}>
                  <FaDesktop className="w-2.5 h-2.5" />
                  Open in Browser
                </button>
              )}
              {(vm.guacamole || vm.type === "container") && (
                <a href={`/lab/${encodeURIComponent(vm.name)}`} title="Open Lab Console"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors border ${
                    vm.isRunning ? "border-blue-600 text-blue-700 hover:bg-blue-50" : "border-gray-300 text-gray-400 pointer-events-none"
                  }`}>
                  Lab Console
                </a>
              )}
            </>
          )}
          {showCapture && vm.isRunning && (
            <button onClick={() => onShadow && onShadow(vm)} disabled={disabled}
              className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors" title="Shadow — view student's live screen">
              <FaEye className="w-3 h-3" />
            </button>
          )}
          {(isAdmin || isSuperAdmin) && vm.email && (
            <button onClick={() => onResetPassword(vm)} disabled={disabled}
              className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors" title={`Reset password for ${vm.email}`}>
              <FaKey className="w-3 h-3" />
            </button>
          )}
                    {isSuperAdmin && (
            <button onClick={() => onDelete(vm)} disabled={disabled}
              className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-30 transition-colors" title="Delete instance">
              <FaTrash className="w-3 h-3" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

/* ============================================================================
 * UI-redesign 2026-06-06 — new components for the Lab Console refresh.
 * Each component below maps 1:1 to a numbered idea from the mock:
 *   #1 BulkBar           — sticky context bar shown when ≥1 row is selected
 *   #2 DetailDrawer      — right-side drawer with quick-launch + activity log
 *   #3 KpiStrip          — cohort header with 5 KPIs above the table
 *   #6 SmartSearchBar    — chip-aware search (status:, expires:, email:, …)
 *   #5 sortable headers  — wired in the table render via SortableTh below
 * ==========================================================================*/

const SortableTh = ({ label, sortKey, sortBy, setSortBy }) => {
  const active = sortBy.key === sortKey;
  const dir = active ? sortBy.dir : null;
  const click = () => setSortBy(active
    ? { key: sortKey, dir: dir === 'asc' ? 'desc' : 'asc' }
    : { key: sortKey, dir: 'asc' });
  return (
    <th onClick={click}
      className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none ${active ? 'text-rose-600 bg-rose-50/50' : 'text-gray-500'}`}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] ${active ? 'text-rose-500' : 'text-gray-300'}`}>{dir === 'desc' ? '↓' : dir === 'asc' ? '↑' : '↕'}</span>
      </span>
    </th>
  );
};

/* ===== #3 KPI Strip ===== */
const KpiStrip = ({ training, organization, vms, dead, expiresAt, vmSize }) => {
  const running = vms.filter(v => v.isRunning).length;
  const stopped = vms.filter(v => !v.isRunning).length;
  const totalAll = vms.length + dead.length;
  const totalQuota = vms.length ? vms.reduce((s, v) => {
    const pct = v?.quota?.total > 0 ? Math.min(100, ((v.quota.consumed * 60) / v.quota.total) * 100) : 0;
    return s + pct;
  }, 0) / vms.length : 0;

  // Expiry display logic.
  // - If expiry is null or beyond 30 days → show absolute date ("31 Dec 2027") and
  //   relabel as "Module expiry" (the "Cohort expires in 572d 20h" countdown
  //   for long-running infra like docker hosts felt misleading).
  // - <= 30 days → countdown ("12h 30m", "5d 4h"), amber when ≤ 2h.
  const exp = expiresAt ? new Date(expiresAt) : null;
  const mins = exp ? Math.max(0, Math.round((exp - new Date()) / 60000)) : null;
  const hrs = mins != null ? Math.floor(mins / 60) : null;
  const days = hrs != null ? Math.floor(hrs / 24) : null;
  const longRange = days != null && days > 30;
  const expiryWarn = mins != null && !longRange && mins <= 120;
  const expiryLabel = exp == null ? 'Module expiry' : longRange ? 'Module expiry' : 'Expires in';
  const expiryStr = exp == null ? '—'
    : longRange ? exp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : days > 0 ? `${days}d ${hrs % 24}h`
    : hrs > 0 ? `${hrs}h ${mins % 60}m`
    : `${mins}m`;

  return (
    <div className="mb-3 bg-white border border-gray-200 rounded-xl px-5 py-3.5 grid items-center"
      style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.2fr', gap: '20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="border-r border-gray-100 pr-5">
        <div className="text-[15px] font-bold text-gray-900 truncate">{training}</div>
        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{organization || ''}</div>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          <span className="text-[9px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 px-2 py-0.5 rounded" title={vmSize || ''}>{formatSpecs(vmSize) || vmSize || 'Azure'}</span>
          {dead.length > 0 && (
            <span className="text-[9px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{dead.length} terminated</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Active</div>
        <div className="text-xl font-bold text-gray-900 tabular-nums">{vms.length}</div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Running</div>
        <div className="text-xl font-bold text-green-600 tabular-nums">{running}</div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Stopped</div>
        <div className="text-xl font-bold text-gray-700 tabular-nums">{stopped}</div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Avg quota</div>
        <div className={`text-xl font-bold tabular-nums ${totalQuota >= 85 ? 'text-red-600' : totalQuota >= 60 ? 'text-amber-600' : 'text-gray-900'}`}>
          {totalQuota.toFixed(0)}<span className="text-xs text-gray-400 font-medium">%</span>
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">{expiryLabel}</div>
        <div className={`text-xl font-bold tabular-nums ${expiryWarn ? 'text-amber-600' : 'text-gray-900'}`}>{expiryStr}</div>
      </div>
    </div>
  );
};

/* ===== #1 Sticky Bulk-action Bar ===== */
// Always-visible action bar (2026-06-06 v2). Renders even with 0 selected so
// users discover the Start / Stop / Extend / Export / Delete affordances
// without first selecting a row. Buttons are disabled until selection.
const BulkBar = ({ selected, total, onStart, onStop, onExtend, onExport, onDelete, onClear, onSelectAll, anyRunning, allRunning, disabled }) => {
  const has = selected.length > 0;
  const names = has ? (selected.slice(0, 3).map(v => v.name).join(', ') + (selected.length > 3 ? ` +${selected.length - 3} more` : '')) : '';
  return (
    <div className="sticky top-2 z-30 mb-3 bg-gray-900 text-white rounded-xl px-4 py-2.5 flex items-center justify-between shadow-xl">
      <div className="flex items-center gap-3 min-w-0">
        {has ? (
          <>
            <span className="bg-rose-600 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">{selected.length} selected</span>
            <span className="text-[12px] text-gray-300 truncate">{names}</span>
            <button onClick={onClear} className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 whitespace-nowrap">Clear</button>
          </>
        ) : (
          <>
            <span className="bg-gray-700 text-gray-300 text-[11px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">Instance actions</span>
            <span className="text-[12px] text-gray-400 truncate">Select instances below to act on them</span>
            <button onClick={onSelectAll} className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold whitespace-nowrap">Select all {total}</button>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onStart} disabled={disabled || !has || allRunning} className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed">
          <FaPlay className="w-2.5 h-2.5"/> Start
        </button>
        <button onClick={onStop} disabled={disabled || !has || !anyRunning} className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed">
          <FaPowerOff className="w-2.5 h-2.5"/> Stop
        </button>
        <button onClick={onExtend} disabled={disabled || !has} className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed">
          <FaClock className="w-2.5 h-2.5"/> Extend
        </button>
        <button onClick={onExport} disabled={disabled || !has} className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed">
          <FaDownload className="w-2.5 h-2.5"/> Export
        </button>
        <button onClick={onDelete} disabled={disabled || !has} className="inline-flex items-center gap-1.5 text-rose-300 hover:bg-rose-500/20 text-[11px] font-semibold px-2.5 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed">
          <FaTrash className="w-2.5 h-2.5"/> Delete
        </button>
      </div>
    </div>
  );
};

/* ===== #6 Smart Search bar ===== */
const SmartSearchBar = ({ raw, setRaw }) => {
  const { chips, free } = parseQuery(raw);
  const removeChip = (c) => {
    const tokens = raw.trim().split(/\s+/).filter(t => t.toLowerCase() !== `${c.key}:${c.val}`.toLowerCase());
    setRaw(tokens.join(' '));
  };
  return (
    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 flex-1 min-w-[280px] max-w-[640px]">
      <FaSearch className="w-3 h-3 text-gray-400 flex-shrink-0"/>
      {chips.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2 py-0.5 text-[11px] font-semibold text-gray-700 whitespace-nowrap">
          <span className="text-rose-600">{c.key}:</span>{c.val}
          <button onClick={() => removeChip(c)} className="text-gray-400 hover:text-rose-600 ml-0.5">×</button>
        </span>
      ))}
      <input
        value={raw} onChange={e => setRaw(e.target.value)}
        placeholder={chips.length ? 'Add filter…' : 'Search · status:running · expires:<2h · email:…'}
        className="flex-1 bg-transparent border-none outline-none text-[12px] text-gray-800 placeholder:text-gray-400 min-w-[180px]"
      />
      {raw && <button onClick={() => setRaw('')} className="text-[10px] text-gray-400 hover:text-rose-600 px-1">clear</button>}
    </div>
  );
};

/* ===== #2 Detail Drawer ===== */
const DetailDrawer = ({ vm, onClose, onAction, onResetPassword, onCapture, onDelete, isSuperAdmin, isAdmin }) => {
  if (!vm) return null;
  const pct = vm?.quota?.total > 0 ? Math.min(100, ((vm.quota.consumed * 60) / vm.quota.total) * 100) : 0;
  const band = quotaBand(pct);
  const qc = quotaColors[band];
  const exp = vm.expiresAt ? new Date(vm.expiresAt) : null;
  const logs = (vm.logs || []).slice(-6).reverse();
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-[480px] max-w-[95vw] bg-white shadow-2xl z-50 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 truncate flex items-center gap-2">
              {vm.name}
              {(() => {
                const lbl = cloudLabelFor(vm.cloud || 'azure', isSuperAdmin ? 'superadmin' : (isAdmin ? 'admin' : 'user'));
                return (
                  <span title={lbl.sub} className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded border ${lbl.chipClass}`}>
                    {lbl.codename}{lbl.sub ? ' · ' + lbl.sub : ''}
                  </span>
                );
              })()}
            </div>
            <div className="text-[12px] text-gray-500 mt-1 truncate">{vm.email || '—'} · {vm.vmSize || vm.os || 'Azure'}</div>
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${vm.isRunning ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${vm.isRunning ? 'bg-green-500' : 'bg-gray-400'}`} />
                {vm.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1">×</button>
        </div>

        {/* Open-instance section — driven by capability flags set at deploy time.
            - Containers always render a browser session (`accessUrl` set).
            - VMs render browser access only when `vm.guacamole === true` (i.e.
              the deploy form opted into browser-based access). If it wasn't
              opted into, customers see native-protocol details instead.
            - SSH/RDP hint is shown when publicIp + credentials exist.
            Azure Portal pivot intentionally removed for customer-facing role. */}
        {(() => {
          const isContainer = vm.type === 'container';
          const browserAvail = isContainer ? !!vm.accessUrl : !!vm.guacamole;
          const isLinux = !(vm.os || '').toLowerCase().includes('windows');
          const nativeProto = isContainer ? null : (isLinux ? 'SSH' : 'RDP');
          const nativeAvail = !isContainer && !!vm.publicIp;
          if (!browserAvail && !nativeAvail) return null;
          return (
            <div className="px-6 py-4 border-b border-gray-50">
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2.5">
                {browserAvail ? 'Open instance' : 'Connect'}
              </div>

              {browserAvail && (
                <button
                  onClick={() => onAction('launch')} disabled={!vm.isRunning}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white rounded-lg py-3 px-4 flex items-center justify-center gap-2 text-[13px] font-semibold disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed">
                  <FaDesktop className="w-4 h-4"/>
                  Open in Browser
                </button>
              )}

              {/* Native-protocol hint — only when the underlying VM exposes it */}
              {nativeAvail && vm.isRunning && (
                <div className={browserAvail ? 'mt-2.5' : ''}>
                  {!browserAvail && (
                    <div className="text-[11px] text-gray-500 mb-2">
                      This instance is configured for direct {nativeProto} access. Use your local {nativeProto} client.
                    </div>
                  )}
                  {nativeProto === 'SSH' ? (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">{browserAvail ? 'Power-user? ' : ''}Native SSH:</span>
                      <button onClick={() => onAction('ssh')}
                        className="font-mono text-gray-700 hover:text-rose-600 underline underline-offset-2">
                        ssh {vm.adminUsername}@{vm.publicIp}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">{browserAvail ? 'Power-user? ' : ''}Native RDP:</span>
                      <span className="font-mono text-gray-700">{vm.publicIp}:3389</span>
                    </div>
                  )}
                </div>
              )}

              {!vm.isRunning && (
                <div className={`text-[11px] text-gray-400 text-center ${browserAvail ? 'mt-2' : ''}`}>
                  Instance is stopped — start it to access
                </div>
              )}
            </div>
          );
        })()}

        {/* Quota */}
        <div className="px-6 py-4 border-b border-gray-50">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2.5">Quota</div>
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-lg font-bold tabular-nums ${qc.text}`}>{pct.toFixed(1)}%</span>
            <span className="text-[11px] text-gray-500 tabular-nums">
              {(vm?.quota?.consumed || 0).toFixed(1)}h used of {((vm?.quota?.total || 0) / 60).toFixed(0)}h
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${qc.fill}`} style={{ width: `${pct}%` }}/>
          </div>
        </div>

        {/* Details */}
        <div className="px-6 py-4 border-b border-gray-50">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2.5">Instance details</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {[
              ['IP address', vm.publicIp, true, null],
              ['Instance size', formatSpecs(vm.vmSize) || vm.vmSize, false, isSuperAdmin ? vm.vmSize : null],
              ['Region', vm.location, false, null],
              ['Username', vm.adminUsername, true, null],
              ['Password', vm.adminPass, true, null],
              ['OS', vm.os || vm.osType, false, null],
              ['Expires', exp ? exp.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—', false, null],
              ...(isSuperAdmin ? [['Resource group', vm.resourceGroup, true, null]] : []),
            ].map(([k, v, mono, sub]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{k}</div>
                <div className={`text-[12px] text-gray-900 font-semibold truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{v || '—'}</div>
                {sub && <div className="text-[10px] font-mono text-gray-400 truncate -mt-0.5">{sub}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Activity */}
        {logs.length > 0 && (
          <div className="px-6 py-4 border-b border-gray-50">
            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2.5">Recent activity</div>
            <ul className="space-y-2">
              {logs.map((l, i) => {
                const t = l.start ? new Date(l.start) : null;
                const dur = l.duration ? `${l.duration}m` : 'open';
                return (
                  <li key={i} className="flex items-start gap-2.5 text-[11px]">
                    <span className="text-gray-400 tabular-nums w-16 flex-shrink-0">{t ? t.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${l.stop ? 'bg-gray-400' : 'bg-green-500'}`}/>
                    <span className="text-gray-700">Session {l.stop ? 'ended' : 'running'} · {dur}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-auto px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-2">
          {(isSuperAdmin || isAdmin) && vm.email && (
            <button onClick={() => onResetPassword(vm)} className="flex-1 text-[11px] font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg py-2 hover:bg-gray-50">
              Reset password
            </button>
          )}
          {isSuperAdmin && (
            <button onClick={() => onCapture(vm.name)} disabled={vm.isRunning} className="flex-1 text-[11px] font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg py-2 hover:bg-gray-50 disabled:opacity-40">
              Snapshot
            </button>
          )}
          {isSuperAdmin && (
            <button onClick={() => { onDelete(vm); onClose(); }} className="flex-1 text-[11px] font-semibold text-red-600 bg-white border border-red-200 rounded-lg py-2 hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      </div>
    </>
  );
};

/* ===== Persisted pending-operation helpers ═════════════════════════════════
 * We used to keep start/stop progress in React state only, so a refresh wiped
 * the progress bar even though the worker kept chugging. Now the in-flight op
 * lives in localStorage (keyed per training), so a refresh rehydrates it and
 * polling resumes where it left off.
 *
 * Shape:  { operation: 'start'|'stop', target: boolean, vmNames: string[],
 *           total: number, startedAt: epochMs, label: string }
 * ===========================================================================*/
const PENDING_OP_KEY = (training) => `vmPendingOp:${training}`;
const PENDING_OP_TTL_MS = 8 * 60 * 1000;   // hard cap — don't show a stuck bar forever

function loadPendingOp(training) {
  if (!training) return null;
  try {
    const raw = localStorage.getItem(PENDING_OP_KEY(training));
    if (!raw) return null;
    const op = JSON.parse(raw);
    if (!op || !op.startedAt || Date.now() - op.startedAt > PENDING_OP_TTL_MS) {
      localStorage.removeItem(PENDING_OP_KEY(training));
      return null;
    }
    return op;
  } catch { return null; }
}
function savePendingOp(training, op) {
  if (!training) return;
  try {
    if (op) localStorage.setItem(PENDING_OP_KEY(training), JSON.stringify(op));
    else localStorage.removeItem(PENDING_OP_KEY(training));
  } catch { /* quota / private mode — fall back to in-memory only */ }
}

/* ===== Main ===== */
const VmDetails = ({ userDetails, selectedTraining, apiRoutes }) => {
  const [aliveVms, setAliveVms] = useState([]);
  const [deadVms, setDeadVms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // #5 sortable headers — default to natural-name asc
  const [sortBy, setSortBy] = useState({ key: 'name', dir: 'asc' });
  // #2 drawer state
  const [drawerVm, setDrawerVm] = useState(null);
  // Density toggle — compact vs comfy
  const [density, setDensity] = useState(() => localStorage.getItem('labConsoleDensity') || 'compact');
  useEffect(() => { try { localStorage.setItem('labConsoleDensity', density); } catch {} }, [density]);
  // pendingOp drives the progress bar *and* per-row "Starting…" chips.
  // Rehydrated from localStorage on training switch so refresh is safe.
  const [pendingOp, setPendingOp] = useState(() => loadPendingOp(selectedTraining));
  const [tick, setTick] = useState(0); // forces re-render for elapsed-seconds display
  const { toast, show, clear } = useToast();

  const filtered = useMemo(() => {
    const q = parseQuery(searchTerm);
    const f = (q.chips.length || q.free.length) ? aliveVms.filter(vm => matchQuery(vm, q)) : aliveVms;
    return sortVms(f, sortBy.key, sortBy.dir);
  }, [aliveVms, searchTerm, sortBy]);

  const sortedDead = useMemo(() => sortVms(deadVms, 'name', 'asc'), [deadVms]);

  const setVmData = useCallback((data) => {
    if (!Array.isArray(data)) return;
    setAliveVms(sortVms(data.filter(vm => vm.isAlive).map(vm => ({ ...vm, selected: false }))));
    setDeadVms(sortVms(data.filter(vm => !vm.isAlive)));
  }, []);

  const getLabsData = useCallback(async () => {
    if (!userDetails?.email || !selectedTraining) return;
    setLoading(true);
    try {
      const res = await apiCaller.get(apiRoutes.machineApi, { params: { trainingName: selectedTraining } });
      if (res?.data) setVmData(res.data);
    } catch (e) { show('Failed to fetch instances', 'error'); }
    finally { setLoading(false); }
  }, [selectedTraining, userDetails?.email, apiRoutes, setVmData, show]);

  // Clear the pending op both in memory and in localStorage. `reason` drives
  // the user-facing toast so "completed" and "timed out" don't look the same.
  const clearPendingOp = useCallback((reason) => {
    setPendingOp((prev) => {
      if (!prev) return null;
      savePendingOp(selectedTraining, null);
      if (reason === 'completed') {
        show(`${prev.operation === 'start' ? 'Started' : 'Stopped'} ${prev.total} ${prev.label}`, 'success');
      } else if (reason === 'timeout') {
        show(`${prev.operation === 'start' ? 'Start' : 'Stop'} is taking longer than expected — check back in a minute`, 'error');
      }
      return null;
    });
  }, [selectedTraining, show]);

  const handleAction = useCallback(async (operation) => {
    if (pendingOp) return show('Another operation is in progress', 'error');

    const sel = aliveVms.filter(vm => vm.selected);
    if (!sel.length) return show('No instances selected', 'error');
    const isStart = operation === 'start';
    if (isStart && sel.some(vm => vm.isRunning)) return show('Some instances are already running', 'error');
    if (!isStart && sel.some(vm => !vm.isRunning)) return show('Some instances are already stopped', 'error');

    const vmSel = sel.filter(v => v.type !== 'container');
    const containerSel = sel.filter(v => v.type === 'container');
    const label = containerSel.length && !vmSel.length ? 'workspaces' : vmSel.length && !containerSel.length ? 'VMs' : 'instances';

    try {
      const promises = [];
      if (vmSel.length) {
        const payload = [{ operation: isStart ? 1 : 0 }, ...vmSel.map(vm => ({ name: vm.name, resourceGroup: vm.resourceGroup }))];
        promises.push(apiCaller.patch(apiRoutes.machineApi, payload));
      }
      if (containerSel.length) {
        const containerIds = containerSel.map(c => c.containerId);
        const endpoint = isStart ? '/containers/start' : '/containers/stop';
        promises.push(apiCaller.patch(endpoint, { containerIds }));
      }
      await Promise.all(promises);

      // Containers flip state server-side immediately — refresh and we're done.
      // Azure VMs are async (queue + Azure API), so we register a pendingOp
      // that the polling effect will watch until the DB reflects the target.
      if (!vmSel.length) {
        await getLabsData();
        show(`${isStart ? 'Started' : 'Stopped'} ${containerSel.length} workspace${containerSel.length > 1 ? 's' : ''}`, 'success');
        return;
      }

      const op = {
        operation,
        target: isStart,
        vmNames: vmSel.map(vm => vm.name),
        total: vmSel.length,
        startedAt: Date.now(),
        label: vmSel.length === 1 ? 'VM' : 'VMs',
      };
      savePendingOp(selectedTraining, op);
      setPendingOp(op);
      if (containerSel.length) setTimeout(getLabsData, 2000);
    } catch (err) {
      // Surface the backend's own message — in particular the 503 from the
      // queue-health guard ("Queue workers are not processing jobs right
      // now…") — so the user sees the real problem instead of a generic
      // "Failed to start VMs".
      const msg = err?.response?.data?.error
        || err?.response?.data?.message
        || err?.message
        || `Failed to ${operation} ${label}`;
      show(msg, 'error');
    }
  }, [pendingOp, aliveVms, apiRoutes, show, getLabsData, selectedTraining]);

  const launchVM = useCallback(async (vm) => {
    if (!vm.isRunning) return show('VM must be running', 'error');
    // NICE DCV path (Hexalabs Edge / AWS) — direct HTTPS to instance:8443, no Guacamole hop
    if (vm.dcv && vm.publicIp) {
      const dcvUrl = vm.dcvPort
        ? 'https://hexalabs.online:' + vm.dcvPort + '/?username=' + encodeURIComponent(vm.adminUsername || 'labuser') + '&password=' + encodeURIComponent(vm.adminPass || '') + '&autoconnect=true'
        : 'https://' + vm.publicIp + ':8443/?username=' + encodeURIComponent(vm.adminUsername || 'labuser') + '&password=' + encodeURIComponent(vm.adminPass || '') + '&autoconnect=true';
      window.open(dcvUrl, '_blank', 'noopener');
      return;
    }
    try {
      show('Opening browser session...', 'success');
      // Check if VM has KasmVNC (port 6901 in training ports or Linux OS)
      const isLinux = !(vm.os || '').toLowerCase().includes('windows');
      const res = await apiCaller.post('/azure/browser-access', {
        vmName: vm.name,
        publicIp: vm.publicIp,
        adminUsername: vm.adminUsername,
        adminPassword: vm.adminPass,
        os: vm.os,
        useVnc: isLinux && vm.kasmVnc, // Only if KasmVNC is installed on the image
        vncPort: 6901,
      });
      window.open(res.data.accessUrl, '_blank', 'noopener');
    } catch {
      // Fallback: direct KasmVNC URL if available, else old Guacamole
      if (vm.kasmVnc) {
        window.open(`http://${vm.publicIp}:6901`, '_blank', 'noopener');
      } else {
        window.open(`https://remote.hexalabs.online/#/?username=${encodeURIComponent(vm.name)}&password=${encodeURIComponent(vm.adminPass)}`, '_blank', 'noopener');
      }
    }
  }, [show]);

  const captureVm = useCallback(async (name) => {
    setLoading(true);
    try { await apiCaller.post(apiRoutes.captureVmApi, { vm: name }); show('Snapshot started', 'success'); }
    catch { show('Snapshot failed', 'error'); }
    finally { setLoading(false); }
  }, [apiRoutes, show]);

  const shadowVm = useCallback(async (vm) => {
    const isWindows = (vm.os || '').toLowerCase().includes('windows');
    const isContainer = vm.type === 'container';

    if (isContainer || !isWindows) {
      // Linux VMs use KasmVNC direct, containers use KasmVNC/ttyd/Webtop.
      // All of these natively support multiple viewers — just open the
      // same URL the student is using. No Guacamole involved.
      if (vm.accessUrl) {
        window.open(vm.accessUrl, '_blank', 'noopener');
        show(`Shadowing ${vm.name} — KasmVNC supports multiple viewers natively`, 'success');
      } else {
        show('No access URL available for this instance', 'error');
      }
      return;
    }

    // Windows VMs use Guacamole RDP — need a sharing profile so the
    // student's session isn't disconnected.
    try {
      show('Creating Guacamole shadow session...', 'success');
      const res = await apiCaller.post(`/admin/shadow/${encodeURIComponent(vm.name)}`);
      if (res.data?.shadowUrl) {
        window.open(res.data.shadowUrl, '_blank', 'noopener');
        show(`Shadowing ${vm.name} via Guacamole (${res.data.readOnly ? 'view-only' : 'full control'})`, 'success');
      } else {
        show('Shadow session created but no URL returned', 'error');
      }
    } catch (err) {
      // Fallback: try opening Guacamole directly (may disconnect student on RDP)
      show(err.response?.data?.message || 'Guacamole shadow failed — trying direct connection', 'error');
    }
  }, [show]);

  const deleteInstance = useCallback(async (vm) => {
    if (!window.confirm(`Delete ${vm.name}? This cannot be undone.`)) return;
    setLoading(true);
    try {
      if (vm.type === 'container') {
        await apiCaller.delete('/containers', { data: { containerIds: [vm.containerId] } });
      } else {
        await apiCaller.delete('/azure/vm', { data: { vmName: vm.name, resourceGroup: vm.resourceGroup } });
      }
      show(`${vm.name} deleted`, 'success');
      await getLabsData();
    } catch { show('Delete failed', 'error'); }
    finally { setLoading(false); }
  }, [show, getLabsData]);

  // Reset a learner's password to Welcome1234! (org-admin or superadmin only).
  // Backend (PATCH /admin/users) is gated by isAdmin + tenant-scoped via orgScope,
  // so org-admins can only hit users in their own organization.
  const resetUserPassword = useCallback(async (vm) => {
    if (!vm?.email) return;
    const ok = window.confirm(`Reset password for ${vm.email}?\n\nNew password will be: Welcome1234!\nShare it with the learner via your usual channel.`);
    if (!ok) return;
    try {
      const res = await apiCaller.patch('/admin/users', { email: vm.email, resetPassword: true });
      alert(res.data?.message || `Password reset for ${vm.email}. New password: Welcome1234!`);
    } catch (e) {
      alert(e.response?.data?.message || `Could not reset password for ${vm.email}.`);
    }
  }, []);


  // #7 inline-edit save for per-VM expiry. PATCH /azure/expiry already
  // supports `vmName`. The datetime-local input gives us "YYYY-MM-DDTHH:mm"
  // in *local* time; convert to ISO via Date constructor (which interprets
  // it as local) for the backend.
  const saveVmExpiry = useCallback(async (vm, localDateStr) => {
    try {
      const iso = new Date(localDateStr).toISOString();
      await apiCaller.patch('/azure/expiry', { vmName: vm.name, expiresAt: iso });
      show(`Expiry updated for ${vm.name}`, 'success');
      getLabsData();
    } catch (e) { show(e.response?.data?.message || 'Could not update expiry', 'error'); }
  }, [show, getLabsData]);

  const toggleAll = useCallback(() => {
    const all = filtered.length > 0 && filtered.every(vm => vm.selected);
    setAliveVms(prev => prev.map(vm => ({ ...vm, selected: !all })));
  }, [filtered]);

  const anySelected = aliveVms.some(vm => vm.selected);
  const allSelected = filtered.length > 0 && filtered.every(vm => vm.selected);
  const running = aliveVms.filter(vm => vm.isRunning).length;
  const stopped = aliveVms.filter(vm => !vm.isRunning).length;
  const showCapture = userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin';

  // ── Derived progress ─────────────────────────────────────────────────────
  // Source of truth is the DB (aliveVms) + pendingOp. Both survive refresh.
  const pendingVmNames = pendingOp ? new Set(pendingOp.vmNames) : null;
  const doneCount = pendingOp
    ? pendingOp.vmNames.filter(n => {
        const v = aliveVms.find(vm => vm.name === n);
        return v && v.isRunning === pendingOp.target;
      }).length
    : 0;
  const progressPct = pendingOp ? Math.round((doneCount / pendingOp.total) * 100) : 0;
  const elapsedSec = pendingOp ? Math.floor((Date.now() - pendingOp.startedAt) / 1000) : 0;
  const opActive = !!pendingOp;

  // Reload VMs when training changes; rehydrate pendingOp from storage for
  // that training (handles both refresh and switching trainings mid-op).
  useEffect(() => {
    if (!selectedTraining) { setAliveVms([]); setDeadVms([]); setPendingOp(null); return; }
    getLabsData();
    setPendingOp(loadPendingOp(selectedTraining));
  }, [selectedTraining, getLabsData]);

  // Polling loop — runs only while a pendingOp exists. Faster cadence than the
  // old 10s setInterval so the progress bar actually moves, and it resyncs
  // after refresh because pendingOp is persisted.
  useEffect(() => {
    if (!pendingOp) return;
    let alive = true;

    // Completion check against the VMs we already have in state
    if (doneCount >= pendingOp.total) { clearPendingOp('completed'); return; }
    if (Date.now() - pendingOp.startedAt > PENDING_OP_TTL_MS) { clearPendingOp('timeout'); return; }

    // First poll runs quickly (3s) — Azure often flips state in well under 30s.
    // Subsequent polls every 5s. A 1s tick keeps the elapsed counter moving.
    const tickId = setInterval(() => alive && setTick(t => t + 1), 1000);
    const firstPoll = setTimeout(() => alive && getLabsData(), 3000);
    const poll = setInterval(() => alive && getLabsData(), 5000);
    return () => { alive = false; clearInterval(tickId); clearInterval(poll); clearTimeout(firstPoll); };
  }, [pendingOp, doneCount, getLabsData, clearPendingOp]);

  if (!selectedTraining) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 flex items-center justify-center mb-4">
          <FaServer className="w-7 h-7 text-blue-400" />
        </div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Select a lab module</h3>
        <p className="text-sm text-gray-500 max-w-xs">Choose a customer and training from the dropdowns above to view and manage lab instances.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toast toast={toast} onClose={clear} />
      {pendingOp && (
        <ProgressBar
          progress={progressPct}
          status={`${doneCount}/${pendingOp.total} ${pendingOp.label} ${pendingOp.target ? 'started' : 'stopped'}`}
          operation={pendingOp.operation}
          label={pendingOp.label}
          elapsedSec={elapsedSec}
          onCancel={elapsedSec > 30 ? () => clearPendingOp() : undefined}
        />
      )}

      {/* #3 Cohort KPI strip */}
      {aliveVms.length > 0 && (
        <KpiStrip
          training={selectedTraining}
          organization={aliveVms[0]?.organization || ''}
          vms={aliveVms}
          dead={deadVms}
          expiresAt={aliveVms.find(v => v.expiresAt)?.expiresAt}
          vmSize={aliveVms[0]?.vmSize}
        />
      )}

      {/* Expiry banner removed 2026-06-06 — KPI strip carries "Cohort expires in".
          The training-wide Extend Expiry button moved to the right toolbar below. */}

      {/* Sticky bulk bar removed 2026-06-06 v3 — replaced by inline action row next
          to VM Settings (below). Extend/Delete were duplicates of the right-rail
          Extend Expiry + per-row trash icon. */}

      {/* Slim toolbar: search + density + utility actions. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* #6 Smart search with chip filters */}
        <SmartSearchBar raw={searchTerm} setRaw={setSearchTerm} />

        {/* Density toggle */}
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          <button onClick={() => setDensity('comfy')}
            className={`text-[10px] font-semibold px-2 py-1 rounded ${density === 'comfy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Comfy</button>
          <button onClick={() => setDensity('compact')}
            className={`text-[10px] font-semibold px-2 py-1 rounded ${density === 'compact' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Compact</button>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {(userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin') && (
            <button
              onClick={async () => {
                const hours = prompt('Extend training expiry by how many hours?', '24');
                if (!hours) return;
                try {
                  await apiCaller.patch('/azure/expiry', { trainingName: selectedTraining, extendHours: parseInt(hours) });
                  show(`Lab extended by ${hours} hours`, 'success');
                  getLabsData();
                } catch { show('Failed to extend', 'error'); }
              }}
              disabled={loading || opActive}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              title="Extend the entire training's expiry"
            >
              <FaClock className="w-2.5 h-2.5" /> Extend Expiry
            </button>
          )}

          <button onClick={() => { if (aliveVms.length) { downloadCsv('vms_all.csv', vmsToCsv(aliveVms)); show('Downloaded', 'success'); } }}
            disabled={loading || opActive || !aliveVms.length}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40" title="Download all VMs as CSV">
            <FaDownload className="w-2.5 h-2.5" /> All
          </button>

          {(userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin') && (
            <button
              onClick={() => {
                apiCaller.get(`/admin/report/${encodeURIComponent(selectedTraining)}`, { responseType: 'blob' })
                  .then(res => {
                    const blob = new Blob([res.data], { type: 'application/pdf' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `lab-report-${selectedTraining}.pdf`;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    show('Report downloaded', 'success');
                  })
                  .catch(() => show('Failed to generate report', 'error'));
              }}
              disabled={loading || opActive}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              title="Download lab activity report + certificates as PDF"
            >
              <FaDownload className="w-2.5 h-2.5" /> Report
            </button>
          )}

          {userDetails?.userType === 'superadmin' && (
            <button
              onClick={() => {
                apiCaller.get(`/admin/usage-report`, {
                  params: { trainingName: selectedTraining, format: 'pdf' },
                  responseType: 'blob',
                })
                  .then(res => {
                    const blob = new Blob([res.data], { type: 'application/pdf' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `usage-report-${selectedTraining}.pdf`;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    show('Usage report downloaded', 'success');
                  })
                  .catch(() => show('Failed to generate usage report', 'error'));
              }}
              disabled={loading || opActive}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-40"
              title="Download B2B usage report with cost breakdown as PDF"
            >
              <FaDownload className="w-2.5 h-2.5" /> Usage Report
            </button>
          )}

          <button onClick={getLabsData} disabled={loading || opActive}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-40 transition-colors" title="Refresh">
            <FaArrowsSpin className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Idle auto-shutdown banner */}
      {aliveVms.some(vm => vm.autoShutdown) && (
        <div className="flex items-center gap-2 px-4 py-2.5 mb-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
          <FaPowerOff className="w-3 h-3 flex-shrink-0" />
          <span className="text-xs font-medium">
            Auto-save enabled: VMs will automatically stop after {aliveVms[0]?.idleMinutes || 15} minutes of inactivity to save costs. Your data is preserved — click Start to resume instantly.
          </span>
        </div>
      )}

      {/* VM Settings — superadmin only */}
      {userDetails?.userType === 'superadmin' && aliveVms.length > 0 && (
        <VmSettingsPanel trainingName={selectedTraining} vms={aliveVms} onUpdate={getLabsData} show={show} />
      )}

      {/* Inline action row — replaces the sticky bulk bar. Lives next to the table
          so users see Start/Stop/Export as first-class affordances; selection
          count + Select-all sit on the right. Per-row Extend (click date) and
          per-row Delete (trash icon) cover the single-VM cases. */}
      {aliveVms.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <button onClick={() => handleAction('start')}
            disabled={!anySelected || loading || opActive || aliveVms.filter(v => v.selected).every(v => v.isRunning)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <FaPlay className="w-2.5 h-2.5" /> Start
          </button>
          <button onClick={() => handleAction('stop')}
            disabled={!anySelected || loading || opActive || !aliveVms.some(v => v.selected && v.isRunning)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <FaPowerOff className="w-2.5 h-2.5" /> Stop
          </button>
          <button onClick={() => {
              const sel = aliveVms.filter(v => v.selected);
              if (sel.length) { downloadCsv('vms_selected.csv', vmsToCsv(sel)); show(`Exported ${sel.length} VMs`, 'success'); }
            }}
            disabled={!anySelected || loading || opActive}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed">
            <FaDownload className="w-2.5 h-2.5" /> Export Selected
          </button>

          <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-500">
            {anySelected ? (
              <>
                <span className="font-semibold text-gray-700">{aliveVms.filter(v => v.selected).length}</span> of {aliveVms.length} selected
                <button onClick={() => setAliveVms(p => p.map(v => ({ ...v, selected: false })))} className="text-rose-600 hover:underline font-semibold">Clear</button>
              </>
            ) : (
              <>
                <span>Select instances to act on them</span>
                <button onClick={() => setAliveVms(p => p.map(v => ({ ...v, selected: true })))} className="text-rose-600 hover:underline font-semibold">Select all</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : aliveVms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white border border-gray-200 rounded-xl" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-50 to-blue-50 border border-gray-200 flex items-center justify-center mb-4">
            <FaServer className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-700">No active instances</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs">This training has no running or stopped instances. Deploy new ones from the Deploy menu, or check the terminated section below.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-gray-200 rounded-xl">
          <FaSearch className="w-5 h-5 text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-600">No results for "{searchTerm}"</p>
          <p className="text-xs text-gray-400 mt-0.5">Try a different search term</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={loading || opActive}
                      className="w-3.5 h-3.5 text-rose-600 rounded border-gray-300" />
                  </th>
                  <SortableTh label="Instance" sortKey="name" sortBy={sortBy} setSortBy={setSortBy} />
                  <SortableTh label="OS" sortKey="os" sortBy={sortBy} setSortBy={setSortBy} />
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Password</th>
                  <SortableTh label="IP Address" sortKey="ip" sortBy={sortBy} setSortBy={setSortBy} />
                  <SortableTh label="Status" sortKey="status" sortBy={sortBy} setSortBy={setSortBy} />
                  <SortableTh label="Expires" sortKey="expires" sortBy={sortBy} setSortBy={setSortBy} />
                  <SortableTh label="Quota" sortKey="quota" sortBy={sortBy} setSortBy={setSortBy} />
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(vm => (
                  <VmRow key={vm._id} vm={vm}
                    transition={pendingVmNames && pendingVmNames.has(vm.name) ? pendingOp.operation : null}
                    onSelect={id => setAliveVms(p => p.map(v => v._id === id ? { ...v, selected: !v.selected } : v))}
                    onLaunch={launchVM} onCapture={captureVm} onDelete={deleteInstance} onShadow={shadowVm} onResetPassword={resetUserPassword}
                    onOpenDrawer={setDrawerVm} onSaveExpiry={saveVmExpiry} density={density}
                    showCapture={showCapture} isSuperAdmin={userDetails?.userType === 'superadmin'} isAdmin={userDetails?.userType === 'admin'} disabled={loading || opActive} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
            {filtered.length} instance{filtered.length !== 1 ? 's' : ''} &middot; {aliveVms.filter(v => v.selected).length} selected
          </div>
        </div>
      )}

      {/* Terminated */}
      {sortedDead.length > 0 && !loading && (
        <div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Terminated</span>
                <span className="text-[10px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">{sortedDead.length}</span>
              </div>
            </div>
            <table className="min-w-full text-[13px]">
              <tbody>
                {sortedDead.map(vm => (
                  <tr key={vm._id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        <span className="font-medium text-gray-500 line-through">{vm.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{vm.os || vm.osType || '-'}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{vm.remarks || 'Terminated'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* #2 Detail Drawer — opens when a row is clicked */}
      <DetailDrawer
        vm={drawerVm}
        onClose={() => setDrawerVm(null)}
        onAction={(act) => {
          if (act === 'launch') launchVM(drawerVm);
          else if (act === 'ssh') window.open(`ssh://${drawerVm.adminUsername}@${drawerVm.publicIp}`, '_blank');
        }}
        onResetPassword={resetUserPassword}
        onCapture={captureVm}
        onDelete={deleteInstance}
        isSuperAdmin={userDetails?.userType === 'superadmin'}
        isAdmin={userDetails?.userType === 'admin'}
      />

      {/* CSS variables for #8 status microbar (inline shadow on each <tr>) */}
      <style>{`
        :root {
          --row-bar-status-on: rgba(34, 197, 94, 0.75);
          --row-bar-status-off: rgba(203, 213, 225, 0.85);
        }
      `}</style>
    </div>
  );
};

/* Note: Terminated rows intentionally show strikethrough names and red "Auto-deleted"
   badges as visual cues that these resources are gone and no longer costing money. */

/* ===== VM Settings Panel (superadmin only) ===== */
function VmSettingsPanel({ trainingName, vms, onUpdate, show }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('training'); // 'training' or specific vmName
  const [autoShutdown, setAutoShutdown] = useState(vms[0]?.autoShutdown ?? true);
  const [idleMinutes, setIdleMinutes] = useState(vms[0]?.idleMinutes || 15);
  const [expiryDate, setExpiryDate] = useState(() => {
    const exp = vms.find(v => v.expiresAt)?.expiresAt;
    return exp ? new Date(exp).toISOString().slice(0, 16) : '';
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { autoShutdown, idleMinutes: parseInt(idleMinutes) || 15 };
      if (expiryDate) body.expiresAt = new Date(expiryDate).toISOString();
      else body.expiresAt = null;

      if (scope === 'training') {
        body.trainingName = trainingName;
      } else {
        body.vmName = scope;
      }

      const r = await apiCaller.patch('/azure/vm-settings', body);
      // Backend returns { message: "Updated N VM(s)" } — surface the real count
      // so admin has concrete proof of how many rows actually changed.
      show(r.data?.message || `Settings updated for ${scope === 'training' ? 'all VMs' : scope}`, 'success');
      onUpdate();
    } catch (err) {
      show('Failed to update settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mb-3">
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <FaServer className="w-2.5 h-2.5" /> VM Settings
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 bg-white border border-gray-200 rounded-xl p-4 space-y-3" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-800 flex items-center gap-2">
          <FaServer className="w-3 h-3 text-blue-500" /> VM Settings
        </h4>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">&times;</button>
      </div>

      {/* Mixed-values indicator: when admin selects "All VMs in training" but
          the VMs have different idleMinutes / autoShutdown values, surface it
          so they don't think they're seeing the existing config and get
          confused. Saving will overwrite all VMs with the selected values. */}
      {scope === 'training' && vms.length > 1 && (() => {
        const idleVals = [...new Set(vms.map(v => v.idleMinutes ?? 15))];
        const autoVals = [...new Set(vms.map(v => v.autoShutdown ?? false))];
        if (idleVals.length <= 1 && autoVals.length <= 1) return null;
        const idleBreakdown = idleVals.length > 1
          ? idleVals.sort((a,b)=>a-b).map(m => `${vms.filter(v => (v.idleMinutes ?? 15) === m).length} × ${m}min`).join(', ')
          : null;
        const autoBreakdown = autoVals.length > 1
          ? `${vms.filter(v => v.autoShutdown).length}/${vms.length} have auto-shutdown enabled`
          : null;
        return (
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-start gap-1.5">
            <span className="text-amber-600 flex-shrink-0">⚠</span>
            <div>
              <span className="font-medium">Mixed values across VMs in this training.</span>
              {idleBreakdown && <span className="block">Idle timeout: {idleBreakdown}</span>}
              {autoBreakdown && <span className="block">Auto-shutdown: {autoBreakdown}</span>}
              <span className="block opacity-75">Saving will set all VMs to the values selected below.</span>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Apply to */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Apply to</label>
          <select value={scope} onChange={e => setScope(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
            <option value="training">All VMs in {trainingName}</option>
            {vms.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </div>

        {/* Auto Shutdown Toggle */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Auto Idle Shutdown</label>
          <div className="flex items-center gap-2 mt-1">
            <button onClick={() => setAutoShutdown(!autoShutdown)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoShutdown ? 'bg-green-500' : 'bg-gray-300'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoShutdown ? 'left-5' : 'left-0.5'}`} />
            </button>
            <span className={`text-xs font-medium ${autoShutdown ? 'text-green-700' : 'text-gray-500'}`}>
              {autoShutdown ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* Idle Minutes */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Idle Timeout (minutes)</label>
          <select value={idleMinutes} onChange={e => setIdleMinutes(+e.target.value)} disabled={!autoShutdown}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-40">
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
        </div>

        {/* Expiry */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Lab Expiry</label>
          <input type="datetime-local" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {expiryDate && (
          <button onClick={() => setExpiryDate('')}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
            Remove Expiry
          </button>
        )}
      </div>
    </div>
  );
}

export default VmDetails;
