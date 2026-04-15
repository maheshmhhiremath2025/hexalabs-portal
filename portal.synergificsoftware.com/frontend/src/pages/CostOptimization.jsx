import React, { useState } from 'react';
import apiCaller from '../services/apiCaller';
import { FaSearch, FaTrash, FaArrowDown, FaExclamationTriangle, FaMoon, FaSun, FaSpinner } from 'react-icons/fa';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export default function CostOptimization() {
  const [tab, setTab] = useState('orphans');
  const [orphans, setOrphans] = useState(null);
  const [rightSizing, setRightSizing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);

  const scanOrphans = async () => {
    setLoading(true); setError(null);
    try { setOrphans((await apiCaller.get('/admin/optimize/orphans')).data); }
    catch (e) { setError(e.response?.data?.message || 'Scan failed'); }
    finally { setLoading(false); }
  };

  const deleteOrphan = async (type, resourceGroup, name) => {
    setDeleting(`${type}-${name}`);
    try {
      await apiCaller.delete('/admin/optimize/orphan', { data: { type, resourceGroup, name } });
      // Remove from local state
      const typeMap = { nic: 'nics', publicIp: 'publicIps', nsg: 'nsgs', disk: 'disks', snapshot: 'snapshots' };
      setOrphans(prev => ({
        ...prev,
        [typeMap[type]]: prev[typeMap[type]].filter(r => r.name !== name),
        totalCount: prev.totalCount - 1,
      }));
    } catch (e) { setError(e.response?.data?.message || 'Delete failed'); }
    finally { setDeleting(null); }
  };

  const scanRightSizing = async () => {
    setLoading(true); setError(null);
    try { setRightSizing((await apiCaller.get('/admin/optimize/rightsizing')).data); }
    catch (e) { setError(e.response?.data?.message || 'Analysis failed'); }
    finally { setLoading(false); }
  };

  const tabs = [
    { key: 'orphans', label: 'Orphan Cleanup', icon: FaTrash },
    { key: 'rightsizing', label: 'Right-Sizing', icon: FaArrowDown },
    { key: 'nightmode', label: 'Night Scale-Down', icon: FaMoon },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Cost Optimization</h1>
        <p className="text-sm text-gray-500 mt-0.5">Find and eliminate wasted Azure spend</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>

      {/* Orphan Cleanup */}
      {tab === 'orphans' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Scan Azure for leaked NICs, public IPs, unattached disks, and old snapshots.</p>
            <button onClick={scanOrphans} disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaSearch className="w-3 h-3" />}
              {loading ? 'Scanning...' : 'Scan Azure'}
            </button>
          </div>

          {orphans && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="Orphan Resources" value={orphans.totalCount} color={orphans.totalCount > 0 ? 'text-red-600' : 'text-green-600'} />
                <SummaryCard label="Wasted/Month" value={formatINR(orphans.totalMonthlyCost)} color="text-red-600" />
                <SummaryCard label="Unattached Disks" value={orphans.disks.length} />
                <SummaryCard label="Unused Public IPs" value={orphans.publicIps.length} />
              </div>

              {orphans.totalCount === 0 ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                  <p className="text-green-800 font-medium">No orphan resources found. Your Azure environment is clean.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {orphans.disks.length > 0 && (
                    <OrphanTable title="Unattached Disks" items={orphans.disks} type="disk"
                      columns={[{ key: 'sizeGB', label: 'Size', fmt: v => `${v} GB` }, { key: 'sku', label: 'Tier' }]}
                      onDelete={deleteOrphan} deleting={deleting} />
                  )}
                  {orphans.publicIps.length > 0 && (
                    <OrphanTable title="Unused Public IPs" items={orphans.publicIps} type="publicIp"
                      columns={[{ key: 'ipAddress', label: 'IP' }, { key: 'allocationMethod', label: 'Type' }]}
                      onDelete={deleteOrphan} deleting={deleting} />
                  )}
                  {orphans.snapshots.length > 0 && (
                    <OrphanTable title="Old Snapshots (>30 days)" items={orphans.snapshots} type="snapshot"
                      columns={[{ key: 'sizeGB', label: 'Size', fmt: v => `${v} GB` }, { key: 'age', label: 'Age', fmt: v => `${v} days` }]}
                      onDelete={deleteOrphan} deleting={deleting} />
                  )}
                  {orphans.nics.length > 0 && (
                    <OrphanTable title="Orphan NICs" items={orphans.nics} type="nic" columns={[]}
                      onDelete={deleteOrphan} deleting={deleting} />
                  )}
                  {orphans.nsgs.length > 0 && (
                    <OrphanTable title="Orphan NSGs" items={orphans.nsgs} type="nsg" columns={[]}
                      onDelete={deleteOrphan} deleting={deleting} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Right-Sizing */}
      {tab === 'rightsizing' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">Analyze running VMs and find ones that can be downsized based on 7-day CPU usage.</p>
            <button onClick={scanRightSizing} disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaSearch className="w-3 h-3" />}
              {loading ? 'Analyzing...' : 'Analyze VMs'}
            </button>
          </div>

          {rightSizing && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard label="VMs Analyzed" value={rightSizing.summary.totalVmsAnalyzed} />
                <SummaryCard label="Oversized" value={rightSizing.summary.oversizedCount} color={rightSizing.summary.oversizedCount > 0 ? 'text-amber-600' : 'text-green-600'} />
                <SummaryCard label="Monthly Savings" value={formatINR(rightSizing.summary.totalMonthlySavings)} color="text-green-600" />
                <SummaryCard label="High Confidence" value={rightSizing.summary.highConfidence} />
              </div>

              {rightSizing.recommendations.length === 0 ? (
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                  <p className="text-green-800 font-medium">All VMs are properly sized. No downsizing recommended.</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[13px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          {['VM', 'Organization', 'Current Size', 'Avg CPU', 'Peak CPU', 'Recommended', 'Monthly Savings', 'Confidence'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rightSizing.recommendations.map(r => (
                          <tr key={r.vmName} className="hover:bg-gray-50/50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-gray-800">{r.vmName}</div>
                              <div className="text-[11px] text-gray-400">{r.trainingName}</div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">{r.organization}</td>
                            <td className="px-4 py-2.5">
                              <span className="text-red-600 font-medium">{r.currentSize}</span>
                              <span className="text-gray-400 text-xs ml-1">({formatINR(r.currentCost)}/hr)</span>
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">{r.metrics.avgCpu}%</td>
                            <td className="px-4 py-2.5 tabular-nums">{r.metrics.peakCpu}%</td>
                            <td className="px-4 py-2.5">
                              <span className="text-green-600 font-medium">{r.recommendedSize}</span>
                              <span className="text-gray-400 text-xs ml-1">({formatINR(r.recommendedCost)}/hr)</span>
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-green-600 tabular-nums">{formatINR(r.savings.monthly)}</td>
                            <td className="px-4 py-2.5">
                              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                r.confidence === 'high' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                              }`}>{r.confidence}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Night Scale-Down */}
      {tab === 'nightmode' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-6" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                <FaMoon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">K8s Night Mode</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Automatically scales the AKS lab node pool down to 1 node at <strong>11 PM IST</strong> and back up at <strong>7 AM IST</strong>.
                  This saves ~60% on node costs during off-hours.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FaMoon className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-sm font-semibold text-gray-800">Night (11 PM - 7 AM IST)</span>
                </div>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between"><span>Min nodes</span><span className="font-medium">1</span></div>
                  <div className="flex justify-between"><span>Max nodes</span><span className="font-medium">3</span></div>
                  <div className="flex justify-between"><span>Max labs</span><span className="font-medium">~15-20</span></div>
                  <div className="flex justify-between"><span>Estimated cost</span><span className="font-medium text-green-600">₹3.5/hr</span></div>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FaSun className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-sm font-semibold text-gray-800">Day (7 AM - 11 PM IST)</span>
                </div>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between"><span>Min nodes</span><span className="font-medium">3</span></div>
                  <div className="flex justify-between"><span>Max nodes</span><span className="font-medium">20</span></div>
                  <div className="flex justify-between"><span>Max labs</span><span className="font-medium">~300-400</span></div>
                  <div className="flex justify-between"><span>Estimated cost</span><span className="font-medium">₹10.5-70/hr</span></div>
                </div>
              </div>
            </div>

            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Estimated monthly savings:</strong> Assuming 8 hours of reduced capacity nightly,
                saving ~₹50/hr on average = <strong className="text-blue-900">₹12,000/month</strong> on node costs.
              </p>
            </div>

            <div className="mt-4">
              <p className="text-xs text-gray-500">
                Deploy with: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">kubectl apply -f k8s/night-scaler.yaml</code>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-500 uppercase font-semibold tracking-wider">{label}</div>
    </div>
  );
}

function OrphanTable({ title, items, type, columns, onDelete, deleting }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{title} ({items.length})</h3>
        <span className="text-xs text-red-500 font-medium">{formatINR(items.reduce((s, i) => s + (i.monthlyCost || 0), 0))}/mo</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Resource Group</th>
              {columns.map(c => <th key={c.key} className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{c.label}</th>)}
              <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cost/mo</th>
              <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(item => (
              <tr key={item.name} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 font-medium text-gray-800">{item.name}</td>
                <td className="px-4 py-2 text-gray-600">{item.resourceGroup}</td>
                {columns.map(c => <td key={c.key} className="px-4 py-2 text-gray-600">{c.fmt ? c.fmt(item[c.key]) : item[c.key]}</td>)}
                <td className="px-4 py-2 text-right text-red-600 font-medium tabular-nums">{formatINR(item.monthlyCost)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => onDelete(type, item.resourceGroup, item.name)}
                    disabled={deleting === `${type}-${item.name}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-red-600 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50 transition-colors">
                    {deleting === `${type}-${item.name}` ? <FaSpinner className="w-2.5 h-2.5 animate-spin" /> : <FaTrash className="w-2.5 h-2.5" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
