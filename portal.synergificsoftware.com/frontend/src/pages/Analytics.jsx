import React, { useState, useEffect } from 'react';
import apiCaller from '../services/apiCaller';
import { FaServer, FaDocker, FaUsers, FaClock, FaExclamationTriangle, FaArrowDown, FaUserGraduate, FaSearch, FaDownload } from 'react-icons/fa';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

function Stat({ label, value, sub, icon: Icon, color = 'bg-gray-50 text-gray-600' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
        <div>
          <div className="text-xl font-bold text-gray-900">{value}</div>
          <div className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">{label}</div>
        </div>
      </div>
      {sub && <div className="text-xs text-gray-400 mt-2">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const [overview, setOverview] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [idle, setIdle] = useState(null);
  const [students, setStudents] = useState(null);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentFilter, setStudentFilter] = useState({ trainingName: '', organization: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    Promise.all([
      apiCaller.get('/admin/analytics/overview'),
      apiCaller.get('/admin/analytics/customers'),
      apiCaller.get('/admin/analytics/idle'),
    ]).then(([o, c, i]) => {
      setOverview(o.data);
      setCustomers(c.data);
      setIdle(i.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const fetchStudents = async () => {
    setStudentsLoading(true);
    try {
      const params = {};
      if (studentFilter.trainingName) params.trainingName = studentFilter.trainingName;
      if (studentFilter.organization) params.organization = studentFilter.organization;
      const r = await apiCaller.get('/admin/analytics/students', { params });
      setStudents(r.data);
    } catch { setStudents({ students: [], total: 0 }); }
    finally { setStudentsLoading(false); }
  };

  useEffect(() => {
    if (tab === 'students' && !students) fetchStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const downloadStudentsCsv = () => {
    if (!students?.students?.length) return;
    const header = ['Email', 'Trainings', 'VMs', 'Workspaces', 'Total Hours', 'Total Cost (INR)', 'Last Active'];
    const rows = filteredStudents.map(s => [
      s.email,
      s.trainings.join('; '),
      s.vmInstances,
      s.containerInstances,
      s.totalHours,
      s.totalCost,
      s.lastSeen ? new Date(s.lastSeen).toISOString() : '',
    ]);
    const escape = v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `students-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredStudents = (() => {
    if (!students?.students) return [];
    const q = studentFilter.search.trim().toLowerCase();
    if (!q) return students.students;
    return students.students.filter(s =>
      s.email.toLowerCase().includes(q) ||
      s.trainings.some(t => t.toLowerCase().includes(q))
    );
  })();

  if (loading) return (
    <div className="max-w-6xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="grid grid-cols-5 gap-4">{[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}</div>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Usage Analytics</h1>
        <p className="text-sm text-gray-500 mt-0.5">Business metrics, customer usage, and cost optimization insights</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit overflow-x-auto">
        {[['overview', 'Overview'], ['customers', 'Customers'], ['students', 'Per Student'], ['idle', 'Idle Risk']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat icon={FaServer} label="Azure VMs" value={overview.instances.vms.total} sub={`${overview.instances.vms.running} running`} color="bg-blue-50 text-blue-600" />
            <Stat icon={FaDocker} label="Workspaces" value={overview.instances.containers.total} sub={`${overview.instances.containers.running} running`} color="bg-cyan-50 text-cyan-600" />
            <Stat icon={FaClock} label="Runtime" value={`${overview.usage.totalRuntimeHours}h`} sub={`VM: ${overview.usage.vmRuntimeHours}h | Workspace: ${overview.usage.containerRuntimeHours}h`} color="bg-purple-50 text-purple-600" />
            <Stat icon={FaUsers} label="Organizations" value={overview.counts.organizations} sub={`${overview.counts.users} users · ${overview.counts.trainings} labs`} color="bg-green-50 text-green-600" />
            <Stat icon={FaArrowDown} label="Workspace Savings" value={formatINR(overview.revenue.containerSavings)} sub="vs running on Azure VMs" color="bg-emerald-50 text-emerald-600" />
          </div>

          {/* Revenue breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Revenue Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">VM Revenue</span>
                  <span className="text-sm font-semibold text-gray-900">{formatINR(overview.revenue.vmRevenue)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Workspace Revenue</span>
                  <span className="text-sm font-semibold text-gray-900">{formatINR(overview.revenue.containerRevenue)}</span>
                </div>
                <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-800">Total Revenue</span>
                  <span className="text-base font-bold text-gray-900">{formatINR(overview.revenue.totalRevenue)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <h3 className="text-sm font-semibold text-gray-800 mb-4">Top Organizations</h3>
              {overview.topOrganizations?.length > 0 ? (
                <div className="space-y-2.5">
                  {overview.topOrganizations.slice(0, 5).map((org, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                        <span className="text-sm text-gray-700">{org._id}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-medium text-gray-900">{formatINR(org.totalInvoice)}</span>
                        <span className="text-[10px] text-gray-400 ml-1">invoiced</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">No transaction data yet</p>}
            </div>
          </div>
        </div>
      )}

      {/* Customers Tab */}
      {tab === 'customers' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3.5 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800">Customer Usage</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Organization', 'Labs', 'VMs', 'Workspaces', 'Running', 'Runtime', 'VM Revenue', 'Workspace Rev', 'Total', 'Idle VMs'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.map(c => (
                  <tr key={c.organization} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{c.organization}</td>
                    <td className="px-4 py-2.5 text-gray-600">{c.labs}</td>
                    <td className="px-4 py-2.5 text-gray-600">{c.instances.vms}</td>
                    <td className="px-4 py-2.5 text-gray-600">{c.instances.containers}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />{c.instances.running}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums">{c.runtimeHours}h</td>
                    <td className="px-4 py-2.5 text-gray-600 tabular-nums">{formatINR(c.vmRevenue)}</td>
                    <td className="px-4 py-2.5 text-green-600 tabular-nums">{formatINR(c.containerRevenue)}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-900 tabular-nums">{formatINR(c.revenue)}</td>
                    <td className="px-4 py-2.5">
                      {c.idleVms > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-[11px] font-semibold">
                          <FaExclamationTriangle className="w-2.5 h-2.5" />{c.idleVms}
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Student Tab */}
      {tab === 'students' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Training Name</label>
              <input value={studentFilter.trainingName} onChange={e => setStudentFilter(f => ({ ...f, trainingName: e.target.value }))} placeholder="all trainings"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Organization</label>
              <input value={studentFilter.organization} onChange={e => setStudentFilter(f => ({ ...f, organization: e.target.value }))} placeholder="all orgs"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Search</label>
              <div className="relative">
                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs" />
                <input value={studentFilter.search} onChange={e => setStudentFilter(f => ({ ...f, search: e.target.value }))} placeholder="email or training"
                  className="w-full pl-7 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>
            <button onClick={fetchStudents} disabled={studentsLoading}
              className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {studentsLoading ? 'Loading...' : 'Apply'}
            </button>
            <button onClick={downloadStudentsCsv} disabled={!filteredStudents.length}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              <FaDownload className="w-3 h-3" /> CSV
            </button>
          </div>

          {students && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat icon={FaUserGraduate} label="Students" value={students.total} sub={`${filteredStudents.length} shown`} color="bg-indigo-50 text-indigo-600" />
                <Stat icon={FaServer} label="Total VMs" value={filteredStudents.reduce((s, x) => s + x.vmInstances, 0)} color="bg-blue-50 text-blue-600" />
                <Stat icon={FaDocker} label="Total Workspaces" value={filteredStudents.reduce((s, x) => s + x.containerInstances, 0)} color="bg-cyan-50 text-cyan-600" />
                <Stat icon={FaClock} label="Total Hours" value={`${filteredStudents.reduce((s, x) => s + x.totalHours, 0)}h`} color="bg-purple-50 text-purple-600" />
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                {filteredStudents.length === 0 ? (
                  <div className="text-center py-12 text-sm text-gray-400">
                    {studentsLoading ? 'Loading…' : 'No students match this filter.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[13px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {['Email', 'Trainings', 'VMs', 'Workspaces', 'Active', 'Hours', 'Cost', 'Last Active'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredStudents.map(s => (
                          <tr key={s.email} className="hover:bg-gray-50/50">
                            <td className="px-4 py-2.5 font-medium text-gray-800 truncate max-w-[220px]" title={s.email}>{s.email}</td>
                            <td className="px-4 py-2.5 text-gray-600">
                              {s.trainings.length === 1 ? (
                                <span className="text-xs">{s.trainings[0]}</span>
                              ) : (
                                <span className="text-xs" title={s.trainings.join(', ')}>{s.trainings[0]} <span className="text-gray-400">+{s.trainings.length - 1}</span></span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">{s.vmInstances}</td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">{s.containerInstances}</td>
                            <td className="px-4 py-2.5">
                              {s.totalRunning > 0 ? (
                                <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />{s.totalRunning} live
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">{s.totalHours}h</td>
                            <td className="px-4 py-2.5 text-gray-600 tabular-nums">{formatINR(s.totalCost)}</td>
                            <td className="px-4 py-2.5 text-xs">
                              {s.lastSeen ? (
                                <span className={s.isStale ? 'text-amber-600' : 'text-gray-500'}>
                                  {new Date(s.lastSeen).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                  {s.isStale && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700">stale</span>}
                                </span>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Idle Risk Tab */}
      {tab === 'idle' && idle && (
        <div className="space-y-4">
          {/* Waste summary */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-1">
                <FaExclamationTriangle /> {idle.count} VMs running without auto-shutdown
              </div>
              <p className="text-sm text-amber-700">These VMs may be wasting money when users aren't actively using them.</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-amber-600 uppercase font-semibold">Potential waste</div>
              <div className="text-xl font-bold text-amber-800">{formatINR(idle.totalWastePerMonth)}/mo</div>
              <div className="text-xs text-amber-600">{formatINR(idle.totalWastePerHour)}/hr &middot; {formatINR(idle.totalWastePerDay)}/day</div>
            </div>
          </div>

          {idle.vms?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {['VM Name', 'Training', 'Organization', 'Rate/hr', 'Runtime', 'Quota Used', 'Monthly Cost'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {idle.vms.map(vm => (
                      <tr key={vm.name} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{vm.name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{vm.training}</td>
                        <td className="px-4 py-2.5 text-gray-600">{vm.organization}</td>
                        <td className="px-4 py-2.5 text-red-600 font-medium tabular-nums">{formatINR(vm.rate)}</td>
                        <td className="px-4 py-2.5 text-gray-600 tabular-nums">{vm.runtimeHours}h</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${vm.quotaUsed > 90 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${vm.quotaUsed}%` }} />
                            </div>
                            <span className="text-xs text-gray-500">{vm.quotaUsed}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-red-600 tabular-nums">{formatINR(vm.rate * 720)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
