import React, { useEffect, useMemo, useState, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import { FaSearch, FaDownload, FaPlay, FaCheck, FaServer, FaSync } from 'react-icons/fa';

/**
 * ViewLogs.jsx — Activity Log 2026-06-06 rewrite.
 *
 * Why: the old page made you pick ONE VM at a time to see its session log.
 * For ops on a 30+ VM cohort that's hostile. The new page renders a cross-VM
 * timeline by default, with chip filters for VM / status / duration / date.
 *
 * Backed by GET /azure/logs/cohort (new endpoint that flattens events across
 * the whole training in one round-trip).
 *
 * Props: { selectedTraining, apiRoutes }
 *   apiRoutes.getLogsApi remains the per-VM endpoint (kept for CSV-per-VM exports).
 */

const fmtDuration = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', {
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short'
}) : '—';

const fmtDateKey = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' });
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const escapeCsv = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const downloadCsv = (fn, csv) => {
  const b = new Blob([csv], { type: 'text/csv' });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = fn;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(u);
};

const DATE_RANGES = [
  { key: 'today', label: 'Today', hours: 24 },
  { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { key: '30d', label: 'Last 30 days', hours: 24 * 30 },
  { key: 'all', label: 'All time', hours: null },
];

const STATUS_OPTS = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Running now' },
  { key: 'completed', label: 'Completed' },
];

const DURATION_OPTS = [
  { key: 'any', label: 'Any duration', min: 0 },
  { key: 'long', label: '> 30m', min: 30 },
  { key: 'short', label: '< 5m (flickers)', min: 0, max: 5 },
];

const ViewLogs = ({ selectedTraining, apiRoutes }) => {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [vmFilter, setVmFilter] = useState('');     // free text
  const [dateRange, setDateRange] = useState('7d');
  const [statusFilter, setStatusFilter] = useState('all');
  const [durFilter, setDurFilter] = useState('any');
  const [density, setDensity] = useState(() => localStorage.getItem('viewLogsDensity') || 'compact');
  useEffect(() => { try { localStorage.setItem('viewLogsDensity', density); } catch {} }, [density]);

  const params = useMemo(() => {
    const p = { trainingName: selectedTraining, limit: 800 };
    const range = DATE_RANGES.find(r => r.key === dateRange);
    if (range?.hours) {
      const from = new Date(Date.now() - range.hours * 3600 * 1000);
      p.fromDate = from.toISOString();
    }
    if (statusFilter === 'running' || statusFilter === 'completed') p.status = statusFilter;
    const dur = DURATION_OPTS.find(d => d.key === durFilter);
    if (dur?.min) p.minDurationMin = dur.min;
    return p;
  }, [selectedTraining, dateRange, statusFilter, durFilter]);

  const fetchData = useCallback(async () => {
    if (!selectedTraining) { setEvents([]); setSummary(null); return; }
    setLoading(true);
    setError('');
    try {
      const res = await apiCaller.get('/azure/logs/cohort', { params });
      setEvents(res.data?.events || []);
      setSummary(res.data?.summary || null);
      setTruncated(!!res.data?.truncated);
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [selectedTraining, params]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Client-side filter for free-text VM/email + max-duration
  const filtered = useMemo(() => {
    let f = events;
    if (vmFilter) {
      const q = vmFilter.toLowerCase();
      f = f.filter(e => (e.vmName || '').toLowerCase().includes(q) || (e.email || '').toLowerCase().includes(q));
    }
    const dur = DURATION_OPTS.find(d => d.key === durFilter);
    if (dur?.max) f = f.filter(e => e.duration < dur.max);
    return f;
  }, [events, vmFilter, durFilter]);

  // Group by date
  const grouped = useMemo(() => {
    const m = new Map();
    for (const e of filtered) {
      const k = fmtDateKey(e.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const exportCsv = () => {
    const header = ['VM', 'Email', 'Start', 'Stop', 'Duration (min)', 'Status'];
    const rows = filtered.map(e => [e.vmName, e.email, e.start, e.stop || '', e.duration, e.status].map(escapeCsv).join(','));
    downloadCsv(`activity-${selectedTraining}-${new Date().toISOString().slice(0,10)}.csv`,
      [header.map(escapeCsv).join(','), ...rows].join('\n'));
  };

  if (!selectedTraining) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p className="text-sm">Select a customer and lab module above to view activity.</p>
      </div>
    );
  }

  const padY = density === 'comfy' ? 'py-3.5' : 'py-2';

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Activity Log</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Session history across all instances in <span className="font-semibold">{selectedTraining}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} disabled={loading}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">
            <FaSync className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}/>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} disabled={!filtered.length}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-100 disabled:opacity-40">
            <FaDownload className="w-3 h-3"/> Export CSV
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Kpi label="Instances" value={summary?.vmCount ?? '—'} />
        <Kpi label="Sessions" value={summary?.eventCount ?? '—'} sub={truncated ? `showing ${events.length}` : ''} />
        <Kpi label="Total hours" value={summary?.totalHours != null ? summary.totalHours.toFixed(1) : '—'} suffix="h"/>
        <Kpi label="Running now" value={summary?.runningNow ?? '—'} valueClass="text-green-600" />
      </div>

      {/* Filter bar */}
      <div className="mb-3 bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5 min-w-[220px] flex-1 max-w-[400px]">
          <FaSearch className="w-3 h-3 text-gray-400 flex-shrink-0"/>
          <input
            value={vmFilter} onChange={e => setVmFilter(e.target.value)}
            placeholder="Filter by VM name or learner email…"
            className="flex-1 bg-transparent border-none outline-none text-[12px] text-gray-800 placeholder:text-gray-400"
          />
          {vmFilter && <button onClick={() => setVmFilter('')} className="text-[10px] text-gray-400 hover:text-rose-600 px-1">clear</button>}
        </div>

        <SegControl options={DATE_RANGES.map(o => ({ key: o.key, label: o.label }))} value={dateRange} onChange={setDateRange} />
        <SegControl options={STATUS_OPTS} value={statusFilter} onChange={setStatusFilter} />
        <SegControl options={DURATION_OPTS.map(o => ({ key: o.key, label: o.label }))} value={durFilter} onChange={setDurFilter} />

        <div className="ml-auto flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
          <button onClick={() => setDensity('comfy')}
            className={`text-[10px] font-semibold px-2 py-1 rounded ${density === 'comfy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Comfy</button>
          <button onClick={() => setDensity('compact')}
            className={`text-[10px] font-semibold px-2 py-1 rounded ${density === 'compact' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Compact</button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-700">{error}</div>
      )}

      {truncated && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
          Showing first {events.length} of {summary?.eventCount} events. Narrow your filters to see more.
        </div>
      )}

      {/* Timeline */}
      {loading && !events.length ? (
        <div className="py-12 text-center text-gray-400 text-[12px]">Loading activity…</div>
      ) : !filtered.length ? (
        <div className="py-16 text-center bg-white border border-gray-200 rounded-lg">
          <FaServer className="w-6 h-6 text-gray-300 mx-auto mb-2"/>
          <div className="text-[13px] font-semibold text-gray-700">No sessions match these filters</div>
          <div className="text-[11px] text-gray-400 mt-1">Try widening the date range or clearing the VM filter.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{day}</div>
                <div className="flex-1 h-px bg-gray-200"/>
                <div className="text-[10px] text-gray-400 tabular-nums">
                  {items.length} session{items.length > 1 ? 's' : ''} · {fmtDuration(items.reduce((s, e) => s + e.duration, 0))}
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-[12px]">
                  <tbody>
                    {items.map((e, i) => (
                      <tr key={i} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/40 ${e.status === 'running' ? 'bg-green-50/30' : ''}`}>
                        <td className={`px-4 ${padY} w-[200px]`}>
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}/>
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-900 truncate">{e.vmName}</div>
                              {e.email && <div className="text-[10px] text-gray-400 truncate">{e.email}</div>}
                            </div>
                          </div>
                        </td>
                        <td className={`px-3 ${padY}`}>
                          <div className="flex items-center gap-3 text-[11px] text-gray-600 tabular-nums">
                            <span className="inline-flex items-center gap-1">
                              <FaPlay className="w-2.5 h-2.5 text-green-500"/>
                              {fmtTime(e.start)}
                            </span>
                            {e.stop ? (
                              <>
                                <span className="text-gray-300">→</span>
                                <span className="inline-flex items-center gap-1">
                                  <FaCheck className="w-2.5 h-2.5 text-gray-400"/>
                                  {fmtTime(e.stop)}
                                </span>
                              </>
                            ) : (
                              <span className="text-green-600 font-semibold">· running</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 ${padY} text-right`}>
                          <span className={`text-[11px] font-bold tabular-nums ${
                            e.status === 'running' ? 'text-green-600' :
                            e.duration < 5 ? 'text-amber-600' :
                            e.duration > 120 ? 'text-rose-600' : 'text-gray-700'
                          }`}>
                            {fmtDuration(e.duration)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Kpi = ({ label, value, sub, suffix = '', valueClass = 'text-gray-900' }) => (
  <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
    <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">{label}</div>
    <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}{suffix && <span className="text-xs text-gray-400 font-medium ml-1">{suffix}</span>}</div>
    {sub && <div className="text-[10px] text-amber-600 mt-0.5">{sub}</div>}
  </div>
);

const SegControl = ({ options, value, onChange }) => (
  <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
    {options.map(o => (
      <button key={o.key} onClick={() => onChange(o.key)}
        className={`text-[10px] font-semibold px-2 py-1 rounded ${value === o.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
        {o.label}
      </button>
    ))}
  </div>
);

export default ViewLogs;
