import React, { useEffect, useState, useCallback, useMemo } from 'react';
import apiCaller from '../services/apiCaller';
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
const ProgressBar = ({ progress, status, operation, label }) => (
  <div className="fixed top-4 right-4 z-50 bg-white rounded-lg border border-gray-200 shadow-xl p-4 w-72">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-semibold text-gray-800">
        {operation === 'start' ? `Starting ${label || 'instances'}...` : operation === 'stop' ? `Stopping ${label || 'instances'}...` : 'Processing...'}
      </span>
      <span className="text-xs font-medium text-gray-500 tabular-nums">{progress}%</span>
    </div>
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${operation === 'start' ? 'bg-green-500' : operation === 'stop' ? 'bg-red-500' : 'bg-blue-500'}`}
        style={{ width: `${progress}%` }}
      />
    </div>
    <p className="text-xs text-gray-500 mt-1.5">{status}</p>
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

/* ===== VM Row ===== */
const VmRow = ({ vm, onSelect, onLaunch, onCapture, onDelete, onShadow, showCapture, isSuperAdmin, disabled }) => {
  const pct = vm?.quota?.total > 0 ? Math.min(100, (vm.quota.consumed / vm.quota.total) * 100) : 0;
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
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
          vm.isRunning ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${vm.isRunning ? 'bg-green-500' : 'bg-gray-400'}`} />
          {vm.isRunning ? 'Running' : 'Stopped'}
        </span>
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
              <button onClick={() => onLaunch(vm)} disabled={!vm.isRunning || disabled}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  vm.isRunning ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                <FaDesktop className="w-2.5 h-2.5" />
                Open in Browser
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

/* ===== Main ===== */
const VmDetails = ({ userDetails, selectedTraining, apiRoutes }) => {
  const [aliveVms, setAliveVms] = useState([]);
  const [deadVms, setDeadVms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [opProgress, setOpProgress] = useState({ show: false, progress: 0, status: '', operation: '' });
  const { toast, show, clear } = useToast();

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

  const monitorOp = useCallback(async (selected, op, target) => {
    let done = 0, checks = 0;
    const iv = setInterval(async () => {
      try {
        const res = await apiCaller.get(apiRoutes.machineApi, { params: { trainingName: selectedTraining } });
        if (res?.data) {
          const cur = res.data.filter(vm => vm.isAlive);
          done = selected.filter(s => { const c = cur.find(vm => vm.name === s.name); return c && c.isRunning === target; }).length;
          checks++;
          setOpProgress(p => ({ ...p, progress: Math.round((done / selected.length) * 100), status: `${done}/${selected.length} instances ${target ? 'started' : 'stopped'}` }));
          if (done === selected.length || checks >= 30) {
            clearInterval(iv);
            setTimeout(() => { setOpProgress({ show: false, progress: 0, status: '', operation: '' }); getLabsData(); show(`${op} completed`, 'success'); }, 800);
          }
        }
      } catch { clearInterval(iv); setOpProgress({ show: false, progress: 0, status: '', operation: '' }); }
    }, 10000);
  }, [selectedTraining, apiRoutes, getLabsData, show]);

  const handleAction = useCallback(async (operation) => {
    const sel = aliveVms.filter(vm => vm.selected);
    if (!sel.length) return show('No instances selected', 'error');
    const isStart = operation === 'start';
    if (isStart && sel.some(vm => vm.isRunning)) return show('Some instances are already running', 'error');
    if (!isStart && sel.some(vm => !vm.isRunning)) return show('Some instances are already stopped', 'error');

    // Split into VMs and containers
    const vmSel = sel.filter(v => v.type !== 'container');
    const containerSel = sel.filter(v => v.type === 'container');
    const label = containerSel.length && !vmSel.length ? 'workspaces' : vmSel.length && !containerSel.length ? 'VMs' : 'instances';

    setOpProgress({ show: true, progress: 0, status: 'Initiating...', operation, label });

    try {
      const promises = [];

      // Handle Azure VMs
      if (vmSel.length) {
        const payload = [{ operation: isStart ? 1 : 0 }, ...vmSel.map(vm => ({ name: vm.name, resourceGroup: vm.resourceGroup }))];
        promises.push(apiCaller.patch(apiRoutes.machineApi, payload));
      }

      // Handle containers — instant, no polling needed
      if (containerSel.length) {
        const containerIds = containerSel.map(c => c.containerId);
        const endpoint = isStart ? '/containers/start' : '/containers/stop';
        promises.push(apiCaller.patch(endpoint, { containerIds }));
      }

      await Promise.all(promises);

      // If only containers, complete immediately (no Azure polling needed)
      if (!vmSel.length) {
        setOpProgress({ show: false, progress: 0, status: '', operation: '' });
        await getLabsData();
        show(`${isStart ? 'Started' : 'Stopped'} ${containerSel.length} workspace${containerSel.length > 1 ? 's' : ''}`, 'success');
      } else {
        // Poll for Azure VMs
        monitorOp(vmSel, isStart ? 'Start' : 'Stop', isStart);
        // If mixed, also refresh to pick up container changes
        if (containerSel.length) setTimeout(getLabsData, 2000);
      }
    } catch {
      setOpProgress({ show: false, progress: 0, status: '', operation: '' });
      show(`Failed to ${operation} ${label}`, 'error');
    }
  }, [aliveVms, apiRoutes, show, monitorOp, getLabsData]);

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
      window.open(res.data.accessUrl, '_blank', 'noopener');
    } catch {
      // Fallback: direct KasmVNC URL if available, else old Guacamole
      if (vm.kasmVnc) {
        window.open(`http://${vm.publicIp}:6901`, '_blank', 'noopener');
      } else {
        window.open(`https://labs.synergificsoftware.com/#/?username=${encodeURIComponent(vm.name)}&password=${encodeURIComponent(vm.adminPass)}`, '_blank', 'noopener');
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

  const toggleAll = useCallback(() => {
    const all = filtered.length > 0 && filtered.every(vm => vm.selected);
    setAliveVms(prev => prev.map(vm => ({ ...vm, selected: !all })));
  }, [filtered]);

  const anySelected = aliveVms.some(vm => vm.selected);
  const allSelected = filtered.length > 0 && filtered.every(vm => vm.selected);
  const running = aliveVms.filter(vm => vm.isRunning).length;
  const stopped = aliveVms.filter(vm => !vm.isRunning).length;
  const showCapture = userDetails?.userType === 'superadmin' || userDetails?.userType === 'admin';
  const opActive = opProgress.show;

  useEffect(() => { selectedTraining ? getLabsData() : (setAliveVms([]), setDeadVms([])); }, [selectedTraining, getLabsData]);

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
      {opProgress.show && <ProgressBar {...opProgress} />}

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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-2">
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
                  <VmRow key={vm._id} vm={vm} onSelect={id => setAliveVms(p => p.map(v => v._id === id ? { ...v, selected: !v.selected } : v))}
                    onLaunch={launchVM} onCapture={captureVm} onDelete={deleteInstance} onShadow={shadowVm} showCapture={showCapture} isSuperAdmin={userDetails?.userType === 'superadmin'} disabled={loading || opActive} />
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
  );
};

/* Note: Terminated rows intentionally show strikethrough names and red "Auto-deleted"
   badges as visual cues that these resources are gone and no longer costing money. */

export default VmDetails;
