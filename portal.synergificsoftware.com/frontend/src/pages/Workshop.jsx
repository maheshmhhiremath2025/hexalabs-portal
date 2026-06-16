import React, { useState, useEffect, useMemo, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import {
  FaServer, FaRocket, FaSearch, FaSpinner, FaCheckCircle, FaTimes,
  FaPlus, FaExpandArrowsAlt, FaHdd, FaCamera, FaTrash, FaExternalLinkAlt,
  FaUbuntu, FaRedhat, FaWindows, FaInfoCircle, FaExclamationTriangle,
} from 'react-icons/fa';

// Workshop · Trainer-built template builder. Phase 5 frontend page.
// Talks to /workshop/* backend (gated by WORKSHOP_ENABLED env flag).
// Mockup reference: workshop-mockup.html — same look, real wiring.

const REFRESH_INTERVAL_MS = 8000;
const HOST = window.location.host.replace(/^www\./, '').replace(/^api\./, '');
// Build the public DCV URL the same way Lab Console does: hexalabs.online:<dcvPort>
function dcvUrlFor(vm) {
  if (!vm.dcvPort) return null;
  return `https://${HOST}:${vm.dcvPort}/?username=labuser&password=Welcome1234!&autoconnect=true`;
}

// Decide pill color from server-driven remarks/state.
function statusPill(vm) {
  const r = (vm.remarks || '').toLowerCase();
  if (r.includes('failed')) return { label: vm.remarks, cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200', dot: 'bg-rose-500' };
  if (r.endsWith('…')) return { label: vm.remarks, cls: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200', dot: 'bg-indigo-500 animate-pulse' };
  if (vm.isRunning) return { label: 'Running', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500' };
  if (vm.isAlive) return { label: vm.remarks || 'Stopped', cls: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' };
  return { label: vm.remarks || 'Terminated', cls: 'bg-red-50 text-red-600', dot: 'bg-red-400' };
}

function sizeLabel(sizeId, sizes) {
  const s = sizes.find(x => x.id === sizeId);
  return s ? `${s.vcpu} vCPU · ${s.ramGB} GB` : sizeId;
}

export default function Workshop() {
  const [bases, setBases] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [diskRange, setDiskRange] = useState({ min: 40, max: 500, default: 100 });
  const [builds, setBuilds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [error, setError] = useState(null);
  const [showBuild, setShowBuild] = useState(false);
  const [resizeVm, setResizeVm] = useState(null);
  const [growVm, setGrowVm] = useState(null);
  const [snapVm, setSnapVm] = useState(null);

  // -------- data loading --------
  const loadCatalog = useCallback(async () => {
    try {
      const res = await apiCaller.get('/workshop/bases');
      setBases(res.data?.bases || []);
      setSizes(res.data?.sizes || []);
      setDiskRange(res.data?.diskRange || { min: 40, max: 500, default: 100 });
    } catch (err) {
      setError(`Catalog: ${err?.response?.data?.message || err.message}`);
    }
  }, []);

  const loadBuilds = useCallback(async () => {
    try {
      const res = await apiCaller.get('/workshop/my-builds');
      setBuilds(res.data?.builds || []);
    } catch (err) {
      if (err?.response?.status === 404) setError('Workshop is disabled on this portal.');
      else setError(`Builds: ${err?.response?.data?.message || err.message}`);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadCatalog(), loadBuilds()]);
      setLoading(false);
    })();
    const id = setInterval(loadBuilds, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadCatalog, loadBuilds]);

  // -------- KPIs --------
  const kpis = useMemo(() => ({
    active: builds.filter(b => b.isAlive).length,
    running: builds.filter(b => b.isRunning).length,
    totalHours: Math.round(builds.reduce((s, b) => s + (b.logs?.reduce((ss, l) => ss + (l.duration || 0), 0) || 0), 0) / 60),
  }), [builds]);

  // -------- filtered list --------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return builds.filter(b => {
      if (q && !b.name.toLowerCase().includes(q) && !(b.targetTemplateName || '').toLowerCase().includes(q)) return false;
      if (filterStatus === 'running' && !b.isRunning) return false;
      if (filterStatus === 'stopped' && b.isRunning) return false;
      if (filterStatus === 'inprogress' && !(b.remarks || '').endsWith('…')) return false;
      return true;
    });
  }, [builds, search, filterStatus]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <FaRocket className="text-indigo-600" /> Workshop
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Build and customize lab templates. Pick a base, size it, configure it inside the browser, snapshot it.
          </p>
        </div>
        <button
          onClick={() => setShowBuild(true)}
          className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2">
          <FaPlus /> Build a Template
        </button>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-center gap-2">
          <FaExclamationTriangle /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700"><FaTimes /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Kpi label="Active builds" value={kpis.active} color="text-indigo-700" />
        <Kpi label="Running" value={kpis.running} color="text-emerald-700" />
        <Kpi label="Build hours" value={kpis.totalHours} color="text-amber-700" />
        <Kpi label="Bases available" value={bases.length} color="text-rose-700" />
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by VM or template name…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="text-sm px-3 py-2 border border-gray-200 rounded-md">
          <option value="all">All status</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
          <option value="inprogress">In progress</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" />Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
          <FaRocket className="mx-auto text-3xl text-gray-300 mb-3" />
          <div className="text-base font-medium mb-1">No build VMs yet</div>
          <div className="text-sm text-gray-400">Click <strong>Build a Template</strong> to start.</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Build VM</th>
                <th className="text-left px-4 py-3">Base</th>
                <th className="text-left px-4 py-3">Size</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(vm => {
                const pill = statusPill(vm);
                const dcv = dcvUrlFor(vm);
                const baseObj = bases.find(b => b.id === vm.templateName) || {};
                return (
                  <tr key={vm.name} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{vm.name}</div>
                      <div className="text-[11px] text-gray-500">→ {vm.targetTemplateName || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <div className="flex items-center gap-2">
                        {baseObj.id === 'ubuntu22' && <FaUbuntu className="text-orange-500" />}
                        {baseObj.id === 'rocky9' && <FaRedhat className="text-emerald-600" />}
                        {baseObj.id === 'windows2022' && <FaWindows className="text-sky-600" />}
                        <span>{baseObj.name || vm.templateName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{sizeLabel(vm.vmSize, sizes)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} /> {pill.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1 justify-end">
                        {dcv && vm.isRunning && (
                          <a href={dcv} target="_blank" rel="noreferrer"
                             className="text-xs px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium inline-flex items-center gap-1">
                            <FaExternalLinkAlt /> Open
                          </a>
                        )}
                        <button onClick={() => setResizeVm(vm)} disabled={!vm.isRunning}
                          className="text-xs px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-30 inline-flex items-center gap-1">
                          <FaExpandArrowsAlt /> Resize
                        </button>
                        <button onClick={() => setGrowVm(vm)} disabled={!vm.isRunning}
                          className="text-xs px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 disabled:opacity-30 inline-flex items-center gap-1">
                          <FaHdd /> Grow
                        </button>
                        <button onClick={() => setSnapVm(vm)} disabled={!vm.isRunning}
                          className="text-xs px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium disabled:opacity-30 inline-flex items-center gap-1">
                          <FaCamera /> Snapshot
                        </button>
                        <DeleteButton vm={vm} onDone={loadBuilds} setError={setError} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-4">
        Build VMs are charged while active. Auto-stop on idle. Limit 5 active build VMs per trainer. Disk shrink not supported — delete and recreate if you need a smaller size.
      </p>

      {showBuild && <BuildModal bases={bases} sizes={sizes} diskRange={diskRange} onClose={() => setShowBuild(false)} onDone={() => { setShowBuild(false); loadBuilds(); }} setError={setError} />}
      {resizeVm && <ResizeModal vm={resizeVm} sizes={sizes} onClose={() => setResizeVm(null)} onDone={() => { setResizeVm(null); loadBuilds(); }} setError={setError} />}
      {growVm && <GrowDiskModal vm={growVm} diskRange={diskRange} onClose={() => setGrowVm(null)} onDone={() => { setGrowVm(null); loadBuilds(); }} setError={setError} />}
      {snapVm && <SnapshotModal vm={snapVm} onClose={() => setSnapVm(null)} onDone={() => { setSnapVm(null); loadBuilds(); }} setError={setError} />}
    </div>
  );
}

// ---------- Subcomponents ----------

function Kpi({ label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function DeleteButton({ vm, onDone, setError }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    if (!confirm(`Delete build VM ${vm.name}? This terminates the EC2 instance. Cannot be undone.`)) return;
    setBusy(true);
    try {
      await apiCaller.delete(`/workshop/${encodeURIComponent(vm.name)}`);
      onDone();
    } catch (err) {
      setError(`Delete: ${err?.response?.data?.message || err.message}`);
    }
    setBusy(false);
  };
  return (
    <button onClick={click} disabled={busy}
      className="text-xs px-2 py-1 rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-30 inline-flex items-center gap-1">
      {busy ? <FaSpinner className="animate-spin" /> : <FaTrash />} Delete
    </button>
  );
}

// ---------- Modals ----------

function ModalShell({ title, children, onClose, footer }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl w-[540px] max-w-[92vw] overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><FaTimes /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function BuildModal({ bases, sizes, diskRange, onClose, onDone, setError }) {
  const [name, setName] = useState('');
  const [baseId, setBaseId] = useState(bases[0]?.id || '');
  const [sizeId, setSizeId] = useState(sizes[0]?.id || '');
  const [disk, setDisk] = useState(diskRange.default);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name || name.length < 3) { setError('Template name must be ≥ 3 chars'); return; }
    setBusy(true);
    try {
      await apiCaller.post('/workshop/build', { baseId, sizeId, diskSizeGB: Number(disk), targetTemplateName: name });
      onDone();
    } catch (err) {
      setError(`Build: ${err?.response?.data?.message || err.message}`);
    }
    setBusy(false);
  };
  const size = sizes.find(s => s.id === sizeId);
  return (
    <ModalShell title="Build a Template" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
          {busy && <FaSpinner className="animate-spin" />} Build VM
        </button>
      </>
    }>
      <Note>You'll get a live VM. Install software, configure settings, customize. When ready, click <strong>Snapshot as Template</strong> from the table to register it.</Note>

      <Field label="Template name">
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. devops-toolkit-v2" />
        <div className="hint">Becomes the name learners see in the Deploy catalog. Lowercase letters, digits, hyphens.</div>
      </Field>

      <Field label="Base OS">
        <select className="input" value={baseId} onChange={e => setBaseId(e.target.value)}>
          {bases.map(b => <option key={b.id} value={b.id}>{b.name} — {b.description}</option>)}
        </select>
      </Field>

      <Field label="Initial size — you can resize anytime">
        <SizeGrid sizes={sizes} value={sizeId} onChange={setSizeId} />
      </Field>

      <Field label={`Disk (${diskRange.min}-${diskRange.max} GB)`}>
        <input type="number" min={diskRange.min} max={diskRange.max} className="input"
               value={disk} onChange={e => setDisk(Math.min(Math.max(Number(e.target.value || 0), diskRange.min), diskRange.max))} />
      </Field>

      <CostPreview rows={[
        ['Build VM rate', size ? `₹${size.pricePerDay} / day` : '—'],
        ['Auto-stops when idle — only billed while active', '~₹15 / day actual (avg)'],
      ]} />
    </ModalShell>
  );
}

function ResizeModal({ vm, sizes, onClose, onDone, setError }) {
  const [sizeId, setSizeId] = useState(vm.vmSize);
  const [busy, setBusy] = useState(false);
  const current = sizes.find(s => s.id === vm.vmSize);
  const next = sizes.find(s => s.id === sizeId);
  const submit = async () => {
    if (sizeId === vm.vmSize) { setError('Pick a different size'); return; }
    setBusy(true);
    try {
      await apiCaller.post(`/workshop/${encodeURIComponent(vm.name)}/resize`, { sizeId });
      onDone();
    } catch (err) {
      setError(`Resize: ${err?.response?.data?.message || err.message}`);
    }
    setBusy(false);
  };
  const delta = current && next ? next.pricePerDay - current.pricePerDay : 0;
  return (
    <ModalShell title={`Resize ${vm.name}`} onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
          {busy && <FaSpinner className="animate-spin" />} Stop &amp; Resize
        </button>
      </>
    }>
      <Warn>VM will stop briefly (~2-3 min) during resize. Disk preserved, no data loss. Auto-starts after.</Warn>
      <Field label="Current size">
        <div className="px-3 py-2 bg-gray-50 rounded-md font-semibold text-sm">{current ? `${current.vcpu} vCPU · ${current.ramGB} GB` : vm.vmSize}</div>
      </Field>
      <Field label="New size">
        <SizeGrid sizes={sizes} value={sizeId} onChange={setSizeId} />
      </Field>
      <CostPreview rows={[
        ['Current rate', current ? `₹${current.pricePerDay} / day` : '—'],
        ['New rate', next ? `₹${next.pricePerDay} / day` : '—'],
        ['Delta', delta === 0 ? '—' : `${delta > 0 ? '+' : ''}₹${delta} / day`],
      ]} />
    </ModalShell>
  );
}

function GrowDiskModal({ vm, diskRange, onClose, onDone, setError }) {
  const [size, setSize] = useState(diskRange.default + 50);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await apiCaller.post(`/workshop/${encodeURIComponent(vm.name)}/grow-disk`, { newSizeGB: Number(size) });
      onDone();
    } catch (err) {
      setError(`Grow disk: ${err?.response?.data?.message || err.message}`);
    }
    setBusy(false);
  };
  return (
    <ModalShell title={`Grow Disk — ${vm.name}`} onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
          {busy && <FaSpinner className="animate-spin" />} Grow to {size} GB
        </button>
      </>
    }>
      <Note><strong>Online — no downtime.</strong> Takes ~30 sec. Partition extended inside OS. <strong>Disk shrink not supported.</strong></Note>
      <Field label={`New size (GB), ${diskRange.min}-${diskRange.max}`}>
        <input type="number" min={diskRange.min} max={diskRange.max} className="input"
               value={size} onChange={e => setSize(Math.min(Math.max(Number(e.target.value || 0), diskRange.min), diskRange.max))} />
      </Field>
    </ModalShell>
  );
}

function SnapshotModal({ vm, onClose, onDone, setError }) {
  const [name, setName] = useState(vm.targetTemplateName || '');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState('private');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name || name.length < 3) { setError('Template name ≥ 3 chars'); return; }
    setBusy(true);
    try {
      await apiCaller.post(`/workshop/${encodeURIComponent(vm.name)}/snapshot`, {
        templateName: name, description: desc, visibility: vis,
      });
      onDone();
    } catch (err) {
      setError(`Snapshot: ${err?.response?.data?.message || err.message}`);
    }
    setBusy(false);
  };
  return (
    <ModalShell title="Snapshot as Template" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={busy}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2">
          {busy && <FaSpinner className="animate-spin" />} Create Template
        </button>
      </>
    }>
      <Warn>Cleanup (bash history, machine-id, SSH keys, package cache) → stop → snapshot → register → terminate build VM. Takes 5-8 minutes.</Warn>
      <Field label="Template name (final)">
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's inside this template" />
      </Field>
      <Field label="Visibility">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'private', name: 'Private', sub: 'Only you can deploy' },
            { id: 'org', name: 'Org Shared', sub: 'Anyone in your org' },
            { id: 'global', name: 'Submit Global', sub: 'Hexalabs approval' },
          ].map(o => (
            <button key={o.id} onClick={() => setVis(o.id)} type="button"
              className={`text-left px-3 py-2 rounded-md border transition ${vis === o.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
              <div className="font-semibold text-sm">{o.name}</div>
              <div className="text-xs text-gray-500">{o.sub}</div>
            </button>
          ))}
        </div>
      </Field>
    </ModalShell>
  );
}

// ---------- Atomic UI ----------

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs uppercase tracking-wider text-gray-600 font-semibold mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Note({ children }) {
  return (
    <div className="mb-4 p-3 rounded-md bg-indigo-50 border border-indigo-200 text-xs text-indigo-800 flex gap-2 items-start">
      <FaInfoCircle className="mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Warn({ children }) {
  return (
    <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2 items-start">
      <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function CostPreview({ rows }) {
  return (
    <div className="mt-2 p-3 rounded-md bg-gray-50 border-l-2 border-indigo-500 text-xs">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex justify-between py-0.5"><span className="text-gray-600">{k}</span><span className="font-semibold text-gray-800">{v}</span></div>
      ))}
    </div>
  );
}

function SizeGrid({ sizes, value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {sizes.map(s => (
        <button key={s.id} type="button" onClick={() => onChange(s.id)}
          className={`text-left px-3 py-2 rounded-md border transition ${value === s.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}>
          <div className="font-semibold text-sm">{s.vcpu} vCPU · {s.ramGB} GB</div>
          <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">₹{s.pricePerDay} / day</div>
        </button>
      ))}
    </div>
  );
}

// Tiny global utility classes used in modals — avoid repeating Tailwind chains.
// Inline <style> block (scoped via React; harmless duplication if loaded twice).
const css = `.input{display:block;width:100%;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;font-family:inherit;}
.input:focus{outline:2px solid #c4b5fd;border-color:#7c3aed;}
.hint{font-size:11px;color:#94a3b8;margin-top:4px;}`;
if (typeof document !== 'undefined' && !document.getElementById('workshop-css')) {
  const el = document.createElement('style');
  el.id = 'workshop-css'; el.innerHTML = css;
  document.head.appendChild(el);
}
