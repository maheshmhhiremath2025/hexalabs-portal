import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaDesktop, FaKey, FaUser, FaWifi, FaPlay, FaPowerOff, FaCamera,
  FaServer, FaSearch, FaCopy, FaCheck, FaExternalLinkAlt, FaDocker, FaTrash, FaClock, FaEye
} from 'react-icons/fa';
import { FaArrowsSpin, FaDownload } from 'react-icons/fa6';
import GuidedLabPanel from '../components/GuidedLab/GuidedLabPanel';

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
const extractNumbers = (name) => { const m = name.match(/(\d+)-(\d+)/); if (m) return { a: +m[1], b: +m[2] }; const s = name.match(/\d+/); return { a: s ? +s[0] : 0, b: 0 }; };
const sortVms = (vms) => [...vms].sort((a, b) => { const an = extractNumbers(a.name), bn = extractNumbers(b.name); return an.a !== bn.a ? an.a - bn.a : an.b - bn.b; });

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
const VmRow = ({ vm, onSelect, onLaunch, onCapture, onDelete, onShadow, showCapture, isSuperAdmin, disabled, transition, guidedLab, trainingName, onOpenLabView }) => {
  const pct = vm?.quota?.total > 0 ? Math.min(100, (vm.quota.consumed / vm.quota.total) * 100) : 0;
  // `transition` is "start" or "stop" while a request is in flight for this VM
  // and the DB hasn't caught up yet. We show a pulsing amber chip so users
  // understand that Stop → [Stopping] → Running (or Start → [Starting]) is in
  // progress, instead of thinking nothing happened.
  const isStarting = transition === 'start' && !vm.isRunning;
  const isStopping = transition === 'stop' && vm.isRunning;
  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50/60 transition-colors ${vm.selected ? 'bg-blue-50/40' : ''}`}>
      <td className="px-3 py-2.5">
        <input type="checkbox" checked={vm.selected} onChange={() => onSelect(vm._id)} disabled={disabled}
          className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${vm.isRunning ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-900 truncate max-w-[180px]">{vm.name}</span>
          {vm.type === 'container' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600 uppercase">
              <FaDocker className="w-2 h-2" /> Workspace
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-gray-600">{vm.os || vm.osType || '-'}</td>
      <td className="px-3 py-2.5"><CopyCell icon={FaUser} value={vm.adminUsername} /></td>
      <td className="px-3 py-2.5"><CopyCell icon={FaKey} value={vm.adminPass} /></td>
      <td className="px-3 py-2.5"><CopyCell icon={FaWifi} value={vm.publicIp} iconColor="text-blue-400" /></td>
      <td className="px-3 py-2.5">
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
      </td>
      <td className="px-3 py-2.5">
        {vm.expiresAt ? (() => {
          const exp = new Date(vm.expiresAt);
          const now = new Date();
          const diff = exp - now;
          const expired = diff <= 0;
          const minsLeft = Math.max(0, Math.round(diff / 60000));
          const hrsLeft = Math.floor(minsLeft / 60);
          const daysLeft = Math.floor(hrsLeft / 24);
          const isUrgent = minsLeft <= 60;
          return (
            <div>
              <div className={`text-[11px] font-medium ${expired ? 'text-red-600' : isUrgent ? 'text-amber-600' : 'text-gray-700'}`}>
                {exp.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              <div className={`text-[10px] ${expired ? 'text-red-500 font-semibold' : isUrgent ? 'text-amber-500' : 'text-gray-400'}`}>
                {expired ? 'Expired' : daysLeft > 0 ? `${daysLeft}d ${hrsLeft % 24}h left` : hrsLeft > 0 ? `${hrsLeft}h ${minsLeft % 60}m left` : `${minsLeft}m left`}
              </div>
            </div>
          );
        })() : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-500 tabular-nums w-8">{pct.toFixed(0)}%</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 justify-end">
          {vm.type === 'container' ? (
            guidedLab ? (
              <button
                onClick={() => onOpenLabView(vm)}
                disabled={!vm.isRunning}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                <FaDesktop className="w-2.5 h-2.5" />
                Open Lab
              </button>
            ) : (
              <>
                <a href={vm.accessUrl} target="_blank" rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 pointer-events-none'
                  }`}>
                  <FaDesktop className="w-2.5 h-2.5" />
                  {vm.vncLabel || 'Open Desktop'}
                </a>
                {vm.isRunning && vm.extraAccessUrls?.map(eu => (
                  <a key={eu.hostPort} href={eu.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors">
                    {eu.label}
                  </a>
                ))}
              </>
            )
          ) : (
            <>
              {showCapture && (
                <button onClick={() => onCapture(vm.name)} disabled={vm.isRunning || disabled}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30 transition-colors" title="Snapshot">
                  <FaCamera className="w-3 h-3" />
                </button>
              )}
              <button onClick={() => onLaunch(vm)} disabled={!vm.isRunning || disabled}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                <FaDesktop className="w-2.5 h-2.5" />
                {guidedLab ? 'Open Lab' : 'Open in Browser'}
              </button>
            </>
          )}
          {showCapture && vm.isRunning && (
            <button onClick={() => onShadow && onShadow(vm)} disabled={disabled}
              className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors" title="Shadow — view student's live screen">
              <FaEye className="w-3 h-3" />
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
  const navigate = useNavigate();
  const [aliveVms, setAliveVms] = useState([]);
  const [deadVms, setDeadVms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // pendingOp drives the progress bar *and* per-row "Starting…" chips.
  // Rehydrated from localStorage on training switch so refresh is safe.
  const [pendingOp, setPendingOp] = useState(() => loadPendingOp(selectedTraining));
  const [tick, setTick] = useState(0); // forces re-render for elapsed-seconds display
  const [guidedLab, setGuidedLab] = useState(null);
  const { toast, show, clear } = useToast();

  // Navigate to LabView (split view: desktop iframe + Lab Guide)
  const openLabView = useCallback((vm) => {
    const url = vm.accessUrl || '';
    const params = new URLSearchParams({
      url, training: selectedTraining, instance: vm.name,
    });
    if (vm.vncLabel) params.set('vncLabel', vm.vncLabel);
    if (vm.extraAccessUrls?.length) params.set('extraUrls', JSON.stringify(vm.extraAccessUrls));
    navigate(`/lab-view?${params.toString()}`);
  }, [navigate, selectedTraining]);

  const filtered = useMemo(() => {
    let f = aliveVms;
    if (searchTerm) f = f.filter(vm => vm.name?.toLowerCase().includes(searchTerm.toLowerCase()) || vm.os?.toLowerCase().includes(searchTerm.toLowerCase()));
    return sortVms(f);
  }, [aliveVms, searchTerm]);

  const sortedDead = useMemo(() => sortVms(deadVms), [deadVms]);

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
      // If guided lab exists, open in LabView split-view instead of new tab
      if (guidedLab && res.data.accessUrl) {
        navigate(`/lab-view?url=${encodeURIComponent(res.data.accessUrl)}&training=${encodeURIComponent(selectedTraining)}&instance=${encodeURIComponent(vm.name)}`);
      } else {
        window.open(res.data.accessUrl, '_blank', 'noopener');
      }
    } catch {
      // Fallback: direct KasmVNC URL if available, else old Guacamole
      const fallbackUrl = vm.kasmVnc
        ? `http://${vm.publicIp}:6901`
        : `https://labs.synergificsoftware.com/#/?username=${encodeURIComponent(vm.name)}&password=${encodeURIComponent(vm.adminPass)}`;
      if (guidedLab) {
        navigate(`/lab-view?url=${encodeURIComponent(fallbackUrl)}&training=${encodeURIComponent(selectedTraining)}&instance=${encodeURIComponent(vm.name)}`);
      } else {
        window.open(fallbackUrl, '_blank', 'noopener');
      }
    }
  }, [show, guidedLab, navigate, selectedTraining]);

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
    // Fetch guided lab linked to this training
    apiCaller.get(`/guided-labs/by-training/${selectedTraining}`)
      .then(res => setGuidedLab(res.data || null))
      .catch(() => setGuidedLab(null));
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
    <div>
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

      {/* Expiry banner */}
      {(() => {
        const firstExpiry = aliveVms.find(vm => vm.expiresAt);
        if (!firstExpiry) return null;
        const exp = new Date(firstExpiry.expiresAt);
        const now = new Date();
        const minsLeft = Math.max(0, Math.round((exp - now) / 60000));
        const hoursLeft = Math.floor(minsLeft / 60);
        const isUrgent = minsLeft <= 60;
        const isExpired = minsLeft <= 0;
        return (
          <div className={`mb-4 p-3 rounded-lg flex items-center justify-between ${isExpired ? 'bg-red-50 border border-red-200' : isUrgent ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200'}`}>
            <div className="flex items-center gap-2">
              <FaClock className={`w-3.5 h-3.5 ${isExpired ? 'text-red-500' : isUrgent ? 'text-amber-500' : 'text-blue-500'}`} />
              <span className={`text-sm font-medium ${isExpired ? 'text-red-700' : isUrgent ? 'text-amber-700' : 'text-blue-700'}`}>
                {isExpired ? 'Lab expired — resources being cleaned up'
                  : isUrgent ? `Lab expires in ${minsLeft} minutes`
                  : `Lab expires on ${exp.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST (${hoursLeft}h ${minsLeft % 60}m left)`}
              </span>
            </div>
            {!isExpired && (userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin') && (
              <button
                onClick={async () => {
                  const hours = prompt('Extend by how many hours?', '24');
                  if (!hours) return;
                  try {
                    await apiCaller.patch('/azure/expiry', { trainingName: selectedTraining, extendHours: parseInt(hours) });
                    show(`Lab extended by ${hours} hours`, 'success');
                    getLabsData();
                  } catch { show('Failed to extend', 'error'); }
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
              >
                Extend Expiry
              </button>
            )}
          </div>
        );
      })()}

      {/* Stats + Actions bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-100 rounded-md">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-xs font-semibold text-green-800">{running}</span>
            <span className="text-[11px] text-green-600">running</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            <span className="text-xs font-semibold text-gray-800">{stopped}</span>
            <span className="text-[11px] text-gray-500">stopped</span>
          </div>
          {deadVms.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-100 rounded-md">
              <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-xs font-semibold text-red-800">{deadVms.length}</span>
              <span className="text-[11px] text-red-500">terminated</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
            <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50 w-40 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" disabled={loading || opActive} />
          </div>

          <div className="h-6 w-px bg-gray-200" />

          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-1 py-0.5">
            <button onClick={() => setAliveVms(p => p.map(vm => ({ ...vm, selected: !!vm.isRunning })))} disabled={loading || opActive}
              className="text-[11px] font-medium text-green-600 hover:bg-green-50 px-2 py-1 rounded disabled:opacity-40">Active</button>
            <button onClick={() => setAliveVms(p => p.map(vm => ({ ...vm, selected: !vm.isRunning })))} disabled={loading || opActive}
              className="text-[11px] font-medium text-gray-600 hover:bg-gray-100 px-2 py-1 rounded disabled:opacity-40">Stopped</button>
            <button onClick={toggleAll} disabled={loading || opActive}
              className="text-[11px] font-medium text-blue-600 hover:bg-blue-50 px-2 py-1 rounded disabled:opacity-40">{allSelected ? 'None' : 'All'}</button>
          </div>

          <div className="h-6 w-px bg-gray-200" />

          <button onClick={() => { if (aliveVms.length) { downloadCsv('vms_all.csv', vmsToCsv(aliveVms)); show('Downloaded', 'success'); } }}
            disabled={loading || opActive || !aliveVms.length}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40" title="Download all">
            <FaDownload className="w-2.5 h-2.5" /> All
          </button>
          <button onClick={() => { const s = aliveVms.filter(vm => vm.selected); if (s.length) { downloadCsv('vms_selected.csv', vmsToCsv(s)); show('Downloaded', 'success'); } }}
            disabled={!anySelected || loading || opActive}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40" title="Download selected">
            <FaDownload className="w-2.5 h-2.5" /> Selected
          </button>

          {(userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin') && (
          <>
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
          </>
          )}

          <div className="h-6 w-px bg-gray-200" />

          <button onClick={() => handleAction('start')} disabled={!anySelected || loading || opActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors">
            <FaPlay className="w-2.5 h-2.5" /> Start
          </button>
          <button onClick={() => handleAction('stop')} disabled={!anySelected || loading || opActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 transition-colors">
            <FaPowerOff className="w-2.5 h-2.5" /> Stop
          </button>

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
                      className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" />
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Instance</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">OS</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Password</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">IP Address</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Expires</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Quota</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(vm => (
                  <VmRow key={vm._id} vm={vm}
                    transition={pendingVmNames && pendingVmNames.has(vm.name) ? pendingOp.operation : null}
                    onSelect={id => setAliveVms(p => p.map(v => v._id === id ? { ...v, selected: !v.selected } : v))}
                    onLaunch={launchVM} onCapture={captureVm} onDelete={deleteInstance} onShadow={shadowVm} showCapture={showCapture} isSuperAdmin={userDetails?.userType === 'superadmin'} disabled={loading || opActive}
                    guidedLab={guidedLab} trainingName={selectedTraining} onOpenLabView={openLabView} />
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
    </div>
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
