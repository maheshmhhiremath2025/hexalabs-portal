import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaBookOpen, FaUsers, FaCheckCircle, FaClock, FaSearch, FaDownload,
  FaChartBar, FaEye, FaExclamationTriangle, FaSpinner, FaArrowLeft,
  FaLightbulb, FaRobot,
} from 'react-icons/fa';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
const DIFFICULTY_COLORS = { beginner: '#10b981', intermediate: '#f59e0b', advanced: '#ef4444' };
const numberFmt = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-IN') : '--');

/* ───── KPI Card ───── */
function KpiCard({ icon: Icon, title, value, subtitle, accent = 'blue' }) {
  const accents = {
    blue:    { border: 'border-l-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-600' },
    indigo:  { border: 'border-l-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-600' },
    emerald: { border: 'border-l-emerald-500',bg: 'bg-emerald-50',text: 'text-emerald-600' },
    amber:   { border: 'border-l-amber-500',  bg: 'bg-amber-50',  text: 'text-amber-600' },
  };
  const a = accents[accent] || accents.blue;
  return (
    <div className={`bg-white border border-gray-200 border-l-[3px] ${a.border} rounded-xl p-4`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1.5 tabular-nums">{value}</div>
          {subtitle && <div className="text-[11px] text-gray-400 mt-1">{subtitle}</div>}
        </div>
        <div className={`w-9 h-9 rounded-lg ${a.bg} flex items-center justify-center flex-shrink-0 ml-3`}>
          <Icon className={`w-4 h-4 ${a.text}`} />
        </div>
      </div>
    </div>
  );
}

/* ───── Section wrapper ───── */
function Section({ title, subtitle, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white overflow-hidden ${className}`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      {(title || subtitle) && (
        <div className="px-5 py-3 border-b border-gray-100">
          {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
          {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/* ───── Custom tooltip ───── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-gray-800 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-gray-600">{p.name}: <span className="font-semibold">{p.value}%</span></div>
      ))}
    </div>
  );
}

/* ───── Completion bar (inline) ───── */
function CompletionBar({ pct }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums">{pct}%</span>
    </div>
  );
}

/* ───── Tabs ───── */
const TABS = [
  { key: 'overview', label: 'Overview', icon: FaChartBar },
  { key: 'perLab', label: 'Per Lab', icon: FaBookOpen },
  { key: 'steps', label: 'Step Analysis', icon: FaEye },
  { key: 'students', label: 'Students', icon: FaUsers },
];

/* ================================================================== */
/*  Main Page                                                          */
/* ================================================================== */
export default function GuidedLabAnalytics() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedLabId, setSelectedLabId] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [studentLabFilter, setStudentLabFilter] = useState('');
  const [studentOrgFilter, setStudentOrgFilter] = useState('');

  const userType = localStorage.getItem('userType');
  const isSuperAdmin = userType === 'superadmin';
  const userOrg = localStorage.getItem('organization') || '';

  const fetchData = async (org) => {
    try {
      setLoading(true);
      setError(null);
      const params = org ? `?org=${encodeURIComponent(org)}` : '';
      const res = await apiCaller.get(`/guided-labs/analytics${params}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(selectedOrg); }, [selectedOrg]);

  // Derived data
  const overview = data?.overview || {};
  const perLab = data?.perLab || [];
  const stepStats = data?.stepStats || [];
  const perStudent = data?.perStudent || [];
  const organizations = data?.organizations || [];

  // Step analysis for selected lab
  const selectedLabSteps = useMemo(() => {
    if (!selectedLabId) return stepStats;
    return stepStats.filter(s => s.labId === selectedLabId).sort((a, b) => a.completionRate - b.completionRate);
  }, [stepStats, selectedLabId]);

  // Unique orgs from student data (for filter dropdown)
  const studentOrgs = useMemo(() => [...new Set(perStudent.map(s => s.organization).filter(Boolean))].sort(), [perStudent]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    let list = perStudent;
    if (studentOrgFilter) list = list.filter(s => s.organization === studentOrgFilter);
    if (studentLabFilter) list = list.filter(s => s.labId === studentLabFilter);
    if (studentSearch) {
      const q = studentSearch.toLowerCase();
      list = list.filter(s => s.userEmail.toLowerCase().includes(q) || s.labTitle.toLowerCase().includes(q));
    }
    return list;
  }, [perStudent, studentOrgFilter, studentLabFilter, studentSearch]);

  // Charts data
  const labCompletionData = useMemo(() =>
    perLab.filter(l => l.totalStudents > 0).map(l => ({
      name: l.title.length > 25 ? l.title.slice(0, 25) + '...' : l.title,
      'Completion %': l.completionRate,
    })), [perLab]);

  const difficultyData = useMemo(() => {
    const counts = {};
    perLab.forEach(l => { counts[l.difficulty] = (counts[l.difficulty] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [perLab]);

  const stepChartData = useMemo(() =>
    selectedLabSteps.map(s => ({
      name: `Step ${s.stepOrder}`,
      'Completion %': s.completionRate,
      'Hints %': s.hintRate,
    })), [selectedLabSteps]);

  // CSV download
  const downloadCSV = () => {
    const header = ['Organization', 'Email', 'Lab', 'Training', 'Progress %', 'Steps Done', 'Total Steps', 'Started', 'Completed', 'Time (min)', 'Hints Used'];
    const rows = filteredStudents.map(s => [
      `"${s.organization || ''}"`, s.userEmail, `"${s.labTitle}"`, s.trainingName, s.progressPct,
      s.completedSteps, s.totalSteps,
      s.startedAt ? new Date(s.startedAt).toLocaleString('en-IN') : '',
      s.completedAt ? new Date(s.completedAt).toLocaleString('en-IN') : '',
      s.timeTakenMinutes ?? '', s.hintsUsed,
    ].join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `guided-lab-analytics${selectedOrg ? '_' + selectedOrg : ''}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <FaSpinner className="animate-spin text-2xl text-blue-500 mb-3" />
        <p className="text-sm text-gray-500">Loading analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-xl text-center">
        <FaExclamationTriangle className="inline text-red-400 mb-2" />
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/guided-labs')} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <FaArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <FaChartBar className="w-5 h-5 text-emerald-600" /> Guided Lab Analytics
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Completion rates, bottleneck steps, and student progress</p>
          </div>
        </div>
        {isSuperAdmin && organizations.length > 0 ? (
          <select
            value={selectedOrg}
            onChange={e => setSelectedOrg(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Organizations</option>
            {organizations.map(org => <option key={org} value={org}>{org}</option>)}
          </select>
        ) : !isSuperAdmin && userOrg ? (
          <span className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium">{userOrg}</span>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ══════════ Overview Tab ══════════ */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={FaBookOpen} title="Total Labs" value={numberFmt(overview.totalLabs)} subtitle={`${overview.totalEnrollments || 0} total enrollments`} accent="blue" />
            <KpiCard icon={FaUsers} title="Unique Students" value={numberFmt(overview.totalStudents)} accent="indigo" />
            <KpiCard icon={FaCheckCircle} title="Completion Rate" value={`${overview.overallCompletionRate || 0}%`} subtitle={`${overview.completedCount || 0} completed`} accent="emerald" />
            <KpiCard icon={FaClock} title="Avg Completion Time" value={overview.avgTimeMinutes > 0 ? `${overview.avgTimeMinutes} min` : '--'} accent="amber" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Section title="Completion Rate by Lab" className="lg:col-span-2">
              {labCompletionData.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(200, labCompletionData.length * 40)}>
                  <BarChart data={labCompletionData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="Completion %" radius={[0, 6, 6, 0]} fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No enrollment data yet</p>
              )}
            </Section>

            <Section title="Labs by Difficulty">
              {difficultyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={difficultyData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {difficultyData.map((d, i) => (
                        <Cell key={i} fill={DIFFICULTY_COLORS[d.name.toLowerCase()] || COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No labs yet</p>
              )}
            </Section>
          </div>
        </div>
      )}

      {/* ══════════ Per Lab Tab ══════════ */}
      {tab === 'perLab' && (
        <Section title="Lab Performance" subtitle="Click a row to view step-by-step analysis">
          {perLab.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No guided labs found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {[...(isSuperAdmin ? ['Organization'] : []), 'Lab Title', 'Cloud', 'Difficulty', 'Steps', 'Students', 'Completed', 'Rate', 'Avg Time'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {perLab.map(l => (
                    <tr
                      key={l.labId}
                      onClick={() => { setSelectedLabId(l.labId); setTab('steps'); }}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      {isSuperAdmin && (
                        <td className="px-4 py-2.5 text-gray-500 text-xs">
                          {(l.assignedOrgs || []).length > 0
                            ? l.assignedOrgs.join(', ')
                            : <span className="text-gray-300">All</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-medium text-gray-800">{l.title}</td>
                      <td className="px-4 py-2.5 text-gray-600 capitalize">{l.cloud || '--'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          l.difficulty === 'beginner' ? 'bg-green-100 text-green-700' :
                          l.difficulty === 'intermediate' ? 'bg-yellow-100 text-yellow-700' :
                          l.difficulty === 'advanced' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                        }`}>{l.difficulty || '--'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{l.totalSteps}</td>
                      <td className="px-4 py-2.5 text-gray-600">{l.totalStudents}</td>
                      <td className="px-4 py-2.5 text-gray-600">{l.completedStudents}</td>
                      <td className="px-4 py-2.5"><CompletionBar pct={l.completionRate} /></td>
                      <td className="px-4 py-2.5 text-gray-500">{l.avgTimeMinutes > 0 ? `${l.avgTimeMinutes} min` : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* ══════════ Step Analysis Tab ══════════ */}
      {tab === 'steps' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-600">Lab:</label>
            <select
              value={selectedLabId}
              onChange={e => setSelectedLabId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[250px]"
            >
              <option value="">All Labs (aggregated)</option>
              {perLab.map(l => <option key={l.labId} value={l.labId}>{l.title}</option>)}
            </select>
          </div>

          {selectedLabSteps.length > 0 && (
            <Section title="Step Completion Rates" subtitle="Sorted by completion rate (lowest first to surface bottlenecks)">
              <ResponsiveContainer width="100%" height={Math.max(200, selectedLabSteps.length * 36)}>
                <BarChart data={stepChartData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="Completion %" radius={[0, 4, 4, 0]}>
                    {stepChartData.map((s, i) => {
                      const pct = s['Completion %'];
                      return <Cell key={i} fill={pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'} />;
                    })}
                  </Bar>
                  <Bar dataKey="Hints %" radius={[0, 4, 4, 0]} fill="#8b5cf6" opacity={0.5} />
                </BarChart>
              </ResponsiveContainer>
            </Section>
          )}

          <Section title="Step Details">
            {selectedLabSteps.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No step data available. Select a lab with enrolled students.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {['Step', 'Title', 'Verify', 'Completion', 'Hints Used', 'Auto-verify Fail'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedLabSteps.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 text-gray-600">{s.stepOrder}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[300px] truncate">{s.stepTitle}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            s.verifyType === 'auto' ? 'bg-blue-50 text-blue-700' :
                            s.verifyType === 'manual' ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-400'
                          }`}>
                            {s.verifyType === 'auto' && <FaRobot className="w-2 h-2" />}
                            {s.verifyType || 'none'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><CompletionBar pct={s.completionRate} /></td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <FaLightbulb className={`w-2.5 h-2.5 ${s.hintRate > 50 ? 'text-amber-500' : 'text-gray-300'}`} />
                            {s.hintRate}% ({s.hintViewedCount}/{s.totalStudents})
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {s.autoVerifyFailRate > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-600">
                              <FaExclamationTriangle className="w-2.5 h-2.5" /> {s.autoVerifyFailRate}%
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">--</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ══════════ Students Tab ══════════ */}
      {tab === 'students' && (
        <div className="space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-gray-900">{filteredStudents.length}</div>
              <div className="text-[11px] text-gray-500">Total Enrollments</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-emerald-600">{filteredStudents.filter(s => s.completedAt).length}</div>
              <div className="text-[11px] text-gray-500">Completed</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-blue-600">{filteredStudents.filter(s => !s.completedAt && s.progressPct > 0).length}</div>
              <div className="text-[11px] text-gray-500">In Progress</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-lg font-semibold text-amber-600">
                {filteredStudents.length > 0 ? Math.round(filteredStudents.reduce((s, st) => s + st.hintsUsed, 0) / filteredStudents.length * 10) / 10 : 0}
              </div>
              <div className="text-[11px] text-gray-500">Avg Hints/Student</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by email or lab name..."
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {isSuperAdmin && studentOrgs.length > 1 && (
              <select
                value={studentOrgFilter}
                onChange={e => setStudentOrgFilter(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
              >
                <option value="">All Orgs</option>
                {studentOrgs.map(org => <option key={org} value={org}>{org}</option>)}
              </select>
            )}
            <select
              value={studentLabFilter}
              onChange={e => setStudentLabFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
            >
              <option value="">All Labs</option>
              {perLab.map(l => <option key={l.labId} value={l.labId}>{l.title}</option>)}
            </select>
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <FaDownload className="w-3 h-3" /> CSV
            </button>
          </div>

          {/* Table */}
          <Section>
            {filteredStudents.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No student progress data found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {[...(isSuperAdmin ? ['Org'] : []), 'Email', 'Lab', 'Training', 'Progress', 'Steps', 'Started', 'Completed', 'Time', 'Hints'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredStudents.slice(0, 200).map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        {isSuperAdmin && <td className="px-3 py-2.5 text-gray-500 text-xs">{s.organization || '--'}</td>}
                        <td className="px-3 py-2.5 font-medium text-gray-800">{s.userEmail}</td>
                        <td className="px-3 py-2.5 text-gray-600 max-w-[150px] truncate">{s.labTitle}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{s.trainingName}</td>
                        <td className="px-3 py-2.5"><CompletionBar pct={s.progressPct} /></td>
                        <td className="px-3 py-2.5 text-gray-600">{s.completedSteps}/{s.totalSteps}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{s.startedAt ? new Date(s.startedAt).toLocaleString('en-IN') : '--'}</td>
                        <td className="px-3 py-2.5">
                          {s.completedAt ? (
                            <span className="text-emerald-600 text-xs">{new Date(s.completedAt).toLocaleString('en-IN')}</span>
                          ) : (
                            <span className="text-gray-400 text-xs">In progress</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{s.timeTakenMinutes != null ? `${s.timeTakenMinutes} min` : '--'}</td>
                        <td className="px-3 py-2.5 text-gray-500">{s.hintsUsed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredStudents.length > 200 && (
                  <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                    Showing 200 of {filteredStudents.length} records. Use CSV export for full data.
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
