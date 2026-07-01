import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useBranding } from '../contexts/BrandingContext';
import apiCaller from '../services/apiCaller';
import {
  FaHome, FaTachometerAlt, FaLaptop, FaUsers, FaChevronDown, FaBars, FaTimes,
  FaSignOutAlt, FaHeadset, FaFileInvoiceDollar, FaHistory, FaNetworkWired,
  FaRocket, FaShieldAlt, FaTrashAlt, FaStopCircle, FaCloud,
  FaCubes, FaFileAlt, FaSuperscript, FaChevronLeft, FaChevronRight, FaChartLine, FaDocker, FaChartBar, FaCut, FaWindows, FaDatabase,
  FaGraduationCap,
  FaMagic,
  FaSearch,
  FaTachometerAlt as FaQuota,
  FaRedhat,
  FaServer,
  FaLayerGroup,
  FaTerminal,
  FaSlidersH,
  FaWallet,
  FaUserShield,
  FaProjectDiagram,
  FaEye,
  FaBolt,
  FaGlobe,
  FaCogs,
} from 'react-icons/fa';

/* ─── NavItem ────────────────────────────────────────────────────────── */
function NavItem({ to, icon: Icon, label, collapsed, onClick, badge }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(to + '/');

  return (
    <Link
      to={to}
      onClick={onClick}
      className={clsx(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium',
        'transition-all duration-200 ease-out',
        active
          ? 'text-white'
          : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
      )}
    >
      {/* Active background — brand glow */}
      {active && (
        <span
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(90deg, rgba(99,102,241,0.14), rgba(99,102,241,0.04), transparent)',
          }}
        />
      )}

      {/* Active left bar — brand gradient */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full"
          style={{ background: 'linear-gradient(to bottom, var(--brand-primary, #818cf8), var(--brand-accent, #a78bfa))' }}
        />
      )}

      {/* Icon */}
      <Icon
        className={clsx(
          'text-sm flex-shrink-0 relative z-10 transition-transform duration-150',
          'group-hover:scale-110',
        )}
        style={active ? { color: 'var(--brand-primary, #a5b4fc)' } : undefined}
      />

      {/* Label */}
      {!collapsed && <span className="truncate relative z-10">{label}</span>}

      {/* Badge — expanded */}
      {badge != null && badge > 0 && !collapsed && (
        <span className="ml-auto relative z-10 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white px-1">
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      {/* Badge — collapsed dot */}
      {badge != null && badge > 0 && collapsed && (
        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#111118] z-20" />
      )}

      {/* Glass tooltip — collapsed */}
      {collapsed && (
        <span className={clsx(
          'pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2',
          'whitespace-nowrap rounded-lg px-3 py-1.5 text-xs text-white',
          'bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50',
          'shadow-xl shadow-black/50',
          'opacity-0 scale-95 transition-all duration-150',
          'group-hover:opacity-100 group-hover:scale-100'
        )}>
          {label}
          {badge != null && badge > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-rose-500 text-[9px] font-bold px-1">
              {badge}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}

/* ─── Accordion ──────────────────────────────────────────────────────── */
function Accordion({ id, icon: Icon, label, collapsed, openMap, setOpenMap, children }) {
  const open = !!openMap[id];
  const toggle = () => setOpenMap(m => ({ ...m, [id]: !m[id] }));

  if (collapsed) {
    return (
      <div className="relative group">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-center rounded-lg px-3 py-2 text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-all duration-200"
        >
          <Icon className="text-sm transition-transform duration-150 group-hover:scale-110" />
        </button>
        <div className={clsx(
          'invisible absolute left-full top-0 z-50 ml-3 min-w-[210px]',
          'rounded-xl p-2 text-sm',
          'bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/50',
          'shadow-2xl shadow-black/60',
          'opacity-0 scale-95 origin-left transition-all duration-200',
          'group-hover:visible group-hover:opacity-100 group-hover:scale-100'
        )}>
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
            {label}
          </div>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-all duration-200"
      >
        <Icon className="text-sm transition-transform duration-150 group-hover:scale-110" />
        <span className="flex-1 truncate text-left">{label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <FaChevronDown className="text-[10px] text-zinc-500" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={`accordion-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-4 pl-3 border-l border-zinc-700/30 space-y-0.5 py-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── SectionDivider ─────────────────────────────────────────────────── */
function SectionDivider({ label, collapsed }) {
  if (collapsed) {
    return <div className="my-3 mx-3 h-px bg-gradient-to-r from-transparent via-zinc-700/40 to-transparent" />;
  }
  return (
    <div className="mt-5 mb-2 px-3 flex items-center gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-zinc-700/30 to-transparent" />
    </div>
  );
}

/* ─── SearchFilter ───────────────────────────────────────────────────── */
function SearchFilter({ query, setQuery, collapsed }) {
  if (collapsed) return null;
  return (
    <div className="px-3 mb-3">
      <div className={clsx(
        'flex items-center gap-2 rounded-lg px-3 py-2',
        'bg-zinc-800/50 border border-zinc-700/30',
        'focus-within:border-indigo-500/40 focus-within:bg-zinc-800/70',
        'transition-all duration-200'
      )}>
        <FaSearch className="text-[11px] text-zinc-500 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Quick find..."
          className="w-full bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <FaTimes className="text-[10px]" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── UserProfileCard ────────────────────────────────────────────────── */
const ROLE_CONFIG = {
  superadmin:     { label: 'Platform Owner', color: 'from-amber-400 to-orange-500' },
  admin:          { label: 'Org Admin',      color: 'from-indigo-400 to-blue-500' },
  user:           { label: 'Instructor',     color: 'from-emerald-400 to-teal-500' },
  sandboxuser:    { label: 'Learner',        color: 'from-violet-400 to-purple-500' },
  awssandboxuser: { label: 'Learner',        color: 'from-violet-400 to-purple-500' },
  selfservice:    { label: 'Explorer',       color: 'from-cyan-400 to-blue-500' },
};

function UserProfileCard({ email, userType, collapsed, onLogout }) {
  const initials = (email?.[0] || 'U').toUpperCase();
  const role = ROLE_CONFIG[userType] || ROLE_CONFIG.user;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-3">
        <div className="relative group">
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white ring-2 ring-zinc-700/50 transition-all duration-200 group-hover:ring-white/10"
            style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), var(--brand-accent, #8b5cf6))' }}
          >
            {initials}
          </div>
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#111118]" />
          <span className={clsx(
            'pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2',
            'whitespace-nowrap rounded-lg px-3 py-2 text-xs',
            'bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/50',
            'shadow-xl shadow-black/50',
            'opacity-0 scale-95 transition-all duration-150',
            'group-hover:opacity-100 group-hover:scale-100'
          )}>
            <div className="text-white font-medium">{email}</div>
            <div className="text-zinc-400 text-[10px] mt-0.5">{role.label}</div>
          </span>
        </div>
        <button
          onClick={onLogout}
          className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all duration-200"
        >
          <FaSignOutAlt className="text-sm" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {/* Profile card */}
      <div className="relative rounded-xl p-px overflow-hidden">
        <div
            className="absolute inset-0 rounded-xl"
            style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--brand-primary, #6366f1) 25%, transparent), color-mix(in srgb, var(--brand-accent, #8b5cf6) 25%, transparent), color-mix(in srgb, var(--brand-primary, #6366f1) 25%, transparent))' }}
          />
        <div className="relative rounded-xl bg-[#16161e] px-3 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), var(--brand-accent, #8b5cf6))' }}
              >
                {initials}
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#16161e]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-zinc-200 truncate">{email}</div>
              <span className={clsx(
                'inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider text-white',
                `bg-gradient-to-r ${role.color}`
              )}>
                {role.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onLogout}
        className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-zinc-500 hover:text-rose-400 hover:bg-rose-500/[0.08] transition-all duration-200 border border-transparent hover:border-rose-500/20"
      >
        <FaSignOutAlt className="text-sm" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}

/* ─── Main Sidebar ───────────────────────────────────────────────────── */
export default function Sidebar({ userDetails, onLogout, collapsed, onToggleCollapse }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ monitor: false, launch: false, cloud: false, billing: false, platform: false });
  const [searchQuery, setSearchQuery] = useState('');
  const { branding } = useBranding();

  const [hasLabResources, setHasLabResources] = useState(true);
  useEffect(() => {
    const t = userDetails?.userType;
    if (t !== 'sandboxuser' && t !== 'awssandboxuser') return;
    let cancelled = false;
    apiCaller.get('/user/has-lab-resources')
      .then(r => { if (!cancelled) setHasLabResources(!!r.data?.hasResources); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userDetails?.userType]);

  const email = userDetails?.email || '';
  const userType = userDetails?.userType || 'user';
  const org = userDetails?.organization || 'org';
  const sidebarWidth = collapsed ? 72 : 260;

  // Search
  const sq = searchQuery.toLowerCase().trim();
  const matchesSearch = (label) => !sq || label.toLowerCase().includes(sq);
  const anyMatch = (...labels) => !sq || labels.some(l => l.toLowerCase().includes(sq));
  const effectiveOpenSections = sq
    ? Object.fromEntries(Object.keys(openSections).map(k => [k, true]))
    : openSections;

  const content = (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/[0.06] backdrop-blur-xl transition-all duration-300 ease-out"
      style={{
        width: sidebarWidth,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.015) 0%, transparent 30%, rgba(0,0,0,0.12) 100%), linear-gradient(180deg, rgba(8,15,26,0.97) 0%, rgba(8,15,26,0.95) 45%, rgba(4,8,18,0.98) 100%)',
      }}
    >
      {/* Accent stripe — brand gradient */}
      <div className="h-[2px] w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, var(--brand-primary, #6366f1), var(--brand-accent, #8b5cf6), var(--brand-primary, #6366f1))' }} />

      {/* Header */}
      <div className="flex items-center h-14 px-3 border-b border-zinc-800/50 flex-shrink-0">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          {collapsed ? (
            <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800/60">
              <img
                src={branding.logoUrl || `/logo/${org}-logo.png`}
                onError={(e) => { e.currentTarget.src = '/logo/logo.png'; }}
                alt="Logo"
                className="h-full w-full object-contain p-0.5"
              />
            </div>
          ) : (
            <img
              src={branding.logoUrl || '/logo/logo.png'}
              onError={(e) => { e.currentTarget.src = '/logo/logo.png'; }}
              alt={branding.companyName || 'HexaLabs'}
              className="h-7 object-contain"
            />
          )}
        </Link>
        <button
          onClick={onToggleCollapse}
          className="ml-auto p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-all duration-200"
        >
          {collapsed ? <FaChevronRight className="text-xs" /> : <FaChevronLeft className="text-xs" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto dark-scrollbar px-2 py-3 space-y-0.5">
        <SearchFilter query={searchQuery} setQuery={setSearchQuery} collapsed={collapsed} />

        {/* ── Self-service (Explorer) ── */}
        {userType === 'selfservice' ? (
          <>
            {matchesSearch('My Labs') && <NavItem to="/my-labs" icon={FaTerminal} label="My Labs" collapsed={collapsed} />}
            {matchesSearch('Explore Courses') && <NavItem to="/courses" icon={FaGraduationCap} label="Explore Courses" collapsed={collapsed} />}
            {matchesSearch('Help Center') && <NavItem to="/support" icon={FaHeadset} label="Help Center" collapsed={collapsed} />}
          </>
        ) : (
        <>
          {/* ── Overview ── */}
          <SectionDivider label="Overview" collapsed={collapsed} />

          {matchesSearch('Home') && (
            <NavItem to="/" icon={FaHome} label="Home" collapsed={collapsed} />
          )}
          {userType === 'superadmin' && matchesSearch('Analytics') && (
            <NavItem to="/dashboard" icon={FaChartBar} label="Analytics" collapsed={collapsed} />
          )}
          {(userType === 'admin' || userType === 'superadmin') && matchesSearch('Courses') && (
            <NavItem to="/courses" icon={FaGraduationCap} label="Courses" collapsed={collapsed} />
          )}

          {/* ── Lab Operations ── */}
          {(userType !== 'sandboxuser' && userType !== 'awssandboxuser') && (
            <SectionDivider label="Lab Operations" collapsed={collapsed} />
          )}

          {(userType === 'admin' || userType === 'superadmin' || userType === 'user') && (
            <>
              {/* Monitor */}
              {anyMatch('Monitor', 'Lab Console', 'Cost Breakdown', 'Activity') && (
                <Accordion id="monitor" icon={FaEye} label="Monitor" collapsed={collapsed} openMap={effectiveOpenSections} setOpenMap={setOpenSections}>
                  {matchesSearch('Lab Console') && <NavItem to="/vm/vmdetails" icon={FaTerminal} label="Lab Console" collapsed={false} />}
                  {(userType === 'admin' || userType === 'superadmin') && matchesSearch('Cost Breakdown') && (
                    <NavItem to="/vm/billing" icon={FaWallet} label="Cost Breakdown" collapsed={false} />
                  )}
                  {(userType === 'admin' || userType === 'superadmin') && matchesSearch('Activity') && (
                    <NavItem to="/vm/logs" icon={FaHistory} label="Activity" collapsed={false} />
                  )}
                </Accordion>
              )}

              {/* Launch */}
              {(userType === 'admin' || userType === 'superadmin') && anyMatch('Launch', 'Virtual Machine', 'Fresh VM', 'Container', 'Templates', 'Workshop', 'Routing', 'RDP Desktop', 'Guided Labs', 'AI Lab Suite', 'ROSA', 'ARO') && (
                <Accordion id="launch" icon={FaBolt} label="Launch" collapsed={collapsed} openMap={effectiveOpenSections} setOpenMap={setOpenSections}>
                  {matchesSearch('Virtual Machine') && <NavItem to="/createvm" icon={FaLaptop} label="Virtual Machine" collapsed={false} />}
                  {matchesSearch('Fresh VM') && <NavItem to="/create-fresh-vm" icon={FaServer} label="Fresh VM" collapsed={false} />}
                  {matchesSearch('Container') && <NavItem to="/containers" icon={FaDocker} label="Container" collapsed={false} />}
                  {matchesSearch('Templates') && <NavItem to="/templates" icon={FaLayerGroup} label="Templates" collapsed={false} />}
                  {matchesSearch('Workshop') && <NavItem to="/workshop" icon={FaRocket} label="Workshop" collapsed={false} />}
                  {userType === 'superadmin' && matchesSearch('Routing') && (
                    <NavItem to="/template-routing" icon={FaProjectDiagram} label="Routing" collapsed={false} />
                  )}
                  {matchesSearch('RDP Desktop') && <NavItem to="/rds" icon={FaWindows} label="RDP Desktop" collapsed={false} />}
                  {matchesSearch('Guided Labs') && <NavItem to="/guided-labs" icon={FaFileAlt} label="Guided Labs" collapsed={false} />}
                  {matchesSearch('AI Lab Suite') && <NavItem to="/guided-labs/toc-suite" icon={FaMagic} label="AI Lab Suite" collapsed={false} />}
                  {matchesSearch('ROSA') && <NavItem to="/rosa" icon={FaRedhat} label="ROSA" collapsed={false} />}
                  {matchesSearch('ARO') && <NavItem to="/aro" icon={FaCloud} label="ARO" collapsed={false} />}
                </Accordion>
              )}
            </>
          )}

          {/* Lab Console for sandbox learners */}
          {(userType === 'sandboxuser' || userType === 'awssandboxuser') && hasLabResources && matchesSearch('Lab Console') && (
            <NavItem to="/vm/vmdetails" icon={FaTerminal} label="Lab Console" collapsed={collapsed} />
          )}

          {/* My Environments */}
          {(userType === 'user' || userType === 'sandboxuser' || userType === 'awssandboxuser' || userType === 'admin' || userType === 'superadmin') && matchesSearch('My Environments') && (
            <NavItem to="/my-sandboxes" icon={FaGlobe} label="My Environments" collapsed={collapsed} />
          )}

          {/* Cloud Accounts */}
          {(userType === 'admin' || userType === 'superadmin') && anyMatch('Cloud Accounts', 'Azure', 'AWS', 'GCP', 'OCI', 'AI Builder') && (
            <Accordion id="cloud" icon={FaCloud} label="Cloud Accounts" collapsed={collapsed} openMap={effectiveOpenSections} setOpenMap={setOpenSections}>
              {matchesSearch('Azure') && <NavItem to="/sandbox/azure/users" icon={FaUsers} label="Azure" collapsed={false} />}
              {matchesSearch('AWS') && <NavItem to="/sandbox/aws/users" icon={FaUsers} label="AWS" collapsed={false} />}
              {matchesSearch('GCP') && <NavItem to="/sandbox/gcp/users" icon={FaUsers} label="GCP" collapsed={false} />}
              {matchesSearch('OCI') && <NavItem to="/sandbox/oci-sandbox" icon={FaDatabase} label="OCI" collapsed={false} />}
              {matchesSearch('AI Builder') && <NavItem to="/sandbox-builder" icon={FaMagic} label="AI Builder" collapsed={false} />}
            </Accordion>
          )}

          {/* ── Management ── */}
          {(userType === 'admin' || userType === 'superadmin') && (
            <SectionDivider label="Management" collapsed={collapsed} />
          )}

          {/* Billing */}
          {(userType === 'admin' || userType === 'superadmin') && anyMatch('Billing', 'Cost Dashboard', 'Invoices') && (
            <Accordion id="billing" icon={FaWallet} label="Billing" collapsed={collapsed} openMap={effectiveOpenSections} setOpenMap={setOpenSections}>
              {userType === 'superadmin' && matchesSearch('Cost Dashboard') && (
                <NavItem to="/costs" icon={FaChartLine} label="Cost Dashboard" collapsed={false} />
              )}
              {matchesSearch('Invoices') && (
                <NavItem to={userType === 'superadmin' ? '/ledger' : '/ledger/account'} icon={FaFileAlt} label="Invoices" collapsed={false} />
              )}
            </Accordion>
          )}

          {/* Platform */}
          {(userType === 'admin' || userType === 'superadmin') && anyMatch('Platform', 'Insights', 'Optimizer', 'Permissions', 'Network', 'Limits', 'Control Panel', 'Cleanup', 'End Training') && (
            <Accordion id="platform" icon={FaCogs} label="Platform" collapsed={collapsed} openMap={effectiveOpenSections} setOpenMap={setOpenSections}>
              {userType === 'superadmin' && matchesSearch('Insights') && (
                <NavItem to="/analytics" icon={FaChartBar} label="Insights" collapsed={false} />
              )}
              {userType === 'superadmin' && matchesSearch('Optimizer') && (
                <NavItem to="/optimize" icon={FaSlidersH} label="Optimizer" collapsed={false} />
              )}
              {matchesSearch('Permissions') && (
                <NavItem to="/admin/access-control" icon={FaUserShield} label="Permissions" collapsed={false} />
              )}
              {matchesSearch('Network') && (
                <NavItem to="/vm/ports" icon={FaNetworkWired} label="Network" collapsed={false} />
              )}
              {userType === 'superadmin' && matchesSearch('Limits') && (
                <NavItem to="/vm/quota" icon={FaQuota} label="Limits" collapsed={false} />
              )}
              {userType === 'superadmin' && matchesSearch('Control Panel') && (
                <NavItem to="/overview" icon={FaSuperscript} label="Control Panel" collapsed={false} />
              )}
              {userType === 'superadmin' && matchesSearch('Cleanup') && (
                <NavItem to="/vm/deletelogs" icon={FaTrashAlt} label="Cleanup" collapsed={false} />
              )}
              {userType === 'superadmin' && matchesSearch('End Training') && (
                <NavItem to="/vm/deletetraining" icon={FaStopCircle} label="End Training" collapsed={false} />
              )}
            </Accordion>
          )}
        </>
        )}
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-zinc-800/50">
        {(!sq || matchesSearch('Help Center')) && (
          <a
            href="https://portal.labsoncloud.online/support"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg mx-2 mt-2 px-3 py-2 text-[13px] font-medium text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-all duration-200"
          >
            <FaHeadset className="text-sm" />
            {!collapsed && <span>Help Center</span>}
          </a>
        )}

        <UserProfileCard email={email} userType={userType} collapsed={collapsed} onLogout={onLogout} />
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 p-2.5 rounded-lg lg:hidden text-white bg-zinc-900/90 backdrop-blur-lg border border-zinc-700/50 shadow-xl shadow-black/30"
      >
        <FaBars />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="hidden lg:block">{content}</div>
      {mobileOpen && <div className="lg:hidden">{content}</div>}
    </>
  );
}
