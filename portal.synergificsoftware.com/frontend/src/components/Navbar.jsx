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
  '/vm/scheduler': 'Operations',
  '/vm/restriction': 'Access Control',
  '/vm/quota': 'Quotas',
  '/vm/deletelogs': 'Purge Logs',
  '/vm/deletetraining': 'End Batch',
  '/createvm': 'Deploy VM',
  '/overview': 'Admin Center',
  '/ledger': 'Invoices',
  '/ledger/account': 'Account',
  '/sandbox/azure': 'Azure Sandbox',
  '/sandbox/azure/users': 'Azure Lab Users',
  '/sandbox/aws/users': 'AWS Lab Users',
  '/support': 'Support',
};

export default function Navbar({ userDetails }) {
  const { pathname } = useLocation();
  const title = routeTitles[pathname] || 'Cloud Portal';

  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-surface-200 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-surface-800">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="hidden md:flex items-center gap-2 bg-surface-50 border border-surface-200 rounded-lg px-3 py-1.5">
          <FaSearch className="text-surface-400 text-xs" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent text-sm text-surface-700 placeholder-surface-400 outline-none w-40"
          />
        </div>

        {/* Notifications */}
        <button className="relative p-2 text-surface-500 hover:text-surface-700 hover:bg-surface-100 rounded-lg transition-colors">
          <FaBell className="text-sm" />
        </button>

        {/* User badge */}
        <div className="flex items-center gap-2.5 pl-3 border-l border-surface-200">
          <div className="h-8 w-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold">
            {(userDetails?.email?.[0] || 'U').toUpperCase()}
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-medium text-surface-800 leading-tight">{userDetails?.email}</div>
            <div className="text-xs text-surface-500 capitalize leading-tight">{userDetails?.userType}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
