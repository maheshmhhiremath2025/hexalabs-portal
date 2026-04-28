import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaPlus, FaTrash, FaSave, FaArrowLeft, FaChevronUp, FaChevronDown,
  FaCheck, FaPlay, FaLightbulb, FaEye, FaRobot, FaWrench, FaSpinner,
  FaFilePdf, FaFileCsv, FaMagic, FaTimes, FaServer
} from 'react-icons/fa';
import { BookOpen, AlertCircle, Upload, Sparkles, Zap, Monitor, Cloud } from 'lucide-react';

const CLOUDS = ['azure', 'aws', 'gcp', 'container'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const CATEGORIES = ['Compute', 'Storage', 'Networking', 'Security', 'Containers', 'Development', 'Database', 'AI/ML'];
const VERIFY_TYPES = [
  { value: 'manual', label: 'Manual (student marks done)' },
  { value: 'auto', label: 'Auto (run command to verify)' },
  { value: 'none', label: 'None (info only, no completion)' },
];

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ===== Troubleshooting Item Editor ===== */
function TroubleshootingEditor({ items = [], onChange }) {
  const addItem = () => onChange([...items, { issue: '', solution: '' }]);
  const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx, field, value) => onChange(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-start">
          <div className="flex-1 space-y-1">
            <input
              type="text"
              placeholder="Issue (e.g., Permission denied when running az command)"
              value={item.issue || ''}
              onChange={(e) => updateItem(idx, 'issue', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none bg-orange-50/50"
            />
            <input
              type="text"
              placeholder="Solution (e.g., Run az login first or check RBAC role)"
              value={item.solution || ''}
              onChange={(e) => updateItem(idx, 'solution', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none bg-orange-50/50"
            />
          </div>
          <button onClick={() => removeItem(idx)} className="p-1 text-red-400 hover:text-red-600 mt-1" title="Remove">
            <FaTimes className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
      <button onClick={addItem}
        className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-medium">
        <FaPlus className="w-2 h-2" /> Add Troubleshooting Item
      </button>
    </div>
  );
}

/* ===== Lab-Level Troubleshooting Editor ===== */
function LabTroubleshootingEditor({ items = [], onChange }) {
  const addItem = () => onChange([...items, { issue: '', solution: '', category: '' }]);
  const removeItem = (idx) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx, field, value) => onChange(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const categories = ['Connectivity', 'Permissions', 'Environment', 'Software', 'General'];

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-start p-2 bg-orange-50/50 border border-orange-200 rounded-md">
          <div className="flex-1 space-y-1.5">
            <select
              value={item.category || ''}
              onChange={(e) => updateItem(idx, 'category', e.target.value)}
              className="px-2 py-1 text-xs border border-orange-200 rounded-md bg-white outline-none"
            >
              <option value="">Category...</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Issue description"
              value={item.issue || ''}
              onChange={(e) => updateItem(idx, 'issue', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none"
            />
            <input
              type="text"
              placeholder="Solution"
              value={item.solution || ''}
              onChange={(e) => updateItem(idx, 'solution', e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-orange-200 rounded-md focus:ring-1 focus:ring-orange-400 outline-none"
            />
          </div>
          <button onClick={() => removeItem(idx)} className="p-1 text-red-400 hover:text-red-600" title="Remove">
            <FaTimes className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
      <button onClick={addItem}
        className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-medium">
        <FaPlus className="w-2 h-2" /> Add Lab Troubleshooting Item
      </button>
    </div>
  );
}

/* ===== Step Editor ===== */
function StepEditor({ step, index, total, onChange, onRemove, onMove, onImprove, improving }) {
  const [showTroubleshooting, setShowTroubleshooting] = useState(!!(step.troubleshooting?.length));

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
            {index + 1}
          </span>
          <span className="text-sm font-semibold text-slate-700">Step {index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onMove(index, -1)} disabled={index === 0}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move up">
            <FaChevronUp className="w-3 h-3" />
          </button>
          <button onClick={() => onMove(index, 1)} disabled={index === total - 1}
            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move down">
            <FaChevronDown className="w-3 h-3" />
          </button>
          <button onClick={() => onRemove(index)}
            className="p-1 text-red-400 hover:text-red-600 ml-2" title="Remove">
            <FaTrash className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Step title"
          value={step.title || ''}
          onChange={(e) => onChange(index, 'title', e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />

        <textarea
          placeholder="Step description (instructions for the student)..."
          value={step.description || ''}
          onChange={(e) => onChange(index, 'description', e.target.value)}
          rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
        />

        <input
          type="text"
          placeholder="Hint (optional — shown when student clicks 'Show hint')"
          value={step.hint || ''}
          onChange={(e) => onChange(index, 'hint', e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />

        <div className="flex items-center gap-3">
          <select
            value={step.verifyType || 'manual'}
            onChange={(e) => onChange(index, 'verifyType', e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500"
          >
            {VERIFY_TYPES.map(vt => (
              <option key={vt.value} value={vt.value}>{vt.label}</option>
            ))}
          </select>
        </div>

        {step.verifyType === 'auto' && (
          <div className="space-y-2 pl-3 border-l-2 border-blue-200">
            <input
              type="text"
              placeholder="Verify command (e.g., az vm show --name myvm -g rg1 --query powerState)"
              value={step.verifyCommand || ''}
              onChange={(e) => onChange(index, 'verifyCommand', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
            />
            <input
              type="text"
              placeholder="Expected output (regex pattern, optional — defaults to exit code 0)"
              value={step.verifyExpectedOutput || ''}
              onChange={(e) => onChange(index, 'verifyExpectedOutput', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono"
            />
            <input
              type="number"
              placeholder="Timeout (seconds)"
              value={step.verifyTimeout || 30}
              onChange={(e) => onChange(index, 'verifyTimeout', parseInt(e.target.value) || 30)}
              className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        )}

        {/* Troubleshooting section */}
        <div className="border-t border-slate-100 pt-2">
          <button
            onClick={() => setShowTroubleshooting(!showTroubleshooting)}
            className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700"
          >
            <FaWrench className="w-2.5 h-2.5" />
            Troubleshooting ({step.troubleshooting?.length || 0})
            <FaChevronDown className={`w-2 h-2 transition-transform ${showTroubleshooting ? 'rotate-180' : ''}`} />
          </button>
          {showTroubleshooting && (
            <div className="mt-2">
              <TroubleshootingEditor
                items={step.troubleshooting || []}
                onChange={(items) => onChange(index, 'troubleshooting', items)}
              />
            </div>
          )}
        </div>

        {/* AI Assist toolbar */}
        <div className="border-t border-slate-100 pt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-slate-400 font-medium uppercase mr-1">AI Assist:</span>
          {[
            { field: 'description', icon: '📝', label: 'Description' },
            { field: 'hint', icon: '💡', label: 'Hint' },
            { field: 'troubleshooting', icon: '🔧', label: 'Troubleshoot' },
            ...(step.verifyType === 'auto' ? [{ field: 'verifyCommand', icon: '✅', label: 'Verify Cmd' }] : []),
          ].map(btn => (
            <button
              key={btn.field}
              onClick={() => onImprove(index, btn.field)}
              disabled={improving === `${index}-${btn.field}`}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-md disabled:opacity-50 transition-colors"
            >
              {improving === `${index}-${btn.field}` ? (
                <FaSpinner className="w-2.5 h-2.5 animate-spin" />
              ) : (
                <span>{btn.icon}</span>
              )}
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== Deploy Modal ===== */
function DeployModal({ lab, onClose }) {
  const navigate = useNavigate();
  const [trainingName, setTrainingName] = useState(
    lab.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ''
  );
  const [organization, setOrganization] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [count, setCount] = useState(1);
  const [emails, setEmails] = useState('');
  const [allocatedHours, setAllocatedHours] = useState(100);
  const [autoShutdown, setAutoShutdown] = useState(true);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [expiresAt, setExpiresAt] = useState('');
  // Remote access: 'none' | 'guacamole' | 'meshcentral'
  const [remoteAccess, setRemoteAccess] = useState(lab.cloud === 'azure' ? 'guacamole' : 'none');
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);

  const userType = (() => {
    try {
      const raw = localStorage.getItem('AH1apq12slurt5');
      if (raw === 'z829Sgry6AkYJ') return 'admin';
      if (raw === 'hpQ3s5dK247') return 'superadmin';
      return 'user';
    } catch { return 'user'; }
  })();

  useEffect(() => {
    if (userType === 'superadmin') {
      apiCaller.get('/admin/organization')
        .then(res => {
          const list = res.data?.organization || [];
          setOrgs(list);
          if (list.length > 0 && !organization) setOrganization(list[0]);
        })
        .catch(() => {});
    } else {
      try { setOrganization(localStorage.getItem('organization') || ''); } catch {}
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiCaller.get(`/guided-labs/${lab._id}/deploy-status/${jobId}`);
        setProgress(res.data);
        if (res.data.status === 'done') clearInterval(interval);
      } catch { clearInterval(interval); }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, lab._id]);

  const handleDeploy = async () => {
    if (!trainingName.trim() || !organization.trim()) return setError('Training name and organization are required');
    setDeploying(true);
    setError('');
    try {
      const emailList = emails.split('\n').map(e => e.trim()).filter(Boolean);
      const res = await apiCaller.post(`/guided-labs/${lab._id}/deploy`, {
        trainingName: trainingName.trim(),
        organization: organization.trim(),
        count,
        emails: emailList,
        allocatedHours,
        autoShutdown,
        idleMinutes,
        expiresAt: expiresAt || undefined,
        ...(lab.cloud === 'azure' && { guacamole: remoteAccess === 'guacamole', meshCentral: remoteAccess === 'meshcentral' }),
      });
      if (res.data.jobId) {
        setJobId(res.data.jobId);
      } else {
        setProgress({ status: 'done', message: res.data.message, cloud: res.data.cloud, total: res.data.total, workerWarning: res.data.workerWarning });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
      setDeploying(false);
    }
  };

  const isDone = progress?.status === 'done';
  const cloudLabel = lab.cloud === 'container' ? 'Container' : lab.cloud?.toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-green-50 to-blue-50">
          <div className="flex items-center gap-2">
            <FaServer className="w-4 h-4 text-green-600" />
            <h2 className="text-lg font-bold text-slate-800">Deploy Lab</h2>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              lab.cloud === 'azure' ? 'bg-blue-100 text-blue-600' :
              lab.cloud === 'aws' ? 'bg-orange-100 text-orange-600' :
              lab.cloud === 'gcp' ? 'bg-red-100 text-red-600' :
              'bg-purple-100 text-purple-600'
            }`}>{cloudLabel}</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="p-3 mb-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-sm font-semibold text-slate-800">{lab.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{lab.steps?.length || 0} steps | {lab.difficulty} | {lab.duration} min</div>
            {lab.cloud === 'container' && lab.containerImage && (
              <div className="text-xs text-purple-600 mt-1">Image: {lab.containerImage}</div>
            )}
            {lab.cloud === 'azure' && lab.vmTemplateName && (
              <div className="text-xs text-blue-600 mt-1">Template: {lab.vmTemplateName}</div>
            )}
          </div>

          {!isDone && !jobId ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Training Name</label>
                <input type="text" value={trainingName} onChange={e => setTrainingName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="e.g. kali-linux-lab" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
                {userType === 'superadmin' && orgs.length > 0 ? (
                  <select value={organization} onChange={e => setOrganization(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-green-400">
                    {orgs.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="text" value={organization} onChange={e => setOrganization(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                )}
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Instance Count</label>
                  <input type="number" min="1" max="50" value={count} onChange={e => setCount(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Allocated Hours</label>
                  <input type="number" min="1" value={allocatedHours} onChange={e => setAllocatedHours(parseInt(e.target.value) || 100)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Student Emails (one per line, optional)</label>
                <textarea rows={3} value={emails} onChange={e => setEmails(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400 font-mono"
                  placeholder={"student1@example.com\nstudent2@example.com"} />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={autoShutdown} onChange={e => setAutoShutdown(e.target.checked)}
                    className="rounded border-slate-300" />
                  Auto-shutdown when idle
                </label>
                {autoShutdown && (
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-slate-500">after</label>
                    <input type="number" min="5" max="120" value={idleMinutes}
                      onChange={e => setIdleMinutes(parseInt(e.target.value) || 30)}
                      className="w-16 px-2 py-1 text-xs border border-slate-200 rounded-md outline-none" />
                    <span className="text-xs text-slate-500">min</span>
                  </div>
                )}
              </div>

              {lab.cloud === 'azure' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Remote Access Method</label>
                  <div className="space-y-2">
                    <label className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg border transition-colors ${
                      remoteAccess === 'guacamole' ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="deployRemoteAccess" checked={remoteAccess === 'guacamole'} onChange={() => setRemoteAccess('guacamole')}
                        className="text-blue-600" />
                      Guacamole <span className="text-[10px] text-slate-400">— RDP/SSH via browser</span>
                    </label>
                    {(lab.vmTemplateName || '').toLowerCase().includes('windows') && (
                    <label className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg border transition-colors ${
                      remoteAccess === 'meshcentral' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="deployRemoteAccess" checked={remoteAccess === 'meshcentral'} onChange={() => setRemoteAccess('meshcentral')}
                        className="text-emerald-600" />
                      MeshCentral <span className="text-[10px] text-slate-400">— agent-based, no extra cost</span>
                    </label>
                    )}
                    <label className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg border transition-colors ${
                      remoteAccess === 'none' ? 'border-slate-400 bg-slate-50 text-slate-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="deployRemoteAccess" checked={remoteAccess === 'none'} onChange={() => setRemoteAccess('none')}
                        className="text-slate-600" />
                      None <span className="text-[10px] text-slate-400">— RDP/SSH client only</span>
                    </label>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Expiry Date (optional)</label>
                <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
              </div>
            </div>
          ) : jobId && !isDone ? (
            <div className="space-y-4 py-4">
              <div className="text-sm font-medium text-slate-700 text-center">Deploying instances...</div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div className="bg-green-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progress?.progress || 0}%` }} />
              </div>
              <div className="text-center text-xs text-slate-500">
                {progress?.completed || 0} / {progress?.total || count} completed
                {progress?.failed > 0 && <span className="text-red-500 ml-2">({progress.failed} failed)</span>}
              </div>
              {progress?.current && (
                <div className="text-center text-xs text-slate-400 animate-pulse">{progress.current}</div>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {progress?.workerWarning ? (
                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-semibold text-amber-700">VM Creation Queued</span>
                    <p className="text-xs text-amber-600 mt-0.5">{progress.workerWarning}</p>
                  </div>
                </div>
              ) : progress?.cloud && progress.cloud !== 'container' ? (
                <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <FaCheck className="w-4 h-4 text-blue-600" />
                  <div>
                    <span className="text-sm font-semibold text-blue-700">VM Creation Queued</span>
                    <p className="text-xs text-blue-600 mt-0.5">{progress.total} VM(s) queued — will be ready in 3-5 minutes once worker processes them.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <FaCheck className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-green-700">Deployment Complete!</span>
                </div>
              )}
              {progress?.results?.length > 0 && (
                <div className="text-xs text-slate-600">
                  <span className="font-medium">{progress.results.filter(r => r.success).length}</span> instance(s) created successfully
                  {progress.failed > 0 && <>, <span className="text-red-500 font-medium">{progress.failed} failed</span></>}
                  {progress.duration && <span className="text-slate-400 ml-2">({progress.duration}s)</span>}
                </div>
              )}
              {progress?.message && !progress?.workerWarning && (
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">{progress.message}</div>
              )}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                Go to <span className="font-semibold">Lab Console</span> and select
                "<span className="font-mono font-medium">{trainingName}</span>" from the training dropdown to see instances.
                {progress?.cloud && progress.cloud !== 'container'
                  ? ' VMs will appear once the worker processes the queue.'
                  : ' The guided lab panel will appear alongside the instances.'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">
            {isDone ? 'Close' : 'Cancel'}
          </button>
          <div className="flex items-center gap-2">
            {isDone && (
              <button onClick={() => navigate('/vm/vmdetails')}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                <Monitor className="w-3.5 h-3.5" /> Open Lab Console
              </button>
            )}
            {!isDone && !jobId && (
              <button onClick={handleDeploy} disabled={deploying}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors">
                {deploying ? (
                  <><FaSpinner className="w-3.5 h-3.5 animate-spin" /> Deploying...</>
                ) : (
                  <><FaPlay className="w-3 h-3" /> Deploy {count} Instance{count > 1 ? 's' : ''}</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Main Editor ===== */
export default function GuidedLabEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const fileInputRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lab, setLab] = useState({
    title: '',
    slug: '',
    description: '',
    cloud: 'azure',
    difficulty: 'beginner',
    duration: 30,
    category: '',
    tags: [],
    icon: '',
    requiresSandbox: true,
    steps: [{ order: 1, title: '', description: '', hint: '', verifyType: 'manual', troubleshooting: [] }],
    labTroubleshooting: [],
  });
  const [tagInput, setTagInput] = useState('');
  const [autoSlug, setAutoSlug] = useState(true);

  // Deploy state
  const [showDeploy, setShowDeploy] = useState(false);
  const [containerImages, setContainerImages] = useState([]);

  // Role checks
  const isSuperAdmin = (() => {
    try { return localStorage.getItem('AH1apq12slurt5') === 'hpQ3s5dK247'; } catch { return false; }
  })();
  const isAdmin = (() => {
    try {
      const raw = localStorage.getItem('AH1apq12slurt5');
      return raw === 'z829Sgry6AkYJ' || raw === 'hpQ3s5dK247';
    } catch { return false; }
  })();
  const readOnly = isEdit && !isSuperAdmin;

  // Org assignment state (superadmin)
  const [allOrgs, setAllOrgs] = useState([]);
  const [orgInput, setOrgInput] = useState('');

  // Fetch container images + orgs on mount
  useEffect(() => {
    apiCaller.get('/containers/images')
      .then(res => setContainerImages(res.data || []))
      .catch(() => {});
    if (isSuperAdmin) {
      apiCaller.get('/admin/organization')
        .then(res => setAllOrgs(res.data?.organization || []))
        .catch(() => {});
    }
  }, []);

  // AI generation state
  const [pdfFile, setPdfFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genMeta, setGenMeta] = useState(null);
  const [cloudHint, setCloudHint] = useState('auto');
  const [difficultyHint, setDifficultyHint] = useState('auto');
  const [improving, setImproving] = useState(null); // "stepIndex-field" when improving

  // Load existing lab for edit mode OR pick up AI-generated lab from sessionStorage
  useEffect(() => {
    if (id) {
      apiCaller.get(`/guided-labs/${id}`)
        .then(res => {
          setLab(res.data);
          setAutoSlug(false);
        })
        .catch(() => setError('Failed to load guided lab'));
    } else {
      // Check if there's an AI-generated lab from the listing page modal
      try {
        const stored = sessionStorage.getItem('ai_generated_lab');
        if (stored) {
          const generated = JSON.parse(stored);
          sessionStorage.removeItem('ai_generated_lab');
          setLab(prev => ({
            ...prev,
            ...generated,
            steps: (generated.steps || []).map((s, i) => ({
              ...s,
              order: i + 1,
              troubleshooting: s.troubleshooting || [],
            })),
            labTroubleshooting: generated.labTroubleshooting || [],
          }));
          setAutoSlug(false);
        }
      } catch { /* ignore parse errors */ }
    }
  }, [id]);

  const updateField = useCallback((field, value) => {
    setLab(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'title' && autoSlug) {
        next.slug = slugify(value);
      }
      return next;
    });
  }, [autoSlug]);

  const updateStep = useCallback((index, field, value) => {
    setLab(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === index ? { ...s, [field]: value } : s),
    }));
  }, []);

  const addStep = useCallback(() => {
    setLab(prev => ({
      ...prev,
      steps: [...prev.steps, { order: prev.steps.length + 1, title: '', description: '', hint: '', verifyType: 'manual', troubleshooting: [] }],
    }));
  }, []);

  const removeStep = useCallback((index) => {
    setLab(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
    }));
  }, []);

  const moveStep = useCallback((index, direction) => {
    setLab(prev => {
      const steps = [...prev.steps];
      const target = index + direction;
      if (target < 0 || target >= steps.length) return prev;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...prev, steps: steps.map((s, i) => ({ ...s, order: i + 1 })) };
    });
  }, []);

  const addTag = useCallback(() => {
    if (!tagInput.trim()) return;
    setLab(prev => ({ ...prev, tags: [...new Set([...prev.tags, tagInput.trim().toLowerCase()])] }));
    setTagInput('');
  }, [tagInput]);

  const removeTag = useCallback((tag) => {
    setLab(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  }, []);

  // ─── AI: Generate from PDF ──────────────────────────────────────────
  const handleGenerate = async () => {
    if (!pdfFile) return setError('Please select a PDF or CSV file first');
    setGenerating(true);
    setError('');
    setGenMeta(null);

    try {
      const formData = new FormData();
      formData.append('file', pdfFile);
      if (cloudHint !== 'auto') formData.append('cloudHint', cloudHint);
      if (difficultyHint !== 'auto') formData.append('difficultyHint', difficultyHint);

      const res = await apiCaller.post('/guided-labs/generate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000, // 5 min timeout for AI generation
      });

      const generated = res.data.lab;
      setLab(prev => ({
        ...prev,
        title: generated.title || prev.title,
        slug: generated.slug || slugify(generated.title || ''),
        description: generated.description || prev.description,
        cloud: generated.cloud || prev.cloud,
        difficulty: generated.difficulty || prev.difficulty,
        duration: generated.duration || prev.duration,
        category: generated.category || prev.category,
        tags: generated.tags || prev.tags,
        containerImage: generated.containerImage || prev.containerImage,
        containerConfig: generated.containerConfig || prev.containerConfig,
        vmTemplateName: generated.vmTemplateName || prev.vmTemplateName,
        steps: (generated.steps || []).map((s, i) => ({
          ...s,
          order: i + 1,
          troubleshooting: s.troubleshooting || [],
        })),
        labTroubleshooting: generated.labTroubleshooting || [],
        aiGenerated: true,
      }));
      setAutoSlug(false);
      setGenMeta({ ...res.data.meta, cloudRecommendation: generated.cloudRecommendation });
    } catch (err) {
      setError(err.response?.data?.message || 'AI generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // ─── AI: Improve Step Field ─────────────────────────────────────────
  const handleImproveStep = async (stepIndex, field) => {
    const key = `${stepIndex}-${field}`;
    setImproving(key);
    setError('');

    try {
      const step = lab.steps[stepIndex];
      const res = await apiCaller.post('/guided-labs/improve-step', {
        step,
        field,
        labContext: { title: lab.title, cloud: lab.cloud, difficulty: lab.difficulty },
      }, { timeout: 60000 });

      const improved = res.data.improved;
      if (field === 'troubleshooting' && Array.isArray(improved)) {
        updateStep(stepIndex, 'troubleshooting', improved);
      } else if (typeof improved === 'string') {
        updateStep(stepIndex, field, improved);
      }
    } catch (err) {
      setError(`AI improvement failed: ${err.response?.data?.message || err.message}`);
    } finally {
      setImproving(null);
    }
  };

  // ─── Save ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    setError('');
    if (!lab.title?.trim()) return setError('Title is required');
    if (!lab.slug?.trim()) return setError('Slug is required');
    if (!lab.description?.trim()) return setError('Description is required');
    if (!lab.steps?.length) return setError('At least one step is required');
    if (lab.steps.some(s => !s.title?.trim())) return setError('All steps must have a title');

    setSaving(true);
    try {
      if (isEdit) {
        await apiCaller.put(`/guided-labs/${id}`, lab);
      } else {
        await apiCaller.post('/guided-labs', lab);
      }
      navigate('/guided-labs');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ─── File Drop Handler ──────────────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const name = file.name?.toLowerCase() || '';
    if (file.type === 'application/pdf' || file.type === 'text/csv' || name.endsWith('.pdf') || name.endsWith('.csv')) {
      setPdfFile(file);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/guided-labs')}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
            <FaArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-600" />
              {readOnly ? 'View Guided Lab' : isEdit ? 'Edit Guided Lab' : 'Create Guided Lab'}
            </h1>
          </div>
        </div>
        {isEdit && lab._id && (isSuperAdmin || isAdmin) && (
          <button
            onClick={() => setShowDeploy(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors shadow-sm"
          >
            <FaPlay className="w-3 h-3" /> Deploy Lab
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className={`space-y-6 ${readOnly ? 'pointer-events-none' : ''}`}>
        {/* AI Generator Panel */}
        {!isEdit && !readOnly && (
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <FaRobot className="w-4 h-4 text-purple-600" />
              <h2 className="text-sm font-semibold text-purple-800">AI Lab Generator</h2>
              <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">Beta</span>
            </div>
            <p className="text-xs text-purple-600 mb-4">
              Upload a course PDF or CSV (syllabus, TOC, lab manual, or structured topics) and AI will generate the complete guided lab with steps, instructions, hints, and troubleshooting tips.
            </p>

            <div className="flex gap-4 items-start">
              {/* File upload area */}
              <div
                className="flex-1 border-2 border-dashed border-purple-300 rounded-lg p-4 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.csv"
                  className="hidden"
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                />
                {pdfFile ? (
                  <div className="flex items-center justify-center gap-2">
                    {pdfFile.name?.toLowerCase().endsWith('.csv')
                      ? <FaFileCsv className="w-5 h-5 text-green-600" />
                      : <FaFilePdf className="w-5 h-5 text-red-500" />
                    }
                    <div className="text-left">
                      <div className="text-sm font-medium text-slate-700">{pdfFile.name}</div>
                      <div className="text-xs text-slate-500">{(pdfFile.size / 1024 / 1024).toFixed(1)} MB</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setPdfFile(null); }} className="ml-2 text-slate-400 hover:text-red-500">
                      <FaTimes className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-purple-400 mx-auto mb-1" />
                    <div className="text-xs text-purple-600">Click to upload or drag & drop PDF / CSV</div>
                    <div className="text-[10px] text-purple-400 mt-0.5">Max 15 MB</div>
                  </>
                )}
              </div>

              {/* Hints + generate button */}
              <div className="w-48 space-y-2">
                <div>
                  <label className="block text-[10px] font-medium text-purple-600 mb-0.5">Cloud Hint</label>
                  <select value={cloudHint} onChange={(e) => setCloudHint(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-purple-200 rounded-md bg-white outline-none">
                    <option value="auto">Auto-detect</option>
                    {CLOUDS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-purple-600 mb-0.5">Difficulty Hint</label>
                  <select value={difficultyHint} onChange={(e) => setDifficultyHint(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-purple-200 rounded-md bg-white outline-none">
                    <option value="auto">Auto-detect</option>
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating || !pdfFile}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {generating ? (
                    <>
                      <FaSpinner className="w-3 h-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Generate Lab
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Generation meta info */}
            {genMeta && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-3 text-[10px] text-purple-500">
                  <Zap className="w-3 h-3" />
                  <span>Generated in {(genMeta.elapsedMs / 1000).toFixed(1)}s</span>
                  <span>|</span>
                  <span>{genMeta.inputTokens?.toLocaleString()} input / {genMeta.outputTokens?.toLocaleString()} output tokens</span>
                  {genMeta.fileType && <><span>|</span><span>Source: {genMeta.fileType.toUpperCase()}</span></>}
                  {genMeta.pageCount > 0 && <><span>|</span><span>{genMeta.pageCount} pages</span></>}
                  <span>|</span>
                  <span>Model: {genMeta.model}</span>
                </div>
                {genMeta.cloudRecommendation?.reason && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Infrastructure Recommendation
                    </div>
                    <div className="text-[10px] text-amber-700 mt-0.5">{genMeta.cloudRecommendation.reason}</div>
                    {genMeta.cloudRecommendation.alternative && genMeta.cloudRecommendation.alternative !== 'none' && (
                      <div className="text-[10px] text-amber-600 mt-0.5 pl-2 border-l-2 border-amber-300">
                        <span className="font-medium">Alternative:</span> {genMeta.cloudRecommendation.alternative.toUpperCase()}
                        {genMeta.cloudRecommendation.alternativeReason && ` — ${genMeta.cloudRecommendation.alternativeReason}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {generating && (
              <div className="mt-3 flex items-center gap-2 text-xs text-purple-600">
                <div className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                Analyzing PDF and generating lab content... This may take 30-60 seconds.
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Lab Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
              <input type="text" value={lab.title} onChange={(e) => updateField('title', e.target.value)}
                placeholder="e.g., Deploy Your First Azure VM"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Slug *</label>
              <input type="text" value={lab.slug} onChange={(e) => { setAutoSlug(false); updateField('slug', e.target.value); }}
                placeholder="e.g., azure-first-vm"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description *</label>
            <textarea value={lab.description} onChange={(e) => updateField('description', e.target.value)}
              rows={2} placeholder="What will the student learn?"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cloud *</label>
              <select value={lab.cloud} onChange={(e) => updateField('cloud', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none">
                {CLOUDS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Difficulty</label>
              <select value={lab.difficulty} onChange={(e) => updateField('difficulty', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none">
                {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Duration (min)</label>
              <input type="number" value={lab.duration} onChange={(e) => updateField('duration', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select value={lab.category || ''} onChange={(e) => updateField('category', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none">
                <option value="">Select...</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Icon (emoji)</label>
              <input type="text" value={lab.icon || ''} onChange={(e) => updateField('icon', e.target.value)}
                placeholder="e.g., 🖥️"
                className="w-20 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none text-center text-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tags</label>
              <div className="flex items-center gap-2">
                <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  placeholder="Add tag..."
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none" />
                <button onClick={addTag} className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg">Add</button>
              </div>
              {lab.tags?.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {lab.tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="text-blue-400 hover:text-blue-600">&times;</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Org Assignment (superadmin only) */}
          {isSuperAdmin && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Assigned Organizations
                <span className="ml-1 font-normal text-slate-400">
                  {(!lab.assignedOrgs || lab.assignedOrgs.length === 0) ? '— Default (visible to all)' : ''}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input type="text" value={orgInput} onChange={(e) => setOrgInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = orgInput.trim();
                        if (val && !lab.assignedOrgs?.includes(val)) {
                          updateField('assignedOrgs', [...(lab.assignedOrgs || []), val]);
                        }
                        setOrgInput('');
                      }
                    }}
                    placeholder="Type org name or pick from list..."
                    list="org-suggestions"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none" />
                  <datalist id="org-suggestions">
                    {allOrgs.filter(o => !lab.assignedOrgs?.includes(o)).map(o => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                </div>
                <button
                  onClick={() => {
                    const val = orgInput.trim();
                    if (val && !lab.assignedOrgs?.includes(val)) {
                      updateField('assignedOrgs', [...(lab.assignedOrgs || []), val]);
                    }
                    setOrgInput('');
                  }}
                  className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                >Add</button>
              </div>
              {lab.assignedOrgs?.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {lab.assignedOrgs.map(org => (
                    <span key={org} className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                      {org}
                      <button onClick={() => updateField('assignedOrgs', lab.assignedOrgs.filter(o => o !== org))} className="text-indigo-400 hover:text-indigo-600">&times;</button>
                    </span>
                  ))}
                  <button
                    onClick={() => updateField('assignedOrgs', [])}
                    className="text-[10px] text-slate-400 hover:text-red-500 ml-1"
                  >Clear all</button>
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-1">Leave empty to make this a default lab visible to all organizations.</p>
            </div>
          )}
        </div>

        {/* Deployment Config */}
        {isSuperAdmin && (
          <div className="bg-white border border-green-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FaServer className="w-3.5 h-3.5 text-green-600" />
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Deployment Config</h2>
              <span className="text-[10px] text-slate-400 font-normal normal-case">Required for deploying this lab</span>
            </div>

            {lab.cloud === 'container' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Container Image *</label>
                  <select
                    value={lab.containerImage || ''}
                    onChange={(e) => updateField('containerImage', e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-green-400"
                  >
                    <option value="">Select container image...</option>
                    {containerImages.map(img => (
                      <option key={img.key} value={img.key}>{img.label} ({img.os})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">CPUs</label>
                    <input type="number" min="1" max="8"
                      value={lab.containerConfig?.cpus || 2}
                      onChange={(e) => updateField('containerConfig', { ...lab.containerConfig, cpus: parseInt(e.target.value) || 2 })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Memory (MB)</label>
                    <input type="number" min="512" max="16384" step="512"
                      value={lab.containerConfig?.memory || 2048}
                      onChange={(e) => updateField('containerConfig', { ...lab.containerConfig, memory: parseInt(e.target.value) || 2048 })}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                  </div>
                </div>
              </>
            )}

            {lab.cloud === 'azure' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">VM Template Name *</label>
                <input type="text"
                  value={lab.vmTemplateName || ''}
                  onChange={(e) => updateField('vmTemplateName', e.target.value)}
                  placeholder="e.g., ubuntu-22, windows-server-2022"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-green-400" />
                <p className="text-[10px] text-slate-400 mt-1">Must match a template name from the Templates page</p>
              </div>
            )}

            {(lab.cloud === 'aws' || lab.cloud === 'gcp') && (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                {lab.cloud.toUpperCase()} labs deploy as cloud sandboxes. No additional config needed — sandbox credentials are provisioned automatically.
              </div>
            )}
          </div>
        )}

        {/* Steps */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Steps ({lab.steps?.length || 0})
            </h2>
            {!readOnly && (
              <button onClick={addStep}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg">
                <FaPlus className="w-2.5 h-2.5" /> Add Step
              </button>
            )}
          </div>

          <div className="space-y-3">
            {lab.steps?.map((step, idx) => (
              <StepEditor
                key={idx}
                step={step}
                index={idx}
                total={lab.steps.length}
                onChange={updateStep}
                onRemove={removeStep}
                onMove={moveStep}
                onImprove={handleImproveStep}
                improving={improving}
              />
            ))}
          </div>

          {(!lab.steps || lab.steps.length === 0) && (
            <div className="text-center py-8 text-sm text-slate-400">
              No steps yet. Click "Add Step" or use the AI Generator above.
            </div>
          )}
        </div>

        {/* Lab-Level Troubleshooting */}
        <div className="bg-white border border-orange-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <FaWrench className="w-3.5 h-3.5 text-orange-500" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Lab Troubleshooting ({lab.labTroubleshooting?.length || 0})
            </h2>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            General troubleshooting tips shown to all students at the bottom of the lab guide.
          </p>
          <LabTroubleshootingEditor
            items={lab.labTroubleshooting || []}
            onChange={(items) => updateField('labTroubleshooting', items)}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between !pointer-events-auto">
          <button onClick={() => navigate('/guided-labs')}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg">
            {readOnly ? 'Back to Labs' : 'Cancel'}
          </button>
          <div className="flex items-center gap-2">
            {isEdit && lab._id && (isSuperAdmin || isAdmin) && (
              <button onClick={() => setShowDeploy(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg">
                <FaPlay className="w-3 h-3" /> Deploy
              </button>
            )}
            {!readOnly && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <FaSave className="w-3.5 h-3.5" />}
                {isEdit ? 'Update Lab' : 'Create Lab'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Deploy Modal */}
      {showDeploy && lab._id && (
        <DeployModal lab={lab} onClose={() => setShowDeploy(false)} />
      )}
    </div>
  );
}
