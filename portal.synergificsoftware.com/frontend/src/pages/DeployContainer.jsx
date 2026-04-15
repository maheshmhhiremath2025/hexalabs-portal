import React, { useState, useEffect } from 'react';
import apiCaller from '../services/apiCaller';
import { containerApiRoutes } from '../services/apiRoutes';
import BulkEmailInput from '../components/BulkEmailInput';
import { FaDocker, FaArrowDown, FaCloud, FaServer, FaPlay, FaPowerOff, FaTrash, FaExternalLinkAlt, FaCopy, FaCheck } from 'react-icons/fa';

function formatINR(n) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n); }

const RESOURCE_PRESETS = [
  { label: '1 CPU / 1 GB', cpus: 1, memory: 1024 },
  { label: '1 CPU / 2 GB', cpus: 1, memory: 2048 },
  { label: '2 CPU / 4 GB', cpus: 2, memory: 4096 },
  { label: '2 CPU / 8 GB', cpus: 2, memory: 8192 },
  { label: '4 CPU / 8 GB', cpus: 4, memory: 8192 },
  { label: '4 CPU / 16 GB', cpus: 4, memory: 16384 },
];

function CostSavingsBanner({ comparison }) {
  if (!comparison) return null;
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div>
          <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Azure VM Cost</div>
          <div className="text-lg font-bold text-red-600 line-through">{formatINR(comparison.azureRate)}/hr</div>
        </div>
        <FaArrowDown className="text-green-500 text-lg rotate-[-90deg]" />
        <div>
          <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider">Workspace Cost</div>
          <div className="text-lg font-bold text-green-600">{formatINR(comparison.containerRate)}/hr</div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-bold text-green-600">{comparison.savingsPercent}%</div>
        <div className="text-xs text-gray-500">savings &middot; {formatINR(comparison.monthlySavingsPerVm)}/mo per instance</div>
      </div>
    </div>
  );
}

export default function DeployContainer({ userDetails }) {
  const [images, setImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState('ubuntu-xfce');
  const [preset, setPreset] = useState(RESOURCE_PRESETS[2]); // 2 CPU / 4 GB default
  const [trainingName, setTrainingName] = useState('');
  const [organization, setOrganization] = useState(userDetails?.organization || '');
  const [count, setCount] = useState(1);
  const [emails, setEmails] = useState('');
  const [hours, setHours] = useState(100);
  const [comparison, setComparison] = useState(null);
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(null);
  // Default expiry: 4 days from now, rounded to the next hour
  const [labExpiryDate, setLabExpiryDate] = useState(() => {
    const d = new Date(Date.now() + 96 * 3600000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm for datetime-local
  });
  const [result, setResult] = useState(null);
  const [containers, setContainers] = useState([]);
  const [showList, setShowList] = useState(false);
  const [listTraining, setListTraining] = useState('');

  useEffect(() => {
    apiCaller.get(containerApiRoutes.containerImages).then(r => setImages(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    apiCaller.get(containerApiRoutes.costCompare, { params: { cpus: preset.cpus, memory: preset.memory } })
      .then(r => setComparison(r.data)).catch(() => {});
  }, [preset]);

  const handleDeploy = async () => {
    if (!trainingName || !organization) return;

    // Guard: expiry must be at least 5 min in the future (containers are fast,
    // but give ops a buffer so the lab doesn't auto-delete instantly).
    if (labExpiryDate) {
      const expiryMs = new Date(labExpiryDate).getTime();
      if (expiryMs < Date.now() + 5 * 60 * 1000) {
        alert('Lab expiry must be at least 5 minutes from now.');
        return;
      }
    }

    setDeploying(true);
    setResult(null);
    setDeployProgress(null);
    try {
      const emailList = emails.split('\n').map(e => e.trim()).filter(Boolean);
      const expiresAt = labExpiryDate ? new Date(labExpiryDate).toISOString() : null;
      const res = await apiCaller.post(containerApiRoutes.createContainer, {
        trainingName, organization, imageKey: selectedImage,
        count, emails: emailList, cpus: preset.cpus, memory: preset.memory, allocatedHours: hours,
        expiresAt,
      });

      const jobId = res.data.jobId;
      if (!jobId) { setResult(res.data); setDeploying(false); return; }

      // Poll for progress
      const poll = setInterval(async () => {
        try {
          const status = await apiCaller.get(`/containers/deploy-status/${jobId}`);
          setDeployProgress(status.data);

          if (status.data.status === 'done') {
            clearInterval(poll);
            setResult({
              message: `${status.data.completed}/${status.data.total} workspaces created in ${status.data.duration}s`,
              results: status.data.results,
              costComparison: status.data.costComparison,
            });
            setDeploying(false);
            setDeployProgress(null);
          }
        } catch { clearInterval(poll); setDeploying(false); }
      }, 1500);
    } catch (err) {
      setResult({ error: err.response?.data?.message || 'Deployment failed' });
      setDeploying(false);
    }
  };

  const fetchContainers = async () => {
    if (!listTraining) return;
    try {
      const res = await apiCaller.get(containerApiRoutes.containers, { params: { trainingName: listTraining } });
      setContainers(res.data);
      setShowList(true);
    } catch { setContainers([]); }
  };

  const handleContainerAction = async (action, ids) => {
    try {
      if (action === 'start') await apiCaller.patch(containerApiRoutes.startContainers, { containerIds: ids });
      if (action === 'stop') await apiCaller.patch(containerApiRoutes.stopContainers, { containerIds: ids });
      if (action === 'delete') await apiCaller.delete(containerApiRoutes.deleteContainers, { data: { containerIds: ids } });
      fetchContainers();
    } catch {}
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FaDocker className="text-blue-500" /> Deploy Workspaces
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Launch Ubuntu desktop workspaces with pre-installed tools
          </p>
        </div>
      </div>

      {/* CostSavingsBanner removed — pricing hidden from client-facing pages */}

      {/* Deploy form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-semibold text-gray-800">New Workspace Deployment</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Training Name</label>
            <input value={trainingName} onChange={e => setTrainingName(e.target.value)} placeholder="e.g. docker-lab-1"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Organization</label>
            <input value={organization} onChange={e => setOrganization(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Image</label>
            <select value={selectedImage} onChange={e => setSelectedImage(e.target.value)}
              className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white">
              {['desktop', 'security', 'dev', 'bigdata', 'app'].map(cat => {
                const catImages = images.filter(i => i.category === cat);
                if (!catImages.length) return null;
                const catLabel = { desktop: 'Desktop Environments', security: 'Cybersecurity', dev: 'Development', bigdata: 'Professional Labs — DevOps, Data, AI/ML, Cloud', app: 'Applications' }[cat];
                return (
                  <optgroup key={cat} label={catLabel}>
                    {catImages.map(img => <option key={img.key} value={img.key}>{img.label}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Resources</label>
            <select value={`${preset.cpus}-${preset.memory}`} onChange={e => {
              const [c, m] = e.target.value.split('-').map(Number);
              setPreset(RESOURCE_PRESETS.find(p => p.cpus === c && p.memory === m) || RESOURCE_PRESETS[2]);
            }}
              className="w-full appearance-none px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white">
              {RESOURCE_PRESETS.map(p => <option key={`${p.cpus}-${p.memory}`} value={`${p.cpus}-${p.memory}`}>{p.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Count</label>
              <input type="number" min={1} max={50} value={count} onChange={e => setCount(+e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Hours</label>
              <input type="number" min={1} value={hours} onChange={e => setHours(+e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
          </div>
        </div>

        <BulkEmailInput
          value={emails}
          onChange={setEmails}
          rows={3}
          label="User Emails (one per line, optional)"
          placeholder={'user1@company.com\nuser2@company.com'}
        />

        {/* Lab Expiry — date/time picker */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Lab expiry (auto-cleanup date & time)</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="datetime-local"
              value={labExpiryDate}
              min={new Date().toISOString().slice(0, 16)}
              onChange={e => setLabExpiryDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            {labExpiryDate && (() => {
              const diff = new Date(labExpiryDate) - new Date();
              if (diff <= 0) return <span className="text-xs text-red-600 font-medium">Date is in the past!</span>;
              const hrs = Math.round(diff / 3600000);
              const days = Math.floor(hrs / 24);
              return (
                <span className="text-xs text-blue-600 font-medium">
                  {days > 0 ? `${days}d ${hrs % 24}h` : `${hrs}h`} from now
                </span>
              );
            })()}
            <div className="flex gap-1.5">
              {[
                { label: '1 day', hours: 24 },
                { label: '3 days', hours: 72 },
                { label: '5 days', hours: 120 },
                { label: '7 days', hours: 168 },
              ].map(p => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => {
                    const d = new Date(Date.now() + p.hours * 3600000);
                    d.setMinutes(0, 0, 0);
                    setLabExpiryDate(d.toISOString().slice(0, 16));
                  }}
                  className="px-2 py-1 text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:border-blue-400 hover:text-blue-700 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Workspaces auto-delete at this time. Students get a warning email 1 hour before.
            To extend later: open the lab in Lab Console → click "Extend".
          </p>
        </div>

        {/* Cost comparison line removed — pricing hidden from client-facing pages */}

        <button onClick={handleDeploy} disabled={deploying || !trainingName || !organization}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          <FaDocker /> {deploying ? 'Deploying...' : `Deploy ${count} Workspace${count > 1 ? 's' : ''}`}
        </button>

        {/* Real-time deploy progress */}
        {deployProgress && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-800">
                Deploying workspaces... {deployProgress.completed + deployProgress.failed}/{deployProgress.total}
              </span>
              <span className="text-xs text-blue-600 tabular-nums">{deployProgress.duration}s elapsed</span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-blue-100 rounded-full h-2">
              <div className="h-2 rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${deployProgress.progress}%` }} />
            </div>

            {/* Current step */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-700">{deployProgress.current}</span>
              <div className="flex items-center gap-3">
                <span className="text-green-600 font-medium">{deployProgress.completed} created</span>
                {deployProgress.failed > 0 && <span className="text-red-600 font-medium">{deployProgress.failed} failed</span>}
              </div>
            </div>
          </div>
        )}

        {result && !result.error && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-sm font-semibold text-green-800 mb-2">{result.message}</div>
            {/* Savings line removed — pricing hidden from client-facing pages */}
            <div className="space-y-1">
              {result.results?.filter(r => r.success).map(r => (
                <div key={r.name} className="flex items-center gap-3 text-sm">
                  <span className="font-medium text-gray-700">{r.name}</span>
                  <a href={r.accessUrl} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:underline inline-flex items-center gap-1">
                    <FaExternalLinkAlt className="w-2.5 h-2.5" /> Open Desktop
                  </a>
                  <span className="text-gray-400 text-xs">pw: {r.password}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {result?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{result.error}</div>
        )}
      </div>

      {/* Container list */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h2 className="text-sm font-semibold text-gray-800">Manage Workspaces</h2>
        <div className="flex items-center gap-3">
          <input value={listTraining} onChange={e => setListTraining(e.target.value)} placeholder="Training name..."
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-64" />
          <button onClick={fetchContainers}
            className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
            Load
          </button>
        </div>

        {showList && (
          <div className="overflow-x-auto">
            {containers.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No workspaces found</p>
            ) : (
              <table className="min-w-full text-[13px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Image</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Resources</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Access</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {containers.filter(c => c.isAlive).map(c => (
                    <ContainerRow key={c._id} c={c} onAction={handleContainerAction} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContainerRow({ c, onAction }) {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <tr className="hover:bg-gray-50/60">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${c.isRunning ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="font-medium text-gray-800">{c.name}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-gray-600">{c.os}</td>
      <td className="px-3 py-2.5 text-gray-600">{c.cpus} CPU / {c.memory >= 1024 ? `${c.memory / 1024} GB` : `${c.memory} MB`}</td>
      <td className="px-3 py-2.5">
        {c.isRunning ? (
          <div className="flex items-center gap-2">
            <a href={`http://${c.hostIp}:${c.vncPort}`} target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1">
              <FaExternalLinkAlt className="w-2 h-2" /> Desktop
            </a>
            <button onClick={() => copy(c.password)} className="text-gray-400 hover:text-gray-600" title={`Password: ${c.password}`}>
              {copied ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
            </button>
          </div>
        ) : <span className="text-gray-400 text-xs">-</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
          c.isRunning ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {c.isRunning ? 'Running' : 'Stopped'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center gap-1 justify-end">
          {c.isRunning ? (
            <button onClick={() => onAction('stop', [c.containerId])}
              className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition-colors" title="Stop">
              <FaPowerOff className="w-3 h-3" />
            </button>
          ) : (
            <button onClick={() => onAction('start', [c.containerId])}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors" title="Start">
              <FaPlay className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => onAction('delete', [c.containerId])}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors" title="Delete">
            <FaTrash className="w-3 h-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}
