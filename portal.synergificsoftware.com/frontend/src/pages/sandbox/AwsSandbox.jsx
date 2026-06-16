import React, { useEffect, useState, useRef, useCallback } from 'react';
import apiCaller from '../../services/apiCaller';
import { FaAws , FaKey } from 'react-icons/fa';
import { FaTrash, FaSpinner, FaRocket, FaDownload, FaExclamationTriangle } from 'react-icons/fa';
import BulkEmailInput from '../../components/BulkEmailInput';

const TTL_OPTIONS = [
    { label: '2 hours', value: 2 },
    { label: '4 hours', value: 4 },
    { label: '8 hours', value: 8 },
    { label: '12 hours', value: 12 },
    { label: '24 hours', value: 24 },
    { label: '48 hours', value: 48 },
    { label: '72 hours', value: 72 },
];

const AwsSandbox = ({ userDetails, superadminApiRoutes }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [deleting, setDeleting] = useState(null);

    // Template deploy state
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateSlug, setSelectedTemplateSlug] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [ttlHours, setTtlHours] = useState(4);
    const [dailyCapHours, setDailyCapHours] = useState(12);
    const [totalCapHours, setTotalCapHours] = useState(0);
    const [batchExpiresAt, setBatchExpiresAt] = useState('');
    const [orgs, setOrgs] = useState([]);
    const [selectedOrg, setSelectedOrg] = useState('');
    const [filterOrg, setFilterOrg] = useState('');
    const [selectedEmails, setSelectedEmails] = useState(new Set());
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const isSuper = userDetails?.userType === 'superadmin';
    const [deployEmails, setDeployEmails] = useState('');
    const [deploying, setDeploying] = useState(false);
    const [deployResults, setDeployResults] = useState(null);

    const pollRef = useRef(null);

    const fetchUsers = useCallback(async (silent = false) => {
        if (isSuper && !filterOrg) {
            setUsers([]);
            setSelectedEmails(new Set());
            if (!silent) setLoading(false);
            return;
        }
        if (!silent) setLoading(true);
        try {
            const url = isSuper && filterOrg
                ? `${superadminApiRoutes.awsUserApi}?organization=${encodeURIComponent(filterOrg)}`
                : superadminApiRoutes.awsUserApi;
            const res = await apiCaller.get(url);
            setUsers(res.data);
            setSelectedEmails(new Set());
        } catch {
            if (!silent) setError('Error fetching AWS sandbox users.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [superadminApiRoutes, isSuper, filterOrg]);

    useEffect(() => {
        fetchUsers();
        fetchTemplates();
        if (userDetails?.userType === 'superadmin') {
            apiCaller.get('/admin/organization')
                .then(r => setOrgs(r.data?.organization || []))
                .catch(() => {});
        }
    }, []);

    useEffect(() => {
        if (isSuper) fetchUsers();
    }, [filterOrg]);

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
        if (!window.confirm(`Delete ${emails.length} AWS sandbox user(s)?\n\nThis will tear down their IAM users + Mongo records. Cannot be undone.`)) return;
        setBulkDeleting(true);
        setError(null); setSuccess(null);
        try {
            const res = await apiCaller.post('/sandbox/bulk-delete-users', { cloud: 'aws', emails });
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

    const fetchTemplates = async () => {
        try {
            const res = await apiCaller.get('/sandbox-templates?cloud=aws');
            const awsTemplates = (res.data || []).filter(t => t.cloud === 'aws');
            setTemplates(awsTemplates);
        } catch {
            // Non-critical
        }
    };

    const handleTemplateChange = async (slug) => {
        setSelectedTemplateSlug(slug);
        setSelectedTemplate(null);
        if (!slug) return;
        try {
            const res = await apiCaller.get(`/sandbox-templates/${slug}`);
            setSelectedTemplate(res.data);
        } catch {
            setError('Failed to load template details.');
        }
    };

    const getEmailList = () =>
        deployEmails
            .split('\n')
            .map(e => e.trim())
            .filter(Boolean);

    const handleTemplateDeploy = async () => {
        const emails = getEmailList();
        if (!selectedTemplateSlug || emails.length === 0) return;
        if (isSuper && !selectedOrg) {
            setError('Please select an Organization to deploy to.');
            return;
        }

        setDeploying(true);
        setError(null);
        setSuccess(null);
        setDeployResults(null);

        try {
            const res = await apiCaller.post('/sandbox/bulk-deploy', {
                templateSlug: selectedTemplateSlug,
                emails,
                ttlHours,
                dailyCapHours,
                totalCapHours,
                batchExpiresAt: batchExpiresAt || null,
                organization: selectedOrg || undefined,
            });
            const data = res.data;
            setDeployResults(data);
            setSuccess(`Deployed ${data.succeeded} of ${data.total} AWS sandboxes from "${data.templateName}".`);
            if (data.failed > 0) {
                setError(`${data.failed} deployment(s) failed.`);
            }
            setDeployEmails('');
            fetchUsers();
        } catch (err) {
            setError(err.response?.data?.message || 'Bulk deploy failed.');
        } finally {
            setDeploying(false);
        }
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
            setError(`Could not reset ${email}. ${e.response?.data?.message || ''}`);
        } finally {
            setResettingUser(null);
        }
    };

    const handleDelete = async (email) => {
        if (!window.confirm(`Delete AWS sandbox user ${email}?\n\nThis will delete the IAM user, policies, and login profile from AWS.`)) return;
        setDeleting(email);
        setError(null);
        setSuccess(`Deleting ${email} — removing IAM user and policies from AWS...`);
        try {
            await apiCaller.delete(superadminApiRoutes.awsUserApi, { data: { email } });
            // Mark as deleting locally; polling will pick up the final state
            setUsers(prev => prev.map(u => u.email === email ? { ...u, deletionStatus: 'deleting' } : u));
            setSuccess(null);
        } catch {
            setError(`Failed to delete ${email}. The IAM user may still exist — check the AWS console.`);
            setSuccess(null);
        } finally {
            setDeleting(null);
        }
    };

    const emailCount = getEmailList().length;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <FaAws className="text-orange-500" /> AWS Sandbox Users
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">Manage AWS sandbox users and IAM credentials</p>
                </div>
            </div>

            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
            {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

            {/* Deploy from Template */}
            {templates.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                        <FaRocket className="text-orange-500 w-3.5 h-3.5" /> Deploy from Template
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Org picker — superadmin only; admin role is server-pinned to their own org */}
                        {isSuper && (
                            <div>
                                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                    Deploy to Organization
                                </label>
                                <select
                                    value={selectedOrg}
                                    onChange={(e) => setSelectedOrg(e.target.value)}
                                    className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                                >
                                    <option value="">Select an organization...</option>
                                    {orgs.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                                <p className="text-[10px] text-gray-400 mt-0.5">Required. Sandboxes will be visible to this org's admin.</p>
                            </div>
                        )}

                        {/* Template dropdown */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                AWS Template
                            </label>
                            <select
                                value={selectedTemplateSlug}
                                onChange={(e) => handleTemplateChange(e.target.value)}
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

                        {/* TTL selector */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Session TTL
                            </label>
                            <select
                                value={ttlHours}
                                onChange={(e) => setTtlHours(Number(e.target.value))}
                                className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                            >
                                {TTL_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Batch end date — hard cutoff, IAM + DB record permanently deleted after */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Batch ends on
                            </label>
                            <input
                                type="datetime-local"
                                value={batchExpiresAt}
                                onChange={(e) => setBatchExpiresAt(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">Optional. After this date, the user is permanently deleted.</p>
                        </div>

                        {/* Daily cap */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Daily Cap (hrs)
                            </label>
                            <input type="number" min={1} max={24} value={dailyCapHours} onChange={e => setDailyCapHours(+e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                                placeholder="12" />
                            <p className="text-[10px] text-gray-400 mt-0.5">Max hours/day per student</p>
                        </div>

                        {/* Total cap */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Total Cap (hrs)
                            </label>
                            <input type="number" min={0} value={totalCapHours} onChange={e => setTotalCapHours(+e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                                placeholder="0 = unlimited" />
                            <p className="text-[10px] text-gray-400 mt-0.5">0 = unlimited. e.g. 180 for 15d x 12h</p>
                        </div>
                    </div>

                    {/* Template info card */}
                    {selectedTemplate && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="text-sm font-semibold text-gray-800">{selectedTemplate.name}</div>
                                    {selectedTemplate.description && (
                                        <p className="text-xs text-gray-500 mt-1">{selectedTemplate.description}</p>
                                    )}
                                </div>
                                {selectedTemplate.certificationLevel && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-700 uppercase">
                                        {selectedTemplate.certificationLevel}
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                                {selectedTemplate.allowedServices?.length > 0 && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-600 mb-1">Allowed Services</p>
                                        <div className="flex flex-wrap gap-1">
                                            {selectedTemplate.allowedServices.map((s, i) => (
                                                <span key={i} className="inline-block px-2 py-0.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded">
                                                    {s.service}{s.restrictions ? ` (${s.restrictions})` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {selectedTemplate.blockedServices?.length > 0 && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-600 mb-1">Blocked Services</p>
                                        <div className="flex flex-wrap gap-1">
                                            {selectedTemplate.blockedServices.map((s, i) => (
                                                <span key={i} className="inline-block px-2 py-0.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded">
                                                    {s.service}{s.reason ? ` - ${s.reason}` : ''}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex gap-4 text-xs text-gray-500">
                                <span>Default TTL: {selectedTemplate.sandboxConfig?.ttlHours || 4}h</span>
                                <span>Region: {selectedTemplate.sandboxConfig?.region || 'ap-south-1'}</span>
                            </div>
                        </div>
                    )}

                    {/* Email input */}
                    <div>
                        <BulkEmailInput
                            label="Student Emails"
                            value={deployEmails}
                            onChange={setDeployEmails}
                            rows={4}
                            placeholder={"student1@example.com\nstudent2@example.com"}
                        />
                    </div>

                    {/* Deploy button */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleTemplateDeploy}
                            disabled={deploying || !selectedTemplateSlug || emailCount === 0}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {deploying ? <FaSpinner className="animate-spin" /> : <FaRocket className="w-3 h-3" />}
                            {deploying ? 'Deploying...' : `Deploy ${emailCount} Sandbox${emailCount !== 1 ? 'es' : ''}`}
                        </button>
                        {deploying && (
                            <span className="text-xs text-gray-500">This may take a few minutes. Do not close this page.</span>
                        )}
                    </div>

                    {/* Deploy results */}
                    {deployResults && deployResults.results && deployResults.results.length > 0 && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-600">
                                    Deploy Results: {deployResults.succeeded} succeeded, {deployResults.failed} failed
                                </span>
                                <button onClick={() => {
                                    const rows = [['Email','Login URL','Username','Password','Region','Expires At'].join(',')];
                                    deployResults.results.forEach(r => {
                                        rows.push([r.email, r.accessUrl || '', r.username, r.password, r.region || 'ap-south-1', r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-IN') : ''].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
                                    });
                                    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                                    a.download = `aws-credentials-${new Date().toISOString().slice(0,10)}.csv`; a.click();
                                }} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors">
                                    <FaDownload className="w-2.5 h-2.5" /> Download CSV
                                </button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-[13px]">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-200">
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Login URL</th>
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Password</th>
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Region</th>
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Expires</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {deployResults.results.map((r, i) => (
                                            <tr key={i} className="hover:bg-gray-50/50">
                                                <td className="px-4 py-2.5 text-gray-700">{r.email}</td>
                                                <td className="px-4 py-2.5">
                                                    {r.accessUrl ? <a href={r.accessUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">{r.accessUrl}</a> : '-'}
                                                </td>
                                                <td className="px-4 py-2.5 font-mono text-gray-800">{r.username}</td>
                                                <td className="px-4 py-2.5 font-mono text-gray-800">{r.password}</td>
                                                <td className="px-4 py-2.5 text-gray-600">{r.region || 'ap-south-1'}</td>
                                                <td className="px-4 py-2.5 text-gray-500">
                                                    {r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Users table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">Users ({users.length})</h3>
                    <div className="flex items-center gap-3 flex-wrap">
                        {isSuper && (
                            <select
                                value={filterOrg}
                                onChange={e => setFilterOrg(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
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
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200">
                            Amazon Web Services
                        </span>
                    </div>
                </div>
                {loading ? (
                    <div className="px-5 py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
                ) : isSuper && !filterOrg ? (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">Select an organization above to view its sandbox users.</div>
                ) : users.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">No AWS sandbox users in this organization.</div>
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
                                    {['Email', 'Username', 'Region', 'Session TTL', 'Status', 'Batch Expires', ''].map(h => (
                                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.map(u => {
                                    const expired = (u.expiresAt || u.endDate) && new Date(u.expiresAt || u.endDate) < new Date();
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
                                            </td>
                                            <td className="px-4 py-2.5 font-mono text-gray-700">{u.username || u.userId || '-'}</td>
                                            <td className="px-4 py-2.5 text-gray-600">{u.region || '-'}</td>
                                            <td className="px-4 py-2.5 text-gray-600">{u.sandboxTtlHours ? `${u.sandboxTtlHours}h` : '-'}</td>
                                            <td className="px-4 py-2.5">
                                                {isDeleting ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-50 text-yellow-700">
                                                        <FaSpinner className="w-2.5 h-2.5 animate-spin" /> Deleting...
                                                    </span>
                                                ) : deleteFailed ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600">
                                                        <FaExclamationTriangle className="w-2.5 h-2.5" /> Delete failed
                                                    </span>
                                                ) : (
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                                        expired
                                                            ? 'bg-red-50 text-red-600'
                                                            : u.status === 'active'
                                                                ? 'bg-green-50 text-green-700'
                                                                : 'bg-gray-100 text-gray-500'
                                                    }`}>
                                                        {expired ? 'Expired' : (u.status || 'active')}
                                                    </span>
                                                )}
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
                                                    <button
                                                        onClick={() => handleResetPassword(u.email)}
                                                        disabled={resettingUser === u.email}
                                                        title="Reset password to Welcome1234!"
                                                        className="p-1.5 mr-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-50 transition-colors"
                                                    >
                                                        {resettingUser === u.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaKey className="w-3 h-3" />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(u.email)}
                                                        disabled={deleting === u.email}
                                                        title={deleteFailed ? 'Retry delete' : 'Delete user'}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors"
                                                    >
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
};

export default AwsSandbox;
