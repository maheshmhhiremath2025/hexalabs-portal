import React, { useEffect, useState, useRef, useCallback } from 'react';
import apiCaller from '../../services/apiCaller';
import { FaGoogle, FaPlus, FaTrash, FaKey, FaSpinner, FaUsers, FaRocket, FaExclamationTriangle, FaDownload } from 'react-icons/fa';
import BulkEmailInput from '../../components/BulkEmailInput';

export default function GcpUsers({ userDetails }) {
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
  const [batchExpiresAt, setBatchExpiresAt] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const isSuper = userDetails?.userType === 'superadmin';
  const [bulkEmails, setBulkEmails] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [emailWarnings, setEmailWarnings] = useState([]);
  const [filterOrg, setFilterOrg] = useState('');
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const pollRef = useRef(null);

  const fetchUsers = useCallback(async (silent = false) => {
    if (isSuper && !filterOrg) {
      setUsers([]);
      setSelectedEmails(new Set());
      if (!silent) setLoading(false);
      return;
    }
    try {
      const url = isSuper && filterOrg ? `/gcp-sandbox/user?organization=${encodeURIComponent(filterOrg)}` : '/gcp-sandbox/user';
      const res = await apiCaller.get(url);
      setUsers(res.data);
      setSelectedEmails(new Set());
    } catch {
      if (!silent) setError('Error fetching GCP sandbox users.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [isSuper, filterOrg]);

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { if (isSuper) fetchUsers(); }, [filterOrg]);

  const toggleSelected = (email) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedEmails(prev => prev.size === users.length ? new Set() : new Set(users.map(u => u.email)));
  };
  const handleBulkDelete = async () => {
    const emails = [...selectedEmails];
    if (emails.length === 0) return;
    if (!window.confirm(`Delete ${emails.length} GCP sandbox user(s)?\n\nThis will tear down their GCP projects + Mongo records. Cannot be undone.`)) return;
    setBulkDeleting(true); setError(null); setSuccess(null);
    try {
      const res = await apiCaller.post('/sandbox/bulk-delete-users', { cloud: 'gcp', emails });
      const jobId = res.data?.jobId;
      if (!jobId) throw new Error('No jobId returned');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        if (attempts > 180) { clearInterval(poll); setBulkDeleting(false); setError('Bulk delete timed out'); return; }
        try {
          const s = await apiCaller.get(`/sandbox/bulk-delete-status/${jobId}`);
          if (s.data?.status === 'done' || s.data?.status === 'failed') {
            clearInterval(poll);
            setBulkDeleting(false);
            const ok = s.data.completed || 0;
            const total = s.data.total || emails.length;
            const failedCount = s.data.failed || 0;
            setSuccess(`Bulk delete: ${ok}/${total} succeeded${failedCount ? `, ${failedCount} failed` : ''}`);
            setSelectedEmails(new Set());
            fetchUsers();
          }
        } catch {}
      }, 2000);
    } catch (e) {
      setBulkDeleting(false);
      setError(`Bulk delete failed: ${e.response?.data?.error || e.message}`);
    }
  };

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

  // Fetch organizations for superadmin org-picker
  useEffect(() => {
    if (userDetails?.userType !== 'superadmin') return;
    apiCaller.get('/admin/organization')
      .then(r => setOrgs(r.data?.organization || []))
      .catch(() => {});
  }, [userDetails]);

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
    if (isSuper && !selectedOrg) {
      setError('Please select an Organization to deploy to.');
      return;
    }
    setDeploying(true); setError(null); setSuccess(null); setDeployResult(null);
    try {
      const res = await apiCaller.post('/gcp-sandbox/bulk-deploy-gcp', {
        templateSlug: selectedTemplate,
        emails,
        ttlHours,
        dailyCapHours,
        totalCapHours,
        batchExpiresAt: batchExpiresAt || null,
        organization: selectedOrg || undefined,
      });
      setDeployResult(res.data);
      setSuccess(`Deployed ${res.data.succeeded}/${res.data.total} GCP sandboxes from "${res.data.templateName}"`);
      setBulkEmails('');
      await fetchUsers();
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk deploy failed');
    } finally { setDeploying(false); }
  };

  
  const [resettingUser, setResettingUser] = useState(null);
  const handleResetPassword = async (email) => {
    if (!window.confirm(`Reset password for ${email}?\n\nNew password will be: Welcome1234!\nShare it with the learner via your usual channel.`)) return;
    setResettingUser(email);
    setError(null);
    try {
      await apiCaller.patch(superadminApiRoutes.usersApi, { email, resetPassword: true });
      setSuccess(`Password reset for ${email}. New password: Welcome1234!`);
      setTimeout(() => setSuccess(null), 6000);
    } catch (e) {
      setError(`Could not reset ${email}. ${e.response?.data?.message || ""}`);
    } finally {
      setResettingUser(null);
    }
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
      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FaGoogle className="text-red-500" /> GCP Sandbox Users
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage GCP sandbox users and their project quotas</p>
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
            {isSuper && (
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Deploy to Organization</label>
                <select
                  value={selectedOrg}
                  onChange={e => setSelectedOrg(e.target.value)}
                  className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                >
                  <option value="">Select an organization...</option>
                  {orgs.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-0.5">Required. Sandboxes will be visible to this org's admin.</p>
              </div>
            )}
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
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Batch ends on</label>
              <input type="datetime-local" value={batchExpiresAt} onChange={e => setBatchExpiresAt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              <p className="text-[10px] text-gray-400 mt-0.5">After this date, IAM user + DB record are permanently deleted</p>
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
        <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-gray-800">Users ({users.length})</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {isSuper && (
              <select
                value={filterOrg}
                onChange={e => setFilterOrg(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-red-500"
                title="Filter by organization"
              >
                <option value="">— Select organization —</option>
                {orgs.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {selectedEmails.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
              >
                {bulkDeleting ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaTrash className="w-3 h-3" />}
                Delete {selectedEmails.size} selected
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
        ) : isSuper && !filterOrg ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">Select an organization above to view its sandbox users.</div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">No GCP sandbox users in this organization.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-3 py-2.5 text-left">
                    <input
                      type="checkbox"
                      checked={users.length > 0 && selectedEmails.size === users.length}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                      title="Select all"
                    />
                  </th>
                  {['Email', 'Session TTL', 'Sandboxes', 'Batch Expires', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map(u => {
                  const activeSandboxes = (u.sandbox || []).length;
                  const expired = u.endDate && new Date(u.endDate) < new Date();
                  const batchExpired = u.batchExpiresAt && new Date(u.batchExpiresAt) < new Date();
                  const isDeleting = u.deletionStatus === 'deleting';
                  const deleteFailed = u.deletionStatus === 'failed';
                  return (
                    <tr key={u._id} className={`hover:bg-gray-50/50 ${isDeleting ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selectedEmails.has(u.email)}
                          onChange={() => toggleSelected(u.email)}
                          disabled={isDeleting}
                          className="rounded border-gray-300"
                        />
                      </td>
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
                      <td className="px-4 py-2.5 text-gray-600">{u.sandboxTtlHours ? `${u.sandboxTtlHours}h` : '-'}</td>
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
                        <span className={batchExpired ? 'text-red-500 font-semibold' : 'text-gray-700'}>
                          {u.batchExpiresAt
                            ? new Date(u.batchExpiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                            : <span className="text-gray-400 italic">no expiry</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isDeleting ? (
                          <FaSpinner className="w-3 h-3 animate-spin text-gray-400 inline" />
                        ) : (<>
                          <button onClick={() => handleResetPassword(u.email)} disabled={resettingUser === u.email}
                            title="Reset password to Welcome1234!"
                            className="p-1.5 mr-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-50 transition-colors">
                            {resettingUser === u.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaKey className="w-3 h-3" />}
                          </button>
                          <button onClick={() => handleDelete(u.email)} disabled={deleting === u.email}
                            title={deleteFailed ? 'Retry delete' : 'Delete user'}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors">
                            {deleting === u.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaTrash className="w-3 h-3" />}
                          </button>
                        </>)}
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
