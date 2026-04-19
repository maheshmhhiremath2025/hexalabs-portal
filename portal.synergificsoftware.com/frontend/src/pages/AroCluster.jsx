import React, { useEffect, useState, useMemo } from 'react';
import apiCaller from '../services/apiCaller';
import BulkEmailInput from '../components/BulkEmailInput';
import {
  FaCloud, FaSpinner, FaPlus, FaMinus, FaTrash, FaDownload,
  FaExternalLinkAlt, FaChevronDown, FaChevronUp, FaUsers,
} from 'react-icons/fa';

const REGIONS = ['southindia', 'eastus', 'westeurope'];
const VERSIONS = ['4.14', '4.15', '4.16'];
const VM_SIZES = [
  { value: 'Standard_D4s_v3', label: 'Standard_D4s_v3 (4 vCPU / 16 GB) -- Standard', rate: 15 },
  { value: 'Standard_D8s_v3', label: 'Standard_D8s_v3 (8 vCPU / 32 GB) -- Large', rate: 30 },
  { value: 'Standard_D16s_v3', label: 'Standard_D16s_v3 (16 vCPU / 64 GB) -- Extra Large', rate: 60 },
];
const TTL_OPTIONS = [
  { label: '4 hours', value: 4 },
  { label: '8 hours', value: 8 },
  { label: '12 hours', value: 12 },
  { label: '24 hours', value: 24 },
  { label: '48 hours', value: 48 },
  { label: '72 hours', value: 72 },
  { label: '1 week (168h)', value: 168 },
];
const CONTROL_PLANE_RATE = 50; // INR/hr for ARO control plane (higher than ROSA)

const STATUS_COLORS = {
  Provisioning: 'bg-amber-50 text-amber-700 border-amber-200',
  Ready: 'bg-green-50 text-green-700 border-green-200',
  Deleting: 'bg-red-50 text-red-600 border-red-200',
};

function formatCountdown(expiresAt) {
  if (!expiresAt) return '-';
  const diff = new Date(expiresAt) - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m remaining`;
}

function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount);
}

export default function AroCluster() {
  // --- Create form state ---
  const [clusterName, setClusterName] = useState('');
  const [trainingName, setTrainingName] = useState('');
  const [organization, setOrganization] = useState('');
  const [region, setRegion] = useState('southindia');
  const [version, setVersion] = useState('4.16');
  const [workerNodes, setWorkerNodes] = useState(3);
  const [vmSize, setVmSize] = useState('Standard_D4s_v3');
  const [ttlHours, setTtlHours] = useState(8);
  const [creating, setCreating] = useState(false);

  // --- Cluster list state ---
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // --- Feedback ---
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // --- Student management per-cluster ---
  const [studentEmails, setStudentEmails] = useState('');
  const [addingStudents, setAddingStudents] = useState(false);
  const [scalingId, setScalingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [removingStudent, setRemovingStudent] = useState(null);

  useEffect(() => {
    fetchClusters();
  }, []);

  const fetchClusters = async () => {
    setLoading(true);
    try {
      const res = await apiCaller.get('/aro');
      setClusters(res.data || []);
    } catch {
      setError('Failed to fetch ARO clusters.');
    } finally {
      setLoading(false);
    }
  };

  // --- Cost estimate ---
  const vmRate = VM_SIZES.find(t => t.value === vmSize)?.rate || 15;
  const costPerHour = CONTROL_PLANE_RATE + workerNodes * vmRate;
  const costPerDay = costPerHour * 24;

  // --- Create cluster ---
  const handleCreate = async () => {
    if (!clusterName.trim()) { setError('Cluster name is required.'); return; }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      await apiCaller.post('/aro', {
        name: clusterName.trim(),
        trainingName: trainingName.trim(),
        organization: organization.trim(),
        region,
        version,
        workerNodes,
        workerVmSize: vmSize,
        ttlHours,
      });
      setSuccess(`Cluster "${clusterName}" creation initiated. This typically takes 35-45 minutes.`);
      setClusterName('');
      setTrainingName('');
      setOrganization('');
      setWorkerNodes(3);
      setVmSize('Standard_D4s_v3');
      setTtlHours(8);
      fetchClusters();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create cluster.');
    } finally {
      setCreating(false);
    }
  };

  // --- Add students ---
  const emailList = useMemo(() =>
    studentEmails.split('\n').map(e => e.trim()).filter(Boolean),
    [studentEmails]
  );

  const handleAddStudents = async (clusterId) => {
    if (emailList.length === 0) return;
    setAddingStudents(true);
    setError(null);
    try {
      await apiCaller.post(`/aro/${clusterId}/students`, { emails: emailList });
      setSuccess(`${emailList.length} student(s) added successfully.`);
      setStudentEmails('');
      fetchClusters();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add students.');
    } finally {
      setAddingStudents(false);
    }
  };

  // --- Remove student ---
  const handleRemoveStudent = async (clusterId, email) => {
    if (!window.confirm(`Remove student ${email}?`)) return;
    setRemovingStudent(email);
    try {
      await apiCaller.delete(`/aro/${clusterId}/students/${encodeURIComponent(email)}`);
      setSuccess(`Student ${email} removed.`);
      fetchClusters();
    } catch {
      setError('Failed to remove student.');
    } finally {
      setRemovingStudent(null);
    }
  };

  // --- Scale ---
  const handleScale = async (clusterId, delta) => {
    const cluster = clusters.find(c => c._id === clusterId);
    if (!cluster) return;
    const newCount = (cluster.workerNodes || 3) + delta;
    if (newCount < 2 || newCount > 10) return;
    setScalingId(clusterId);
    try {
      await apiCaller.patch(`/aro/${clusterId}/scale`, { workerNodes: newCount });
      setSuccess(`Scaling to ${newCount} worker nodes...`);
      fetchClusters();
    } catch {
      setError('Failed to scale cluster.');
    } finally {
      setScalingId(null);
    }
  };

  // --- Delete cluster ---
  const handleDelete = async (clusterId, name) => {
    if (!window.confirm(`Delete cluster "${name}"? This cannot be undone.`)) return;
    setDeletingId(clusterId);
    setError(null);
    try {
      await apiCaller.delete(`/aro/${clusterId}`);
      setSuccess(`Cluster "${name}" deletion initiated.`);
      fetchClusters();
    } catch {
      setError('Failed to delete cluster.');
    } finally {
      setDeletingId(null);
    }
  };

  // --- Download CSV ---
  const handleDownloadCSV = (cluster) => {
    const students = cluster.students || [];
    if (students.length === 0) return;
    const rows = [['Email', 'Namespace', 'Username', 'Password', 'Status'].join(',')];
    students.forEach(s => {
      rows.push(
        [s.email, s.namespace, s.username, s.password, s.status]
          .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
          .join(',')
      );
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aro-${cluster.name}-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400';
  const labelClass = 'text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FaCloud className="text-blue-600" /> ARO Cluster Management
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Provision and manage Azure Red Hat OpenShift clusters for training
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {success}
          <button onClick={() => setSuccess(null)} className="ml-2 text-green-400 hover:text-green-600">&times;</button>
        </div>
      )}

      {/* Panel 1: Create Cluster */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h3 className="text-sm font-semibold text-gray-800">Create Cluster</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Cluster Name</label>
            <input
              type="text"
              value={clusterName}
              onChange={e => setClusterName(e.target.value)}
              className={inputClass}
              placeholder="my-training-cluster"
            />
          </div>
          <div>
            <label className={labelClass}>Training Name</label>
            <input
              type="text"
              value={trainingName}
              onChange={e => setTrainingName(e.target.value)}
              className={inputClass}
              placeholder="OpenShift Admin - Batch 12"
            />
          </div>
          <div>
            <label className={labelClass}>Organization</label>
            <input
              type="text"
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              className={inputClass}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className={labelClass}>Region</label>
            <select value={region} onChange={e => setRegion(e.target.value)} className={inputClass + ' appearance-none'}>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>OpenShift Version</label>
            <select value={version} onChange={e => setVersion(e.target.value)} className={inputClass + ' appearance-none'}>
              {VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Worker Nodes</label>
            <input
              type="number"
              min={2}
              max={10}
              value={workerNodes}
              onChange={e => setWorkerNodes(Math.min(10, Math.max(2, Number(e.target.value) || 2)))}
              className={inputClass}
            />
            <p className="text-[10px] text-gray-400 mt-0.5">Min 2, Max 10</p>
          </div>
          <div>
            <label className={labelClass}>Worker VM Size</label>
            <select value={vmSize} onChange={e => setVmSize(e.target.value)} className={inputClass + ' appearance-none'}>
              {VM_SIZES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>TTL (Time to Live)</label>
            <select value={ttlHours} onChange={e => setTtlHours(Number(e.target.value))} className={inputClass + ' appearance-none'}>
              {TTL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Pricing intentionally hidden from this form — pricing is a sales
            conversation, not a UI element. Internal cluster cost still tracked
            in the Existing Clusters panel below. */}

        <div className="flex items-center gap-3">
          <button
            onClick={handleCreate}
            disabled={creating || !clusterName.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {creating ? <FaSpinner className="animate-spin" /> : <FaCloud className="w-3.5 h-3.5" />}
            {creating ? 'Creating...' : 'Create Cluster'}
          </button>
          {creating && (
            <span className="text-xs text-gray-500">Provisioning takes 35-45 minutes. You can close this page.</span>
          )}
        </div>
      </div>

      {/* Panel 2: Existing Clusters */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">
            Existing Clusters ({clusters.length})
          </h3>
          <button
            onClick={fetchClusters}
            disabled={loading}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading && clusters.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <FaSpinner className="animate-spin inline text-gray-400 text-lg" />
          </div>
        ) : clusters.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
            No ARO clusters yet. Create one above.
          </div>
        ) : (
          clusters.map(cluster => {
            const expanded = expandedId === cluster._id;
            const students = cluster.students || [];
            const cRate = VM_SIZES.find(t => t.value === cluster.workerVmSize)?.rate || 15;
            const clusterCostHr = CONTROL_PLANE_RATE + (cluster.workerNodes || 3) * cRate;
            const statusStyle = STATUS_COLORS[cluster.status] || 'bg-gray-100 text-gray-600 border-gray-200';

            return (
              <div key={cluster._id} className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                {/* Cluster card header */}
                <button
                  onClick={() => setExpandedId(expanded ? null : cluster._id)}
                  className="w-full text-left px-5 py-4 flex items-center gap-4 hover:bg-gray-50/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{cluster.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusStyle}`}>
                        {cluster.status || 'Unknown'}
                      </span>
                      {cluster.status === 'provisioning' && (
                        <FaSpinner className="animate-spin text-amber-500 w-3 h-3" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500 flex-wrap">
                      <span>{cluster.region}</span>
                      <span>{cluster.workerNodes || 3} nodes</span>
                      <span>v{cluster.version || '4.16'}</span>
                      <span>INR {formatINR(clusterCostHr)}/hr</span>
                      {cluster.totalCostInr != null && cluster.totalCostInr > 0 && (
                        <span className="text-amber-600 font-medium">Running total: INR {formatINR(cluster.totalCostInr)}</span>
                      )}
                      <span>{formatCountdown(cluster.expiresAt)}</span>
                      {students.length > 0 && (
                        <span className="flex items-center gap-1"><FaUsers className="w-3 h-3" /> {students.length} students</span>
                      )}
                    </div>
                  </div>
                  {cluster.consoleUrl && cluster.status === 'ready' && (
                    <a
                      href={cluster.consoleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      <FaExternalLinkAlt className="w-2.5 h-2.5" /> Console
                    </a>
                  )}
                  {expanded ? <FaChevronUp className="text-gray-400 w-3 h-3" /> : <FaChevronDown className="text-gray-400 w-3 h-3" />}
                </button>

                {/* Expanded detail panel */}
                {expanded && (
                  <div className="border-t border-gray-200 px-5 py-5 space-y-5">
                    {/* Add Students */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Add Students</h4>
                      <BulkEmailInput
                        label="Student Emails"
                        value={studentEmails}
                        onChange={setStudentEmails}
                        rows={3}
                        placeholder={"student1@example.com\nstudent2@example.com"}
                      />
                      <button
                        onClick={() => handleAddStudents(cluster._id)}
                        disabled={addingStudents || emailList.length === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {addingStudents ? <FaSpinner className="animate-spin" /> : <FaUsers className="w-3 h-3" />}
                        {addingStudents ? 'Adding...' : `Add ${emailList.length} Student${emailList.length !== 1 ? 's' : ''}`}
                      </button>
                    </div>

                    {/* Student list */}
                    {students.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                            Students ({students.length})
                          </h4>
                          <button
                            onClick={() => handleDownloadCSV(cluster)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                          >
                            <FaDownload className="w-2.5 h-2.5" /> Download CSV
                          </button>
                        </div>
                        <div className="border border-gray-200 rounded-lg overflow-x-auto">
                          <table className="min-w-full text-[13px]">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Namespace</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Username</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Password</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {students.map((s, i) => (
                                <tr key={i} className="hover:bg-gray-50/50">
                                  <td className="px-4 py-2.5 text-gray-700">{s.email}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-600">{s.namespace || '-'}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-800">{s.username || '-'}</td>
                                  <td className="px-4 py-2.5 font-mono text-gray-800">{s.password || '-'}</td>
                                  <td className="px-4 py-2.5">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      s.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                      {s.status || 'pending'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <button
                                      onClick={() => handleRemoveStudent(cluster._id, s.email)}
                                      disabled={removingStudent === s.email}
                                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md disabled:opacity-50 transition-colors"
                                    >
                                      {removingStudent === s.email ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaTrash className="w-3 h-3" />}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Scale controls + Delete */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Scale Workers</span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleScale(cluster._id, -1)}
                            disabled={scalingId === cluster._id || (cluster.workerNodes || 3) <= 2}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors border border-gray-200"
                          >
                            <FaMinus className="w-2.5 h-2.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-semibold text-gray-800">
                            {scalingId === cluster._id ? <FaSpinner className="inline animate-spin w-3 h-3" /> : (cluster.workerNodes || 3)}
                          </span>
                          <button
                            onClick={() => handleScale(cluster._id, 1)}
                            disabled={scalingId === cluster._id || (cluster.workerNodes || 3) >= 10}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 transition-colors border border-gray-200"
                          >
                            <FaPlus className="w-2.5 h-2.5" />
                          </button>
                        </div>
                        <span className="text-xs text-gray-400">nodes (2-10)</span>
                      </div>

                      <button
                        onClick={() => handleDelete(cluster._id, cluster.name)}
                        disabled={deletingId === cluster._id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        {deletingId === cluster._id ? <FaSpinner className="animate-spin w-3 h-3" /> : <FaTrash className="w-3 h-3" />}
                        Delete Cluster
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
