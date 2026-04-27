// Admin Center / Control Center — tab-based layout with per-tab search,
// colored role badges, usage counts, edit + delete actions, and
// consolidated Quick-Add. Replaces the stacked-sections legacy design.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import { AssignVmCardModal } from '../components/modal/AssignTemplate';
import { CreateVmCardModal } from '../components/modal/CreateTemplate';
import { CreateUserModal } from '../components/modal/CreateUser';
import { CreateOrganizationModal } from '../components/modal/CreateOrganization';
import { EditUserModal } from '../components/modal/EditUser';
import { EditTemplateModal } from '../components/modal/EditTemplate';
import { ConfirmDialog } from '../components/modal/ConfirmDialog';
import { UserTypeBadge, Badge } from '../components/Badge';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import debounce from 'lodash.debounce';
import {
  FaBuilding, FaUsers, FaDesktop, FaLink, FaPlus, FaSearch, FaEdit, FaTrash, FaTimes,
  FaSort, FaSortUp, FaSortDown, FaChevronLeft, FaChevronRight,
} from 'react-icons/fa';

const TABS = [
  { id: 'orgs',      label: 'Organizations', icon: <FaBuilding /> },
  { id: 'users',     label: 'Users',         icon: <FaUsers /> },
  { id: 'templates', label: 'Templates',     icon: <FaDesktop /> },
  { id: 'assigns',   label: 'Assignments',   icon: <FaLink /> },
];

const PAGE_SIZES = [10, 25, 50, 100];

// ─── Primitives ──────────────────────────────────────────────────────────

function KpiCard({ label, value, icon, accent = 'blue' }) {
  const bgAccent = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-emerald-50 text-emerald-600',
    amber:  'bg-amber-50 text-amber-600',
    purple: 'bg-violet-50 text-violet-600',
  }[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{value}</div>
        </div>
        <div className={clsx('flex h-10 w-10 items-center justify-center rounded-lg', bgAccent)}>
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

function SkeletonRows({ n = 8 }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3">
          <div className="h-4 w-8 rounded bg-slate-100 animate-pulse" />
          <div className="h-4 flex-1 rounded bg-slate-100 animate-pulse" />
          <div className="h-6 w-16 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-6 w-20 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, hint, action }) {
  return (
    <div className="p-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <FaSearch />
      </div>
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function SortHeader({ label, active, direction, onClick, align = 'left', className }) {
  return (
    <th
      onClick={onClick}
      className={clsx(
        'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 select-none',
        onClick && 'cursor-pointer hover:text-slate-800',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {onClick && (
          <span className="text-slate-300">
            {active ? (direction === 'asc' ? <FaSortUp /> : <FaSortDown />) : <FaSort className="opacity-50" />}
          </span>
        )}
      </span>
    </th>
  );
}

function Pagination({ total, page, pageSize, onPage, onPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600 rounded-b-xl">
      <div className="flex items-center gap-2">
        <span>Showing {total === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + pageSize, total)} of {total}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(+e.target.value)}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(1)} disabled={safePage === 1}
          className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent">First</button>
        <button onClick={() => onPage(safePage - 1)} disabled={safePage === 1}
          className="rounded p-1.5 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"><FaChevronLeft className="text-[10px]" /></button>
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          let pageNum;
          if (totalPages <= 5) pageNum = i + 1;
          else if (safePage <= 3) pageNum = i + 1;
          else if (safePage >= totalPages - 2) pageNum = totalPages - 4 + i;
          else pageNum = safePage - 2 + i;
          return (
            <button key={pageNum} onClick={() => onPage(pageNum)}
              className={clsx('rounded px-2.5 py-1 min-w-[28px]',
                safePage === pageNum ? 'bg-blue-600 text-white' : 'hover:bg-slate-200')}>
              {pageNum}
            </button>
          );
        })}
        <button onClick={() => onPage(safePage + 1)} disabled={safePage === totalPages}
          className="rounded p-1.5 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"><FaChevronRight className="text-[10px]" /></button>
        <button onClick={() => onPage(totalPages)} disabled={safePage === totalPages}
          className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent">Last</button>
      </div>
    </div>
  );
}

// Reusable tab-panel shell: tool bar (search + add), scrollable table, pagination.
function TabPanel({ children, searchValue, onSearch, onAdd, addLabel, toolbarExtra }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {searchValue && (
            <button onClick={() => onSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <FaTimes className="text-xs" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbarExtra}
          {onAdd && (
            <button onClick={onAdd} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
              <FaPlus className="text-xs" /> {addLabel}
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────

const Controller = ({ superadminApiRoutes }) => {
  // Data
  const [orgs, setOrgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [assigns, setAssigns] = useState([]);
  const [loading, setLoading] = useState({ orgs: true, users: true, templates: true, assigns: true });

  // Per-tab UI state
  const [activeTab, setActiveTab] = useState('orgs');
  const [search, setSearch] = useState({ orgs: '', users: '', templates: '', assigns: '' });
  const [page, setPage] = useState({ orgs: 1, users: 1, templates: 1, assigns: 1 });
  const [pageSize, setPageSize] = useState({ orgs: 25, users: 25, templates: 25, assigns: 25 });
  const [sort, setSort] = useState({
    orgs: { col: 'name', dir: 'asc' },
    users: { col: 'email', dir: 'asc' },
    templates: { col: 'name', dir: 'asc' },
    assigns: { col: 'organization', dir: 'asc' },
  });

  // Modals
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editTemplate, setEditTemplate] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm }

  // ─── Fetchers ──────────────────────────────────────────────────────────
  const fetchOrgs = useCallback(async () => {
    setLoading((l) => ({ ...l, orgs: true }));
    try {
      const r = await apiCaller.get(superadminApiRoutes.organizationApi);
      setOrgs(r?.data?.organization || []);
    } catch { setOrgs([]); } finally { setLoading((l) => ({ ...l, orgs: false })); }
  }, [superadminApiRoutes.organizationApi]);

  const fetchUsers = useCallback(async () => {
    setLoading((l) => ({ ...l, users: true }));
    try {
      const r = await apiCaller.get(superadminApiRoutes.usersApi);
      setUsers(r?.data || []);
    } catch { setUsers([]); } finally { setLoading((l) => ({ ...l, users: false })); }
  }, [superadminApiRoutes.usersApi]);

  const fetchTemplates = useCallback(async () => {
    setLoading((l) => ({ ...l, templates: true }));
    try {
      const r = await apiCaller.get(superadminApiRoutes.templatesApi);
      setTemplates(r?.data || []);
    } catch { setTemplates([]); } finally { setLoading((l) => ({ ...l, templates: false })); }
  }, [superadminApiRoutes.templatesApi]);

  const fetchAssigns = useCallback(async () => {
    setLoading((l) => ({ ...l, assigns: true }));
    try {
      const r = await apiCaller.get(superadminApiRoutes.assignTemplatesApi);
      setAssigns(r?.data || []);
    } catch { setAssigns([]); } finally { setLoading((l) => ({ ...l, assigns: false })); }
  }, [superadminApiRoutes.assignTemplatesApi]);

  useEffect(() => {
    fetchOrgs(); fetchUsers(); fetchTemplates(); fetchAssigns();
  }, [fetchOrgs, fetchUsers, fetchTemplates, fetchAssigns]);

  // ─── Derived counts (for Orgs / Templates columns) ─────────────────────
  const usersPerOrg = useMemo(() => {
    const m = {};
    users.forEach((u) => { if (u.organization) m[u.organization] = (m[u.organization] || 0) + 1; });
    return m;
  }, [users]);

  const assignsPerOrg = useMemo(() => {
    const m = {};
    assigns.forEach((a) => { if (a.organization) m[a.organization] = (m[a.organization] || 0) + 1; });
    return m;
  }, [assigns]);

  const assignsPerTemplate = useMemo(() => {
    const m = {};
    assigns.forEach((a) => { if (a.template) m[a.template] = (m[a.template] || 0) + 1; });
    return m;
  }, [assigns]);

  // ─── Row enrichment + filter + sort + paginate ─────────────────────────
  const orgRows = useMemo(() => {
    const enriched = orgs.map((o) => ({
      name: typeof o === 'string' ? o : o?.organization || o?.name || '',
      userCount: usersPerOrg[typeof o === 'string' ? o : o?.organization || o?.name] || 0,
      assignCount: assignsPerOrg[typeof o === 'string' ? o : o?.organization || o?.name] || 0,
    }));
    const q = search.orgs.toLowerCase().trim();
    const filtered = q ? enriched.filter(r => r.name.toLowerCase().includes(q)) : enriched;
    const s = sort.orgs;
    const sorted = [...filtered].sort((a, b) => {
      const va = a[s.col], vb = b[s.col];
      const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return s.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [orgs, usersPerOrg, assignsPerOrg, search.orgs, sort.orgs]);

  const userRows = useMemo(() => {
    const q = search.users.toLowerCase().trim();
    const filtered = q ? users.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.organization || '').toLowerCase().includes(q) ||
      (u.userType || '').toLowerCase().includes(q)
    ) : users;
    const s = sort.users;
    return [...filtered].sort((a, b) => {
      const cmp = String(a[s.col] || '').localeCompare(String(b[s.col] || ''));
      return s.dir === 'asc' ? cmp : -cmp;
    });
  }, [users, search.users, sort.users]);

  const templateRows = useMemo(() => {
    const enriched = templates.map(t => ({
      ...t,
      os: t?.creation?.os || '—',
      vmSize: t?.creation?.vmSize || '—',
      assignCount: assignsPerTemplate[t?.name] || 0,
    }));
    const q = search.templates.toLowerCase().trim();
    const filtered = q ? enriched.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.os || '').toLowerCase().includes(q) ||
      (r.vmSize || '').toLowerCase().includes(q)
    ) : enriched;
    const s = sort.templates;
    return [...filtered].sort((a, b) => {
      const va = a[s.col], vb = b[s.col];
      const cmp = typeof va === 'number' ? va - vb : String(va || '').localeCompare(String(vb || ''));
      return s.dir === 'asc' ? cmp : -cmp;
    });
  }, [templates, assignsPerTemplate, search.templates, sort.templates]);

  const assignRows = useMemo(() => {
    const q = search.assigns.toLowerCase().trim();
    const filtered = q ? assigns.filter(a =>
      (a.organization || '').toLowerCase().includes(q) ||
      (a.template || '').toLowerCase().includes(q)
    ) : assigns;
    const s = sort.assigns;
    return [...filtered].sort((a, b) => {
      const cmp = String(a[s.col] || '').localeCompare(String(b[s.col] || ''));
      return s.dir === 'asc' ? cmp : -cmp;
    });
  }, [assigns, search.assigns, sort.assigns]);

  // ─── Helpers ───────────────────────────────────────────────────────────
  const setTabSearch = (tab, q) => { setSearch((s) => ({ ...s, [tab]: q })); setPage((p) => ({ ...p, [tab]: 1 })); };
  const setTabPage = (tab, p) => setPage((prev) => ({ ...prev, [tab]: p }));
  const setTabPageSize = (tab, ps) => { setPageSize((prev) => ({ ...prev, [tab]: ps })); setPage((p) => ({ ...p, [tab]: 1 })); };
  const toggleSort = (tab, col) => setSort((prev) => ({
    ...prev,
    [tab]: prev[tab].col === col ? { col, dir: prev[tab].dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
  }));

  const paginate = (rows, tab) => {
    const ps = pageSize[tab];
    const start = (page[tab] - 1) * ps;
    return rows.slice(start, start + ps);
  };

  const orgNamesList = useMemo(() => orgs.map((o) => typeof o === 'string' ? o : o?.organization || o?.name).filter(Boolean), [orgs]);

  // ─── CRUD actions ──────────────────────────────────────────────────────
  const doCreateOrg = async (payload) => {
    try { const r = await apiCaller.post(superadminApiRoutes.organizationApi, payload); alert(r.data.message); fetchOrgs(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
    finally { setCreateOrgOpen(false); }
  };
  const doDeleteOrg = (name) => setConfirm({
    title: `Delete organization "${name}"?`,
    message: <>This removes the organization record. Users and VMs assigned to it will be orphaned until reassigned. <strong>This cannot be undone.</strong></>,
    onConfirm: async () => {
      try { const r = await apiCaller.delete(superadminApiRoutes.organizationApi, { data: { organization: name } }); alert(r.data.message); fetchOrgs(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
      setConfirm(null);
    },
  });

  const doCreateUser = async (userData) => {
    try { const r = await apiCaller.post(superadminApiRoutes.usersApi, userData); alert(r.data.message); fetchUsers(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
    finally { setCreateUserOpen(false); }
  };
  const doUpdateUser = async (payload) => {
    try {
      const r = await apiCaller.patch(superadminApiRoutes.usersApi, payload);
      alert(r.data.message);
      fetchUsers();
      setEditUser(null);
    } catch (e) { alert(e.response?.data?.message || 'Failed'); }
  };
  const doDeleteUser = (user) => setConfirm({
    title: `Delete user ${user.email}?`,
    message: <>They'll lose portal access immediately. VMs assigned to this email stay until you delete them separately. <strong>This cannot be undone.</strong></>,
    onConfirm: async () => {
      try { const r = await apiCaller.delete(superadminApiRoutes.usersApi, { data: { email: user.email, organization: user.organization } }); alert(r.data.message); fetchUsers(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
      setConfirm(null);
    },
  });

  const doCreateTemplate = async (payload) => {
    try { const r = await apiCaller.post(superadminApiRoutes.templatesApi, payload); alert(r.data.message); fetchTemplates(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
    finally { setCreateTemplateOpen(false); }
  };
  const doUpdateTemplate = async (payload) => {
    try { const r = await apiCaller.patch(superadminApiRoutes.templatesApi, payload); alert(r.data.message); fetchTemplates(); setEditTemplate(null); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
  };
  const doDeleteTemplate = (t) => setConfirm({
    title: `Delete template "${t.name}"?`,
    message: <>VMs already created from this template keep running, but you won't be able to deploy new ones from it. Assignments to orgs will break.</>,
    onConfirm: async () => {
      try { const r = await apiCaller.delete(superadminApiRoutes.templatesApi, { data: { template: t.name } }); alert(r.data.message); fetchTemplates(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
      setConfirm(null);
    },
  });

  const doAssign = async (payload) => {
    try { const r = await apiCaller.post(superadminApiRoutes.assignTemplatesApi, payload); alert(r.data.message); fetchAssigns(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
    finally { setAssignOpen(false); }
  };
  const doDeleteAssign = (a) => setConfirm({
    title: `Remove "${a.template}" from ${a.organization}?`,
    message: <>The organization can no longer deploy this template. Existing VMs stay.</>,
    onConfirm: async () => {
      try { const r = await apiCaller.delete(superadminApiRoutes.assignTemplatesApi, { data: { organization: a.organization, template: a.template } }); alert(r.data.message); fetchAssigns(); } catch (e) { alert(e.response?.data?.message || 'Failed'); }
      setConfirm(null);
    },
  });

  // ─── Render ────────────────────────────────────────────────────────────
  const counts = {
    orgs: orgs.length,
    users: users.length,
    templates: templates.length,
    assigns: assigns.length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-1 rounded-full bg-gradient-to-b from-blue-500 to-violet-500" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">Control Center</h1>
                <p className="text-sm text-slate-500">Manage organizations, users, templates and assignments</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <button onClick={() => setCreateOrgOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Organization</button>
              <button onClick={() => setCreateUserOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ User</button>
              <button onClick={() => setCreateTemplateOpen(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">+ Template</button>
              <button onClick={() => setAssignOpen(true)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">Assign template</button>
            </div>
          </div>

          {/* KPI cards */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Organizations" value={counts.orgs} icon={<FaBuilding />} accent="blue" />
            <KpiCard label="Users" value={counts.users} icon={<FaUsers />} accent="green" />
            <KpiCard label="Templates" value={counts.templates} icon={<FaDesktop />} accent="amber" />
            <KpiCard label="Assignments" value={counts.assigns} icon={<FaLink />} accent="purple" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-t border-slate-200 px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={clsx(
                'inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              <span className="text-xs">{t.icon}</span>
              {t.label}
              <Badge tone={activeTab === t.id ? 'blue' : 'slate'}>{counts[t.id]}</Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Tab panel */}
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'orgs' && (
              <TabPanel
                searchValue={search.orgs}
                onSearch={(q) => setTabSearch('orgs', q)}
                onAdd={() => setCreateOrgOpen(true)}
                addLabel="New organization"
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <SortHeader label="Organization" active={sort.orgs.col === 'name'} direction={sort.orgs.dir} onClick={() => toggleSort('orgs', 'name')} />
                        <SortHeader label="Users" active={sort.orgs.col === 'userCount'} direction={sort.orgs.dir} onClick={() => toggleSort('orgs', 'userCount')} align="right" />
                        <SortHeader label="Templates assigned" active={sort.orgs.col === 'assignCount'} direction={sort.orgs.dir} onClick={() => toggleSort('orgs', 'assignCount')} align="right" />
                        <SortHeader label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading.orgs ? (
                        <tr><td colSpan={4}><SkeletonRows n={6} /></td></tr>
                      ) : orgRows.length === 0 ? (
                        <tr><td colSpan={4}><EmptyState title={search.orgs ? 'No organizations match' : 'No organizations yet'} hint={search.orgs ? 'Try a different search term.' : 'Create your first organization to get started.'} /></td></tr>
                      ) : (
                        paginate(orgRows, 'orgs').map((r) => (
                          <tr key={r.name} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.userCount}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.assignCount}</td>
                            <td className="px-4 py-3 text-right">
                              <button onClick={() => doDeleteOrg(r.name)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete">
                                <FaTrash className="text-xs" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!loading.orgs && orgRows.length > 0 && (
                  <Pagination total={orgRows.length} page={page.orgs} pageSize={pageSize.orgs} onPage={(p) => setTabPage('orgs', p)} onPageSize={(ps) => setTabPageSize('orgs', ps)} />
                )}
              </TabPanel>
            )}

            {activeTab === 'users' && (
              <TabPanel
                searchValue={search.users}
                onSearch={(q) => setTabSearch('users', q)}
                onAdd={() => setCreateUserOpen(true)}
                addLabel="New user"
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <SortHeader label="Email" active={sort.users.col === 'email'} direction={sort.users.dir} onClick={() => toggleSort('users', 'email')} />
                        <SortHeader label="Organization" active={sort.users.col === 'organization'} direction={sort.users.dir} onClick={() => toggleSort('users', 'organization')} />
                        <SortHeader label="Role" active={sort.users.col === 'userType'} direction={sort.users.dir} onClick={() => toggleSort('users', 'userType')} />
                        <SortHeader label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading.users ? (
                        <tr><td colSpan={4}><SkeletonRows n={8} /></td></tr>
                      ) : userRows.length === 0 ? (
                        <tr><td colSpan={4}><EmptyState title={search.users ? 'No users match' : 'No users yet'} hint={search.users ? 'Try a different search term.' : 'Create users to give access to the platform.'} /></td></tr>
                      ) : (
                        paginate(userRows, 'users').map((u) => (
                          <tr key={`${u.email}-${u.organization}`} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900 font-mono text-xs">{u.email}</td>
                            <td className="px-4 py-3 text-slate-600">{u.organization || <span className="text-slate-400">—</span>}</td>
                            <td className="px-4 py-3"><UserTypeBadge userType={u.userType} /></td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button onClick={() => setEditUser(u)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                                  <FaEdit className="text-xs" />
                                </button>
                                <button onClick={() => doDeleteUser(u)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete">
                                  <FaTrash className="text-xs" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!loading.users && userRows.length > 0 && (
                  <Pagination total={userRows.length} page={page.users} pageSize={pageSize.users} onPage={(p) => setTabPage('users', p)} onPageSize={(ps) => setTabPageSize('users', ps)} />
                )}
              </TabPanel>
            )}

            {activeTab === 'templates' && (
              <TabPanel
                searchValue={search.templates}
                onSearch={(q) => setTabSearch('templates', q)}
                onAdd={() => setCreateTemplateOpen(true)}
                addLabel="New template"
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <SortHeader label="Template" active={sort.templates.col === 'name'} direction={sort.templates.dir} onClick={() => toggleSort('templates', 'name')} />
                        <SortHeader label="OS" active={sort.templates.col === 'os'} direction={sort.templates.dir} onClick={() => toggleSort('templates', 'os')} />
                        <SortHeader label="VM Size" active={sort.templates.col === 'vmSize'} direction={sort.templates.dir} onClick={() => toggleSort('templates', 'vmSize')} />
                        <SortHeader label="Rate (₹/hr)" active={sort.templates.col === 'rate'} direction={sort.templates.dir} onClick={() => toggleSort('templates', 'rate')} align="right" />
                        <SortHeader label="Flags" />
                        <SortHeader label="Assigned to" active={sort.templates.col === 'assignCount'} direction={sort.templates.dir} onClick={() => toggleSort('templates', 'assignCount')} align="right" />
                        <SortHeader label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading.templates ? (
                        <tr><td colSpan={7}><SkeletonRows n={6} /></td></tr>
                      ) : templateRows.length === 0 ? (
                        <tr><td colSpan={7}><EmptyState title={search.templates ? 'No templates match' : 'No templates yet'} hint={search.templates ? 'Try a different search term.' : 'Create VM templates to standardize deployments.'} /></td></tr>
                      ) : (
                        paginate(templateRows, 'templates').map((t) => (
                          <tr key={t._id || t.name} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900 font-mono text-xs">{t.name}</td>
                            <td className="px-4 py-3 text-slate-600">{t.os}</td>
                            <td className="px-4 py-3 text-slate-600 font-mono text-xs">{t.vmSize}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{t.rate ?? '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {t.kasmVnc && <Badge tone="green">KasmVNC</Badge>}
                                {t.hasXrdp && <Badge tone="blue">xrdp</Badge>}
                                {!t.kasmVnc && !t.hasXrdp && <span className="text-slate-400 text-xs">—</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">{t.assignCount} org{t.assignCount === 1 ? '' : 's'}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button onClick={() => setEditTemplate(t)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600" title="Edit">
                                  <FaEdit className="text-xs" />
                                </button>
                                <button onClick={() => doDeleteTemplate(t)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Delete">
                                  <FaTrash className="text-xs" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!loading.templates && templateRows.length > 0 && (
                  <Pagination total={templateRows.length} page={page.templates} pageSize={pageSize.templates} onPage={(p) => setTabPage('templates', p)} onPageSize={(ps) => setTabPageSize('templates', ps)} />
                )}
              </TabPanel>
            )}

            {activeTab === 'assigns' && (
              <TabPanel
                searchValue={search.assigns}
                onSearch={(q) => setTabSearch('assigns', q)}
                onAdd={() => setAssignOpen(true)}
                addLabel="Assign template"
              >
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <SortHeader label="Organization" active={sort.assigns.col === 'organization'} direction={sort.assigns.dir} onClick={() => toggleSort('assigns', 'organization')} />
                        <SortHeader label="Template" active={sort.assigns.col === 'template'} direction={sort.assigns.dir} onClick={() => toggleSort('assigns', 'template')} />
                        <SortHeader label="" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading.assigns ? (
                        <tr><td colSpan={3}><SkeletonRows n={6} /></td></tr>
                      ) : assignRows.length === 0 ? (
                        <tr><td colSpan={3}><EmptyState title={search.assigns ? 'No assignments match' : 'No assignments yet'} hint={search.assigns ? 'Try a different search term.' : 'Assign templates to organizations so they can deploy VMs.'} /></td></tr>
                      ) : (
                        paginate(assignRows, 'assigns').map((a, idx) => (
                          <tr key={`${a.organization}-${a.template}-${idx}`} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">{a.organization}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-600">{a.template}</td>
                            <td className="px-4 py-3 text-right">
                              <button onClick={() => doDeleteAssign(a)} className="inline-flex items-center justify-center rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Unassign">
                                <FaTrash className="text-xs" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {!loading.assigns && assignRows.length > 0 && (
                  <Pagination total={assignRows.length} page={page.assigns} pageSize={pageSize.assigns} onPage={(p) => setTabPage('assigns', p)} onPageSize={(ps) => setTabPageSize('assigns', ps)} />
                )}
              </TabPanel>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Modals — existing Create* components are always-rendered, so gate
          them with conditional mount. Prop names match the legacy API:
          CreateUser expects onCreateUser + organization list, etc. */}
      {createOrgOpen && (
        <CreateOrganizationModal onClose={() => setCreateOrgOpen(false)} onCreateOrganization={doCreateOrg} />
      )}
      {createUserOpen && (
        <CreateUserModal onClose={() => setCreateUserOpen(false)} onCreateUser={doCreateUser} organization={orgNamesList} />
      )}
      {createTemplateOpen && (
        <CreateVmCardModal onClose={() => setCreateTemplateOpen(false)} onCreateVmCard={doCreateTemplate} />
      )}
      {assignOpen && (
        <AssignVmCardModal onClose={() => setAssignOpen(false)} onAssignTemplate={doAssign} organization={orgNamesList} templates={templates} />
      )}
      <EditUserModal open={!!editUser} user={editUser} organizations={orgNamesList} onClose={() => setEditUser(null)} onSave={doUpdateUser} />
      <EditTemplateModal open={!!editTemplate} template={editTemplate} onClose={() => setEditTemplate(null)} onSave={doUpdateTemplate} />
      <ConfirmDialog open={!!confirm} title={confirm?.title} message={confirm?.message} confirmLabel="Delete" onConfirm={confirm?.onConfirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

export default Controller;
