// AccessControl — superadmin page to set login restrictions (time window,
// weekdays, hard expiry) on users, either per-email or per-org/training.
// Complements (does not replace) /vm/scheduler which handles VM power
// schedules. Separation of concerns: this page = "WHO can log in WHEN".

import React, { useState, useEffect, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import {
  FaShieldAlt, FaClock, FaCalendarAlt, FaUserClock, FaBuilding, FaEnvelope,
  FaGraduationCap, FaCheck, FaTimes, FaSpinner, FaTrashAlt, FaInfoCircle,
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

export default function AccessControl() {
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FaShieldAlt className="text-blue-500" /> Access Control
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Set login-time windows, allowed weekdays, and hard access expiry for users.
          Applies portal-wide — once rules are set, the portal login gate enforces them for VMs, sandboxes, workspaces, RDS, ROSA, and ARO.
        </p>
      </div>

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
                      ? 'bg-blue-600 border-blue-600 text-white'
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
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
            Restrictions are enforced at the login gate. Already-logged-in users keep their session until auto-logout (5 min idle) or browser refresh — so rules don't interrupt mid-session.
            For VM power schedules (start/stop the infrastructure itself), use the existing <span className="font-semibold">Operations</span> page instead.
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
                {restrictedUsers.map(u => (
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
          </div>
        )}
      </div>
    </div>
  );
}
