import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaArrowLeft, FaAws, FaCloud, FaGoogle, FaRocket, FaShieldAlt, FaBan, FaLayerGroup,
  FaClock, FaRupeeSign, FaCheckCircle, FaCopy, FaCheck, FaExternalLinkAlt, FaKey,
  FaBook, FaChartPie, FaMicrochip, FaTerminal, FaSpinner, FaUsers, FaTimes, FaDownload,
} from 'react-icons/fa';

const CLOUD_META = {
  aws:   { label: 'AWS',   Icon: FaAws,    color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-200' },
  azure: { label: 'Azure', Icon: FaCloud,  color: 'text-blue-600',  bg: 'bg-blue-50',   border: 'border-blue-200' },
  gcp:   { label: 'GCP',   Icon: FaGoogle, color: 'text-red-600',   bg: 'bg-red-50',    border: 'border-red-200' },
};

const LEVEL_PILL = {
  foundational: 'bg-green-50 text-green-700 border-green-200',
  associate:    'bg-blue-50 text-blue-700 border-blue-200',
  professional: 'bg-purple-50 text-purple-700 border-purple-200',
  specialty:    'bg-pink-50 text-pink-700 border-pink-200',
};

export default function CourseDetail() {
  const { slug } = useParams();
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState(null);
  const [copiedField, setCopiedField] = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [loadingDeployments, setLoadingDeployments] = useState(true);
  const [justDeployedId, setJustDeployedId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSeats, setBulkSeats] = useState(5);
  const [bulkJob, setBulkJob] = useState(null);
  const [bulkError, setBulkError] = useState(null);
  const [bulkEmails, setBulkEmails] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [selectedDeployments, setSelectedDeployments] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    apiCaller.get(`/sandbox-templates/${slug}`)
      .then(r => setTemplate(r.data))
      .catch(e => setError(e.response?.data?.message || 'Failed to load course'))
      .finally(() => setLoading(false));
  }, [slug]);

  const fetchDeployments = React.useCallback(async () => {
    setLoadingDeployments(true);
    try {
      const res = await apiCaller.get(`/sandbox-templates/${slug}/deployments`);
      setDeployments(res.data?.deployments || []);
    } catch (e) {
      // Non-fatal — the legacy deploy flow pre-dates this endpoint; just leave empty.
      setDeployments([]);
    } finally {
      setLoadingDeployments(false);
    }
  }, [slug]);

  useEffect(() => { fetchDeployments(); }, [fetchDeployments]);

  const handleDeploy = async () => {
    // GCP requires a Google email for IAM binding
    if (template?.cloud === 'gcp' && !googleEmail) {
      setDeployError('GCP sandboxes require a Google email (Gmail or Google Workspace). Enter it below the Deploy button.');
      return;
    }
    setDeploying(true); setDeployError(null);
    try {
      const body = template?.cloud === 'gcp' ? { googleEmail } : {};
      const res = await apiCaller.post(`/sandbox-templates/${slug}/deploy`, body);
      setJustDeployedId(res.data?.deploymentId || null);
      await fetchDeployments();
    } catch (e) {
      setDeployError(e.response?.data?.message || 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  const handleDeleteDeployment = async (deploymentId) => {
    if (!window.confirm('Delete this sandbox?\n\nThis will immediately tear down the cloud resource (IAM user / resource group / project) and remove it from the list.')) return;
    try {
      await apiCaller.delete(`/sandbox-templates/deployments/${deploymentId}`);
      setDeployments((prev) => prev.filter((d) => d._id !== deploymentId));
      setSelectedDeployments((prev) => { const next = new Set(prev); next.delete(deploymentId); return next; });
    } catch (e) {
      setDeployError(e.response?.data?.message || 'Failed to delete');
    }
  };

  const toggleSelectDeployment = (id) => {
    setSelectedDeployments((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDeployments.size === deployments.length) {
      setSelectedDeployments(new Set());
    } else {
      setSelectedDeployments(new Set(deployments.map((d) => d._id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDeployments.size === 0) return;
    if (!window.confirm(`Delete ${selectedDeployments.size} sandbox${selectedDeployments.size > 1 ? 'es' : ''}?\n\nThis will tear down all selected cloud resources and cannot be undone.`)) return;
    setBulkDeleting(true);
    setDeployError(null);
    let failed = 0;
    for (const id of selectedDeployments) {
      try {
        await apiCaller.delete(`/sandbox-templates/deployments/${id}`);
        setDeployments((prev) => prev.filter((d) => d._id !== id));
      } catch {
        failed++;
      }
    }
    setSelectedDeployments(new Set());
    setBulkDeleting(false);
    if (failed > 0) setDeployError(`${failed} sandbox${failed > 1 ? 'es' : ''} failed to delete — retry or check cloud console`);
  };

  const handleDownloadCSV = () => {
    if (deployments.length === 0) return;
    const rows = [['Email/Deployed By', 'Login URL', 'Username', 'Password', 'Region', 'TTL (hrs)', 'Expires At', 'Cloud Resource'].join(',')];
    for (const d of deployments) {
      const cloudRes = d.aws?.iamUsername ? `IAM: ${d.aws.iamUsername}` : d.azure?.resourceGroupName ? `RG: ${d.azure.resourceGroupName}` : d.gcp?.projectId ? `Project: ${d.gcp.projectId}` : '';
      const expires = d.expiresAt ? new Date(d.expiresAt).toLocaleString('en-IN') : '';
      const row = [
        d.deployedBy || '',
        d.accessUrl || '',
        d.username || '',
        d.password || '',
        d.region || '',
        d.ttlHours || '',
        expires,
        cloudRes,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      rows.push(row);
    }
    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${slug}-credentials-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleBulkDeploy = async () => {
    setBulkError(null); setBulkJob(null);
    const body = { seats: bulkSeats };
    if (template?.cloud === 'gcp' && bulkEmails.trim()) {
      body.emails = bulkEmails.split('\n').map(e => e.trim()).filter(Boolean);
      body.seats = body.emails.length;
    }
    try {
      const res = await apiCaller.post(`/sandbox-templates/${slug}/bulk-deploy`, body);
      const jobId = res.data?.jobId;
      if (!jobId) throw new Error('No jobId returned');
      setBulkJob({ jobId, total: bulkSeats, completed: 0, failed: 0, status: 'running', progress: 0 });
      // Poll for progress every 2s
      const interval = setInterval(async () => {
        try {
          const r = await apiCaller.get(`/sandbox-templates/bulk-jobs/${jobId}`);
          setBulkJob(r.data);
          if (r.data?.status === 'done' || r.data?.status === 'failed') {
            clearInterval(interval);
            await fetchDeployments();
          }
        } catch (err) {
          clearInterval(interval);
          setBulkError('Lost connection to job status');
        }
      }, 2000);
    } catch (e) {
      setBulkError(e.response?.data?.message || 'Bulk deploy failed to start');
    }
  };

  const closeBulkModal = () => {
    if (bulkJob?.status === 'running') {
      if (!window.confirm('A bulk deploy is in progress. Close this window anyway? The deployment will continue in the background.')) return;
    }
    setBulkOpen(false);
    setBulkJob(null);
    setBulkError(null);
  };

  const copy = (field, value) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loading) return (
    <div className="max-w-5xl mx-auto py-20 text-center">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
      <p className="text-sm text-gray-500 mt-3">Loading course…</p>
    </div>
  );

  if (error || !template) return (
    <div className="max-w-5xl mx-auto py-20 text-center text-gray-500">
      <p className="text-sm">{error || 'Course not found'}</p>
      <Link to="/courses" className="text-sm text-blue-600 hover:underline mt-3 inline-block">← Back to Catalog</Link>
    </div>
  );

  const cloud = CLOUD_META[template.cloud] || CLOUD_META.aws;
  const CloudIcon = cloud.Icon;
  const levelPill = LEVEL_PILL[template.certificationLevel] || 'bg-gray-50 text-gray-700 border-gray-200';

  const tabs = [
    { id: 'overview', label: 'Overview', Icon: FaBook },
    { id: 'domains', label: 'Exam Domains', Icon: FaChartPie, count: template.examDomains?.length },
    { id: 'labs', label: 'Guided Labs', Icon: FaLayerGroup, count: template.labs?.length },
    { id: 'services', label: 'Allowed Services', Icon: FaShieldAlt, count: template.allowedServices?.length },
    { id: 'blocked', label: 'Blocked', Icon: FaBan, count: template.blockedServices?.length },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back */}
      <Link to="/courses" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
        <FaArrowLeft className="w-2.5 h-2.5" /> Back to Course Catalog
      </Link>

      {/* Header card */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className={`h-1.5 ${cloud.bg}`} />
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${cloud.bg} ${cloud.border} border flex-shrink-0`}>
              <CloudIcon className={`w-7 h-7 ${cloud.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                {template.certificationCode && (
                  <span className="text-[11px] font-mono font-bold text-gray-700 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                    {template.certificationCode}
                  </span>
                )}
                {template.certificationLevel && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${levelPill}`}>
                    {template.certificationLevel}
                  </span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${cloud.bg} ${cloud.color} ${cloud.border}`}>
                  {cloud.label}
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">{template.name}</h1>
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">{template.description}</p>

              {/* Quick facts */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5"><FaLayerGroup className="w-3 h-3" /> {template.labs?.length || 0} guided labs</span>
                <span className="flex items-center gap-1.5"><FaShieldAlt className="w-3 h-3" /> {template.allowedServices?.length || 0} services allowed</span>
                {template.sandboxConfig?.ttlHours && (
                  <span className="flex items-center gap-1.5"><FaClock className="w-3 h-3" /> {template.sandboxConfig.ttlHours}h TTL</span>
                )}
                {template.sandboxConfig?.budgetInr && (
                  <span className="flex items-center gap-1.5"><FaRupeeSign className="w-3 h-3" /> ₹{template.sandboxConfig.budgetInr} budget</span>
                )}
                {template.sandboxConfig?.region && (
                  <span className="flex items-center gap-1.5"><FaMicrochip className="w-3 h-3" /> {template.sandboxConfig.region}</span>
                )}
              </div>
            </div>
          </div>

          {/* Deploy button + deployed sandboxes list */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            {/* GCP requires a Google email — show input when cloud=gcp */}
            {template?.cloud === 'gcp' && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <label className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider block mb-1.5">
                  Google Email (required for GCP)
                </label>
                <input
                  type="email"
                  value={googleEmail}
                  onChange={e => setGoogleEmail(e.target.value)}
                  placeholder="student@gmail.com or student@company.com"
                  className="w-full max-w-md px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                />
                <p className="text-[11px] text-amber-700 mt-1">
                  GCP Console uses Google accounts for authentication. Enter the student's Gmail or Google Workspace email — they'll sign in with their existing Google password.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeploy}
                  disabled={deploying || (template?.cloud === 'gcp' && !googleEmail)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {deploying ? (
                    <><FaSpinner className="w-3.5 h-3.5 animate-spin" /> Deploying sandbox…</>
                  ) : (
                    <><FaRocket className="w-3.5 h-3.5" /> Deploy for Training</>
                  )}
                </button>
                <button
                  onClick={() => { setBulkOpen(true); setBulkJob(null); setBulkError(null); }}
                  disabled={deploying}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-blue-300 text-blue-700 text-sm font-semibold rounded-lg hover:bg-blue-50 disabled:opacity-60 transition-colors"
                >
                  <FaUsers className="w-3.5 h-3.5" /> Deploy N seats in bulk
                </button>
              </div>
              {deployments.length > 0 && (
                <div className="text-xs text-gray-500">
                  {deployments.length} active sandbox{deployments.length === 1 ? '' : 'es'} from this template
                </div>
              )}
            </div>

            {deployError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{deployError}</div>
            )}

            {/* Active deployments list — survives page refresh */}
            {loadingDeployments ? (
              <div className="mt-3 text-xs text-gray-400 flex items-center gap-2">
                <FaSpinner className="w-3 h-3 animate-spin" /> Loading active sandboxes…
              </div>
            ) : deployments.length > 0 && (
              <div className="mt-3 space-y-2">
                {/* Action bar */}
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  {deployments.length > 1 ? (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={selectedDeployments.size === deployments.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {selectedDeployments.size === deployments.length ? 'Deselect all' : 'Select all'} ({deployments.length})
                    </label>
                  ) : (
                    <span className="text-[11px] text-gray-500">{deployments.length} sandbox{deployments.length === 1 ? '' : 'es'}</span>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownloadCSV}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <FaDownload className="w-2.5 h-2.5" /> Download CSV
                    </button>
                      {selectedDeployments.size > 0 && (
                        <button
                          onClick={handleBulkDelete}
                          disabled={bulkDeleting}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {bulkDeleting ? (
                            <><FaSpinner className="w-2.5 h-2.5 animate-spin" /> Deleting {selectedDeployments.size}...</>
                          ) : (
                            <><FaTimes className="w-2.5 h-2.5" /> Delete {selectedDeployments.size} selected</>
                          )}
                        </button>
                      )}
                  </div>
                </div>
                {deployments.map((d) => {
                  const isNew = d._id === justDeployedId;
                  const expiresAt = d.expiresAt ? new Date(d.expiresAt) : null;
                  const now = new Date();
                  const expired = expiresAt && expiresAt < now;
                  const minsLeft = expiresAt ? Math.max(0, Math.round((expiresAt - now) / 60000)) : null;
                  return (
                    <div key={d._id} className={`border rounded-lg p-4 ${isNew ? 'bg-green-50 border-green-300' : expired ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-green-200'} ${selectedDeployments.has(d._id) ? 'ring-2 ring-blue-400' : ''}`}>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedDeployments.has(d._id)}
                            onChange={() => toggleSelectDeployment(d._id)}
                            className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                          />
                          {isNew ? <FaCheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" /> : <FaKey className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />}
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900">
                              {isNew ? 'Just deployed' : 'Active sandbox'}
                              {expired && <span className="ml-2 text-[10px] font-bold text-gray-500 bg-gray-200 rounded-full px-1.5 py-0.5 uppercase">expired</span>}
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              {d.deployedBy && <span>by {d.deployedBy} · </span>}
                              {new Date(d.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                              {minsLeft !== null && !expired && (
                                <> · <span className={minsLeft < 30 ? 'text-amber-600 font-medium' : ''}>{minsLeft < 60 ? `${minsLeft}m left` : `${Math.round(minsLeft / 60)}h left`}</span></>
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteDeployment(d._id)}
                          title="Delete sandbox and clean up cloud resources"
                          className="text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 font-medium px-2 py-1 rounded-md transition-colors"
                        >
                          Delete
                        </button>
                      </div>

                      <div className="space-y-2">
                        {d.accessUrl && (
                          <CredRow label="Login URL" value={d.accessUrl} field={`url-${d._id}`} copiedField={copiedField} onCopy={copy} isLink />
                        )}
                        {d.username && (
                          <CredRow label="Username" value={d.username} field={`user-${d._id}`} copiedField={copiedField} onCopy={copy} />
                        )}
                        {d.password && d.password !== 'Use Google account' && (
                          <CredRow label="Password" value={d.password} field={`pass-${d._id}`} copiedField={copiedField} onCopy={copy} mono />
                        )}
                        <div className="text-[11px] text-gray-600 flex flex-wrap gap-3 pt-1">
                          {d.region && <span><span className="font-medium">Region:</span> {d.region}</span>}
                          {d.ttlHours && <span><span className="font-medium">TTL:</span> {d.ttlHours}h</span>}
                          {d.budgetInr && <span><span className="font-medium">Budget:</span> ₹{d.budgetInr}</span>}
                          {d.aws?.iamUsername && <span><span className="font-medium">IAM user:</span> <code>{d.aws.iamUsername}</code></span>}
                          {d.azure?.resourceGroupName && <span><span className="font-medium">RG:</span> <code>{d.azure.resourceGroupName}</code></span>}
                          {d.gcp?.projectId && <span><span className="font-medium">Project:</span> <code>{d.gcp.projectId}</code></span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="border-b border-gray-200 px-1 overflow-x-auto">
          <div className="flex gap-0">
            {tabs.map(t => {
              const Icon = t.Icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                    active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                  {typeof t.count === 'number' && (
                    <span className={`ml-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{t.count}</span>
                  )}
                  {active && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6">
          {tab === 'overview' && <OverviewTab template={template} slug={slug} />}
          {tab === 'domains' && <DomainsTab domains={template.examDomains} />}
          {tab === 'labs' && <LabsTab labs={template.labs} />}
          {tab === 'services' && <ServicesTab services={template.allowedServices} instanceTypes={template.allowedInstanceTypes?.[template.cloud]} />}
          {tab === 'blocked' && <BlockedTab services={template.blockedServices} />}
        </div>
      </div>

      {/* Bulk deploy modal */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeBulkModal}>
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <div className="text-base font-semibold text-gray-900">Bulk deploy — {template.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">Provision multiple sandboxes from this template. One per seat.</div>
              </div>
              <button onClick={closeBulkModal} className="text-gray-400 hover:text-gray-700 text-lg leading-none"><FaTimes /></button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {!bulkJob && (
                <>
                  {template?.cloud === 'gcp' ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                        Student Google Emails (one per line — Gmail or Google Workspace required)
                      </label>
                      <textarea
                        value={bulkEmails}
                        onChange={(e) => { setBulkEmails(e.target.value); const count = e.target.value.split('\n').map(l => l.trim()).filter(Boolean).length; setBulkSeats(Math.max(1, count)); }}
                        rows={5}
                        placeholder={"student1@gmail.com\nstudent2@company.com\nstudent3@gmail.com"}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
                      />
                      <div className="text-[11px] text-gray-500 mt-1">{bulkSeats} email{bulkSeats !== 1 ? 's' : ''} detected. Each student gets their own GCP project with their Google account.</div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Number of seats</label>
                      <input
                        type="number" min={1} max={100}
                        value={bulkSeats}
                        onChange={(e) => setBulkSeats(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      />
                      <div className="text-[11px] text-gray-500 mt-1">Max 100 per job. Each sandbox has its own credentials and TTL.</div>
                    </div>
                  )}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                    <strong>Heads up:</strong> each seat calls the cloud provider API sequentially (~3-5s per {template?.cloud === 'gcp' ? 'GCP project' : 'sandbox'}). {bulkSeats} seats ≈ {Math.ceil(bulkSeats * 4 / 60)} min. Don't close this window.
                  </div>
                  {bulkError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{bulkError}</div>
                  )}
                </>
              )}

              {bulkJob && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-700">
                      {bulkJob.status === 'done' ? 'Bulk deploy complete' : bulkJob.status === 'failed' ? 'Bulk deploy failed' : 'Deploying…'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {bulkJob.completed || 0} ok · {bulkJob.failed || 0} failed · {bulkJob.total} total
                    </div>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${bulkJob.status === 'failed' ? 'bg-red-500' : bulkJob.failed > 0 ? 'bg-amber-500' : 'bg-green-500'}`}
                      style={{ width: `${bulkJob.progress || 0}%` }}
                    />
                  </div>
                  {bulkJob.current && (
                    <div className="text-[11px] text-gray-500">{bulkJob.current}</div>
                  )}
                  {bulkJob.errors?.length > 0 && (
                    <div className="max-h-24 overflow-y-auto bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700 space-y-0.5">
                      {bulkJob.errors.slice(0, 5).map((e, i) => (
                        <div key={i}><strong>#{e.index || '?'}:</strong> {e.message}</div>
                      ))}
                      {bulkJob.errors.length > 5 && <div>…and {bulkJob.errors.length - 5} more</div>}
                    </div>
                  )}
                  {bulkJob.status === 'done' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
                      All {bulkJob.completed} sandboxes provisioned. Credentials are now visible in the "Active sandboxes" list below. Scroll down or close this modal.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
              {!bulkJob ? (
                <>
                  <button onClick={closeBulkModal} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkDeploy}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    <FaRocket /> Deploy {bulkSeats} seat{bulkSeats === 1 ? '' : 's'}
                  </button>
                </>
              ) : (
                <button
                  onClick={closeBulkModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                  disabled={bulkJob.status === 'running'}
                >
                  {bulkJob.status === 'running' ? 'Running…' : 'Close'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CredRow({ label, value, field, copiedField, onCopy, isLink, mono }) {
  return (
    <div className="flex items-center gap-2 bg-white border border-green-200 rounded px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-green-700 w-20 flex-shrink-0">{label}</div>
      {isLink ? (
        <a href={value} target="_blank" rel="noopener noreferrer" className="flex-1 text-xs text-blue-600 hover:underline truncate flex items-center gap-1">
          {value} <FaExternalLinkAlt className="w-2.5 h-2.5" />
        </a>
      ) : (
        <code className={`flex-1 text-xs text-gray-800 truncate ${mono ? 'font-mono' : ''}`}>{value}</code>
      )}
      <button
        onClick={() => onCopy(field, value)}
        className="text-gray-400 hover:text-gray-700 transition-colors"
      >
        {copiedField === field ? <FaCheck className="w-3 h-3 text-green-600" /> : <FaCopy className="w-3 h-3" />}
      </button>
    </div>
  );
}

function OverviewTab({ template, slug }) {
  return (
    <div className="space-y-5">
      <Section title="About this course">
        <p className="text-sm text-gray-600 leading-relaxed">{template.description || 'No additional description.'}</p>
      </Section>

      {template.examDomains?.length > 0 && (
        <Section title="Exam domain weights">
          <div className="space-y-2.5">
            {template.examDomains.map((d, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700">{d.name}</span>
                  <span className="text-xs font-semibold text-gray-600">{d.weight}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${d.weight}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniStat label="Guided labs" value={template.labs?.length || 0} />
        <MiniStat label="Services allowed" value={template.allowedServices?.length || 0} />
        <MiniStat label="Services blocked" value={template.blockedServices?.length || 0} />
      </div>

      <Section title="Raw IAM policy">
        <p className="text-xs text-gray-500 mb-2">The generated {template.cloud.toUpperCase()} policy is fetched live from the API.</p>
        <a
          href={`${import.meta.env.VITE_API_URL || 'https://api.getlabs.cloud'}/sandbox-templates/${slug}/policy`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-mono bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5"
        >
          <FaTerminal className="w-3 h-3" /> GET /sandbox-templates/{slug}/policy <FaExternalLinkAlt className="w-2.5 h-2.5" />
        </a>
      </Section>
    </div>
  );
}

function DomainsTab({ domains }) {
  if (!domains?.length) return <EmptyState text="No exam domains defined for this course." />;
  return (
    <div className="space-y-3">
      {domains.map((d, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">{d.name}</h4>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">{d.weight}% of exam</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full" style={{ width: `${d.weight}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LabsTab({ labs }) {
  if (!labs?.length) return <EmptyState text="No guided labs defined for this course." />;
  return (
    <div className="space-y-3">
      {labs.map((lab, i) => (
        <div key={lab._id || i} className="border border-gray-200 rounded-lg p-4 hover:border-blue-200 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[10px] font-mono text-gray-400">#{i + 1}</span>
                <h4 className="text-sm font-semibold text-gray-900">{lab.title}</h4>
                {lab.difficulty && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                    lab.difficulty === 'beginner' ? 'bg-green-50 text-green-700' :
                    lab.difficulty === 'intermediate' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                  }`}>{lab.difficulty}</span>
                )}
              </div>
              {lab.description && (
                <p className="text-xs text-gray-600 mt-1 line-clamp-2">{lab.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                {lab.domain && (
                  <span className="flex items-center gap-1"><FaChartPie className="w-2.5 h-2.5" /> {lab.domain}{lab.domainWeight ? ` (${lab.domainWeight}%)` : ''}</span>
                )}
                {lab.duration && (
                  <span className="flex items-center gap-1"><FaClock className="w-2.5 h-2.5" /> {lab.duration} min</span>
                )}
                {lab.steps?.length > 0 && (
                  <span>{lab.steps.length} steps</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ServicesTab({ services, instanceTypes }) {
  if (!services?.length) return <EmptyState text="No services defined — sandbox will use defaults." />;
  const byCategory = services.reduce((acc, s) => {
    const cat = s.category || 'Other';
    (acc[cat] = acc[cat] || []).push(s);
    return acc;
  }, {});
  return (
    <div className="space-y-5">
      {instanceTypes?.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-blue-800 mb-1.5 flex items-center gap-1.5"><FaMicrochip className="w-3 h-3" /> Allowed instance types</div>
          <div className="flex flex-wrap gap-1.5">
            {instanceTypes.map(it => (
              <span key={it} className="text-[11px] font-mono text-blue-700 bg-white border border-blue-200 rounded px-1.5 py-0.5">{it}</span>
            ))}
          </div>
        </div>
      )}
      {Object.entries(byCategory).map(([cat, list]) => (
        <div key={cat}>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{cat} <span className="text-gray-400">({list.length})</span></h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {list.map((s, i) => (
              <div key={i} className="border border-gray-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <FaCheckCircle className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-800 font-mono">{s.service}</div>
                  {s.restrictions && <div className="text-[11px] text-gray-500 mt-0.5">{s.restrictions}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockedTab({ services }) {
  if (!services?.length) return <EmptyState text="Nothing explicitly blocked — only the default sandbox policy applies." />;
  return (
    <div className="space-y-2">
      {services.map((s, i) => (
        <div key={i} className="border border-red-100 bg-red-50/30 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <FaBan className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-gray-800 font-mono">{s.service}</div>
            {s.reason && <div className="text-[11px] text-gray-500 mt-0.5">{s.reason}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="py-8 text-center text-sm text-gray-500">{text}</div>;
}
