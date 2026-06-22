// AccessControl — unified superadmin control panel for access + power.
// Tab 1 "Login Access": login-time window, weekdays, hard expiry (per
//   email / organization / training).  Login gate runs portal-wide so
//   this covers VM / RDS / ROSA / ARO / sandbox / workspace users.
// Tab 2 "Power Schedule": create start/stop schedules for VMs of a
//   training batch — shares the same API as /vm/scheduler.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import apiCaller from '../services/apiCaller';
import { apiRoutes } from '../services/apiRoutes';
import {
  FaShieldAlt, FaClock, FaCalendarAlt, FaUserClock, FaBuilding, FaEnvelope,
  FaGraduationCap, FaCheck, FaTimes, FaSpinner, FaTrashAlt, FaInfoCircle,
  FaPowerOff, FaChevronDown, FaPlay, FaStop, FaPlus, FaServer,
} from 'react-icons/fa';

const DAY_LABELS = [
  { v: 0, label: 'Sun' },
  { v: 1, label: 'Mon' },
  { v: 2, label: 'Tue' },
  { v: 3, label: 'Wed' },
  { v: 4, label: 'Thu' },
  { v: 5, label: 'Fri' },
  { v: 6, label: 'Sat' },
];

const SCOPES = [
  { v: 'email',        label: 'Single user (by email)',       icon: FaEnvelope },
  { v: 'organization', label: 'Whole organization',           icon: FaBuilding },
  { v: 'trainingName', label: 'Training batch',               icon: FaGraduationCap },
];

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
        toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
      }`}>
        {toast.message}
        <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">&times;</button>
      </div>
    </div>
  );
}

function PowerScheduleTab({ pushToast }) {
  const [orgs, setOrgs] = useState([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [trainings, setTrainings] = useState([]);
  const [loadingTrainings, setLoadingTrainings] = useState(false);
  const [selectedTraining, setSelectedTraining] = useState('');

  // schedule form + list
  const [action, setAction] = useState('start');             // 'start' | 'stop'
  const [dates, setDates] = useState([]);                    // array of yyyy-mm-dd
  const [time, setTime] = useState('');                      // HH:mm
  const [scopeAll, setScopeAll] = useState(true);            // all VMs vs specific
  const [vmNames, setVmNames] = useState([]);
  const [selectedVMs, setSelectedVMs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // --- Multi-date helpers (DayPicker mode="multiple") ---
  const toISODate = (dt) => {
    if (!dt) return '';
    const d = dt instanceof Date ? dt : new Date(dt);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const selectedDaysForCalendar = useMemo(
    () => dates.map(s => new Date(s + 'T00:00:00')),
    [dates]
  );
  const onCalendarSelect = (picked) => {
    if (!picked) { setDates([]); return; }
    const arr = Array.isArray(picked) ? picked : [picked];
    setDates(arr.map(toISODate).filter(Boolean).sort());
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await apiCaller.get('/admin/organization');
        setOrgs(r.data?.organization || []);
      } catch { /* silent */ }
      finally { setLoadingOrgs(false); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrg) { setTrainings([]); setSelectedTraining(''); return; }
    setLoadingTrainings(true);
    setSelectedTraining('');
    (async () => {
      try {
        const r = await apiCaller.get(`${apiRoutes.trainingNameApi}?organization=${encodeURIComponent(selectedOrg)}`);
        setTrainings(r.data?.trainingNames || []);
      } catch { /* silent */ }
      finally { setLoadingTrainings(false); }
    })();
  }, [selectedOrg]);

  const fetchSchedules = useCallback(async (name) => {
    if (!name) return;
    setLoadingSchedules(true);
    try {
      const r = await apiCaller.get(`${apiRoutes.schedulesApi}?trainingName=${encodeURIComponent(name)}`);
      setSchedules(r.data?.schedules || []);
    } catch { pushToast('Failed to load schedules', 'error'); }
    finally { setLoadingSchedules(false); }
  }, [pushToast]);

  const fetchVmNames = useCallback(async (name) => {
    if (!name) return;
    try {
      const r = await apiCaller.get(`${apiRoutes.vmNamesApi}?trainingName=${encodeURIComponent(name)}`);
      // Backend response can be: array of strings, array of {vmName}|{name}, or {vmList:[...]}
      const raw = Array.isArray(r?.data) ? r.data : (r?.data?.vmList || r?.data?.vmNames || r?.data?.vms || []);
      const names = raw.map(v => typeof v === 'string' ? v : (v.vmName || v.name)).filter(Boolean);
      setVmNames(names);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setSchedules([]); setVmNames([]); setSelectedVMs([]); setPage(1);
    if (selectedTraining) { fetchSchedules(selectedTraining); fetchVmNames(selectedTraining); }
  }, [selectedTraining, fetchSchedules, fetchVmNames]);

  const addSchedule = async () => {
    if (!selectedTraining) { pushToast('Pick a training first', 'error'); return; }
    if (dates.length === 0 || !time) { pushToast('Pick at least one date and a time', 'error'); return; }
    if (!scopeAll && selectedVMs.length === 0) { pushToast('Pick at least one VM, or switch to "All VMs"', 'error'); return; }
    setSubmitting(true);
    try {
      await apiCaller.post(apiRoutes.schedulesApi, {
        trainingName: selectedTraining,
        data: {
          schedules: dates.map(d => ({
            date: d, time, action,
            entireTraining: scopeAll,
            targetVMs: scopeAll ? [] : selectedVMs,
          })),
          restrictLogin: { restrictUserLogin: false },
        },
      });
      pushToast(`${action === 'start' ? 'Start' : 'Stop'} schedule${dates.length > 1 ? 's' : ''} added for ${dates.length} date${dates.length > 1 ? 's' : ''}`);
      setDates([]); setTime(''); setSelectedVMs([]); setScopeAll(true);
      fetchSchedules(selectedTraining);
    } catch (err) {
      pushToast(err.response?.data?.message || 'Failed to add schedule', 'error');
    } finally { setSubmitting(false); }
  };

  const deleteSchedule = async (s) => {
    const label = (String(s.action || '').toLowerCase() === 'start' || String(s.action || '').toLowerCase() === 'power on') ? 'start' : 'stop';
    if (!window.confirm(`Delete this ${label} schedule for ${new Date(s.date).toLocaleDateString()} ${s.time}?`)) return;
    try {
      await apiCaller.delete(apiRoutes.schedulesApi, {
        params: { scheduleId: s._id, trainingName: selectedTraining },
      });
      pushToast('Schedule deleted');
      fetchSchedules(selectedTraining);
    } catch (err) { pushToast(err.response?.data?.message || 'Delete failed', 'error'); }
  };

  const toggleVM = (v) => setSelectedVMs(arr => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const isStartAction = a => { const v = String(a || '').toLowerCase(); return v === 'start' || v === 'power on' || v === 'poweron'; };
  const sorted = [...schedules].sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-6">
      {/* Target picker card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <FaBuilding className="w-3 h-3 text-blue-400" /> Organization
            </label>
            <div className="relative">
              <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)} disabled={loadingOrgs}
                className="w-full appearance-none px-3 py-2.5 pr-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white disabled:bg-gray-50">
                <option value="">{loadingOrgs ? 'Loading…' : 'Select organization'}</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <FaGraduationCap className="w-3 h-3 text-blue-400" /> Training batch
            </label>
            <div className="relative">
              <select value={selectedTraining} onChange={e => setSelectedTraining(e.target.value)} disabled={!selectedOrg || loadingTrainings}
                className="w-full appearance-none px-3 py-2.5 pr-9 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">
                  {!selectedOrg ? 'Pick organization first' : loadingTrainings ? 'Loading…' : trainings.length === 0 ? 'No trainings' : 'Select training'}
                </option>
                {trainings.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {selectedTraining && (
          <>
            {/* Action (Start | Stop) */}
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2">Action</label>
              <div className="grid grid-cols-2 gap-2 max-w-md">
                {[
                  { v: 'start', label: 'Start VMs', icon: FaPlay, color: 'green' },
                  { v: 'stop',  label: 'Stop VMs',  icon: FaStop, color: 'red'   },
                ].map(a => (
                  <button key={a.v} type="button" onClick={() => setAction(a.v)}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 text-sm rounded-lg border transition-all ${
                      action === a.v
                        ? a.color === 'green'
                          ? 'bg-green-50 border-green-300 text-green-700 font-semibold'
                          : 'bg-red-50 border-red-300 text-red-700 font-semibold'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    <a.icon className={`w-3 h-3 ${action === a.v ? (a.color === 'green' ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`} />
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date(s) + Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                  <FaCalendarAlt className="w-3 h-3 text-blue-400" /> Date(s)
                </label>
                <div className="border border-gray-200 rounded-lg p-3 bg-white">
                  <DayPicker
                    mode="multiple"
                    selected={selectedDaysForCalendar}
                    onSelect={onCalendarSelect}
                    disabled={{ before: new Date(new Date().setHours(0,0,0,0)) }}
                    className="text-sm"
                  />
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-600">
                      {dates.length} date{dates.length !== 1 ? 's' : ''} selected
                    </span>
                    {dates.length > 0 && (
                      <button type="button" onClick={() => setDates([])}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">Clear</button>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                  <FaClock className="w-3 h-3 text-blue-400" /> Time (IST)
                </label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>

            {/* Scope */}
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                <FaServer className="w-3 h-3 text-blue-400" /> Target VMs
              </label>
              <div className="grid grid-cols-2 gap-2 max-w-md mb-3">
                {[
                  { v: true,  label: 'All VMs in training' },
                  { v: false, label: 'Specific VMs'        },
                ].map(s => (
                  <button key={String(s.v)} type="button" onClick={() => setScopeAll(s.v)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                      scopeAll === s.v
                        ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {s.label}
                  </button>
                ))}
              </div>
              {!scopeAll && (
                <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto bg-gray-50/40">
                  {vmNames.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4">No VMs found for this training.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {vmNames.map(v => (
                        <label key={v} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-white cursor-pointer">
                          <input type="checkbox" checked={selectedVMs.includes(v)} onChange={() => toggleVM(v)}
                            className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 focus:ring-blue-500" />
                          <span className="truncate text-gray-700" title={v}>{v}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button onClick={addSchedule} disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaPlus className="w-3 h-3" />}
                Add schedule
              </button>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <FaInfoCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800 leading-relaxed">
                Schedules run at the configured IST time. Start wakes the VMs; Stop deallocates them to save cost.
                For login-time gating (who can access, when), switch to the <span className="font-semibold">Login Access</span> tab.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Upcoming schedules */}
      {selectedTraining && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">Schedules for <span className="text-blue-600">{selectedTraining}</span> ({schedules.length})</h3>
            <button onClick={() => fetchSchedules(selectedTraining)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Refresh</button>
          </div>
          {loadingSchedules ? (
            <div className="py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
          ) : schedules.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No schedules yet. Add one above.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {['Action', 'Date', 'Time (IST)', 'Target VMs', 'Status', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paged.map(s => (
                    <tr key={s._id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          isStartAction(s.action) ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {isStartAction(s.action) ? <FaPlay className="w-2.5 h-2.5" /> : <FaStop className="w-2.5 h-2.5" />}
                          {isStartAction(s.action) ? 'Start' : 'Stop'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 tabular-nums text-xs">{fmtDate(s.date)}</td>
                      <td className="px-4 py-2.5 text-gray-700 tabular-nums text-xs">{s.time}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs truncate max-w-[260px]" title={(s.targetVMs || []).join(', ')}>
                        {s.scope === 'entire' ? 'All VMs' : (s.targetVMs || []).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${
                          s.status === 'done'    ? 'bg-gray-100 text-gray-600' :
                          s.status === 'failed'  ? 'bg-red-50 text-red-700'    :
                                                   'bg-blue-50 text-blue-700'
                        }`}>{s.status || 'pending'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => deleteSchedule(s)} title="Delete schedule"
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                          <FaTrashAlt className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-600">
                <div className="flex items-center gap-3">
                  <span>Showing <span className="font-semibold">{(safePage - 1) * pageSize + 1}</span>–<span className="font-semibold">{Math.min(safePage * pageSize, sorted.length)}</span> of <span className="font-semibold">{sorted.length}</span></span>
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="px-2 py-1 border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                    {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(1)} disabled={safePage === 1}
                    className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">« First</button>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                    className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">‹ Prev</button>
                  <span className="px-2 py-1 font-semibold text-gray-700">Page {safePage} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                    className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
                  <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
                    className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">Last »</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!selectedTraining && (
        <div className="bg-white border border-gray-200 rounded-xl py-14 text-center">
          <FaPowerOff className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-700">Pick an organization and training</p>
          <p className="text-xs text-gray-400 mt-1">VM start/stop schedules will appear here once a training is selected.</p>
        </div>
      )}
    </div>
  );
}

export default function AccessControl() {
  const [activeTab, setActiveTab] = useState('login');
  const [scope, setScope] = useState('email');
  const [target, setTarget] = useState('');
  const [loginStart, setLoginStart] = useState('');
  const [loginStop, setLoginStop] = useState('');
  const [weekdays, setWeekdays] = useState([]);   // array of 0-6
  const [accessExpiresAt, setAccessExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const [restrictedUsers, setRestrictedUsers] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [suggestions, setSuggestions] = useState({ emails: [], organizations: [], trainings: [] });
  const [showSuggest, setShowSuggest] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const pushToast = (msg, type = 'success') => setToast({ message: msg, type, id: Date.now() });
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); } }, [toast]);

  // Fetch currently-restricted users for the bottom table
  const fetchList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await apiCaller.get('/admin/user-schedule/list');
      setRestrictedUsers(r.data?.users || []);
    } catch {
      pushToast('Failed to load restricted users', 'error');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  // Autocomplete suggestions as user types the target
  useEffect(() => {
    if (!target || target.length < 2) { setSuggestions({ emails: [], organizations: [], trainings: [] }); return; }
    const h = setTimeout(async () => {
      try {
        const r = await apiCaller.get('/admin/user-schedule/suggestions', { params: { q: target } });
        setSuggestions(r.data || { emails: [], organizations: [], trainings: [] });
      } catch { /* silent */ }
    }, 250);
    return () => clearTimeout(h);
  }, [target]);

  const toggleDay = (d) => setWeekdays(ws => ws.includes(d) ? ws.filter(x => x !== d) : [...ws, d].sort());

  const submit = async (clearAll = false) => {
    if (!target.trim()) { pushToast('Enter a target (email, org, or training)', 'error'); return; }
    if (!clearAll && !loginStart && !loginStop && weekdays.length === 0 && !accessExpiresAt) {
      pushToast('Set at least one restriction, or click "Clear all" instead.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        scope,
        target: target.trim(),
        ...(clearAll ? { clearAll: true } : {
          loginStart: loginStart || '',
          loginStop:  loginStop  || '',
          allowedWeekdays: weekdays,
          accessExpiresAt: accessExpiresAt || null,
        }),
      };
      const r = await apiCaller.patch('/admin/user-schedule', body);
      pushToast(r.data?.message || `Updated ${r.data?.modified} user(s)`);
      fetchList();
    } catch (err) {
      pushToast(err.response?.data?.message || 'Update failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const clearFromRow = async (user) => {
    if (!window.confirm(`Remove all schedule restrictions from ${user.email}?`)) return;
    try {
      await apiCaller.patch('/admin/user-schedule', { scope: 'email', target: user.email, clearAll: true });
      pushToast(`Cleared restrictions for ${user.email}`);
      fetchList();
    } catch (err) {
      pushToast(err.response?.data?.message || 'Clear failed', 'error');
    }
  };

  const fmtDays = (arr) => (arr || []).map(d => DAY_LABELS[d]?.label).join(', ') || '—';
  const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const totalPages = Math.max(1, Math.ceil(restrictedUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = restrictedUsers.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FaShieldAlt className="text-blue-500" /> Access Control
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Unified control — login gating for all resources and VM power schedules for batches.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {[
          { v: 'login', label: 'Login Access',    icon: FaShieldAlt, hint: 'Who can log in, when' },
          { v: 'power', label: 'Power Schedule',  icon: FaPowerOff,  hint: 'VM start/stop for a batch' },
          { v: 'cleanup', label: 'Bulk Cleanup',  icon: FaTrashAlt, hint: 'Filter + delete schedules by VM' },
        ].map(t => (
          <button key={t.v} onClick={() => setActiveTab(t.v)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === t.v ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            <span className="text-[11px] text-gray-400 font-normal hidden md:inline">· {t.hint}</span>
            {activeTab === t.v && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
          </button>
        ))}
      </div>

      {activeTab === 'power' && <PowerScheduleTab pushToast={pushToast} />}
      {activeTab === 'cleanup' && <BulkCleanupTab pushToast={pushToast} />}

      {activeTab === 'login' && <>
      {/* Form card */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-2">Apply to</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {SCOPES.map(s => (
              <button key={s.v} type="button" onClick={() => setScope(s.v)}
                className={`flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg border transition-all ${
                  scope === s.v
                    ? 'bg-blue-50 border-blue-300 text-blue-700 font-semibold'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <s.icon className={`w-3.5 h-3.5 ${scope === s.v ? 'text-blue-500' : 'text-gray-400'}`} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
            {scope === 'email' ? 'User email' : scope === 'organization' ? 'Organization name' : 'Training batch name'}
          </label>
          <div className="relative">
            <input
              value={target}
              onChange={e => { setTarget(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 200)}
              placeholder={scope === 'email' ? 'student@company.com' : scope === 'organization' ? 'synsoft / Amazon Connect Fundamentals / ...' : 'aws-batch-may-2026'}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            {showSuggest && target.length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-56 overflow-y-auto">
                {(scope === 'email' ? suggestions.emails.map(u => u.email) :
                  scope === 'organization' ? suggestions.organizations :
                  suggestions.trainings).slice(0, 8).map(s => (
                  <button key={s} onMouseDown={() => { setTarget(s); setShowSuggest(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0">
                    {s}
                  </button>
                ))}
                {(scope === 'email' ? suggestions.emails.length :
                  scope === 'organization' ? suggestions.organizations.length :
                  suggestions.trainings.length) === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400">No matches — this might be a new value</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Login window */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <FaClock className="w-3 h-3 text-blue-400" /> Login window (IST)
            </label>
            <div className="flex items-center gap-2">
              <input type="time" value={loginStart} onChange={e => setLoginStart(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              <span className="text-gray-400 text-sm">→</span>
              <input type="time" value={loginStop} onChange={e => setLoginStop(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Stop &lt; start = overnight (e.g. 18:45 → 01:15)</p>
          </div>

          {/* Hard expiry */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <FaUserClock className="w-3 h-3 text-blue-400" /> Access expires
            </label>
            <input type="datetime-local" value={accessExpiresAt} onChange={e => setAccessExpiresAt(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            <p className="text-[11px] text-gray-400 mt-1.5">After this, login is blocked with "expired" message</p>
          </div>

          {/* Allowed days */}
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <FaCalendarAlt className="w-3 h-3 text-blue-400" /> Allowed days
            </label>
            <div className="flex gap-1 flex-wrap">
              {DAY_LABELS.map(d => (
                <button key={d.v} type="button" onClick={() => toggleDay(d.v)}
                  className={`w-10 h-9 text-[11px] font-semibold rounded-md border transition-colors ${
                    weekdays.includes(d.v)
                      ? 'bg-indigo-600 border-blue-600 text-white'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Empty = all days allowed</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => submit(false)} disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaCheck className="w-3 h-3" />}
            Apply restrictions
          </button>
          <button onClick={() => submit(true)} disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-red-600 border border-red-200 text-sm font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50">
            <FaTimes className="w-3 h-3" />
            Clear all restrictions for this target
          </button>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <FaInfoCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 leading-relaxed">
            Restrictions are enforced at the login gate. Already-logged-in users keep their session until auto-logout (15 min idle) or browser refresh — so rules don't interrupt mid-session.
            To start/stop VMs on a schedule, use the <span className="font-semibold">Power Schedule</span> tab above.
          </p>
        </div>
      </div>

      {/* Currently-restricted users */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Users with restrictions ({restrictedUsers.length})</h3>
          <button onClick={fetchList} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Refresh</button>
        </div>
        {loadingList ? (
          <div className="py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
        ) : restrictedUsers.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No users currently have login restrictions.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Email', 'Organization', 'Login window', 'Allowed days', 'Expires', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pagedUsers.map(u => (
                  <tr key={u.email} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-800 truncate max-w-[220px]" title={u.email}>{u.email}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{u.organization || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums text-xs">
                      {u.loginStart && u.loginStop ? `${u.loginStart} → ${u.loginStop}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{fmtDays(u.allowedWeekdays)}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{fmtDate(u.accessExpiresAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => clearFromRow(u)} title="Clear all restrictions"
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                        <FaTrashAlt className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-600">
              <div className="flex items-center gap-3">
                <span>
                  Showing <span className="font-semibold">{(safePage - 1) * pageSize + 1}</span>–
                  <span className="font-semibold">{Math.min(safePage * pageSize, restrictedUsers.length)}</span>{' '}
                  of <span className="font-semibold">{restrictedUsers.length}</span>
                </span>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="px-2 py-1 border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={safePage === 1}
                  className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">« First</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                  className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">‹ Prev</button>
                <span className="px-2 py-1 font-semibold text-gray-700">Page {safePage} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                  className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
                <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
                  className="px-2 py-1 rounded-md border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">Last »</button>
              </div>
            </div>
          </div>
        )}
      </div>
      </>}
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────────────
// Bulk Schedule Cleanup tab (added 2026-05-28)
// Lets superadmins filter every Power-Schedule entry across all trainings by
// target VM + status, multi-select, and delete in one click. Backed by:
//   GET  /azure/schedules/by-vm?vmName=…&status=…
//   POST /azure/schedules/bulk-delete  { items: […] }  OR  { filter: { vmName, status } }
// ───────────────────────────────────────────────────────────────────────────
function BulkCleanupTab({ pushToast }) {
  const [vmName, setVmName] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState('selected'); // 'selected' | 'all'
  const [deleting, setDeleting] = useState(false);
  const [vmSuggestions, setVmSuggestions] = useState([]);

  // Bulk-edit state — empty string in any field = "don't change"
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState('selected'); // 'selected' | 'all'
  const [editTime, setEditTime] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editing, setEditing] = useState(false);

  // Pre-populate VM suggestions from the dockerhosts + portal-managed VMs
  // pattern. Cheap — falls back to the trainingName route to enumerate
  // known docker-host VM names.
  useEffect(() => {
    (async () => {
      try {
        // Static suggestions — known portal-adopted docker hosts.
        // This list is informational only; user can type anything.
        setVmSuggestions([
          'docker-host-a17718d5',
          'docker-host-d6815ffb',
          'docker-host-mpcjf0gu',
          'docker-host-clvs-mpgipd06',
        ]);
      } catch { /* no-op */ }
    })();
  }, []);

  const loadSchedules = useCallback(async () => {
    if (!vmName.trim()) {
      pushToast('Enter a VM name first', 'error');
      return;
    }
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const q = new URLSearchParams({ vmName: vmName.trim() });
      if (statusFilter && statusFilter !== 'all') q.set('status', statusFilter);
      const r = await apiCaller.get(`/azure/schedules/by-vm?${q.toString()}`);
      setRows(r.data?.schedules || []);
      if ((r.data?.schedules || []).length === 0) {
        pushToast('No matching schedules found', 'success');
      }
    } catch {
      pushToast('Failed to load schedules', 'error');
    } finally {
      setLoading(false);
    }
  }, [vmName, statusFilter, pushToast]);

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allChecked = rows.length > 0 && selectedIds.size === rows.length;
  const toggleAll = () => {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => String(r.scheduleId))));
  };

  const openConfirm = (mode) => {
    if (mode === 'selected' && selectedIds.size === 0) {
      pushToast('Select at least one row', 'error');
      return;
    }
    setConfirmMode(mode);
    setConfirmOpen(true);
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      let body;
      if (confirmMode === 'selected') {
        const itemsByRow = rows
          .filter(r => selectedIds.has(String(r.scheduleId)))
          .map(r => ({ trainingName: r.trainingName, scheduleId: r.scheduleId }));
        body = { items: itemsByRow };
      } else {
        // 'all matching' mode = filter-based
        body = { filter: { vmName: vmName.trim(), ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}) } };
      }
      const r = await apiCaller.post('/azure/schedules/bulk-delete', body);
      pushToast(`Deleted ${r.data?.count ?? 0} schedule(s)`, 'success');
      setConfirmOpen(false);
      setSelectedIds(new Set());
      await loadSchedules();
    } catch {
      pushToast('Bulk delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (mode) => {
    if (mode === 'selected' && selectedIds.size === 0) {
      pushToast('Select at least one row', 'error');
      return;
    }
    setEditMode(mode);
    setEditTime('');
    setEditAction('');
    setEditStatus('');
    setEditOpen(true);
  };

  const handleBulkEdit = async () => {
    const updates = {};
    if (editTime.trim()) {
      if (!/^\d{2}:\d{2}$/.test(editTime.trim())) {
        pushToast('Time must be HH:MM (24-hour)', 'error');
        return;
      }
      updates.time = editTime.trim();
    }
    if (editAction) updates.action = editAction;
    if (editStatus) updates.status = editStatus;
    if (Object.keys(updates).length === 0) {
      pushToast('Pick at least one field to change', 'error');
      return;
    }
    setEditing(true);
    try {
      let body;
      if (editMode === 'selected') {
        const items = rows
          .filter(r => selectedIds.has(String(r.scheduleId)))
          .map(r => ({ trainingName: r.trainingName, scheduleId: r.scheduleId }));
        body = { items, updates };
      } else {
        body = {
          filter: { vmName: vmName.trim(), ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}) },
          updates
        };
      }
      const r = await apiCaller.post('/azure/schedules/bulk-update', body);
      pushToast(`Updated ${r.data?.count ?? 0} schedule(s)`, 'success');
      setEditOpen(false);
      setSelectedIds(new Set());
      await loadSchedules();
    } catch (err) {
      const msg = err?.response?.data?.message || 'Bulk update failed';
      pushToast(msg, 'error');
    } finally {
      setEditing(false);
    }
  };

  const fmtDate2 = (d) => {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
    } catch { return String(d); }
  };

  return (
    <div className="space-y-4">
      {/* Filter card */}
      <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <FaServer className="w-3.5 h-3.5 text-gray-500" />
          Bulk schedule cleanup — filter by target VM
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">VM name</label>
            <input
              type="text"
              list="bulk-vm-suggestions"
              value={vmName}
              onChange={(e) => setVmName(e.target.value)}
              placeholder="docker-host-a17718d5"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            <datalist id="bulk-vm-suggestions">
              {vmSuggestions.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="md:col-span-3">
            <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
              <option value="failed">Failed</option>
              <option value="all">All statuses</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              onClick={loadSchedules}
              disabled={loading}
              className="w-full inline-flex justify-center items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaServer className="w-3 h-3" />}
              Load schedules
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <FaInfoCircle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 leading-relaxed">
            Only schedules with <span className="font-semibold">scope = specific</span> and the given VM in their target list are shown.
            "Delete all matching" removes every entry that matches the current filter, ignoring checkbox selection.
            Deleted schedules cannot be recovered — schedule the same window again from the Power Schedule tab if you change your mind.
          </p>
        </div>
      </div>

      {/* Results card */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-gray-800">
            Matching schedules
            {rows.length > 0 && <span className="ml-2 text-gray-500 font-normal">({selectedIds.size} of {rows.length} selected)</span>}
          </h3>
          <div className="flex items-center gap-2">
            <button
              disabled={rows.length === 0 || selectedIds.size === 0}
              onClick={() => openEdit('selected')}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FaPlus className="w-3 h-3 rotate-45" />
              Edit selected ({selectedIds.size})
            </button>
            <button
              disabled={rows.length === 0}
              onClick={() => openEdit('all')}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-600 text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FaPlus className="w-3 h-3 rotate-45" />
              Edit ALL matching ({rows.length})
            </button>
            <button
              disabled={rows.length === 0 || selectedIds.size === 0}
              onClick={() => openConfirm('selected')}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FaTrashAlt className="w-3 h-3" />
              Delete selected ({selectedIds.size})
            </button>
            <button
              disabled={rows.length === 0}
              onClick={() => openConfirm('all')}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-600 text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FaTrashAlt className="w-3 h-3" />
              Delete ALL matching ({rows.length})
            </button>
          </div>
        </div>
        {loading ? (
          <div className="py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">No matching schedules. Pick a VM + status and click "Load schedules".</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  {['Training', 'Action', 'Date', 'Time (IST)', 'Target VMs', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const sid = String(r.scheduleId);
                  const isStart = String(r.action).toLowerCase().includes('start') || String(r.action).toLowerCase().includes('power on');
                  return (
                    <tr key={sid} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedIds.has(sid)} onChange={() => toggleOne(sid)} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs font-medium truncate max-w-[220px]" title={r.trainingName}>{r.trainingName}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${isStart ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {isStart ? <FaPlay className="w-2.5 h-2.5" /> : <FaStop className="w-2.5 h-2.5" />}
                          {isStart ? 'Start' : 'Stop'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 tabular-nums text-xs">{fmtDate2(r.date)}</td>
                      <td className="px-4 py-2.5 text-gray-700 tabular-nums text-xs">{r.time}</td>
                      <td className="px-4 py-2.5 text-gray-600 text-xs truncate max-w-[260px]" title={(r.targetVMs || []).join(', ')}>{(r.targetVMs || []).join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${
                          r.status === 'completed' ? 'bg-gray-100 text-gray-600' :
                          r.status === 'missed'    ? 'bg-amber-50 text-amber-700' :
                          r.status === 'failed'    ? 'bg-red-50 text-red-700' :
                                                     'bg-blue-50 text-blue-700'
                        }`}>{r.status || 'pending'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <h4 className="text-base font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <FaTrashAlt className="w-4 h-4 text-red-600" />
              Confirm bulk delete
            </h4>
            <p className="text-sm text-gray-600 mb-4">
              {confirmMode === 'selected'
                ? <>You are about to delete <span className="font-semibold">{selectedIds.size}</span> selected schedule entr{selectedIds.size === 1 ? 'y' : 'ies'} for <span className="font-semibold">{vmName}</span>.</>
                : <>You are about to delete <span className="font-semibold">ALL {rows.length}</span> schedule entries matching VM <span className="font-semibold">{vmName}</span>{statusFilter && statusFilter !== 'all' ? <> with status <span className="font-semibold">{statusFilter}</span></> : null}.</>
              } This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={deleting}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={doDelete} disabled={deleting}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-600 text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deleting ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaTrashAlt className="w-3 h-3" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk-edit modal */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <h4 className="text-base font-semibold text-gray-800 mb-1 flex items-center gap-2">
              <FaPlus className="w-4 h-4 text-blue-600 rotate-45" />
              Bulk edit schedules
            </h4>
            <p className="text-xs text-gray-500 mb-4">
              {editMode === 'selected'
                ? <>Updating <span className="font-semibold">{selectedIds.size}</span> selected entr{selectedIds.size === 1 ? 'y' : 'ies'} for <span className="font-semibold">{vmName}</span>.</>
                : <>Updating <span className="font-semibold">ALL {rows.length}</span> matching entries for <span className="font-semibold">{vmName}</span>{statusFilter && statusFilter !== 'all' ? <> with status <span className="font-semibold">{statusFilter}</span></> : null}.</>
              } Leave a field blank to keep its current value.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">New time (IST)</label>
                <input type="text" value={editTime} onChange={e => setEditTime(e.target.value)} placeholder="HH:MM (e.g. 05:00)"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 tabular-nums" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">New action</label>
                <select value={editAction} onChange={e => setEditAction(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                  <option value="">(keep current)</option>
                  <option value="start">start</option>
                  <option value="stop">stop</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">New status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                  <option value="">(keep current)</option>
                  <option value="pending">pending</option>
                  <option value="completed">completed</option>
                  <option value="missed">missed</option>
                  <option value="failed">failed</option>
                </select>
                <p className="mt-1 text-[11px] text-gray-400">Reset a missed/failed entry to "pending" so the scheduler will retry it on its next tick.</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setEditOpen(false)} disabled={editing}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleBulkEdit} disabled={editing}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-600 text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">
                {editing ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaPlus className="w-3 h-3 rotate-45" />}
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
