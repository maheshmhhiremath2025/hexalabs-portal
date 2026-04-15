import React, { useEffect, useState, useRef, useCallback } from 'react';
import apiCaller from '../../services/apiCaller';
import { FaGoogle, FaPlus, FaTrash, FaSpinner, FaUsers, FaRocket, FaExclamationTriangle, FaDownload } from 'react-icons/fa';
import BulkEmailInput from '../../components/BulkEmailInput';

export default function GcpUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ googleEmail: '', duration: 5, sandboxTtlHours: 4, credits: 3, budgetLimit: 500 });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Template deploy state
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateDetail, setTemplateDetail] = useState(null);
  const [ttlHours, setTtlHours] = useState(4);
  const [dailyCapHours, setDailyCapHours] = useState(12);
  const [totalCapHours, setTotalCapHours] = useState(0);
  const [bulkEmails, setBulkEmails] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [emailWarnings, setEmailWarnings] = useState([]);

  const pollRef = useRef(null);

  const fetchUsers = useCallback(async (silent = false) => {
    try {
      const res = await apiCaller.get('/gcp-sandbox/user');
      setUsers(res.data);
    } catch {
      if (!silent) setError('Error fetching GCP sandbox users.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, []);

  // Auto-poll when any user has deletionStatus === 'deleting'
  useEffect(() => {
    const hasDeleting = users.some(u => u.deletionStatus === 'deleting');
    if (hasDeleting && !pollRef.current) {
      pollRef.current = setInterval(() => fetchUsers(true), 3000);
    } else if (!hasDeleting && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [users, fetchUsers]);

  // Fetch GCP templates
  useEffect(() => {
    (async () => {
      try {
        const res = await apiCaller.get('/sandbox-templates');
        const gcpTemplates = (res.data || []).filter(t => t.cloud === 'gcp');
        setTemplates(gcpTemplates);
      } catch {}
    })();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.googleEmail) { setError('Google email required'); return; }
    setCreating(true); setError(null); setSuccess(null);
    try {
      await apiCaller.post('/gcp-sandbox/user', form);
      setSuccess(`User ${form.googleEmail} created`);
      setForm({ googleEmail: '', duration: 5, sandboxTtlHours: 4, credits: 3, budgetLimit: 500 });
      setShowForm(false);
      await fetchUsers();
    } catch (err) { setError(err.response?.data?.message || 'Creation failed'); }
    finally { setCreating(false); }
  };

  // Validate Google emails and set warnings
  const getEmailList = () => bulkEmails.split('\n').map(s => s.trim()).filter(Boolean);

  const validateGoogleEmails = (emails) => {
    const warnings = [];
    for (const em of emails) {
      const domain = em.split('@')[1]?.toLowerCase();
      if (!domain) continue;
      if (domain !== 'gmail.com' && !domain.endsWith('.google.com')) {
        warnings.push(em);
      }
    }
    return warnings;
  };

  useEffect(() => {
    const emails = getEmailList();
    if (emails.length > 0) {
      setEmailWarnings(validateGoogleEmails(emails));
    } else {
      setEmailWarnings([]);
    }
  }, [bulkEmails]);

  const handleTemplateChange = async (slug) => {
    setSelectedTemplate(slug);
    setTemplateDetail(null);
    if (!slug) return;
    try {
      const res = await apiCaller.get(`/sandbox-templates/${slug}`);
      setTemplateDetail(res.data);
    } catch {}
  };

  const handleBulkDeploy = async () => {
    const emails = getEmailList();
    if (!selectedTemplate || emails.length === 0) return;
    setDeploying(true); setError(null); setSuccess(null); setDeployResult(null);
    try {
      const res = await apiCaller.post('/gcp-sandbox/bulk-deploy-gcp', {
        templateSlug: selectedTemplate,
        emails,
        ttlHours,
        dailyCapHours,
        totalCapHours,
      });
      setDeployResult(res.data);
      setSuccess(`Deployed ${res.data.succeeded}/${res.data.total} GCP sandboxes from "${res.data.templateName}"`);
      setBulkEmails('');
      await fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk deploy failed');
    } finally { setDeploying(false); }
  };

  const handleDelete = async (email) => {
    if (!window.confirm(`Delete GCP user ${email} and all their projects?\n\nThis will remove IAM bindings and delete GCP projects.`)) return;
    setDeleting(email);
    setError(null);
    setSuccess(`Deleting ${email} — removing GCP projects and IAM bindings...`);
    try {
      await apiCaller.delete('/gcp-sandbox/user', { data: { email } });
      // Mark as deleting locally; polling will pick up the final state
      setUsers(prev => prev.map(u => u.email === email ? { ...u, deletionStatus: 'deleting' } : u));
      setSuccess(null);
    } catch (err) {
      setError(err.response?.data?.message || `Failed to delete ${email}. Check GCP console.`);
      setSuccess(null);
    } finally { setDeleting(null); }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FaGoogle className="text-red-500" /> GCP Sandbox Users
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage GCP sandbox users and their project quotas</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">
          <FaPlus className="w-3 h-3" /> Add User
        </button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

      {/* Deploy from Template */}
      {templates.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <FaRocket className="text-blue-500 w-3.5 h-3.5" /> Deploy from Template
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">GCP Template</label>
              <select
                value={selectedTemplate || ''}
                onChange={e => handleTemplateChange(e.target.value)}
                className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              >
                <option value="">Select a template...</option>
                {templates.map(t => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}{t.certificationCode ? ` (${t.certificationCode})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Session TTL</label>
              <select
                value={ttlHours}
                onChange={e => setTtlHours(+e.target.value)}
                className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              >
                <option value={2}>2 hours</option>
                <option value={4}>4 hours</option>
                <option value={8}>8 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours</option>
                <option value={72}>72 hours</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Daily Cap (hrs)</label>
              <input type="number" min={1} max={24} value={dailyCapHours} onChange={e => setDailyCapHours(+e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" placeholder="12" />
              <p className="text-[10px] text-gray-400 mt-0.5">Max hours/day per student</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Total Cap (hrs)</label>
              <input type="number" min={0} value={totalCapHours} onChange={e => setTotalCapHours(+e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" placeholder="0 = unlimited" />
              <p className="text-[10px] text-gray-400 mt-0.5">0 = unlimited. e.g. 180 for 15d x 12h</p>
            </div>
          </div>

          {/* Template info card */}
          {templateDetail && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{templateDetail.name}</div>
                  {templateDetail.description && (
                    <p className="text-xs text-gray-500 mt-1">{templateDetail.description}</p>
                  )}
                </div>
                {templateDetail.certificationLevel && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase">
                    {templateDetail.certificationLevel}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                {templateDetail.allowedServices?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">Allowed Services</p>
                    <div className="flex flex-wrap gap-1">
                      {templateDetail.allowedServices.map((s, i) => (
                        <span key={i} className="inline-block px-2 py-0.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded">
                          {s.service}{s.restrictions ? ` (${s.restrictions})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {templateDetail.blockedServices?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">Blocked Services</p>
                    <div className="flex flex-wrap gap-1">
                      {templateDetail.blockedServices.map((s, i) => (
                        <span key={i} className="inline-block px-2 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded">
                          {s.service}{s.reason ? ` - ${s.reason}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>Default TTL: {templateDetail.sandboxConfig?.ttlHours || 4}h</span>
                <span>Region: {templateDetail.sandboxConfig?.region || 'asia-south1'}</span>
              </div>
            </div>
          )}

          <div>
            <BulkEmailInput
              label="Google Emails (Gmail or Google Workspace)"
              value={bulkEmails}
              onChange={setBulkEmails}
              rows={4}
              placeholder={"student1@gmail.com\nstudent2@company.com"}
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Google emails required (Gmail or Google Workspace). Each email gets a separate GCP project with Editor access.
            </p>
          </div>

          {/* Non-Google email warnings */}
          {emailWarnings.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <FaExclamationTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-700">
                <span className="font-semibold">Warning:</span> {emailWarnings.length} email{emailWarnings.length !== 1 ? 's' : ''} may not be Google accounts. GCP requires Gmail or Google Workspace emails for console access.
                <div className="mt-1 font-mono text-[11px] text-amber-600">
                  {emailWarnings.slice(0, 5).join(', ')}
                  {emailWarnings.length > 5 && `, +${emailWarnings.length - 5} more`}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkDeploy}
              disabled={deploying || !selectedTemplate || getEmailList().length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {deploying ? <FaSpinner className="animate-spin" /> : <FaRocket className="w-3 h-3" />}
              {deploying ? 'Deploying...' : `Deploy ${getEmailList().length} Sandbox${getEmailList().length !== 1 ? 'es' : ''}`}
            </button>
            {deploying && (
              <span className="text-xs text-gray-500">This may take a few minutes. Do not close this page.</span>
            )}
          </div>

          {/* Deploy results */}
          {deployResult && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">
                  Deploy Results: {deployResult.succeeded} succeeded, {deployResult.failed} failed
                </span>
                <button onClick={() => {
                  const rows = [['Email','Project ID','Status'].join(',')];
                  deployResult.results.forEach(r => {
                    rows.push([r.email, r.projectId || '', r.status].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
                  });
                  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                  a.download = `gcp-credentials-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                }} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                  <FaDownload className="w-2.5 h-2.5" /> CSV
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto divide-y divide-gray-100">
                {deployResult.results.map((r, i) => (
                  <div key={i} className="px-4 py-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-medium text-gray-800">{r.email}</span>
                      {r.projectId && <span className="text-gray-400 ml-2">{r.projectId}</span>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      r.status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {r.status === 'success' ? (r.iamBindingSuccess ? 'Success' : 'Created (IAM failed)') : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <h3 className="text-sm font-semibold text-gray-800">New GCP Sandbox User</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Google Email</label>
              <input value={form.googleEmail} onChange={e => setForm({ ...form, googleEmail: e.target.value })} placeholder="user@gmail.com" type="email"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Duration (days)</label>
              <input type="number" min={1} max={365} value={form.duration} onChange={e => setForm({ ...form, duration: +e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Sandbox TTL (hours)</label>
              <select value={form.sandboxTtlHours} onChange={e => setForm({ ...form, sandboxTtlHours: +e.target.value })}
                className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                <option value={2}>2 hours</option>
                <option value={4}>4 hours</option>
                <option value={8}>8 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Total Credits</label>
              <input type="number" min={1} max={50} value={form.credits} onChange={e => setForm({ ...form, credits: +e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {creating ? <FaSpinner className="animate-spin" /> : <FaPlus className="w-3 h-3" />} Create User
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">Users ({users.length})</h3>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No GCP sandbox users yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Email', 'Duration', 'TTL', 'Credits', 'Sandboxes', 'Expires', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => {
                  const available = (u.credits?.total || 0) - (u.credits?.consumed || 0);
                  const activeSandboxes = (u.sandbox || []).length;
                  const expired = u.endDate && new Date(u.endDate) < new Date();
                  const isDeleting = u.deletionStatus === 'deleting';
                  const deleteFailed = u.deletionStatus === 'failed';
                  return (
                    <tr key={u._id} className={`hover:bg-gray-50/50 ${isDeleting ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-800">{u.email}</div>
                        {u.googleEmail && u.googleEmail !== u.email && <div className="text-[11px] text-gray-400">{u.googleEmail}</div>}
                        {isDeleting && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-yellow-700">
                            <FaSpinner className="w-2 h-2 animate-spin" /> Deleting...
                          </span>
                        )}
                        {deleteFailed && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
                            <FaExclamationTriangle className="w-2 h-2" /> Delete failed -- retry
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{u.duration} days</td>
                      <td className="px-4 py-2.5 text-gray-600">{u.sandboxTtlHours || 4}h</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${available > 0 ? 'text-green-600' : 'text-red-600'}`}>{available}</span>
                        <span className="text-gray-400">/{u.credits?.total || 0}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {activeSandboxes > 0 ? (
                          <div className="space-y-1">
                            {(u.sandbox || []).map(sb => (
                              <div key={sb.projectId} className="text-xs">
                                <span className="font-medium text-gray-700">{sb.projectId}</span>
                                {sb.deleteTime && (
                                  <span className="text-gray-400 ml-1">
                                    (expires {new Date(sb.deleteTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : <span className="text-gray-300">none</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${expired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                          {expired ? 'Expired' : new Date(u.endDate).toLocaleDateString('en-IN')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isDeleting ? (
                          <FaSpinner className="w-3 h-3 animate-spin text-gray-400 inline" />
                        ) : (
                          <button onClick={() => handleDelete(u.email)} disabled={deleting === u.email}
                            title={deleteFailed ? 'Retry delete' : 'Delete user'}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors">
                            {deleting === u.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaTrash className="w-3 h-3" />}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
