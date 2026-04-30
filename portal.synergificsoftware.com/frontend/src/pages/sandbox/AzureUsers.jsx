import React, { useEffect, useState, useRef, useCallback } from 'react';
import apiCaller from '../../services/apiCaller';
import { FaMicrosoft, FaTrash, FaSpinner, FaRocket, FaDownload, FaUsers, FaUserPlus, FaExclamationTriangle } from 'react-icons/fa';
import { CreateUserModal, BulkUserCreateModal } from '../../components/modal/SandboxAZ';
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

const REGION_OPTIONS = [
    { label: 'South India', value: 'southindia' },
    { label: 'East US', value: 'eastus' },
    { label: 'West US', value: 'westus' },
];

const AzureUsers = ({ apiRoutes, superadminApiRoutes }) => {
    const [users, setUsers] = useState([]);
    const [bulkUsers, setBulkUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [showBulkForm, setShowBulkForm] = useState(false);
    const [deleting, setDeleting] = useState(null);
    const [deletingUser, setDeletingUser] = useState(null);
    const [duration, setDuration] = useState('');
    const [progress, setProgress] = useState(0);

    // Template deploy state
    const [templates, setTemplates] = useState([]);
    const [selectedTemplateSlug, setSelectedTemplateSlug] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [ttlHours, setTtlHours] = useState(4);
    const [dailyCapHours, setDailyCapHours] = useState(12);
    const [totalCapHours, setTotalCapHours] = useState(0);
    const [deployRegion, setDeployRegion] = useState('southindia');
    const [deployEmails, setDeployEmails] = useState('');
    const [deploying, setDeploying] = useState(false);
    const [deployResults, setDeployResults] = useState(null);
    const [filterTemplate, setFilterTemplate] = useState('all');

    const pollRef = useRef(null);

    const fetchUsers = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await apiCaller.get(superadminApiRoutes.sandboxUserApi);
            setUsers(res.data);
        } catch {
            if (!silent) setError('Error fetching Azure sandbox users.');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [superadminApiRoutes]);

    useEffect(() => {
        fetchUsers();
        fetchTemplates();
    }, []);

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
            const res = await apiCaller.get('/sandbox-templates');
            const azureTemplates = (res.data || []).filter(t => t.cloud === 'azure');
            setTemplates(azureTemplates);
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
            if (res.data?.sandboxConfig?.ttlHours) {
                setTtlHours(res.data.sandboxConfig.ttlHours);
            }
            if (res.data?.sandboxConfig?.region) {
                setDeployRegion(res.data.sandboxConfig.region);
            }
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

        setDeploying(true);
        setError(null);
        setSuccess(null);
        setDeployResults(null);

        try {
            const res = await apiCaller.post('/sandbox/bulk-deploy-azure', {
                templateSlug: selectedTemplateSlug,
                emails,
                ttlHours,
                region: deployRegion,
                dailyCapHours,
                totalCapHours,
            });
            const data = res.data;
            setDeployResults(data);
            setSuccess(`Deployed ${data.deployed ?? 0} of ${data.total} Azure sandboxes from "${data.templateName || selectedTemplateSlug}".`);
            if (data.failed > 0) {
                setError(`${data.failed} deployment(s) failed.`);
            }
            setDeployEmails('');
            fetchUsers();
        } catch (err) {
            setError(err.response?.data?.error || err.response?.data?.message || 'Bulk deploy failed.');
        } finally {
            setDeploying(false);
        }
    };

    const handleDeleteSandbox = async (userId, resourceGroupName) => {
        setDeleting(resourceGroupName);
        setError(null);
        setSuccess(null);
        try {
            await apiCaller.delete(apiRoutes.sandboxApi, { data: { resourceGroupName } });
            setSuccess(`Sandbox ${resourceGroupName} deleted successfully!`);
            setUsers(prev =>
                prev.map(user =>
                    user.userId === userId
                        ? { ...user, sandbox: user.sandbox.filter(s => s.resourceGroupName !== resourceGroupName) }
                        : user
                )
            );
        } catch {
            setError('Error deleting sandbox.');
        } finally {
            setDeleting(null);
        }
    };

    const handleDeleteUser = async (email) => {
        if (!window.confirm(`Delete Azure sandbox user ${email}?\n\nThis will delete the Azure AD user, resource group, and all resources inside it. This may take 30-60 seconds.`)) return;
        setDeletingUser(email);
        setError(null);
        setSuccess(`Deleting ${email} — removing Azure AD user and resource group...`);
        try {
            await apiCaller.delete(superadminApiRoutes.sandboxUserApi, { data: { email } });
            // Mark as deleting locally; polling will pick up the final state
            setUsers(prev => prev.map(u => u.email === email ? { ...u, deletionStatus: 'deleting' } : u));
            setSuccess(null);
        } catch {
            setError(`Failed to delete ${email}. The user may still exist in Azure AD — check the Azure portal.`);
            setSuccess(null);
        } finally {
            setDeletingUser(null);
        }
    };

    const handleCreateUser = async ({ username, personalEmail, duration }) => {
        if (!username || !duration || !personalEmail) {
            setError('Please fill in all fields.');
            return;
        }
        setLoading(true);
        setError(null);
        setSuccess(null);
        try {
            await apiCaller.post(superadminApiRoutes.sandboxUserApi, { username, duration, personalEmail });
            setSuccess('User created successfully!');
            fetchUsers();
            setDuration('');
            setShowForm(false);
        } catch {
            setError('Error creating user.');
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            parseCSV(text);
        };
        reader.readAsText(file);
    };

    const parseCSV = (text) => {
        const rows = text.split('\n').map(row => row.trim()).filter(row => row);
        if (rows.length <= 1) {
            setError('CSV file must have at least one user entry.');
            return;
        }
        const parsedUsers = rows.slice(1).map(row => {
            const columns = row.split(',').map(col => col.trim());
            return { username: columns[0], personalEmail: columns[1] };
        }).filter(user => user.username && user.personalEmail);
        if (parsedUsers.length === 0) {
            setError('Invalid CSV format. Ensure the first column is username and the second is personalEmail.');
        } else {
            setError(null);
            setBulkUsers(parsedUsers);
        }
    };

    const handleCreateUsers = async () => {
        setLoading(true);
        setProgress(0);
        setError(null);
        for (let i = 0; i < bulkUsers.length; i++) {
            try {
                await apiCaller.post(superadminApiRoutes.sandboxUserApi, {
                    username: bulkUsers[i].username,
                    personalEmail: bulkUsers[i].personalEmail,
                    duration,
                });
                setProgress(((i + 1) / bulkUsers.length) * 100);
            } catch {
                setError('Error creating user');
            }
        }
        setLoading(false);
        resetFields();
        setShowBulkForm(false);
        fetchUsers();
    };

    const resetFields = () => {
        document.querySelector('input[type="file"]').value = '';
        setUsers([]);
        setDuration('');
        setError(null);
        setProgress(0);
    };

    const emailCount = getEmailList().length;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <FaMicrosoft className="text-blue-500" /> Azure Sandbox Users
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">Manage Azure sandbox users and resource groups</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="p-2 bg-gray-900 text-white rounded-full hover:bg-gray-700"
                        onClick={() => setShowForm(true)}
                        title="Add New User"
                    >
                        <FaUserPlus />
                    </button>
                    <button
                        className="p-2 bg-gray-900 text-white rounded-full hover:bg-gray-700"
                        onClick={() => setShowBulkForm(true)}
                        title="Bulk Add Users"
                    >
                        <FaUsers />
                    </button>
                </div>
            </div>

            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
            {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

            {/* Deploy from Template */}
            {templates.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                        <FaRocket className="text-blue-500 w-3.5 h-3.5" /> Deploy from Template
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Template dropdown */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Azure Template
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

                        {/* Region selector */}
                        <div>
                            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                                Region
                            </label>
                            <select
                                value={deployRegion}
                                onChange={(e) => setDeployRegion(e.target.value)}
                                className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                            >
                                {REGION_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
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
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 uppercase">
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
                                <span>Region: {selectedTemplate.sandboxConfig?.region || 'southindia'}</span>
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
                                    Deploy Results: {deployResults.deployed ?? 0} succeeded, {deployResults.failed} failed
                                </span>
                                <button onClick={() => {
                                    const rows = [['Email','Login URL','Username','Password','Resource Group','Expires At'].join(',')];
                                    deployResults.results.forEach(r => {
                                        rows.push([r.email, r.accessUrl || '', r.username, r.password, r.resourceGroupName || '', r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-IN') : ''].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
                                    });
                                    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                                    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                                    a.download = `azure-credentials-${new Date().toISOString().slice(0,10)}.csv`; a.click();
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
                                            <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Resource Group</th>
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
                                                <td className="px-4 py-2.5 text-gray-600">{r.resourceGroupName || '-'}</td>
                                                <td className="px-4 py-2.5 text-gray-500">
                                                    {r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {deployResults.errors?.length > 0 && (
                                <div className="px-4 py-3 bg-red-50 border-t border-red-200">
                                    <p className="text-xs font-medium text-red-600 mb-1">Errors:</p>
                                    {deployResults.errors.map((e, i) => (
                                        <p key={i} className="text-xs text-red-500">{e.email}: {e.error}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Users table */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">Users ({users.length})</h3>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                        Microsoft Azure
                    </span>
                </div>

                {/* Template filter tabs */}
                {users.length > 0 && (
                    <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-1 overflow-x-auto">
                        {[
                            { key: 'all', label: 'All' },
                            { key: 'azure-sandbox', label: 'Sandbox' },
                            { key: 'azure-databricks', label: 'Databricks' },
                            { key: 'azure-openai', label: 'OpenAI' },
                            { key: 'self-service', label: 'Self-Service' },
                        ].map(tab => {
                            const count = tab.key === 'all' ? users.length
                                : tab.key === 'self-service'
                                    ? users.filter(u => !u.usageSessions?.length || u.usageSessions.every(s => !s.templateSlug)).length
                                    : users.filter(u => u.usageSessions?.some(s => s.templateSlug === tab.key)).length;
                            return (
                                <button
                                    key={tab.key}
                                    onClick={() => setFilterTemplate(tab.key)}
                                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                                        filterTemplate === tab.key
                                            ? 'bg-blue-600 text-white'
                                            : 'text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {tab.label} ({count})
                                </button>
                            );
                        })}
                    </div>
                )}

                {loading ? (
                    <div className="px-5 py-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
                ) : users.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-gray-400">No Azure sandbox users yet</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-[13px]">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                    {['Email', 'User ID', 'Template', 'Credits', 'Start', 'End', ''].map(h => (
                                        <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {users.filter(u => {
                                    if (filterTemplate === 'all') return true;
                                    if (filterTemplate === 'self-service') return !u.usageSessions?.length || u.usageSessions.every(s => !s.templateSlug);
                                    return u.usageSessions?.some(s => s.templateSlug === filterTemplate);
                                }).map(u => {
                                    const expired = u.endDate && new Date(u.endDate) < new Date();
                                    const isDeleting = u.deletionStatus === 'deleting';
                                    const deleteFailed = u.deletionStatus === 'failed';
                                    return (
                                        <tr key={u._id} className={`hover:bg-gray-50/50 ${isDeleting ? 'opacity-50' : ''}`}>
                                            <td className="px-4 py-2.5">
                                                <div className="font-medium text-gray-800">{u.email}</div>
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
                                            <td className="px-4 py-2.5 font-mono text-gray-700">{u.userId || '-'}</td>
                                            <td className="px-4 py-2.5 text-gray-600">
                                                {u.usageSessions?.length > 0 && u.usageSessions[u.usageSessions.length - 1].templateSlug
                                                    ? <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-700 rounded">
                                                        {({ 'azure-sandbox': 'Sandbox', 'azure-databricks': 'Databricks', 'azure-openai': 'OpenAI' })[u.usageSessions[u.usageSessions.length - 1].templateSlug] || u.usageSessions[u.usageSessions.length - 1].templateSlug}
                                                      </span>
                                                    : u.duration ? `${u.duration} days` : <span className="text-gray-400 text-[10px]">Self-Service</span>}
                                            </td>
                                            <td className="px-4 py-2.5 text-gray-600">{u.credits ? `${u.credits.consumed} / ${u.credits.total}` : '-'}</td>
                                            <td className="px-4 py-2.5 text-gray-500">
                                                {u.startDate ? new Date(u.startDate).toLocaleString('en-IN') : '-'}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <span className={expired ? 'text-red-500' : 'text-gray-500'}>
                                                    {u.endDate ? new Date(u.endDate).toLocaleString('en-IN') : '-'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right">
                                                {isDeleting ? (
                                                    <FaSpinner className="w-3 h-3 animate-spin text-gray-400 inline" />
                                                ) : (
                                                    <button
                                                        onClick={() => handleDeleteUser(u.email)}
                                                        disabled={deletingUser === u.email}
                                                        title={deleteFailed ? 'Retry delete' : 'Delete user'}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors"
                                                    >
                                                        {deletingUser === u.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaTrash className="w-3 h-3" />}
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

            {showForm && (
                <CreateUserModal
                    onClose={() => setShowForm(false)}
                    onCreateUser={handleCreateUser}
                    loading={loading}
                />
            )}
            {showBulkForm && (
                <BulkUserCreateModal
                    onClose={() => setShowBulkForm(false)}
                    handleFileUpload={handleFileUpload}
                    error={error}
                    users={bulkUsers}
                    duration={duration}
                    progress={progress}
                    setProgress={setProgress}
                    setDuration={setDuration}
                    onConfirmCreateUsers={handleCreateUsers}
                    onReset={resetFields}
                />
            )}
        </div>
    );
};

export default AzureUsers;
