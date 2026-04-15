import React, { useState, useEffect, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import { costApiRoutes } from '../services/apiRoutes';
import { FaSync, FaChevronRight, FaArrowUp, FaArrowDown } from 'react-icons/fa';

function formatINR(amount) {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function StatCard({ label, value, subtext, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tracking-tight ${color || 'text-gray-900'}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  );
}

function ProfitIndicator({ profit, margin }) {
  const isPositive = profit >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${isPositive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
      {isPositive ? <FaArrowUp className="text-[9px]" /> : <FaArrowDown className="text-[9px]" />}
      {margin}%
    </span>
  );
}

export default function CostAnalytics() {
  const [overview, setOverview] = useState(null);
  const [orgSummary, setOrgSummary] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgLabs, setOrgLabs] = useState([]);
  const [selectedLab, setSelectedLab] = useState(null);
  const [labDetail, setLabDetail] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unified, setUnified] = useState(null);
  const [unifiedLoading, setUnifiedLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [ovRes, sumRes] = await Promise.all([
        apiCaller.get(costApiRoutes.costOverview),
        apiCaller.get(costApiRoutes.costSummary),
      ]);
      setOverview(ovRes.data);
      setOrgSummary(sumRes.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load cost data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch unified P&L (all resource types)
  useEffect(() => {
    setUnifiedLoading(true);
    apiCaller.get('/admin/costs/unified')
      .then(r => setUnified(r.data))
      .catch(() => setUnified(null))
      .finally(() => setUnifiedLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiCaller.post(costApiRoutes.costSync);
      await fetchData();
    } catch (err) {
      setError(err.response?.data?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleOrgClick = async (org) => {
    setSelectedOrg(org);
    setSelectedLab(null);
    setLabDetail(null);
    try {
      const res = await apiCaller.get(costApiRoutes.costOrgLabs, { params: { organization: org } });
      setOrgLabs(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load labs');
    }
  };

  const handleLabClick = async (lab) => {
    setSelectedLab(lab.trainingName);
    try {
      const res = await apiCaller.get(costApiRoutes.costLab, {
        params: { trainingName: lab.trainingName, organization: lab.organization },
      });
      setLabDetail(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load lab details');
    }
  };

  const handleBack = () => {
    if (selectedLab) {
      setSelectedLab(null);
      setLabDetail(null);
    } else if (selectedOrg) {
      setSelectedOrg(null);
      setOrgLabs([]);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
          </div>
          <div className="h-64 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            {(selectedOrg || selectedLab) && (
              <button onClick={handleBack} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                &larr; Back
              </button>
            )}
            <h1 className="text-lg font-semibold text-gray-900">
              {selectedLab ? `${selectedLab}` : selectedOrg ? `${selectedOrg}` : 'Cost Analytics'}
            </h1>
          </div>
          {!selectedOrg && (
            <p className="text-sm text-gray-500 mt-0.5">
              Real-time Azure infrastructure costs mapped to labs
              {overview?.lastSynced && (
                <span className="ml-2 text-gray-400">
                  &middot; Last synced {new Date(overview.lastSynced).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <FaSync className={`text-xs ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from Azure'}
        </button>
      </div>

      {/* Unified P&L — all resource types combined */}
      {!selectedOrg && !selectedLab && unified && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <div className="text-sm font-semibold text-gray-900">Platform P&L — All Resource Types</div>
            <div className="text-xs text-gray-500">Azure VMs + Containers + AWS Sandboxes + GCP Sandboxes + RDS</div>
          </div>
          <div className="p-5">
            {/* Top-line metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              <StatCard label="Total Revenue" value={formatINR(unified.summary?.totalRevenue)} color="text-blue-700" />
              <StatCard label="Total Infra Spend" value={formatINR(unified.summary?.totalInfraSpend)} color="text-red-700" />
              <StatCard label="Total Profit" value={formatINR(unified.summary?.totalProfit)} color={unified.summary?.totalProfit >= 0 ? 'text-green-700' : 'text-red-700'} subtext={<ProfitIndicator profit={unified.summary?.totalProfit || 0} margin={unified.summary?.profitMargin || 0} />} />
              <StatCard label="Profit Margin" value={`${unified.summary?.profitMargin || 0}%`} color={unified.summary?.profitMargin >= 30 ? 'text-green-700' : 'text-amber-700'} />
            </div>

            {/* Per resource type breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Azure VMs */}
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Azure VMs</div>
                <div className="text-lg font-semibold text-gray-900">{formatINR(unified.azureVMs?.totalSpend)}</div>
                <div className="text-xs text-gray-500">{unified.azureVMs?.vmCount || 0} VMs · {unified.azureVMs?.labCount || 0} labs</div>
                {unified.azureVMs?.profit != null && (
                  <div className={`text-xs font-medium mt-1 ${unified.azureVMs.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    Profit: {formatINR(unified.azureVMs.profit)}
                  </div>
                )}
              </div>

              {/* Containers */}
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Workspaces</div>
                <div className="text-lg font-semibold text-gray-900">{formatINR(unified.containers?.totalSpend)}</div>
                <div className="text-xs text-gray-500">{unified.containers?.totalContainers || 0} workspaces · {unified.containers?.totalHours || 0}h</div>
                {unified.containers?.savings > 0 && (
                  <div className="text-xs font-medium text-green-600 mt-1">
                    Saved {formatINR(unified.containers.savings)} vs Azure VMs ({unified.containers.savingsPercent}%)
                  </div>
                )}
              </div>

              {/* Cloud Sandboxes */}
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Cloud Sandboxes</div>
                <div className="text-lg font-semibold text-gray-900">{unified.sandboxes?.totalDeployments || 0} deployed</div>
                <div className="text-xs text-gray-500">
                  AWS: {unified.sandboxes?.aws?.total || 0} · Azure: {unified.sandboxes?.azure?.total || 0} · GCP: {unified.sandboxes?.gcp?.total || 0}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Budget allocated: {formatINR(unified.sandboxes?.totalBudgetAllocated)}
                </div>
                <div className="text-xs text-amber-600 mt-1">{unified.sandboxes?.activeDeployments || 0} currently active</div>
              </div>

              {/* RDS */}
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Windows Desktop</div>
                <div className="text-lg font-semibold text-gray-900">{formatINR(unified.rds?.totalBilled)}</div>
                <div className="text-xs text-gray-500">{unified.rds?.totalVMs || 0} sessions · {unified.rds?.totalHours || 0}h</div>
                <div className="text-xs text-gray-500 mt-1">{unified.rds?.runningVMs || 0} currently running</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Overview stats - only show at top level */}
      {!selectedOrg && overview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Azure Spend" value={formatINR(overview.totalAzureCost)} color="text-red-600" />
          <StatCard label="Billed to Clients" value={formatINR(overview.totalBilled)} color="text-blue-600" />
          <StatCard
            label="Net Profit"
            value={formatINR(overview.totalProfit)}
            color={overview.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}
            subtext={`${overview.margin}% margin`}
          />
          <StatCard label="Active Labs" value={overview.totalLabs} />
          <StatCard label="Total VMs" value={overview.totalVMs} />
        </div>
      )}

      {/* Organization list */}
      {!selectedOrg && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Cost by Organization</h2>
            <span className="text-xs text-gray-400">{orgSummary.length} organizations</span>
          </div>
          <div className="divide-y divide-gray-100">
            {orgSummary.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No cost data yet. Click "Sync from Azure" to fetch costs.
              </div>
            ) : (
              orgSummary.map((org) => (
                <button
                  key={org.organization}
                  onClick={() => handleOrgClick(org.organization)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{org.organization}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {org.labCount} lab{org.labCount !== 1 ? 's' : ''} &middot; {org.totalVMs} VMs
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <div className="text-xs text-gray-400">Azure Cost</div>
                      <div className="text-sm font-medium text-red-600">{formatINR(org.totalAzureCost)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Billed</div>
                      <div className="text-sm font-medium text-blue-600">{formatINR(org.totalBilledAmount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Profit</div>
                      <div className="text-sm font-medium">
                        {formatINR(org.totalProfit)}
                        <span className="ml-1.5"><ProfitIndicator profit={org.totalProfit} margin={org.margin} /></span>
                      </div>
                    </div>
                    <FaChevronRight className="text-gray-300 text-xs" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Labs for selected org */}
      {selectedOrg && !selectedLab && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3.5 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-800">Labs for {selectedOrg}</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {orgLabs.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No labs found</div>
            ) : (
              orgLabs.map((lab) => (
                <button
                  key={lab.trainingName}
                  onClick={() => handleLabClick(lab)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors text-left"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-800">{lab.trainingName}</div>
                    <div className="text-xs text-gray-500">{lab.vmCount} VMs &middot; {lab.periodStart && new Date(lab.periodStart).toLocaleDateString('en-IN')} - {lab.periodEnd && new Date(lab.periodEnd).toLocaleDateString('en-IN')}</div>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <div className="text-xs text-gray-400">Azure</div>
                      <div className="text-sm font-medium text-red-600">{formatINR(lab.totalAzureCost)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Billed</div>
                      <div className="text-sm font-medium text-blue-600">{formatINR(lab.totalBilledAmount)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Profit</div>
                      <div className="text-sm font-medium text-green-600">{formatINR(lab.profit)}</div>
                    </div>
                    <FaChevronRight className="text-gray-300 text-xs" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Lab detail - per VM breakdown */}
      {selectedLab && labDetail && (
        <div className="space-y-4">
          {/* Lab summary */}
          {labDetail.costs?.[0] && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Azure Spend" value={formatINR(labDetail.costs[0].totalAzureCost)} color="text-red-600" />
              <StatCard label="Billed" value={formatINR(labDetail.costs[0].totalBilledAmount)} color="text-blue-600" />
              <StatCard
                label="Profit"
                value={formatINR(labDetail.costs[0].profit)}
                color={labDetail.costs[0].profit >= 0 ? 'text-green-600' : 'text-red-600'}
              />
              <StatCard label="VMs" value={labDetail.costs[0].vmCount} />
            </div>
          )}

          {/* VM cost breakdown table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="px-5 py-3.5 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-800">Per-VM Cost Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">VM Name</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Compute</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">OS Disk</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Data Disk</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Network</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Snapshots</th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="py-2.5 px-4 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {labDetail.costs?.[0]?.vmCosts?.map((vc) => {
                    const vm = labDetail.vms?.find(v => v.name === vc.vmName);
                    return (
                      <tr key={vc.vmName} className="hover:bg-gray-50/50">
                        <td className="py-2.5 px-4 font-medium text-gray-800">{vc.vmName}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vc.compute)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vc.osDisk)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vc.dataDisk)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vc.networking)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vc.snapshots)}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-gray-900">{formatINR(vc.total)}</td>
                        <td className="py-2.5 px-4 text-center">
                          {vm ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              vm.isRunning ? 'bg-green-50 text-green-700' :
                              vm.isAlive ? 'bg-yellow-50 text-yellow-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {vm.isRunning ? 'Running' : vm.isAlive ? 'Stopped' : 'Terminated'}
                            </span>
                          ) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* VM runtime/billing info */}
          {labDetail.vms?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3.5 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-800">VM Runtime & Billing Rate</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">VM Name</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Runtime (hrs)</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Rate/hr</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Billed Amount</th>
                      <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Quota Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {labDetail.vms.map((vm) => {
                      const hours = ((vm.duration || 0) / 3600).toFixed(1);
                      const billed = ((vm.duration || 0) / 3600) * (vm.rate || 0);
                      const quotaPct = vm.quota?.total > 0
                        ? Math.round((vm.quota.consumed / vm.quota.total) * 100)
                        : 0;
                      return (
                        <tr key={vm.name} className="hover:bg-gray-50/50">
                          <td className="py-2.5 px-4 font-medium text-gray-800">{vm.name}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{hours}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums text-gray-600">{formatINR(vm.rate)}</td>
                          <td className="py-2.5 px-4 text-right tabular-nums font-medium text-blue-600">{formatINR(billed)}</td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${quotaPct > 90 ? 'bg-red-500' : quotaPct > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                  style={{ width: `${Math.min(quotaPct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 tabular-nums w-8">{quotaPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
