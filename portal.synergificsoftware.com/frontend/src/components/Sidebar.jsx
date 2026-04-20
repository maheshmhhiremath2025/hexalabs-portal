import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useBranding } from '../contexts/BrandingContext';
import {
  FaHome, FaTachometerAlt, FaLaptop, FaUsers, FaChevronDown, FaBars, FaTimes,
  FaSignOutAlt, FaHeadset, FaFileInvoiceDollar, FaHistory, FaNetworkWired,
  FaClock, FaRocket, FaShieldAlt, FaTrashAlt, FaStopCircle, FaCloud,
  FaCubes, FaFileAlt, FaSuperscript, FaChevronLeft, FaChevronRight, FaChartLine, FaDocker, FaChartBar, FaCut, FaWindows, FaDatabase,
  FaGraduationCap,
  FaRobot,
  FaCog,
  FaTachometerAlt as FaQuota,
  FaRedhat,
} from 'react-icons/fa';

function NavItem({ to, icon: Icon, label, collapsed, onClick }) {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(to + '/');
  return (
    <Link
      to={to}
      onClick={onClick}
      className={clsx(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-100',
        active
          ? 'bg-white/10 text-white'
          : 'text-surface-400 hover:text-white hover:bg-white/5'
      )}
    >
      <Icon className="text-sm flex-shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {collapsed && (
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-surface-700 px-2.5 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {label}
        </span>
      )}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full" style={{ backgroundColor: 'var(--brand-primary, #3b82f6)' }} />
      )}
    </Link>
  );
}

function Accordion({ id, icon: Icon, label, collapsed, openMap, setOpenMap, children }) {
  const open = !!openMap[id];
  const toggle = () => setOpenMap(m => ({ ...m, [id]: !m[id] }));

  if (collapsed) {
    return (
      <div className="relative group">
        <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-surface-400 hover:bg-white/5 hover:text-white transition-colors">
          <Icon className="text-sm" />
        </button>
        <div className="invisible absolute left-full top-0 z-50 ml-3 min-w-[200px] overflow-hidden rounded-lg border border-surface-700 bg-surface-800 p-2 text-sm shadow-xl opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-surface-400 hover:bg-white/5 hover:text-white transition-colors">
        <Icon className="text-sm" />
        <span className="flex-1 truncate text-left">{label}</span>
        <FaChevronDown className={clsx('text-[10px] text-surface-500 transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-4 pl-3 border-l border-white/10 space-y-0.5 py-1">
          {children}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ userDetails, onLogout, collapsed, onToggleCollapse }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState({ instance: false, deploy: false, maintenance: false, sandboxes: false });
  const { branding } = useBranding();

  const email = userDetails?.email || '';
  const userType = userDetails?.userType || 'user';
  const org = userDetails?.organization || 'org';
  const sidebarWidth = collapsed ? 72 : 260;

  const content = (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex flex-col bg-surface-900 transition-all duration-200"
      style={{ width: sidebarWidth }}
    >
      {/* Accent stripe */}
      <div className="h-[3px] w-full flex-shrink-0" style={{ background: `linear-gradient(90deg, ${branding.primaryColor}, ${branding.accentColor})` }} />

      {/* Header */}
      <div className="flex items-center h-14 px-3 border-b border-white/10 flex-shrink-0">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          {collapsed ? (
            <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg bg-white/10">
              <img
                src={branding.logoUrl || `/logo/${org}-logo.png`}
                onError={(e) => { e.currentTarget.src = '/logo/synergificsoftware-logo.png'; }}
                alt="Logo"
                className="h-full w-full object-contain p-0.5"
              />
            </div>
          ) : (
            <>
              <img
                src={branding.logoUrl || '/logo/synergificsoftware-logo.png'}
                onError={(e) => { e.currentTarget.src = '/logo/synergificsoftware-logo.png'; }}
                alt={branding.companyName || 'Synergific'}
                className="h-7 object-contain"
              />
            </>
          )}
        </Link>
        <button
          onClick={onToggleCollapse}
          className="ml-auto p-1.5 text-surface-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
        >
          {collapsed ? <FaChevronRight className="text-xs" /> : <FaChevronLeft className="text-xs" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        {!collapsed && <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">Main</div>}

        {/* Self-service users get a simplified nav */}
        {userType === 'selfservice' ? (
          <>
            <NavItem to="/my-labs" icon={FaDocker} label="My Labs" collapsed={collapsed} />
            <NavItem to="/courses" icon={FaGraduationCap} label="Course Catalog" collapsed={collapsed} />
            <NavItem to="/support" icon={FaHeadset} label="Support" collapsed={collapsed} />
          </>
        ) : (
        <>
        <NavItem to="/" icon={FaHome} label="Home" collapsed={collapsed} />
        {userType === 'superadmin' && (
          <NavItem to="/dashboard" icon={FaTachometerAlt} label="Dashboard" collapsed={collapsed} />
        )}
        {(userType === 'admin' || userType === 'superadmin') && (
          <NavItem to="/courses" icon={FaGraduationCap} label="Course Catalog" collapsed={collapsed} />
        )}

        {!collapsed && (userType !== 'sandboxuser' && userType !== 'awssandboxuser') && <div className="px-3 mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">Infrastructure</div>}

        {(userType === 'admin' || userType === 'superadmin' || userType === 'user') && (
          <>
          {/* Instance Overview — read-only diagnostic stuff that all roles can see */}
          <Accordion id="instance" icon={FaLaptop} label="Instance Overview" collapsed={collapsed} openMap={openSections} setOpenMap={setOpenSections}>
            <NavItem to="/vm/vmdetails" icon={FaLaptop} label="Lab Console" collapsed={false} />
            {(userType === 'admin' || userType === 'superadmin') && (
              <NavItem to="/vm/billing" icon={FaFileInvoiceDollar} label="Cost Analysis" collapsed={false} />
            )}
            {(userType === 'admin' || userType === 'superadmin') && (
              <NavItem to="/vm/logs" icon={FaHistory} label="Activity Log" collapsed={false} />
            )}
          </Accordion>

          {/* Deploy — provisioning actions, all 3 lab types under one roof */}
          {(userType === 'admin' || userType === 'superadmin') && (
            <Accordion id="deploy" icon={FaRocket} label="Deploy" collapsed={collapsed} openMap={openSections} setOpenMap={setOpenSections}>
              <NavItem to="/createvm" icon={FaLaptop} label="Deploy VM" collapsed={false} />
              <NavItem to="/containers" icon={FaDocker} label="Deploy Workspace" collapsed={false} />
              <NavItem to="/templates" icon={FaCubes} label="Workspace Templates" collapsed={false} />
              <NavItem to="/rds" icon={FaWindows} label="Windows Desktop" collapsed={false} />
              <NavItem to="/rosa" icon={FaRedhat} label="ROSA Clusters" collapsed={false} />
              <NavItem to="/aro" icon={FaCloud} label="ARO Clusters" collapsed={false} />
            </Accordion>
          )}

          {/* Maintenance — admin actions: networking, scheduling, access control,
              destructive ops. Grouped to keep them out of the way. */}
          {(userType === 'admin' || userType === 'superadmin') && (
            <Accordion id="maintenance" icon={FaCog} label="Maintenance" collapsed={collapsed} openMap={openSections} setOpenMap={setOpenSections}>
              <NavItem to="/vm/ports" icon={FaNetworkWired} label="Networking" collapsed={false} />
              <NavItem to="/vm/scheduler" icon={FaClock} label="Operations" collapsed={false} />
              <NavItem to="/vm/restriction" icon={FaShieldAlt} label="Access Control" collapsed={false} />
              {userType === 'superadmin' && (
                <>
                  <NavItem to="/vm/quota" icon={FaQuota} label="Quotas" collapsed={false} />
                  <NavItem to="/vm/deletelogs" icon={FaTrashAlt} label="Purge Logs" collapsed={false} />
                  <NavItem to="/vm/deletetraining" icon={FaStopCircle} label="End Batch" collapsed={false} />
                </>
              )}
            </Accordion>
          )}
          </>
        )}

        {/* Sandbox users only see My Sandboxes — their assigned sandboxes appear there automatically */}
        {(userType === 'sandboxuser' || userType === 'awssandboxuser') && (
          <NavItem to="/my-sandboxes" icon={FaCubes} label="My Sandboxes" collapsed={collapsed} />
        )}

        {(userType === 'admin' || userType === 'superadmin') && (
        <Accordion id="sandboxes" icon={FaCubes} label="Sandboxes" collapsed={collapsed} openMap={openSections} setOpenMap={setOpenSections}>
          {userType === 'superadmin' && (
            <>
              <NavItem to="/sandbox/azure/users" icon={FaUsers} label="Azure Lab Users" collapsed={false} />
              <NavItem to="/sandbox/aws/users" icon={FaUsers} label="AWS Lab Users" collapsed={false} />
              <NavItem to="/sandbox/gcp/users" icon={FaUsers} label="GCP Lab Users" collapsed={false} />
              <NavItem to="/sandbox/oci-sandbox" icon={FaDatabase} label="OCI Lab Users" collapsed={false} />
            </>
          )}
        </Accordion>
        )}

        {(userType === 'admin' || userType === 'superadmin') && (
          <>
            {!collapsed && <div className="px-3 mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">B2B Sales</div>}
            <NavItem to="/b2b/courses" icon={FaRobot} label="Course Analyses" collapsed={collapsed} />

            {!collapsed && <div className="px-3 mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">Finance</div>}
            {userType === 'superadmin' && (
              <NavItem to="/costs" icon={FaChartLine} label="Cost Analytics" collapsed={collapsed} />
            )}
            <NavItem to={userType === 'superadmin' ? '/ledger' : '/ledger/account'} icon={FaFileAlt} label="Invoices" collapsed={collapsed} />
          </>
        )}

        {userType === 'superadmin' && (
          <>
            {!collapsed && <div className="px-3 mt-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">Administration</div>}
            <NavItem to="/analytics" icon={FaChartBar} label="Usage Analytics" collapsed={collapsed} />
            <NavItem to="/optimize" icon={FaCut} label="Cost Optimization" collapsed={collapsed} />
            <NavItem to="/admin/access-control" icon={FaShieldAlt} label="Access Control" collapsed={collapsed} />
            <NavItem to="/overview" icon={FaSuperscript} label="Admin Center" collapsed={collapsed} />
          </>
        )}
        </>
        )}
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-white/10 p-3 space-y-2">
        <a
          href="https://getlabs.cloud/support"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-surface-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <FaHeadset className="text-sm" />
          {!collapsed && <span>Support</span>}
        </a>

        {!collapsed && (
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="h-8 w-8 rounded-full bg-white/10 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {(email?.[0] || 'U').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-surface-300 truncate">{email}</div>
              <div className="text-[10px] text-surface-500 capitalize">{userType}</div>
            </div>
          </div>
        )}

        <button
          onClick={onLogout}
          className={clsx(
            "w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium",
            "text-red-400 hover:bg-red-500/10 transition-colors"
          )}
        >
          <FaSignOutAlt className="text-sm" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 p-2.5 bg-surface-800 text-white shadow-lg rounded-lg border border-surface-700 lg:hidden"
      >
        <FaBars />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Desktop: always show. Mobile: show when open */}
      <div className={clsx("hidden lg:block")}>{content}</div>
      {mobileOpen && <div className="lg:hidden">{content}</div>}
    </>
  );
}
