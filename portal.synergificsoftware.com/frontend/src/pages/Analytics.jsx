import React, { useState, useEffect } from 'react';
import apiCaller from '../services/apiCaller';
import { FaServer, FaDocker, FaUsers, FaClock, FaExclamationTriangle, FaArrowDown } from 'react-icons/fa';

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
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[['overview', 'Overview'], ['customers', 'Customers'], ['idle', 'Idle Risk']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
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
