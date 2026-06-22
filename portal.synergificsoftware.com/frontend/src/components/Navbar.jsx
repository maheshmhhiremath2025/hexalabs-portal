import React from 'react';
import { useLocation } from 'react-router-dom';
import { FaBell, FaSearch } from 'react-icons/fa';

const routeTitles = {
  '/': 'Home',
  '/dashboard': 'Dashboard',
  '/vm/vmdetails': 'Lab Console',
  '/vm/billing': 'Cost Analysis',
  '/vm/logs': 'Activity Log',
  '/vm/ports': 'Networking',
  '/admin/access-control': 'Permissions',
  '/vm/quota': 'Limits',
  '/vm/deletelogs': 'Cleanup',
  '/vm/deletetraining': 'End Training',
  '/createvm': 'Virtual Machine',
  '/overview': 'Control Panel',
  '/ledger': 'Invoices',
  '/ledger/account': 'Account',
  '/sandbox/azure': 'Azure Sandbox',
  '/sandbox/azure/users': 'Azure Lab Users',
  '/sandbox/aws/users': 'AWS Lab Users',
  '/sandbox/gcp/users': 'GCP Lab Users',
  '/containers': 'Container',
  '/rds': 'RDP Desktop',
  '/templates': 'Templates',
  '/costs': 'Cost Dashboard',
  '/analytics': 'Insights',
  '/optimize': 'Optimizer',
  '/courses': 'Course Catalog',
  '/guided-labs': 'Guided Labs',
  '/support': 'Help Center',
  '/my-labs': 'My Labs',
  '/my-sandboxes': 'My Environments',
};

export default function Navbar({ userDetails }) {
  const { pathname } = useLocation();
  const title = routeTitles[pathname] || 'Cloud Portal';

  // Role display mapping (matches sidebar naming)
  const roleLabel = {
    superadmin: 'Platform Owner',
    admin: 'Org Admin',
    user: 'Instructor',
    sandboxuser: 'Explorer',
    selfservice: 'Self-Service',
  }[userDetails?.userType] || userDetails?.userType;

  return (
    <header className="sticky top-0 z-30 h-14 bg-white/80 backdrop-blur-lg border-b border-gray-200/60 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-gray-50/80 border border-gray-200/60 rounded-lg px-3 py-1.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
          <FaSearch className="text-gray-400 text-xs" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none w-40"
          />
        </div>

        {/* Notifications */}
        <button className="relative p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all duration-200">
          <FaBell className="text-sm" />
        </button>

        {/* User badge */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-gray-200/60">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-xs font-semibold shadow-sm">
            {(userDetails?.email?.[0] || 'U').toUpperCase()}
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-medium text-gray-800 leading-tight">{userDetails?.email}</div>
            <div className="text-[11px] text-gray-400 leading-tight">{roleLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
