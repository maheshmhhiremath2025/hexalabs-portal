import React, { useState, useEffect } from 'react';
import apiCaller from '../services/apiCaller';
import { FaWindows, FaUsers, FaArrowDown, FaServer, FaSpinner, FaDesktop } from 'react-icons/fa';

const formatINR = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export default function DeployRDS({ userDetails }) {
  const [options, setOptions] = useState({ vmSizes: {} });
  const [trainingName, setTrainingName] = useState('');
  const [organization, setOrganization] = useState(userDetails?.organization || '');
  const [vmSize, setVmSize] = useState('medium');
  const [userCount, setUserCount] = useState(10);
  const maxUsersForSize = options.vmSizes?.[vmSize]?.maxUsers || 30;
  const [emails, setEmails] = useState('');
  const [allocatedHours, setAllocatedHours] = useState(100);
  const [autoShutdown, setAutoShutdown] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [labExpiry, setLabExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [comparison, setComparison] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { apiCaller.get('/rds/options').then(r => setOptions(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    apiCaller.get('/rds/cost-compare', { params: { users: userCount, vmSize } })
      .then(r => setComparison(r.data)).catch(() => {});
  }, [userCount, vmSize]);

  const handleDeploy = async () => {
    if (!trainingName || !organization) return;

    // Guard: if expiry is set, ensure it's at least 30 min in the future.
    // Azure VM provisioning takes 3-5 min; setting a near-future expiry will
    // cause the labExpiryChecker to auto-delete the VM before users can use it.
    if (labExpiry && expiryDate) {
      const expiryMs = new Date(expiryDate).getTime();
      const minExpiry = Date.now() + 15 * 60 * 1000;
      if (expiryMs < minExpiry) {
        setError('Lab expiry must be at least 15 minutes from now. Azure VMs take 3-5 minutes to provision — a closer expiry risks the lab auto-deleting before students can use it.');
        return;
      }
    }

    setDeploying(true); setResult(null); setError(null); setProgress(null);
    try {
      const emailList = emails.split('\n').map(e => e.trim()).filter(Boolean);
      const res = await apiCaller.post('/rds/create', { trainingName, organization, vmSize, userCount, emails: emailList, allocatedHours, autoShutdown, idleMinutes, expiresAt: labExpiry && expiryDate ? new Date(expiryDate).toISOString() : null });
      const jobId = res.data.jobId;
      if (!jobId) { setResult(res.data); setDeploying(false); return; }

      const poll = setInterval(async () => {
        try {
          const s = await apiCaller.get(`/rds/deploy-status/${jobId}`);
          setProgress(s.data);
          if (s.data.status === 'done' || s.data.status === 'failed') {
            clearInterval(poll);
            if (s.data.status === 'done') setResult(s.data.result);
            else setError(s.data.phase);
            setDeploying(false); setProgress(null);
          }
        } catch { clearInterval(poll); setDeploying(false); }
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed'); setDeploying(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FaDesktop className="text-blue-500" /> Windows Desktop Lab
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Deploy Windows desktops for students — each user gets their own isolated desktop session accessible via browser.
        </p>
      </div>

      {/* Cost comparison removed — pricing hidden from client-facing pages */}

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Deploy form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-semibold text-gray-800">New Windows Desktop Lab</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Training Name</label>
            <input value={trainingName} onChange={e => setTrainingName(e.target.value)} placeholder="e.g. windows-lab-1"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Organization</label>
            <input value={organization} onChange={e => setOrganization(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Server Size</label>
            <select value={vmSize} onChange={e => { setVmSize(e.target.value); const max = options.vmSizes?.[e.target.value]?.maxUsers || 30; if (userCount > max) setUserCount(max); }}
              className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
              {Object.entries(options.vmSizes || {}).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
              Number of Users <span className="text-gray-400 normal-case">(max {maxUsersForSize} for this size)</span>
            </label>
            <input type="number" min={1} max={maxUsersForSize} value={Math.min(userCount, maxUsersForSize)}
              onChange={e => setUserCount(Math.min(+e.target.value, maxUsersForSize))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            {userCount > maxUsersForSize && (
              <p className="text-xs text-red-500 mt-1">Reduced to {maxUsersForSize} — select a larger VM for more users</p>
            )}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">User Emails (one per line, optional — auto-generated if empty)</label>
          <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={3} placeholder="user1@company.com&#10;user2@company.com"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Allocated Hours</label>
            <input type="number" min={1} value={allocatedHours} onChange={e => setAllocatedHours(+e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Idle Auto-Shutdown</label>
            <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={autoShutdown} onChange={e => setAutoShutdown(e.target.checked)}
                  className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" />
                <span className="text-sm text-gray-700">Auto-stop when idle</span>
              </label>
              {autoShutdown && (
                <select value={idleMinutes} onChange={e => setIdleMinutes(+e.target.value)}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white">
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                </select>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {autoShutdown ? `Server will auto-stop after ${idleMinutes} min of idle — saves cost when users aren't connected` : 'Disabled — server runs 24/7'}
            </p>
          </div>
        </div>

        {/* Lab Expiry */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={labExpiry} onChange={e => setLabExpiry(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" />
            <span className="text-sm text-gray-700 font-medium">Set lab expiry (auto-delete server + all users)</span>
          </label>
          {labExpiry && (
            <div className="mt-2 flex items-center gap-3">
              <input type="datetime-local" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                min={new Date().toISOString().slice(0, 16)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              {expiryDate && <span className="text-xs text-blue-600">Server + all resources auto-delete on {new Date(expiryDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>}
            </div>
          )}
          {!labExpiry && <p className="text-xs text-gray-400 mt-1">No expiry — server runs until manually deleted</p>}
        </div>

        {comparison && (
          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 flex items-center gap-3">
            <FaServer className="text-gray-400" />
            <span>
              Will provision <strong>{userCount}</strong> isolated Windows desktop sessions
            </span>
          </div>
        )}

        <button onClick={handleDeploy} disabled={deploying || !trainingName || !organization}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {deploying ? <FaSpinner className="animate-spin" /> : <FaWindows />}
          {deploying ? 'Deploying...' : `Deploy ${userCount} Windows Desktop${userCount > 1 ? 's' : ''}`}
        </button>

        {/* Progress */}
        {progress && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-800">Deploying Windows Desktops...</span>
              <span className="text-xs text-blue-600 tabular-nums">{progress.duration}s elapsed</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div className="h-2 rounded-full bg-blue-600 transition-all duration-700" style={{ width: `${progress.progress}%` }} />
            </div>
            <div className="text-xs text-blue-700">{progress.phase}</div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-green-800">Windows Desktops Ready — {result.userCount} users</div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-gray-500">Server</div>
                <div className="font-semibold text-gray-800">{result.serverName}</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-gray-500">Public IP</div>
                <div className="font-semibold text-gray-800">{result.publicIp}</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <div className="text-gray-500">Users</div>
                <div className="font-semibold text-gray-800">{result.userCount}</div>
              </div>
            </div>

            {/* User credentials table */}
            <div className="bg-white rounded-lg border border-green-200 overflow-hidden">
              <div className="px-4 py-2 bg-green-100/50 border-b border-green-200 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                Student Credentials — each student gets their own Windows desktop
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-gray-500">#</th>
                      <th className="px-3 py-2 text-left text-gray-500">Email</th>
                      <th className="px-3 py-2 text-left text-gray-500">Username</th>
                      <th className="px-3 py-2 text-left text-gray-500">Password</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.users.map((u, i) => (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-1.5 text-gray-700">{u.email}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-800">{u.username}</td>
                        <td className="px-3 py-1.5 font-mono text-gray-700">{u.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Students access via Lab Console → click "Open in Browser" to launch their Windows desktop
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
