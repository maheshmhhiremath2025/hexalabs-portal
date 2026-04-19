import React, { useEffect, useState, useRef } from 'react';
import apiCaller from '../../services/apiCaller';
import { FaCloud, FaPlus, FaTrash, FaClock, FaSpinner } from 'react-icons/fa';

// GCP project provisioning takes 1-3 min — same time-based phase pattern
// used elsewhere in the portal.
function gcpProgress(startedAt) {
  if (!startedAt) return null;
  const sec = (Date.now() - startedAt) / 1000;
  const ESTIMATED = 90;
  let label = 'Submitting request to Google Cloud...';
  if (sec > 60) label = 'Finalizing IAM bindings...';
  else if (sec > 30) label = 'Applying budget cap + org policies...';
  else if (sec > 10) label = 'Creating GCP project...';
  return { sec, pct: Math.min(95, Math.round((sec / ESTIMATED) * 100)), label };
}

export default function GcpSandbox({ userDetails }) {
  const [data, setData] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Tick every 1s while creating so the progress card updates
  const [createStartedAt, setCreateStartedAt] = useState(null);
  const [, setTick] = useState(0);
  const tickRef = useRef(null);
  useEffect(() => {
    if (creating) tickRef.current = setInterval(() => setTick(t => t + 1), 1000);
    else if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [creating]);

  const fetchData = async () => {
    try {
      const res = await apiCaller.get('/gcp-sandbox/');
      setData(res.data);
    } catch { setError('Failed to load sandbox data'); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!projectName || projectName.length > 20) { setError('Project name must be 1-20 characters'); return; }
    setCreating(true); setCreateStartedAt(Date.now()); setError(null); setSuccess(null);
    try {
      const res = await apiCaller.post('/gcp-sandbox/', { projectName });
      setSuccess(`Sandbox ${res.data.projectId} created (TTL: ${res.data.ttlHours}h)`);
      setProjectName('');
      await fetchData();
    } catch (err) { setError(err.response?.data?.message || 'Creation failed'); }
    finally { setCreating(false); setCreateStartedAt(null); }
  };

  const handleDelete = async (projectId) => {
    if (!window.confirm(`Delete sandbox ${projectId}?`)) return;
    setDeleting(projectId);
    try {
      await apiCaller.delete('/gcp-sandbox/', { data: { projectId } });
      setSuccess(`Sandbox ${projectId} deletion queued`);
      await fetchData();
    } catch (err) { setError(err.response?.data?.message || 'Delete failed'); }
    finally { setDeleting(null); }
  };

  if (!data) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
    </div>
  );

  const available = (data.credits?.total || 0) - (data.credits?.consumed || 0);
  const sandboxes = data.sandbox || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header stats */}
      <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <FaCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">GCP Sandbox</h2>
              <p className="text-xs text-gray-500">{data.email || data.googleEmail}</p>
            </div>
          </div>
          <a href="/gcp-sandbox-guide.pdf" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Sandbox Guide</a>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase font-semibold">Credits Used</div>
            <div className="text-xl font-bold text-gray-900">{data.credits?.consumed || 0}<span className="text-sm text-gray-400 font-normal">/{data.credits?.total || 0}</span></div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase font-semibold">Available</div>
            <div className={`text-xl font-bold ${available > 0 ? 'text-green-600' : 'text-red-600'}`}>{available}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 uppercase font-semibold">TTL per Sandbox</div>
            <div className="text-xl font-bold text-gray-900">{data.sandboxTtlHours || 4}h</div>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

      {/* Create sandbox */}
      {available > 0 && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Create New Sandbox</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Project Name</label>
              <input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="my-sandbox"
                maxLength={20} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
            <button type="submit" disabled={creating || !projectName}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {creating ? <FaSpinner className="animate-spin" /> : <FaPlus className="w-3 h-3" />}
              Create
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Project will be auto-deleted after {data.sandboxTtlHours || 4} hours. Budget limit: ₹{data.budgetLimit || 500}.</p>

          {/* Live create progress */}
          {creating && (() => {
            const p = gcpProgress(createStartedAt);
            return (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-blue-800">{p.label}</span>
                  <span className="text-xs text-blue-600 tabular-nums">{p.pct}% &middot; {Math.floor(p.sec)}s elapsed</span>
                </div>
                <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                  <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${p.pct}%` }} />
                </div>
              </div>
            );
          })()}
        </form>
      )}

      {/* Sandboxes list */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">My Sandboxes ({sandboxes.length})</h3>
        </div>
        {sandboxes.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No sandboxes yet. Create one above.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sandboxes.map(sb => {
              const now = new Date();
              const expiry = sb.deleteTime ? new Date(sb.deleteTime) : null;
              const minutesLeft = expiry ? Math.max(0, Math.round((expiry - now) / 60000)) : null;
              const isExpired = expiry && expiry <= now;
              const hoursLeft = minutesLeft ? Math.floor(minutesLeft / 60) : 0;
              const minsLeft = minutesLeft ? minutesLeft % 60 : 0;

              return (
                <div key={sb.projectId || sb._id} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{sb.projectId}</span>
                      {sb.projectName && <span className="text-xs text-gray-400">({sb.projectName})</span>}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        isExpired ? 'bg-red-50 text-red-600' : minutesLeft <= 30 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
                      }`}>
                        {isExpired ? 'Expired' : `${hoursLeft}h ${minsLeft}m left`}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
                      <span><FaClock className="inline w-2.5 h-2.5 mr-1" />Created {new Date(sb.createdTime).toLocaleString('en-IN')}</span>
                      {expiry && <span>Expires {expiry.toLocaleString('en-IN')}</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(sb.projectId)} disabled={deleting === sb.projectId}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors">
                    {deleting === sb.projectId ? <FaSpinner className="w-3.5 h-3.5 animate-spin" /> : <FaTrash className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
