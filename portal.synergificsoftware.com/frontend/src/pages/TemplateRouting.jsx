import React, { useEffect, useState, useMemo } from 'react';
import apiCaller from '../services/apiCaller';
import { FaServer, FaCloud, FaSearch, FaCheckCircle, FaSpinner } from 'react-icons/fa';

// Workload-routing admin: per-template, set the backend tier (azure/aws/forge/auto),
// the browser access protocol, and the nested-virt flag. The portal Deploy flow
// uses these to auto-route new VMs to the correct cloud + worker queue.
//
// Backend endpoints:
//   GET   /admin/templates              — fetch all templates (with routing fields)
//   PATCH /admin/template               — update {name, requiredBackend?, accessProtocol?, nestedVirt?}

const BACKEND_OPTS = [
  { value: 'auto', label: 'Auto (use cloud)' },
  { value: 'azure', label: 'Core (Azure)' },
  { value: 'aws',   label: 'Edge (AWS)' },
  { value: 'forge', label: 'Forge (bare-metal)' },
];

const PROTOCOL_OPTS = [
  { value: 'auto', label: 'Auto (legacy flags)' },
  { value: 'dcv',       label: 'DCV' },
  { value: 'guacamole', label: 'Guacamole' },
  { value: 'rdp',       label: 'RDP' },
  { value: 'kasm',      label: 'Kasm' },
  { value: 'kasmvnc',   label: 'KasmVNC' },
  { value: 'ssh',       label: 'SSH only' },
];

function backendPill(v) {
  const m = {
    auto:  'bg-gray-100 text-gray-700',
    azure: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    aws:   'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    forge: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  };
  return m[v] || m.auto;
}

function protocolPill(v) {
  const m = {
    auto:      'bg-gray-100 text-gray-700',
    dcv:       'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    guacamole: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    rdp:       'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
    kasm:      'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
    kasmvnc:   'bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200',
    ssh:       'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  };
  return m[v] || m.auto;
}

export default function TemplateRouting() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingName, setSavingName] = useState(null);
  const [savedFlash, setSavedFlash] = useState({});
  const [search, setSearch] = useState('');
  const [filterBackend, setFilterBackend] = useState('all');
  const [filterProtocol, setFilterProtocol] = useState('all');
  const [filterNested, setFilterNested] = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiCaller.get('/admin/template');
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err?.response?.data?.message || err.message);
    }
    setLoading(false);
  }

  async function patch(t, set) {
    setSavingName(t.name);
    try {
      await apiCaller.patch('/admin/template', { name: t.name, ...set });
      setTemplates(prev => prev.map(x => x.name === t.name ? { ...x, ...set } : x));
      setSavedFlash(prev => ({ ...prev, [t.name]: Date.now() }));
      setTimeout(() => setSavedFlash(prev => {
        const next = { ...prev };
        if (Date.now() - (next[t.name] || 0) >= 1400) delete next[t.name];
        return next;
      }), 1500);
    } catch (err) {
      setError(`${t.name}: ${err?.response?.data?.message || err.message}`);
    }
    setSavingName(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter(t => {
      if (q && !t.name?.toLowerCase().includes(q)) return false;
      if (filterBackend !== 'all') {
        const b = t.requiredBackend || 'auto';
        if (b !== filterBackend) return false;
      }
      if (filterProtocol !== 'all') {
        const p = t.accessProtocol || 'auto';
        if (p !== filterProtocol) return false;
      }
      if (filterNested === 'yes' && !t.nestedVirt) return false;
      if (filterNested === 'no' && t.nestedVirt) return false;
      return true;
    });
  }, [templates, search, filterBackend, filterProtocol, filterNested]);

  const stats = useMemo(() => ({
    total: templates.length,
    aws:   templates.filter(t => (t.requiredBackend || (t.cloud === 'aws' ? 'aws' : 'azure')) === 'aws').length,
    azure: templates.filter(t => (t.requiredBackend || (t.cloud === 'aws' ? 'aws' : 'azure')) === 'azure').length,
    forge: templates.filter(t => t.requiredBackend === 'forge').length,
    nested: templates.filter(t => t.nestedVirt).length,
  }), [templates]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <FaServer className="text-indigo-600" /> Template Routing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Pin each template to a backend tier and Open-in-Browser protocol. Auto = derive from legacy flags.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-700">
          Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <Kpi label="Total" value={stats.total} />
        <Kpi label="Azure (Core)" value={stats.azure} color="text-blue-700" />
        <Kpi label="AWS (Edge)" value={stats.aws} color="text-amber-700" />
        <Kpi label="Forge" value={stats.forge} color="text-rose-700" />
        <Kpi label="Nested virt" value={stats.nested} color="text-emerald-700" />
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by template name…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <select value={filterBackend} onChange={e => setFilterBackend(e.target.value)}
                className="text-sm px-3 py-2 border border-gray-200 rounded-md">
          <option value="all">All backends</option>
          {BACKEND_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterProtocol} onChange={e => setFilterProtocol(e.target.value)}
                className="text-sm px-3 py-2 border border-gray-200 rounded-md">
          <option value="all">All protocols</option>
          {PROTOCOL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterNested} onChange={e => setFilterNested(e.target.value)}
                className="text-sm px-3 py-2 border border-gray-200 rounded-md">
          <option value="all">Nested virt: any</option>
          <option value="yes">Nested virt only</option>
          <option value="no">Non-nested only</option>
        </select>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500"><FaSpinner className="animate-spin inline mr-2" />Loading…</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Template</th>
                <th className="text-left px-4 py-3">OS / Size</th>
                <th className="text-left px-4 py-3">Backend</th>
                <th className="text-left px-4 py-3">Access Protocol</th>
                <th className="text-center px-4 py-3">Nested Virt</th>
                <th className="text-center px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const rb = t.requiredBackend || 'auto';
                const ap = t.accessProtocol  || 'auto';
                const isSaving = savingName === t.name;
                const justSaved = !!savedFlash[t.name];
                return (
                  <tr key={t.name} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      <div>{t.creation?.os || '—'}</div>
                      <div className="text-gray-400">{t.creation?.vmSize || ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={rb} onChange={e => patch(t, { requiredBackend: e.target.value })}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${backendPill(rb)}`}>
                        {BACKEND_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={ap} onChange={e => patch(t, { accessProtocol: e.target.value })}
                        className={`text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ${protocolPill(ap)}`}>
                        {PROTOCOL_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox" checked={!!t.nestedVirt}
                        onChange={e => patch(t, { nestedVirt: e.target.checked })}
                        className="w-4 h-4 cursor-pointer accent-emerald-600"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isSaving && <FaSpinner className="animate-spin text-gray-400 inline" />}
                      {justSaved && !isSaving && <FaCheckCircle className="text-emerald-500 inline" />}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400 text-sm">No templates match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Backend = which cloud tier the worker queue routes new deploys to. Protocol = which Open-in-Browser flow the Lab Console renders. Nested virt = forces Dsv5/Edsv5 SKU on Azure (or Forge bare-metal); never Spot non-metal on AWS.
      </p>
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
