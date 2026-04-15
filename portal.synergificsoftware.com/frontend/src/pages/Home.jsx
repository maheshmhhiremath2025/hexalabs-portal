import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { apiOpenRoutes } from '../services/apiRoutes';
import {
  FaServer, FaDocker, FaWindows, FaCloud, FaAws, FaGoogle, FaMicrosoft,
  FaRocket, FaUsers, FaChartLine, FaFileAlt, FaExclamationTriangle,
  FaCheckCircle, FaClock, FaArrowRight, FaRobot, FaCubes, FaGraduationCap,
  FaShieldAlt, FaChartBar, FaCut, FaSuperscript, FaBook, FaHeadset,
} from 'react-icons/fa';

export default function Home({ userDetails }) {
  const org = userDetails?.organization || 'Organization';
  const userType = userDetails?.userType || 'user';
  const email = userDetails?.email || '';
  const firstName = email.split('@')[0]?.split('.')[0] || 'there';

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCaller.get(apiOpenRoutes.dashboardApi)
      .then(r => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isAdmin = userType === 'admin' || userType === 'superadmin';
  const isSuperAdmin = userType === 'superadmin';

  // Time-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Hero welcome */}
      <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }}>
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="relative px-7 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">
              {greeting}, <span className="text-blue-400">{firstName}</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {org} · {userType === 'superadmin' ? 'Super Admin' : userType === 'admin' ? 'Admin' : 'User'}
              {stats && !loading && (
                <span className="ml-3 text-slate-500">
                  · {stats.users || 0} users · {stats.organization || 0} orgs · {stats.virtualMachines || 0} VMs
                </span>
              )}
            </p>
          </div>
          <Link
            to="/vm/vmdetails"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <FaServer className="w-3.5 h-3.5" /> Lab Console
          </Link>
        </div>
      </div>

      {/* Live stats strip */}
      {stats && !loading && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <MiniStat icon={FaUsers} label="Users" value={stats.users || 0} accent="blue" />
          <MiniStat icon={FaCubes} label="Organizations" value={stats.organization || 0} accent="indigo" />
          <MiniStat icon={FaServer} label="VMs" value={stats.virtualMachines || 0} accent="emerald" />
          <MiniStat icon={FaFileAlt} label="Templates" value={stats.templates || 0} accent="cyan" />
          <MiniStat icon={FaGraduationCap} label="Trainings" value={(stats.azureTraining || 0) + (stats.gcpTraining || 0)} accent="amber" />
          <MiniStat icon={FaGoogle} label="GCP Projects" value={stats.projects || 0} accent="rose" />
        </div>
      )}

      {/* Alerts — only show if there are issues */}
      {stats && ((stats.azureQuotaExceeded || 0) > 0 || (stats.gcpQuotaExceeded || 0) > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 flex items-center gap-3">
          <FaExclamationTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div className="flex-1 text-sm text-amber-800">
            <span className="font-semibold">{(stats.azureQuotaExceeded || 0) + (stats.gcpQuotaExceeded || 0)} quota alert{((stats.azureQuotaExceeded || 0) + (stats.gcpQuotaExceeded || 0)) !== 1 ? 's' : ''}</span>
            {stats.azureQuotaExceeded > 0 && <span> · {stats.azureQuotaExceeded} Azure VMs exceeded quota</span>}
            {stats.gcpQuotaExceeded > 0 && <span> · {stats.gcpQuotaExceeded} GCP projects over budget</span>}
          </div>
          <Link to="/vm/quota" className="text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap">View →</Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Deploy actions — the primary column */}
        <div className="lg:col-span-2 space-y-5">

          {/* Deploy shortcuts */}
          {isAdmin && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Deploy</div>
                <div className="text-[11px] text-gray-500">Provision labs for your customers</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                <ActionCard to="/createvm" icon={FaServer} iconBg="bg-blue-50 text-blue-600 border-blue-100" title="Deploy VM" desc="Azure virtual machine" />
                <ActionCard to="/containers" icon={FaDocker} iconBg="bg-emerald-50 text-emerald-600 border-emerald-100" title="Deploy Workspace" desc="Docker lab environment" />
                <ActionCard to="/rds" icon={FaWindows} iconBg="bg-indigo-50 text-indigo-600 border-indigo-100" title="Windows Desktop" desc="Windows desktop lab" />
              </div>
            </div>
          )}

          {/* Cloud & B2B shortcuts */}
          {isAdmin && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Cloud Sandboxes & B2B</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                <ActionCard to="/sandbox/azure/users" icon={FaMicrosoft} iconBg="bg-blue-50 text-[#0078d4] border-blue-100" title="Azure Sandboxes" desc="Manage Azure lab users" />
                <ActionCard to="/sandbox/aws/users" icon={FaAws} iconBg="bg-amber-50 text-[#FF9900] border-amber-100" title="AWS Sandboxes" desc="Manage AWS lab users" />
                <ActionCard to="/b2b/courses" icon={FaRobot} iconBg="bg-violet-50 text-violet-600 border-violet-100" title="Course Analyses" desc="PDF analyzer + auto-templates" />
              </div>
            </div>
          )}

          {/* For regular users — simplified */}
          {!isAdmin && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Your Lab</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                <ActionCard to="/vm/vmdetails" icon={FaServer} iconBg="bg-blue-50 text-blue-600 border-blue-100" title="Lab Console" desc="Access your VMs and workspaces" />
                <ActionCard to="/courses" icon={FaGraduationCap} iconBg="bg-emerald-50 text-emerald-600 border-emerald-100" title="Course Catalog" desc="Browse available courses" />
              </div>
            </div>
          )}

          {/* Cloud provider status */}
          <div className="grid grid-cols-3 gap-3">
            <ProviderCard icon={FaMicrosoft} name="Azure" color="#0078d4" bg="bg-[#0078d4]/5" border="border-[#0078d4]/15" count={stats?.virtualMachines} label="VMs" />
            <ProviderCard icon={FaAws} name="AWS" color="#FF9900" bg="bg-[#FF9900]/5" border="border-[#FF9900]/15" count={stats?.azureQuotaExceeded === 0 ? 'Active' : `${stats?.azureQuotaExceeded || 0} alerts`} label="status" />
            <ProviderCard icon={FaGoogle} name="GCP" color="#4285F4" bg="bg-[#4285F4]/5" border="border-[#4285F4]/15" count={stats?.projects} label="Projects" />
          </div>

          {/* FAQ */}
          <FaqSection />
        </div>

        {/* Right sidebar — admin tools + resources */}
        <div className="space-y-5">

          {/* Admin quick nav */}
          {isSuperAdmin && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Administration</div>
              </div>
              <div className="divide-y divide-gray-50">
                <NavRow to="/dashboard" icon={FaChartLine} label="Dashboard" desc="Platform analytics" />
                <NavRow to="/costs" icon={FaChartBar} label="Cost Analytics" desc="P&L by resource" />
                <NavRow to="/optimize" icon={FaCut} label="Cost Optimization" desc="Orphan scan + right-sizing" />
                <NavRow to="/analytics" icon={FaChartLine} label="Usage Analytics" desc="Customer breakdown" />
                <NavRow to="/overview" icon={FaSuperscript} label="Admin Center" desc="Users, orgs, templates" />
                <NavRow to="/ledger" icon={FaFileAlt} label="Invoices" desc="Client ledger + billing" />
              </div>
            </div>
          )}

          {/* Resources */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="px-5 py-3 border-b border-gray-100">
              <div className="text-sm font-semibold text-gray-900">Resources</div>
            </div>
            <div className="divide-y divide-gray-50">
              <NavRow to="/courses" icon={FaGraduationCap} label="Course Catalog" desc="Browse lab templates" />
              <a href="https://getlabs.cloud/support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center">
                  <FaBook className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">Documentation</div>
                  <div className="text-[11px] text-gray-500">Guides and API reference</div>
                </div>
                <FaArrowRight className="w-3 h-3 text-gray-300" />
              </a>
              <NavRow to="/support" icon={FaHeadset} label="Get Support" desc="Contact our team" />
            </div>
          </div>

          {/* System status */}
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <div className="text-sm font-medium text-gray-900">All systems operational</div>
                <div className="text-[11px] text-gray-500">Azure · AWS · GCP · Portal</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Subcomponents ---------- */

function MiniStat({ icon: Icon, label, value, accent }) {
  const accents = {
    blue: 'border-l-blue-500', indigo: 'border-l-indigo-500', emerald: 'border-l-emerald-500',
    cyan: 'border-l-cyan-500', amber: 'border-l-amber-500', rose: 'border-l-rose-500',
  };
  return (
    <div className={`bg-white border border-gray-200 border-l-[3px] ${accents[accent] || accents.blue} rounded-lg px-3 py-2.5`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="text-lg font-semibold text-gray-900 tabular-nums">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function ActionCard({ to, icon: Icon, iconBg, title, desc }) {
  return (
    <Link to={to} className="group flex items-center gap-3.5 px-5 py-4 hover:bg-gray-50/70 transition-colors">
      <div className={`w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">{title}</div>
        <div className="text-[11px] text-gray-500">{desc}</div>
      </div>
      <FaArrowRight className="w-3 h-3 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
    </Link>
  );
}

function NavRow({ to, icon: Icon, label, desc }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center">
        <Icon className="w-3.5 h-3.5 text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="text-[11px] text-gray-500">{desc}</div>
      </div>
      <FaArrowRight className="w-3 h-3 text-gray-300" />
    </Link>
  );
}

function ProviderCard({ icon: Icon, name, color, bg, border, count, label }) {
  return (
    <div className={`rounded-xl ${bg} border ${border} px-4 py-3.5 text-center`}>
      <Icon className="w-5 h-5 mx-auto mb-2" style={{ color }} />
      <div className="text-lg font-semibold text-gray-900">{count ?? '—'}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{name} {label}</div>
    </div>
  );
}

const FAQ_ITEMS = [
  { q: 'How do I deploy a lab for my customer?', a: 'Go to Deploy → choose VM, Workspace, or Windows Desktop. Select the image, set resources and seat count, enter student emails, set expiry, and click Deploy. Students receive a welcome email with credentials automatically.' },
  { q: 'What\'s the difference between VMs, Workspaces, and Windows Desktops?', a: 'VMs give each student a full virtual machine (best for admin/server labs). Workspaces give lightweight Linux environments with pre-installed tools (best for DevOps, Big Data, AI/ML). Windows Desktops give each student their own isolated Windows desktop accessible via browser (best for Windows application labs).' },
  { q: 'How does the B2B Course Analyzer work?', a: 'Upload a customer\'s course PDF → our AI extracts modules, services, and hours → checks feasibility against our catalog → generates a deployment plan → locks into a deployable sandbox template. Works for both cloud sandbox courses and workspace lab courses.' },
  { q: 'How do cloud sandbox accounts get cleaned up?', a: 'Every sandbox has a TTL (2h, 4h, 8h, or 24h). Students get a warning email 30 min before expiry. At expiry, Azure deletes the resource group, AWS deletes the IAM user + all resources, GCP deletes the entire project. Fully automatic, no orphans.' },
  { q: 'How does usage tracking work?', a: 'Azure usage syncs automatically every 6 hours. Workspace usage is tracked by duration. Admins can view detailed analytics in the Cost Analytics dashboard.' },
  { q: 'Can students extend their lab duration?', a: 'Yes — admins can click "Extend" on the expiry banner in the Lab Console. Students see a countdown in their view. The extension resets the TTL and sends a fresh warning email before the new expiry.' },
];

function FaqSection() {
  const [open, setOpen] = React.useState(null);
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="px-5 py-3 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-900">Frequently asked questions</div>
      </div>
      <div className="divide-y divide-gray-100">
        {FAQ_ITEMS.map((faq, i) => (
          <div key={i}>
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50/50 transition-colors"
            >
              <span className="text-sm font-medium text-gray-700 pr-4">{faq.q}</span>
              <span className="text-gray-400 flex-shrink-0 text-xs">{open === i ? '−' : '+'}</span>
            </button>
            {open === i && (
              <div className="px-5 pb-3 text-sm text-gray-600 leading-relaxed">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
