import React, { useState, useEffect, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import { costApiRoutes } from '../services/apiRoutes';
import { FaSync, FaChevronDown, FaChevronRight, FaExclamationTriangle } from 'react-icons/fa';

const CLOUDS = [
  { key: 'azure', label: 'Azure',  color: 'bg-blue-50  text-blue-700  border-blue-200' },
  { key: 'aws',   label: 'AWS',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'gcp',   label: 'GCP',    color: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'oci',   label: 'OCI',    color: 'bg-red-50   text-red-700   border-red-200' },
];

const PERIOD_OPTIONS = [
  { key: 'this-month',  label: 'This month' },
  { key: 'last-month',  label: 'Last month' },
  { key: 'last-quarter',label: 'Last quarter (3 months)' },
  { key: '6m',          label: 'Last 6 months · slow first load' },
  { key: '1y',          label: 'Last 1 year · slow first load' },
  { key: 'all',         label: 'All time (12 months) · slow first load' },
];

// Compute {from, to} for each period. Returns {} for 'all' so backend defaults to last 12 months.
function periodToRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case 'this-month': {
      return { from: new Date(y, m, 1), to: now };
    }
    case 'last-month': {
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) };
    }
    case 'last-quarter': {
      return { from: new Date(now.getTime() - 90 * 86400000), to: now };
    }
    case '6m': {
      return { from: new Date(now.getTime() - 180 * 86400000), to: now };
    }
    case '1y': {
      return { from: new Date(now.getTime() - 364 * 86400000), to: now };
    }
    case 'all':
    default:
      return {};
  }
}

function formatINR(amount) {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}

function StatCard({ label, value, subtext, accent }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tracking-tight ${accent || 'text-gray-900'}`}>{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  );
}

function Caret({ open }) {
  return open ? <FaChevronDown className="text-[10px] text-gray-500" /> : <FaChevronRight className="text-[10px] text-gray-500" />;
}

// Org card: collapses/expands to reveal training labs + sandboxes for that org
function OrgCard({ org, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-xl mb-2 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-3">
          <Caret open={open} />
          <div>
            <div className="text-sm font-semibold text-gray-900">{org.org}</div>
            <div className="text-xs text-gray-500">
              {org.trainingLabs.length} lab{org.trainingLabs.length === 1 ? '' : 's'} · {org.sandboxes.length} sandbox template{org.sandboxes.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="text-base font-semibold text-gray-900 tabular-nums">{formatINR(org.totalInr)}</div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3">
          {org.trainingLabs.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Training labs</div>
              {org.trainingLabs.map(lab => <LabRow key={lab.trainingName} lab={lab} />)}
            </div>
          )}
          {org.sandboxes.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sandboxes</div>
              {org.sandboxes.map(sb => <SandboxRow key={sb.templateSlug} sandbox={sb} />)}
            </div>
          )}
          {org.trainingLabs.length === 0 && org.sandboxes.length === 0 && (
            <div className="text-xs text-gray-400 py-2">No spend in this period.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Lab row: expands to per-VM breakdown
function LabRow({ lab }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-1.5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <Caret open={open} />
          <span className="text-sm font-medium text-gray-800">{lab.trainingName}</span>
          <span className="text-xs text-gray-500">{lab.vms.length} VMs</span>
        </div>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatINR(lab.totalInr)}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">VM</th>
                <th className="text-left px-2 py-2 font-medium">SKU</th>
                <th className="text-right px-2 py-2 font-medium">Hours</th>
                <th className="text-right px-2 py-2 font-medium">Compute</th>
                <th className="text-right px-2 py-2 font-medium">Disk</th>
                <th className="text-right px-2 py-2 font-medium">Network</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lab.vms.map(vm => (
                <tr key={vm.name} className="border-t border-gray-100">
                  <td className="px-4 py-1.5 text-gray-800 font-mono text-[11px]">{vm.name}</td>
                  <td className="px-2 py-1.5 text-gray-500">{vm.sku || '-'}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{vm.hours?.toFixed(1) || '0.0'}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR(vm.breakdown?.compute)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR((vm.breakdown?.osDisk || 0) + (vm.breakdown?.dataDisk || 0) + (vm.breakdown?.snapshots || 0))}</td>
                  <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR(vm.breakdown?.networking)}</td>
                  <td className="px-4 py-1.5 text-right font-semibold text-gray-900 tabular-nums">{formatINR(vm.totalInr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Sandbox row: groups deployments by user (a user with multiple deploys = relaunches), expandable to per-RG history.
function SandboxRow({ sandbox }) {
  const [open, setOpen] = useState(false);
  // Group deployments by user.
  const groupedByUser = {};
  for (const d of sandbox.deployments) {
    const k = d.user || '(unknown)';
    if (!groupedByUser[k]) groupedByUser[k] = { user: k, totalInr: 0, deploys: [] };
    groupedByUser[k].totalInr += d.totalInr;
    groupedByUser[k].deploys.push(d);
  }
  const userRows = Object.values(groupedByUser).sort((a, b) => b.totalInr - a.totalInr);
  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-1.5">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <Caret open={open} />
          <span className="text-sm font-medium text-gray-800">{sandbox.templateName}</span>
          <span className="text-xs text-gray-500">
            {userRows.length} user{userRows.length === 1 ? '' : 's'}
            {sandbox.deployments.length !== userRows.length && ` · ${sandbox.deployments.length} deploys`}
          </span>
        </div>
        <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatINR(sandbox.totalInr)}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">User</th>
                <th className="text-left px-2 py-2 font-medium">Deploys</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u, i) => <UserDeploymentsRow key={i} user={u} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserDeploymentsRow({ user }) {
  const [open, setOpen] = useState(false);
  const single = user.deploys.length === 1;
  return (
    <>
      <tr className={`border-t border-gray-100 ${single ? '' : 'cursor-pointer hover:bg-gray-50'}`} onClick={() => !single && setOpen(!open)}>
        <td className="px-4 py-1.5 text-gray-800 text-[11px]">
          <span className="inline-flex items-center gap-2">
            {!single && <Caret open={open} />}
            {user.user}
          </span>
        </td>
        <td className="px-2 py-1.5 text-gray-600">
          {single ? (
            <span className="font-mono text-[10px] text-gray-500">{user.deploys[0].rg || user.deploys[0].iamUser || user.deploys[0].projectId || user.deploys[0].compartmentId || '-'}</span>
          ) : (
            <span>{user.deploys.length} deployments</span>
          )}
        </td>
        <td className="px-4 py-1.5 text-right font-semibold text-gray-900 tabular-nums">{formatINR(user.totalInr)}</td>
      </tr>
      {open && !single && user.deploys.map((d, i) => (
        <tr key={i} className="border-t border-gray-50 bg-gray-50/50">
          <td className="px-4 py-1 text-[10px] text-gray-500 pl-12">↳ {d.status}</td>
          <td className="px-2 py-1 text-gray-500 font-mono text-[10px]">{d.rg || d.iamUser || d.projectId || d.compartmentId || '-'}</td>
          <td className="px-4 py-1 text-right text-gray-700 tabular-nums">{formatINR(d.totalInr)}</td>
        </tr>
      ))}
    </>
  );
}

// Patched 2026-05-21: group unattributed by resource type (virtualmachines / disks / factories / workspaces / etc.)
function UnattributedByCategory({ items }) {
  const [openCats, setOpenCats] = useState({});
  // Categorize by the second-to-last segment of resourceId (e.g. "virtualmachines", "disks", "factories")
  const cats = {};
  items.forEach(r => {
    const parts = (r.resourceId || '').split('/');
    const type = parts.length >= 2 ? parts[parts.length - 2] : 'other';
    if (!cats[type]) cats[type] = { items: [], total: 0 };
    cats[type].items.push(r);
    cats[type].total += r.totalInr || 0;
  });
  const sortedCats = Object.entries(cats).sort((a,b) => b[1].total - a[1].total);
  if (sortedCats.length === 0) {
    return <div className="px-5 py-4 text-xs text-gray-500">No matching unattributed resources.</div>;
  }
  return (
    <div>
      {sortedCats.map(([type, group]) => {
        const isOpen = !!openCats[type];
        return (
          <div key={type} className="border-b border-gray-100 last:border-b-0">
            <button
              onClick={() => setOpenCats(prev => ({ ...prev, [type]: !prev[type] }))}
              className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-gray-50 text-left"
            >
              <div className="flex items-center gap-2">
                <Caret open={isOpen} />
                <span className="text-xs font-semibold text-gray-700 font-mono">{type}/</span>
                <span className="text-[10px] text-gray-400">({group.items.length} resources)</span>
              </div>
              <span className="text-xs font-semibold text-gray-900 tabular-nums">{formatINR(group.total)}</span>
            </button>
            {isOpen && (
              <table className="w-full text-xs">
                <tbody>
                  {group.items.sort((a,b) => (b.totalInr||0) - (a.totalInr||0)).map((r, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="pl-12 pr-2 py-1.5 text-gray-700 font-mono text-[10px] truncate max-w-md" title={r.resourceId}>{r.resourceId.split('/').slice(-1)[0]}</td>
                      <td className="px-2 py-1.5 text-gray-500 font-mono text-[10px]">{r.rg}</td>
                      <td className="pr-5 py-1.5 text-right font-semibold text-gray-900 tabular-nums">{formatINR(r.totalInr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CloudPanel({ cloud, data, searchQuery = '', sortBy = 'cost-desc' }) {
  // Patched 2026-05-21: live filter/sort of org list + filter unattributed by search.
  const q = (searchQuery || '').trim().toLowerCase();
  const matchOrg = o => !q || o.org.toLowerCase().includes(q)
    || (o.trainingLabs || []).some(l => l.trainingName.toLowerCase().includes(q) || (l.vms||[]).some(v => v.name.toLowerCase().includes(q)))
    || (o.sandboxes || []).some(sb => (sb.templateName||'').toLowerCase().includes(q) || (sb.deployments||[]).some(d => (d.user||'').toLowerCase().includes(q)));
  const matchResource = r => !q || (r.resourceId||'').toLowerCase().includes(q) || (r.rg||'').toLowerCase().includes(q);
  const sorter = {
    'cost-desc': (a,b) => (b.totalInr||0) - (a.totalInr||0),
    'cost-asc':  (a,b) => (a.totalInr||0) - (b.totalInr||0),
    'name-asc':  (a,b) => (a.org||a.name||'').localeCompare(b.org||b.name||''),
  }[sortBy] || ((a,b)=>0);
  const [showShared, setShowShared] = useState(false);
  const [showUnattrib, setShowUnattrib] = useState(false);
  if (!data) return <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>;
  if (data.error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <FaExclamationTriangle className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-amber-900">{cloud.label} cost data unavailable</div>
          <div className="text-xs text-amber-700 mt-1">{data.error}</div>
        </div>
      </div>
    );
  }
  const partial = data.partial;
  const note = data.note;
  // For OCI (no cost API wired yet) and other cases where the cloud has zero data AND a note,
  // we still render the panel — note shows as a banner but the byOrg/sandboxes still display.
  return (
    <div>
      {note && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <FaExclamationTriangle className="text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-900">{note}</div>
        </div>
      )}
      {partial && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
          <FaExclamationTriangle className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <div className="font-semibold text-amber-900">Partial data — {partial.chunksFailed.length} of {partial.chunksTotal} time windows failed (Azure rate-limit).</div>
            <div className="text-xs text-amber-700 mt-1">
              Failed: {partial.chunksFailed.map(c => `${c.from}→${c.to}`).join(', ')}. Click "Sync now" in 60 seconds to retry, or pick a shorter range.
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label={`${cloud.label} grand total`} value={formatINR(data.totalInr)} subtext="Matches Azure native portal" />
        {cloud.key === 'azure' && <StatCard label="Shared infrastructure" value={formatINR(data.sharedInfraInr || 0)} subtext="Guacamole, portal, LMS, HRM, marketing" />}
        <StatCard label="Unattributed" value={formatINR(data.unattributedInr || 0)} subtext="Resources we couldn't map to org" accent={data.unattributedInr > 1000 ? 'text-amber-600' : 'text-gray-900'} />
        {cloud.key === 'azure' && data.untrackedInr > 0 && <StatCard label="Untracked" value={formatINR(data.untrackedInr)} subtext="Truncated by Azure API row limit — investigate" accent="text-amber-600" />}
      </div>

      <div className="mb-5">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">By organization ({data.byOrg.length})</div>
        {data.byOrg.length === 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
            No spend attributed to any org for this period.
            {cloud.key === 'aws' && data.totalInr === 0 && ' Cost Explorer may not have CreatedBy tag enabled, or no IAM users billed any cost in the window.'}
          </div>
        )}
        {[...data.byOrg].filter(matchOrg).sort(sorter).map((o, i) => <OrgCard key={o.org} org={o} defaultOpen={i === 0 && data.byOrg.length <= 3} />)}
      </div>

      {cloud.key === 'azure' && data.sharedInfra?.length > 0 && (
        <div className="mb-5">
          <button onClick={() => setShowShared(!showShared)} className="w-full bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between hover:bg-gray-50">
            <div className="flex items-center gap-3">
              <Caret open={showShared} />
              <div>
                <div className="text-sm font-semibold text-gray-900">Shared infrastructure</div>
                <div className="text-xs text-gray-500">{data.sharedInfra.length} resources · Guacamole, portal, LMS, HRM, marketing, etc.</div>
              </div>
            </div>
            <div className="text-base font-semibold text-gray-900 tabular-nums">{formatINR(data.sharedInfraInr)}</div>
          </button>
          {showShared && (
            <div className="bg-white border border-gray-200 border-t-0 rounded-b-xl -mt-1">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Resource</th>
                    <th className="text-right px-2 py-2 font-medium">Compute</th>
                    <th className="text-right px-2 py-2 font-medium">Storage</th>
                    <th className="text-right px-2 py-2 font-medium">Network</th>
                    <th className="text-right px-5 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sharedInfra.map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-5 py-1.5 text-gray-800 font-mono text-[11px]">{r.name}</td>
                      <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR(r.compute)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR(r.storage)}</td>
                      <td className="px-2 py-1.5 text-right text-gray-600 tabular-nums">{formatINR(r.networking)}</td>
                      <td className="px-5 py-1.5 text-right font-semibold text-gray-900 tabular-nums">{formatINR(r.totalInr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {data.unattributed?.length > 0 && (
        <div className="mb-5">
          <button onClick={() => setShowUnattrib(!showUnattrib)} className="w-full bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 flex items-center justify-between hover:bg-amber-100/50">
            <div className="flex items-center gap-3">
              <Caret open={showUnattrib} />
              <FaExclamationTriangle className="text-amber-600" />
              <div className="text-left">
                <div className="text-sm font-semibold text-amber-900">Unattributed resources</div>
                <div className="text-xs text-amber-700">Couldn't match to an org/lab — may be deleted Mongo records, build artifacts, or untagged resources</div>
              </div>
            </div>
            <div className="text-base font-semibold text-amber-900 tabular-nums">{formatINR(data.unattributedInr)}</div>
          </button>
          {showUnattrib && (
            <div className="bg-white border border-amber-200 border-t-0 rounded-b-xl -mt-1 max-h-[600px] overflow-auto">
              {/* Patched 2026-05-21: categorize unattributed by resource type prefix */}
              <UnattributedByCategory items={data.unattributed.filter(matchResource)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Top-of-page comparison & insights (2026-06-06) ─── */
function KpiTotal({ data, prevData }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total spend</div>
      <div className="text-2xl font-semibold mt-1 tracking-tight text-gray-900">{formatINR(data.totalSpendInr)}</div>
      <div className="text-[11px] text-gray-400 mt-1.5">
        Azure {formatINRShort(data.azure?.totalInr || 0)} · AWS {formatINRShort(data.aws?.totalInr || 0)} · GCP {formatINRShort(data.gcp?.totalInr || 0)}
      </div>
    </div>
  );
}
function KpiDelta({ data, prevData }) {
  const cur = data.totalSpendInr || 0;
  const prev = prevData?.totalSpendInr;
  if (prev == null) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">vs previous period</div>
        <div className="text-2xl font-semibold mt-1 text-gray-300">—</div>
        <div className="text-[11px] text-gray-400 mt-1.5">Loading comparison…</div>
      </div>
    );
  }
  const delta = cur - prev;
  const pct = prev > 0 ? (delta / prev) * 100 : null;
  const up = delta > 0;
  const tone = pct == null ? 'text-gray-700' : up ? 'text-rose-600' : 'text-green-600';
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">vs previous period</div>
      <div className={`text-2xl font-semibold mt-1 tracking-tight ${tone}`}>
        {up ? '+' : ''}{formatINRShort(delta)}{pct != null && <span className="text-base text-gray-400 ml-1">({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)</span>}
      </div>
      <div className="text-[11px] text-gray-400 mt-1.5">prev: {formatINRShort(prev)}</div>
    </div>
  );
}
function KpiTopOrg({ data }) {
  // Top org by Azure spend (the only cloud with full attribution today)
  const orgs = data.azure?.byOrg || [];
  const top = [...orgs].sort((a, b) => (b.totalInr || 0) - (a.totalInr || 0))[0];
  if (!top) return <div className="bg-white border border-gray-200 rounded-xl p-5"><div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Top org</div><div className="text-gray-300 text-2xl font-semibold mt-1">—</div></div>;
  const share = data.azure?.totalInr ? (top.totalInr / data.azure.totalInr) * 100 : 0;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Top org · Azure</div>
      <div className="text-lg font-semibold mt-1 text-gray-900 truncate" title={top.org}>{top.org}</div>
      <div className="text-[11px] text-gray-400 mt-1.5">{formatINRShort(top.totalInr)} · {share.toFixed(1)}% of Azure</div>
    </div>
  );
}
function KpiTopLab({ data }) {
  // Highest single training lab across all orgs (Azure)
  const labs = [];
  for (const org of data.azure?.byOrg || []) {
    for (const lab of org.trainingLabs || []) labs.push({ ...lab, org: org.org });
  }
  const top = labs.sort((a, b) => (b.totalInr || 0) - (a.totalInr || 0))[0];
  if (!top) return <div className="bg-white border border-gray-200 rounded-xl p-5"><div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Top lab</div><div className="text-gray-300 text-2xl font-semibold mt-1">—</div></div>;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Top lab</div>
      <div className="text-lg font-semibold mt-1 text-gray-900 truncate" title={top.trainingName}>{top.trainingName}</div>
      <div className="text-[11px] text-gray-400 mt-1.5">{top.org} · {formatINRShort(top.totalInr)} · {top.vms?.length || 0} VMs</div>
    </div>
  );
}

function TopConsumersBar({ data }) {
  // Top 5 orgs across ALL clouds, summed by org name.
  const m = new Map();
  for (const c of ['azure', 'aws', 'gcp', 'oci']) {
    for (const o of data[c]?.byOrg || []) {
      m.set(o.org, (m.get(o.org) || 0) + (o.totalInr || 0));
    }
  }
  const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!top.length || !top[0][1]) return null;
  const max = top[0][1];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Top 5 consumers (all clouds)</div>
      <div className="space-y-2">
        {top.map(([org, inr]) => (
          <div key={org} className="flex items-center gap-3 text-[12px]">
            <div className="w-44 truncate font-medium text-gray-700" title={org}>{org}</div>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${(inr / max) * 100}%` }} />
            </div>
            <div className="w-24 text-right font-semibold text-gray-900 tabular-nums">{formatINRShort(inr)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Previous-period range for the same length (for ↑↓ comparison).
function previousPeriodRange(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case 'this-month':   return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0, 23, 59, 59) };
    case 'last-month':   return { from: new Date(y, m - 2, 1), to: new Date(y, m - 1, 0, 23, 59, 59) };
    case 'last-quarter': return { from: new Date(now.getTime() - 180 * 86400000), to: new Date(now.getTime() - 90 * 86400000) };
    case '6m':           return { from: new Date(now.getTime() - 360 * 86400000), to: new Date(now.getTime() - 180 * 86400000) };
    case '1y':           return { from: new Date(now.getTime() - 728 * 86400000), to: new Date(now.getTime() - 364 * 86400000) };
    default: return null;
  }
}

// "₹12.3 L" / "₹4.5 K" — compact for KPI strip.
function formatINRShort(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n/1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `₹${(n/1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(n/1e3).toFixed(1)} K`;
  return `₹${Math.round(n)}`;
}

export default function CostAnalytics() {
  const [data, setData] = useState(null);
  const [prevData, setPrevData] = useState(null);   // previous-period for comparison
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('this-month');
  const [activeCloud, setActiveCloud] = useState('azure');
  const [refreshing, setRefreshing] = useState(false);
  // Patched 2026-05-21: search + sort controls for org list and unattributed.
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('cost-desc');

  const fetchData = useCallback(async (force = false) => {
    setLoading(!data);
    if (force) setRefreshing(true);
    setError(null);
    try {
      const { from, to } = periodToRange(period);
      const params = new URLSearchParams();
      if (from) params.set('from', from.toISOString());
      if (to) params.set('to', to.toISOString());
      if (force) params.set('force', '1');
      const qs = params.toString();
      const res = await apiCaller.get(`${costApiRoutes.costCenter}${qs ? '?' + qs : ''}`);
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Fetch previous-period totals (lightweight — same endpoint, cached, no force).
  // Non-blocking — failures here don't affect the main view.
  const fetchPrev = useCallback(async () => {
    const range = previousPeriodRange(period);
    if (!range) { setPrevData(null); return; }
    try {
      const params = new URLSearchParams();
      params.set('from', range.from.toISOString());
      params.set('to', range.to.toISOString());
      const res = await apiCaller.get(`${costApiRoutes.costCenter}?${params.toString()}`);
      setPrevData(res.data);
    } catch { setPrevData(null); }
  }, [period]);

  useEffect(() => { fetchData(false); }, [fetchData]);
  useEffect(() => { fetchPrev(); }, [fetchPrev]);

  // Patched 2026-05-21: if backend says refresh is in flight (refreshing: true),
  // poll every 5s without force until it finishes — no more long-hung Sync clicks.
  useEffect(() => {
    if (!data?.refreshing) return;
    const id = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(id);
  }, [data?.refreshing, fetchData]);

  const cloud = CLOUDS.find(c => c.key === activeCloud);
  const cloudData = data?.[activeCloud];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Cost Center</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real cloud spend per organization, lab and sandbox.
            {data?.lastSynced && <> · Last synced {new Date(data.lastSynced).toLocaleString()}{data.fromCache ? ' (cached, 30 min)' : ''}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
            {PERIOD_OPTIONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="text-sm bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 flex items-center gap-2"
          >
            <FaSync className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* Patched 2026-05-21: search + sort controls */}
      <div className="flex items-center gap-3 mb-5 mt-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search org, lab, VM, or resource ID…"
            className="w-full text-sm border border-gray-200 rounded-lg pl-3 pr-8 py-2 bg-white focus:outline-none focus:border-gray-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
          )}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <option value="cost-desc">Sort: highest cost first</option>
          <option value="cost-asc">Sort: lowest cost first</option>
          <option value="name-asc">Sort: name (A→Z)</option>
        </select>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {data && (
        <>
          {/* New KPI strip 2026-06-06: total · delta vs prev period · top org · top lab */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-5 mb-5">
            <KpiTotal data={data} prevData={prevData} />
            <KpiDelta data={data} prevData={prevData} />
            <KpiTopOrg data={data} />
            <KpiTopLab data={data} />
          </div>

          {/* Top consumers (Azure only — rest sum to org totals in cards above) */}
          <TopConsumersBar data={data} />

          <div className="border-b border-gray-200 mb-5">
            <nav className="flex gap-1">
              {CLOUDS.map(c => {
                const active = activeCloud === c.key;
                const total = data[c.key]?.totalInr || 0;
                return (
                  <button
                    key={c.key}
                    onClick={() => setActiveCloud(c.key)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  >
                    {c.label}
                    <span className="ml-2 text-xs text-gray-400 tabular-nums">{formatINR(total)}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <CloudPanel cloud={cloud} data={cloudData} searchQuery={searchQuery} sortBy={sortBy} />
        </>
      )}

      {loading && !data && (
        <div className="mt-8 text-center text-gray-500">Loading cost data — first call can take 5-10s as Azure Cost Management is queried…</div>
      )}
    </div>
  );
}
