import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiCaller from '../services/apiCaller';
import { FaPlay, FaPowerOff, FaTrash, FaExternalLinkAlt, FaDocker, FaCopy, FaCheck, FaRocket, FaCloud, FaAws, FaBook, FaBan, FaKey, FaClock, FaLock, FaEye, FaEyeSlash, FaStar, FaRegStar } from 'react-icons/fa';

export default function SelfServiceDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('containers');
  const [deploying, setDeploying] = useState(false);
  const [selectedImage, setSelectedImage] = useState('ubuntu-desktop');
  const [images, setImages] = useState([]);
  const [sandboxName, setSandboxName] = useState('');
  const [sandboxCloud, setSandboxCloud] = useState('azure');
  const [creatingSandbox, setCreatingSandbox] = useState(false);
  const [sandboxGoogleEmail, setSandboxGoogleEmail] = useState('');
  const [sandboxResult, setSandboxResult] = useState(null);
  const [sandboxes, setSandboxes] = useState([]);
  const [guidedLabs, setGuidedLabs] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [feedbackModal, setFeedbackModal] = useState(null); // { trainingName, email }
  const [submittedFeedback, setSubmittedFeedback] = useState({}); // { trainingName: true }

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await apiCaller.get('/selfservice/dashboard');
      setData(res.data);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchDashboard();
    apiCaller.get('/containers/images').then(r => setImages(r.data)).catch(() => {});
    apiCaller.get('/selfservice/sandboxes').then(r => setSandboxes(r.data?.active || r.data || [])).catch(() => {});
    apiCaller.get('/selfservice/guided-labs').then(r => setGuidedLabs(r.data)).catch(() => {});
  }, [fetchDashboard]);

  // Deploy progress: real-time status from /selfservice/deploy-status/:jobId
  // shape: { phase, label, progress, elapsedSeconds, status, error?, result? }
  const [deployProgress, setDeployProgress] = useState(null);
  const deployPollRef = useRef(null);

  // Cancel any in-flight poll on unmount so we don't leak interval timers
  useEffect(() => () => { if (deployPollRef.current) clearInterval(deployPollRef.current); }, []);

  const handleDeploy = async () => {
    setDeploying(true); setError(null); setSuccess(null);
    setDeployProgress({ phase: 'queued', label: 'Starting...', progress: 5, elapsedSeconds: 0 });

    try {
      const res = await apiCaller.post('/selfservice/deploy-async', { imageKey: selectedImage });
      const { jobId } = res.data;
      if (!jobId) throw new Error('No job id returned');

      // Poll every 1.2s until done or failed
      deployPollRef.current = setInterval(async () => {
        try {
          const s = await apiCaller.get(`/selfservice/deploy-status/${jobId}`);
          setDeployProgress(s.data);
          if (s.data.status === 'done') {
            clearInterval(deployPollRef.current); deployPollRef.current = null;
            setSuccess('Workspace ready! Click "Open" to access it.');
            await fetchDashboard();
            // Hide the bar shortly so the user sees "100% Ready" briefly
            setTimeout(() => setDeployProgress(null), 800);
            setDeploying(false);
          } else if (s.data.status === 'failed') {
            clearInterval(deployPollRef.current); deployPollRef.current = null;
            setError(s.data.error || 'Deploy failed');
            setDeployProgress(null);
            setDeploying(false);
          }
        } catch {
          // Job lookup itself failed — stop polling and surface a generic error
          clearInterval(deployPollRef.current); deployPollRef.current = null;
          setError('Lost connection to deploy job');
          setDeployProgress(null);
          setDeploying(false);
        }
      }, 1200);
    } catch (err) {
      setError(err.response?.data?.message || 'Deploy failed');
      setDeployProgress(null);
      setDeploying(false);
    }
  };

  const handleSandbox = async () => {
    if (!sandboxName) return setError('Sandbox name required');
    setCreatingSandbox(true); setError(null); setSuccess(null);
    try {
      if (sandboxCloud === 'gcp' && !sandboxGoogleEmail) {
        setError('GCP sandboxes require your Google email (Gmail or Google Workspace).');
        return;
      }
      const res = await apiCaller.post('/selfservice/sandbox', {
        cloud: sandboxCloud, name: sandboxName,
        ...(sandboxCloud === 'gcp' && { googleEmail: sandboxGoogleEmail }),
      });
      const a = res.data.access;
      setSandboxResult(null); // Don't show duplicate — Active Sandboxes shows it
      setSuccess(`${sandboxCloud.toUpperCase()} sandbox created! Scroll down to Active Sandboxes for access details.`);
      setSandboxName('');
      setCreatingSandbox(false);
      setTimeout(() => { fetchDashboard(); apiCaller.get('/selfservice/sandboxes').then(r => setSandboxes(r.data?.active || r.data || [])).catch(() => {}); }, 3000);
    } catch (err) { setError(err.response?.data?.message || 'Sandbox creation failed'); setCreatingSandbox(false); }
  };

  const handleAction = async (action, containerId) => {
    try {
      if (action === 'stop') await apiCaller.post('/selfservice/stop', { containerId });
      if (action === 'start') await apiCaller.post('/selfservice/start', { containerId });
      if (action === 'delete') await apiCaller.delete('/selfservice/instance', { data: { containerId } });
      await fetchDashboard();
    } catch (err) { setError(err.response?.data?.message || `Failed to ${action}`); }
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}</div>
    </div>
  );

  const sub = data?.subscription;
  const instances = data?.instances || [];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Subscription overview */}
      {sub ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{sub.plan} Plan</h2>
              <p className="text-xs text-gray-500">{sub.daysRemaining} days remaining</p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${sub.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{sub.status}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Container hours */}
            <QuotaCard label="Workspace Hours" used={sub.containerHours?.used} total={sub.containerHours?.total} unit="hrs" />

            {/* Sandbox credits */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-gray-500 uppercase font-semibold">Sandbox Credits</div>
              <div className="mt-1 space-y-1">
                {sub.sandboxCredits?.azure?.total > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-blue-600">Azure</span>
                    <span className="font-medium">{sub.sandboxCredits.azure.remaining}/{sub.sandboxCredits.azure.total}</span>
                  </div>
                )}
                {sub.sandboxCredits?.aws?.total > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-600">AWS</span>
                    <span className="font-medium">{sub.sandboxCredits.aws.remaining}/{sub.sandboxCredits.aws.total}</span>
                  </div>
                )}
                {sub.sandboxCredits?.gcp?.total > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-500">GCP</span>
                    <span className="font-medium">{sub.sandboxCredits.gcp.remaining}/{sub.sandboxCredits.gcp.total}</span>
                  </div>
                )}
              </div>
            </div>

            {/* VM hours */}
            {sub.vmHours?.total > 0 && <QuotaCard label="VM Hours" used={sub.vmHours?.used} total={sub.vmHours?.total} unit="hrs" />}

            {/* Days remaining */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-gray-500 uppercase font-semibold">Expires</div>
              <div className="text-xl font-bold text-gray-900">{sub.daysRemaining}<span className="text-sm text-gray-400 font-normal"> days</span></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
          <p className="text-amber-800 font-medium">No active subscription. <a href="/signup" className="text-blue-600 underline">Choose a plan</a></p>
        </div>
      )}

      {/* Upgrade prompt when credits are low */}
      {sub && (
        (sub.containerHours?.remaining <= 1 ||
         (sub.sandboxCredits?.azure?.remaining <= 0 && sub.sandboxCredits?.aws?.remaining <= 0 && sub.sandboxCredits?.gcp?.remaining <= 0)) && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-800">Running low on credits?</div>
              <p className="text-xs text-blue-600 mt-0.5">Upgrade your plan for more workspace hours, sandbox credits, and premium features.</p>
            </div>
            <a href="/signup" className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
              Upgrade Plan
            </a>
          </div>
        )
      )}

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{success}</div>}

      {/* Tabs */}
      {sub?.status === 'active' && (
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          <button onClick={() => setTab('containers')} className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'containers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            <FaDocker className="w-3 h-3" /> Workspaces
          </button>
          <button onClick={() => setTab('sandboxes')} className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'sandboxes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            <FaCloud className="w-3 h-3" /> Cloud Sandboxes
          </button>
          <button onClick={() => setTab('labs')} className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'labs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            <FaBook className="w-3 h-3" /> Guided Labs
          </button>
        </div>
      )}

      {/* Containers tab */}
      {tab === 'containers' && sub?.status === 'active' && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Deploy Workspace</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Environment</label>
                <select value={selectedImage} onChange={e => setSelectedImage(e.target.value)}
                  className="w-full appearance-none px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  {['desktop', 'security', 'dev', 'bigdata', 'app'].map(cat => {
                    const catImages = images.filter(i => i.category === cat);
                    if (!catImages.length) return null;
                    return (<optgroup key={cat} label={{ desktop: 'Desktops', security: 'Security', dev: 'Development', bigdata: 'Professional Labs', app: 'Applications' }[cat]}>
                      {catImages.map(img => <option key={img.key} value={img.key}>{img.label}</option>)}
                    </optgroup>);
                  })}
                </select>
              </div>
              <button onClick={handleDeploy} disabled={deploying || sub.activeContainers >= sub.maxContainers}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2">
                <FaRocket className="w-3 h-3" /> {deploying ? 'Deploying...' : 'Deploy'}
              </button>
            </div>
            {/* Deploy progress — real-time from backend job tracker */}
            {deployProgress && (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-blue-800">
                    {deployProgress.label || 'Deploying workspace...'}
                  </span>
                  <span className="text-[11px] text-blue-600 tabular-nums">
                    {deployProgress.progress}% &middot; {deployProgress.elapsedSeconds || 0}s
                  </span>
                </div>
                <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${deployProgress.progress || 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-blue-600">
                  {deployProgress.phase === 'pulling_image'
                    ? 'First-time image download — usually 30s-2min. Subsequent deploys are instant.'
                    : 'Cached images deploy in 2-3 seconds.'}
                </p>
              </div>
            )}
          </div>

          {/* Instance list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <div className="px-5 py-3.5 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-800">My Workspaces ({instances.length})</h3>
            </div>
            {instances.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <FaDocker className="mx-auto text-3xl text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">No workspaces yet. Deploy one above.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {instances.map(inst => <InstanceRow key={inst._id} inst={inst} onAction={handleAction} onFeedback={() => {
                  const trainingName = inst.name || inst.os || 'Lab';
                  const email = data?.user?.email || '';
                  if (submittedFeedback[trainingName]) return;
                  setFeedbackModal({ trainingName, email, organization: data?.user?.organization });
                }} feedbackSubmitted={!!submittedFeedback[inst.name || inst.os || 'Lab']} />)}
              </div>
            )}
          </div>
        </>
      )}

      {/* Sandboxes tab */}
      {tab === 'sandboxes' && sub?.status === 'active' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Create Cloud Sandbox</h3>
            <div className="flex items-end gap-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Cloud</label>
                <div className="flex gap-1.5">
                  {[
                    { key: 'azure', label: 'Azure', color: 'blue', remaining: sub.sandboxCredits?.azure?.remaining },
                    { key: 'aws', label: 'AWS', color: 'amber', remaining: sub.sandboxCredits?.aws?.remaining },
                    { key: 'gcp', label: 'GCP', color: 'red', remaining: sub.sandboxCredits?.gcp?.remaining },
                  ].map(c => (
                    <button key={c.key} onClick={() => setSandboxCloud(c.key)} disabled={!c.remaining || c.remaining <= 0}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-30 ${
                        sandboxCloud === c.key ? `bg-${c.color}-50 border-${c.color}-300 text-${c.color}-700` : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {c.label} ({c.remaining || 0})
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Sandbox Name</label>
                <input value={sandboxName} onChange={e => setSandboxName(e.target.value)} placeholder="my-sandbox" maxLength={10}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <button onClick={handleSandbox} disabled={creatingSandbox || !sandboxName || (sandboxCloud === 'gcp' && !sandboxGoogleEmail)}
                className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2">
                <FaCloud className="w-3 h-3" /> {creatingSandbox ? 'Creating...' : 'Create'}
              </button>
            </div>
            {sandboxCloud === 'gcp' && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <label className="text-[11px] font-semibold text-red-700 uppercase tracking-wider block mb-1">Google Email (required)</label>
                <input
                  type="email"
                  value={sandboxGoogleEmail}
                  onChange={e => setSandboxGoogleEmail(e.target.value)}
                  placeholder="your.name@gmail.com"
                  className="w-full max-w-sm px-3 py-2 text-sm border border-red-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
                <p className="text-[11px] text-red-600 mt-1">GCP Console uses Google accounts. Enter your Gmail or Google Workspace email — you'll sign in with your Google password.</p>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Sandbox auto-expires in {sub.sandboxTtlHours || 2} hours. Small instances only.
            </p>
          </div>

          {/* Sandbox creation result with full details */}
          {sandboxResult && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FaClock className="text-amber-600 w-3.5 h-3.5" />
                  <span className="text-sm font-semibold text-amber-800">{sandboxResult.access?.status || 'Sandbox Provisioning...'}</span>
                </div>
                <button onClick={() => setSandboxResult(null)} className="text-amber-400 hover:text-amber-600 text-xs">Dismiss</button>
              </div>

              <div className="p-5 space-y-4">
                {/* Access + Credentials row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">🔗 Access</div>
                    <div className="space-y-1.5 text-xs">
                      <div><span className="text-gray-400 w-16 inline-block">Name:</span> <span className="font-mono font-medium text-gray-800">{sandboxResult.name}</span></div>
                      <div><span className="text-gray-400 w-16 inline-block">URL:</span> <a href={sandboxResult.access?.accessUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{sandboxResult.access?.accessUrl}</a></div>
                      <div><span className="text-gray-400 w-16 inline-block">Region:</span> <span className="font-medium">{sandboxResult.access?.region}</span></div>
                      <div><span className="text-gray-400 w-16 inline-block">TTL:</span> <span className="font-medium">{sandboxResult.ttl} hours</span></div>
                      {/* Budget line hidden from student view */}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">🔑 Login Credentials</div>
                    <CredentialDisplay
                      username={sandboxResult.access?.credentials?.username}
                      password={sandboxResult.access?.credentials?.password}
                    />
                    <div className="text-gray-400 text-xs mt-2">{sandboxResult.remaining} credits remaining</div>
                  </div>
                </div>

                {/* Allowed / Blocked */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="text-[10px] font-semibold text-green-700 uppercase mb-2">✅ What You Can Use</div>
                    <div className="space-y-2 text-xs text-gray-700">
                      {sandboxResult.access?.allowed?.vmSizes && (
                        <div><span className="font-semibold text-green-700">VM Sizes:</span><div className="mt-0.5 text-gray-600">{sandboxResult.access.allowed.vmSizes.join(', ')}</div></div>
                      )}
                      {sandboxResult.access?.allowed?.storage && (
                        <div><span className="font-semibold text-green-700">Storage:</span> {sandboxResult.access.allowed.storage.join(', ')}</div>
                      )}
                      {sandboxResult.access?.allowed?.services && (
                        <div><span className="font-semibold text-green-700">Services:</span><div className="mt-0.5 text-gray-600">{sandboxResult.access.allowed.services.join(', ')}</div></div>
                      )}
                    </div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-[10px] font-semibold text-red-700 uppercase mb-2">🚫 Not Available</div>
                    <div className="space-y-2 text-xs text-gray-700">
                      {sandboxResult.access?.blocked?.vmSizes && (
                        <div><span className="font-semibold text-red-600">Blocked VMs:</span> {sandboxResult.access.blocked.vmSizes.join(', ')}</div>
                      )}
                      {sandboxResult.access?.blocked?.storage && (
                        <div><span className="font-semibold text-red-600">Blocked Storage:</span> {sandboxResult.access.blocked.storage.join(', ')}</div>
                      )}
                      {sandboxResult.access?.blocked?.services && (
                        <div><span className="font-semibold text-red-600">Blocked Services:</span> {sandboxResult.access.blocked.services.join(', ')}</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sandbox info cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <FaCloud className="text-blue-600" />
                <span className="text-sm font-semibold text-blue-800">Azure Sandbox</span>
              </div>
              <p className="text-xs text-blue-700">Get your own Azure resource group. Deploy VMs, storage, networking. Full Azure portal access.</p>
              <div className="mt-2 text-xs text-blue-600 font-medium">
                {sub.sandboxCredits?.azure?.remaining || 0} credits remaining
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <FaAws className="text-amber-700" />
                <span className="text-sm font-semibold text-amber-800">AWS Sandbox</span>
              </div>
              <p className="text-xs text-amber-700">Get your own AWS IAM user. Launch EC2, S3, Lambda. Full AWS console access.</p>
              <div className="mt-2 text-xs text-amber-600 font-medium">
                {sub.sandboxCredits?.aws?.remaining || 0} credits remaining
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <FaCloud className="text-red-500" />
                <span className="text-sm font-semibold text-red-800">GCP Sandbox</span>
              </div>
              <p className="text-xs text-red-700">Get your own GCP project. Deploy Compute Engine, Cloud Storage, BigQuery.</p>
              <div className="mt-2 text-xs text-red-600 font-medium">
                {sub.sandboxCredits?.gcp?.remaining || 0} credits remaining
              </div>
            </div>
          </div>
          {/* Active sandboxes with access details */}
          {sandboxes.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3.5 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-800">Active Sandboxes ({sandboxes.length})</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {sandboxes.map((sb, i) => (
                  <SandboxCard key={i} sb={sb} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Guided Labs tab */}
      {tab === 'labs' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Guided Labs</h3>
            <p className="text-xs text-gray-500">Step-by-step hands-on labs. Each lab provisions a sandbox or workspace automatically.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {guidedLabs.map(lab => (
              <a key={lab.slug} href={`/lab/${lab.slug}`}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all group" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{lab.icon || '📚'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700">{lab.title}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        lab.difficulty === 'beginner' ? 'bg-green-50 text-green-700' :
                        lab.difficulty === 'intermediate' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>{lab.difficulty}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{lab.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><FaClock className="w-2.5 h-2.5" />{lab.duration} min</span>
                      <span className={`px-1.5 py-0.5 rounded-full font-semibold ${
                        lab.cloud === 'azure' ? 'bg-blue-50 text-blue-600' :
                        lab.cloud === 'aws' ? 'bg-amber-50 text-amber-600' :
                        lab.cloud === 'gcp' ? 'bg-red-50 text-red-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>{lab.cloud}</span>
                      <span>{lab.category}</span>
                      {lab.minTier !== 'free' && <span className="flex items-center gap-0.5"><FaLock className="w-2 h-2" />{lab.minTier}+</span>}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {guidedLabs.length === 0 && (
            <div className="text-center py-10 text-sm text-gray-400">No guided labs available yet.</div>
          )}
        </div>
      )}

      {/* Feedback Modal */}
      {feedbackModal && (
        <FeedbackModal
          trainingName={feedbackModal.trainingName}
          email={feedbackModal.email}
          organization={feedbackModal.organization}
          onClose={() => setFeedbackModal(null)}
          onSuccess={(name) => {
            setSubmittedFeedback(prev => ({ ...prev, [name]: true }));
            setFeedbackModal(null);
            setSuccess('Thank you for your feedback!');
          }}
        />
      )}
    </div>
  );
}

function FeedbackModal({ trainingName, email, organization, onClose, onSuccess }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [difficulty, setDifficulty] = useState('');
  const [contentQuality, setContentQuality] = useState(0);
  const [hoverContent, setHoverContent] = useState(0);
  const [labEnvironment, setLabEnvironment] = useState(0);
  const [hoverEnv, setHoverEnv] = useState(0);
  const [wouldRecommend, setWouldRecommend] = useState(null);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!rating) { setError('Please select a rating'); return; }
    setSubmitting(true); setError(null);
    try {
      await apiCaller.post('/selfservice/feedback', {
        email, trainingName, organization, rating, difficulty: difficulty || undefined,
        contentQuality: contentQuality || undefined,
        labEnvironment: labEnvironment || undefined,
        wouldRecommend, comments: comments.trim() || undefined,
      });
      onSuccess(trainingName);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit feedback');
    } finally { setSubmitting(false); }
  };

  const StarRow = ({ value, hoverValue, onSet, onHover, onLeave, label }) => (
    <div>
      <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">{label}</label>
      <div className="flex gap-1" onMouseLeave={onLeave}>
        {[1,2,3,4,5].map(i => (
          <button key={i} type="button" onClick={() => onSet(i)} onMouseEnter={() => onHover(i)}
            className="text-lg focus:outline-none transition-colors">
            {i <= (hoverValue || value) ? <FaStar className="text-amber-400" /> : <FaRegStar className="text-gray-300" />}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md mx-4 overflow-hidden" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Rate this Lab</h3>
          <p className="text-xs text-gray-500 mt-0.5">{trainingName}</p>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

          <StarRow label="Overall Rating *" value={rating} hoverValue={hoverRating}
            onSet={setRating} onHover={setHoverRating} onLeave={() => setHoverRating(0)} />

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Difficulty Level</label>
            <div className="flex gap-2">
              {[
                { key: 'too_easy', label: 'Too Easy' },
                { key: 'just_right', label: 'Just Right' },
                { key: 'too_hard', label: 'Too Hard' },
              ].map(opt => (
                <button key={opt.key} type="button" onClick={() => setDifficulty(opt.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    difficulty === opt.key ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>{opt.label}</button>
              ))}
            </div>
          </div>

          <StarRow label="Content Quality" value={contentQuality} hoverValue={hoverContent}
            onSet={setContentQuality} onHover={setHoverContent} onLeave={() => setHoverContent(0)} />

          <StarRow label="Lab Environment" value={labEnvironment} hoverValue={hoverEnv}
            onSet={setLabEnvironment} onHover={setHoverEnv} onLeave={() => setHoverEnv(0)} />

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Would you recommend this lab?</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setWouldRecommend(true)}
                className={`px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  wouldRecommend === true ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>Yes</button>
              <button type="button" onClick={() => setWouldRecommend(false)}
                className={`px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  wouldRecommend === false ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>No</button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Comments</label>
            <textarea value={comments} onChange={e => setComments(e.target.value)} maxLength={1000} rows={3}
              placeholder="Share your experience..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none" />
            <div className="text-right text-[10px] text-gray-400">{comments.length}/1000</div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting || !rating}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SandboxCard({ sb }) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
            sb.cloud === 'azure' ? 'bg-blue-100 text-blue-700' : sb.cloud === 'aws' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
          }`}>{sb.cloud}</span>
          <span className="text-sm font-medium text-gray-800">{sb.name}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
            sb.status === 'expired' ? 'bg-red-50 text-red-700' : sb.status === 'ready' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>{sb.status}</span>
        </div>
        {sb.status === 'expired' ? (
          <span className="text-xs text-red-500 font-medium">Expired — resources being cleaned up</span>
        ) : sb.ttl && (
          <span className={`text-xs ${sb.ttl.minutes <= 30 ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>{sb.ttl.display} left</span>
        )}
      </div>

      {sb.status === 'ready' && (
        <div className="space-y-3">
          {/* Row 1: Access + Credentials */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">🔗 Access Details</div>
              <div className="space-y-1.5 text-xs">
                <div><span className="text-gray-400 w-20 inline-block">Login URL:</span> <a href={sb.loginUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{sb.loginUrl}</a></div>
                {sb.cloud === 'azure' && sb.resourceGroup && <div><span className="text-gray-400 w-20 inline-block">Resource Group:</span> <span className="font-mono font-medium text-gray-800">{sb.resourceGroup}</span></div>}
                {sb.cloud === 'azure' && sb.resourceUrl && <div><span className="text-gray-400 w-20 inline-block">Direct Link:</span> <a href={sb.resourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[11px]">Open in Azure Portal →</a></div>}
                {sb.cloud === 'aws' && sb.accountId && <div><span className="text-gray-400 w-20 inline-block">Account ID:</span> <span className="font-mono font-medium text-gray-800">{sb.accountId}</span></div>}
                {sb.cloud === 'gcp' && sb.projectId && <div><span className="text-gray-400 w-20 inline-block">Project ID:</span> <span className="font-mono font-medium text-gray-800">{sb.projectId}</span></div>}
                {sb.cloud === 'gcp' && sb.projectUrl && <div><span className="text-gray-400 w-20 inline-block">Direct Link:</span> <a href={sb.projectUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[11px]">Open in GCP Console →</a></div>}
                <div><span className="text-gray-400 w-20 inline-block">Region:</span> <span className="font-medium text-gray-700">{sb.region}</span></div>
                {/* Budget alert line hidden from student view */}
                <div><span className="text-gray-400 w-20 inline-block">Expires:</span> <span className="font-medium">{sb.ttl?.display || '-'}</span></div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-gray-500 uppercase mb-2">🔑 Login Credentials</div>
              <CredentialDisplay username={sb.credentials?.username} password={sb.credentials?.password} />
              {sb.cloud === 'azure' && <p className="text-[10px] text-gray-400 mt-2">Use these credentials at portal.azure.com</p>}
              {sb.cloud === 'aws' && <p className="text-[10px] text-gray-400 mt-2">Use Account ID: {sb.accountId} at AWS sign-in page</p>}
              {sb.cloud === 'gcp' && <p className="text-[10px] text-gray-400 mt-2">Sign in with your Google account at console.cloud.google.com</p>}
            </div>
          </div>

          {/* Row 2: Allowed + Blocked */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-green-700 uppercase mb-1.5">✅ Allowed Resources</div>
              <div className="space-y-1 text-xs text-gray-700">
                {sb.allowed?.vmSizes && <div><span className="text-green-600 font-medium">VMs:</span> {sb.allowed.vmSizes.join(', ')}</div>}
                {sb.allowed?.storage && <div><span className="text-green-600 font-medium">Storage:</span> {sb.allowed.storage.join(', ')}</div>}
                {sb.allowed?.services && <div><span className="text-green-600 font-medium">Services:</span> {sb.allowed.services.join(', ')}</div>}
              </div>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-red-700 uppercase mb-1.5">🚫 Blocked Resources</div>
              <div className="space-y-1 text-xs text-gray-700">
                {sb.blocked?.vmSizes && <div><span className="text-red-600 font-medium">VMs:</span> {sb.blocked.vmSizes.join(', ')}</div>}
                {sb.blocked?.storage && <div><span className="text-red-600 font-medium">Storage:</span> {sb.blocked.storage.join(', ')}</div>}
                {sb.blocked?.services && <div><span className="text-red-600 font-medium">Services:</span> {sb.blocked.services.join(', ')}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {sb.status === 'provisioning' && (
        <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">Provisioning in progress... Access details will appear here when ready (refresh in 1-2 minutes).</div>
      )}
    </div>
  );
}

function CredentialDisplay({ username, password }) {
  const [showPass, setShowPass] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  const copy = (text, field) => { navigator.clipboard.writeText(text || ''); setCopiedField(field); setTimeout(() => setCopiedField(null), 1500); };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-gray-400 w-16 flex-shrink-0">Username:</span>
        <span className="font-mono font-medium text-gray-800 break-all">{username || '-'}</span>
        {username && (
          <button onClick={() => copy(username, 'user')} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            {copiedField === 'user' ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400 w-16 flex-shrink-0">Password:</span>
        <span className="font-mono font-medium text-gray-800">{showPass ? (password || '-') : '••••••••••'}</span>
        <button onClick={() => setShowPass(!showPass)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
          {showPass ? <FaEyeSlash className="w-2.5 h-2.5" /> : <FaEye className="w-2.5 h-2.5" />}
        </button>
        {password && (
          <button onClick={() => copy(password, 'pass')} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            {copiedField === 'pass' ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function QuotaCard({ label, used = 0, total = 0, unit = '' }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-[11px] text-gray-500 uppercase font-semibold">{label}</div>
      <div className="text-xl font-bold text-gray-900">{Math.round(used)}<span className="text-sm text-gray-400 font-normal">/{total} {unit}</span></div>
      <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InstanceRow({ inst, onAction, onFeedback, feedbackSubmitted }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(inst.password); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="px-5 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${inst.isRunning ? 'bg-green-500' : 'bg-gray-300'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800">{inst.name}</div>
          <div className="text-xs text-gray-500">
            {inst.os} &middot; {inst.cpus} CPU / {inst.memory >= 1024 ? `${inst.memory / 1024} GB` : `${inst.memory} MB`} &middot; {inst.runtimeHours}h used
          </div>
          {inst.expiresAt && (
            <LabTimer
              expiresAt={inst.expiresAt}
              quotaTotal={inst.quota?.total}
              quotaConsumed={inst.quota?.consumed}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {inst.isRunning && (
          <>
            <a href={inst.accessUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[11px] font-semibold rounded-md hover:bg-blue-700 transition-colors">
              <FaExternalLinkAlt className="w-2.5 h-2.5" /> Open
            </a>
            <button onClick={copy} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100" title="Copy password">
              {copied ? <FaCheck className="w-3 h-3 text-green-500" /> : <FaCopy className="w-3 h-3" />}
            </button>
          </>
        )}
        {inst.isRunning ? (
          <button onClick={() => onAction('stop', inst.containerId)} className="p-1.5 text-red-400 hover:text-red-600 rounded-md hover:bg-red-50"><FaPowerOff className="w-3 h-3" /></button>
        ) : (
          <button onClick={() => onAction('start', inst.containerId)} className="p-1.5 text-green-500 hover:text-green-700 rounded-md hover:bg-green-50"><FaPlay className="w-3 h-3" /></button>
        )}
        <button onClick={() => onAction('delete', inst.containerId)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50"><FaTrash className="w-3 h-3" /></button>
        {onFeedback && (
          <button onClick={onFeedback} disabled={feedbackSubmitted}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
              feedbackSubmitted ? 'bg-green-50 border-green-200 text-green-600 cursor-default' : 'bg-white border-gray-200 text-gray-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700'
            }`}
            title={feedbackSubmitted ? 'Feedback submitted' : 'Rate this Lab'}>
            {feedbackSubmitted ? <FaCheck className="w-2.5 h-2.5" /> : <FaStar className="w-2.5 h-2.5" />}
            {feedbackSubmitted ? 'Rated' : 'Rate'}
          </button>
        )}
      </div>
    </div>
  );
}

function LabTimer({ expiresAt, quotaTotal, quotaConsumed }) {
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const exp = new Date(expiresAt).getTime();
  const diff = Math.max(0, exp - now);
  const expired = diff <= 0;

  // Countdown breakdown
  const totalSecs = Math.floor(diff / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, '0');

  // Color tiers based on fraction of time remaining
  // We use quota total (hours) to determine the original duration for percentage calc
  const totalAllocatedMs = quotaTotal ? quotaTotal * 3600 * 1000 : null;
  const fractionLeft = totalAllocatedMs ? diff / totalAllocatedMs : (diff > 0 ? 1 : 0);

  const isExpiringSoon = hours < 2 && !expired;
  const isPulsingRed = hours < 1 && !expired;

  // Color classes
  let timerColor = 'text-green-600';
  let barColor = 'bg-green-500';
  if (expired) {
    timerColor = 'text-red-600';
    barColor = 'bg-red-500';
  } else if (fractionLeft <= 0.25) {
    timerColor = 'text-red-600';
    barColor = 'bg-red-500';
  } else if (fractionLeft <= 0.5) {
    timerColor = 'text-amber-600';
    barColor = 'bg-amber-500';
  }

  // Quota progress bar: consumed / total hours
  const quotaPct = quotaTotal > 0 ? Math.min(100, ((quotaConsumed || 0) / quotaTotal) * 100) : 0;
  const quotaBarColor = quotaPct > 90 ? 'bg-red-500' : quotaPct > 60 ? 'bg-amber-500' : 'bg-blue-500';

  if (expired) {
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-1.5">
          <FaClock className="w-2.5 h-2.5 text-red-500" />
          <span className="text-[11px] font-semibold text-red-600">Lab expired -- save your work</span>
        </div>
        {quotaTotal > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden max-w-[120px]">
              <div className={`h-full rounded-full ${quotaBarColor}`} style={{ width: `${quotaPct}%` }} />
            </div>
            <span className="text-[10px] text-gray-400">{Math.round(quotaConsumed || 0)}/{quotaTotal}h used</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <FaClock className={`w-2.5 h-2.5 ${timerColor}`} />
          <span className={`text-[11px] font-mono font-semibold tabular-nums ${timerColor} ${isPulsingRed ? 'animate-pulse' : ''}`}>
            {pad(hours)}:{pad(minutes)}:{pad(seconds)}
          </span>
        </div>
        {isExpiringSoon && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
            Expiring Soon
          </span>
        )}
      </div>
      {quotaTotal > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden max-w-[120px]">
            <div className={`h-full rounded-full ${quotaBarColor}`} style={{ width: `${quotaPct}%` }} />
          </div>
          <span className="text-[10px] text-gray-400">{Math.round(quotaConsumed || 0)}/{quotaTotal}h used</span>
        </div>
      )}
    </div>
  );
}
