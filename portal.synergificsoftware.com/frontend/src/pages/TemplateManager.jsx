import React, { useState, useEffect, useRef } from 'react';
import apiCaller from '../services/apiCaller';
import { containerApiRoutes } from '../services/apiRoutes';
import { FaDocker, FaTrash, FaCopy, FaPlus, FaDownload, FaSpinner, FaCheck, FaExclamationTriangle } from 'react-icons/fa';

// Phase text + estimated % for an in-flight container capture (1-5 min op).
// We don't get mid-state info from the docker capture pipeline, so this is
// time-based — same approach as the cluster pages.
function captureProgress(startedAt) {
  if (!startedAt) return null;
  const sec = (Date.now() - startedAt) / 1000;
  const ESTIMATED = 120; // 2 min average for capture
  let label = 'Inspecting source container...';
  if (sec > 90) label = 'Finalizing template registration...';
  else if (sec > 45) label = 'Pushing image to registry...';
  else if (sec > 15) label = 'Committing container as image...';
  return { sec, pct: Math.min(95, Math.round((sec / ESTIMATED) * 100)), label };
}

export default function TemplateManager() {
  const [builtInImages, setBuiltInImages] = useState([]);
  const [customImages, setCustomImages] = useState([]);
  const [containers, setContainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  // Clone from container state
  const [cloneTraining, setCloneTraining] = useState('');
  const [cloneContainerId, setCloneContainerId] = useState('');
  const [cloneTemplateName, setCloneTemplateName] = useState('');
  const [cloning, setCloning] = useState(false);

  // Add custom template state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newImage, setNewImage] = useState('');
  const [newPort, setNewPort] = useState(8080);
  const [newProtocol, setNewProtocol] = useState('http');
  const [newCategory, setNewCategory] = useState('dev');
  const [newOs, setNewOs] = useState('Linux');
  const [newUser, setNewUser] = useState('');
  const [newEnvVars, setNewEnvVars] = useState('PASSWORD=password');
  const [newScreenshotUrl, setNewScreenshotUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [builtIn, custom] = await Promise.all([
        apiCaller.get(containerApiRoutes.containerImages).catch(() => ({ data: [] })),
        apiCaller.get('/custom-images').catch(() => ({ data: [] })),
      ]);
      setBuiltInImages(builtIn.data || []);
      setCustomImages(custom.data || []);
    } catch {}
    setLoading(false);
  };

  const fetchContainers = async () => {
    if (!cloneTraining.trim()) return;
    try {
      const res = await apiCaller.get(containerApiRoutes.containers, { params: { trainingName: cloneTraining.trim() } });
      setContainers(res.data?.filter(c => c.isAlive) || []);
    } catch { setContainers([]); }
  };

  // Capture progress — startedAt drives phase + % display
  const [cloneStartedAt, setCloneStartedAt] = useState(null);
  // Tick every 1s so the progress card updates without changing other state
  const [, setTick] = useState(0);
  const tickRef = useRef(null);
  useEffect(() => {
    if (cloning) {
      tickRef.current = setInterval(() => setTick(t => t + 1), 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null;
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [cloning]);

  const handleClone = async () => {
    if (!cloneContainerId || !cloneTemplateName.trim()) return;
    setCloning(true);
    setCloneStartedAt(Date.now());
    setError(null);
    setMsg(null);
    try {
      const res = await apiCaller.post('/containers/capture', {
        containerId: cloneContainerId,
        templateName: cloneTemplateName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        templateLabel: cloneTemplateName.trim(),
      });
      setMsg(res.data.message || 'Template created');
      setCloneContainerId('');
      setCloneTemplateName('');
      setContainers([]);
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Clone failed');
    } finally {
      setCloning(false);
      setCloneStartedAt(null);
    }
  };

  const handleAddCustom = async () => {
    if (!newName.trim() || !newImage.trim()) return;
    setAdding(true);
    setError(null);
    setMsg(null);
    try {
      const envVars = newEnvVars.split('\n').filter(Boolean).map(line => {
        const [key, ...rest] = line.split('=');
        return { key: key.trim(), value: rest.join('=').trim() };
      });
      const res = await apiCaller.post('/custom-images', {
        name: newName.trim(),
        image: newImage.trim(),
        port: newPort,
        protocol: newProtocol,
        category: newCategory,
        os: newOs,
        defaultUser: newUser || undefined,
        envVars,
        isPublic: true,
        screenshotUrl: newScreenshotUrl.trim() || undefined,
        description: newDescription.trim() || undefined,
      });
      setMsg(res.data.message || 'Template added');
      setShowAdd(false);
      setNewName(''); setNewImage(''); setNewPort(8080); setNewUser(''); setNewEnvVars('PASSWORD=password');
      setNewScreenshotUrl(''); setNewDescription('');
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add template');
    } finally {
      setAdding(false);
    }
  };

  const handlePull = async (key) => {
    setMsg(null);
    try {
      const res = await apiCaller.post('/custom-images/pull', { key });
      setMsg(res.data.message || 'Pull started');
    } catch (err) {
      setError(err.response?.data?.message || 'Pull failed');
    }
  };

  const handleDelete = async (key, name) => {
    if (!window.confirm(`Delete template "${name}"? This only removes the template entry — existing containers using this image are not affected.`)) return;
    setError(null);
    try {
      await apiCaller.delete('/custom-images', { data: { key } });
      setMsg(`Template "${name}" deleted`);
      fetchAll();
    } catch (err) {
      setError(err.response?.data?.message || 'Delete failed');
    }
  };

  const categories = { desktop: 'Desktop', dev: 'Development', bigdata: 'Professional Labs', security: 'Cybersecurity', custom: 'Custom' };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FaDocker className="text-blue-500" /> Workspace Templates
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage container images available for deployment</p>
        </div>
      </div>

      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2"><FaCheck className="w-3 h-3" /> {msg}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2"><FaExclamationTriangle className="w-3 h-3" /> {error}</div>}

      {/* Clone from existing container */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <FaCopy className="text-purple-500 w-3.5 h-3.5" /> Clone Template from Running Container
        </h3>
        <p className="text-xs text-gray-500">Capture a configured container as a new reusable template. The container's current state (installed tools, settings, files) becomes the template.</p>

        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Training Name</label>
            <div className="flex gap-2">
              <input value={cloneTraining} onChange={e => setCloneTraining(e.target.value)} placeholder="e.g. claudesbx"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-48" />
              <button onClick={fetchContainers} className="px-3 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                Load
              </button>
            </div>
          </div>

          {containers.length > 0 && (
            <>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Source Container</label>
                <select value={cloneContainerId} onChange={e => setCloneContainerId(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-56">
                  <option value="">Select container...</option>
                  {containers.map(c => (
                    <option key={c.containerId} value={c.containerId}>{c.name} ({c.isRunning ? 'Running' : 'Stopped'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Template Name</label>
                <input value={cloneTemplateName} onChange={e => setCloneTemplateName(e.target.value)} placeholder="e.g. Claude Code Thinknyx"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-56" />
              </div>
              <button onClick={handleClone} disabled={cloning || !cloneContainerId || !cloneTemplateName.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {cloning ? <FaSpinner className="animate-spin" /> : <FaCopy className="w-3 h-3" />}
                {cloning ? 'Cloning...' : 'Clone as Template'}
              </button>
            </>
          )}
        </div>

        {/* Live capture progress (shows while clone is in flight) */}
        {cloning && (() => {
          const p = captureProgress(cloneStartedAt);
          return (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-purple-800">{p.label}</span>
                <span className="text-xs text-purple-600 tabular-nums">{p.pct}% &middot; {Math.floor(p.sec)}s elapsed</span>
              </div>
              <div className="w-full bg-purple-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-1.5 rounded-full bg-purple-500 transition-all duration-500" style={{ width: `${p.pct}%` }} />
              </div>
              <p className="text-[11px] text-purple-600 mt-1.5">First-time capture takes 1-3 minutes — image push to registry can take longer for big templates.</p>
            </div>
          );
        })()}
      </div>

      {/* Add custom template */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <FaPlus className="text-green-500 w-3.5 h-3.5" /> Add Custom Template
          </h3>
          <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-blue-600 hover:underline">
            {showAdd ? 'Cancel' : 'Add New'}
          </button>
        </div>

        {showAdd && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Template Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Python Data Science Lab"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Docker Image</label>
                <input value={newImage} onChange={e => setNewImage(e.target.value)} placeholder="e.g. jupyter/scipy-notebook:latest"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Category</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Port</label>
                  <input type="number" value={newPort} onChange={e => setNewPort(+e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Protocol</label>
                  <select value={newProtocol} onChange={e => setNewProtocol(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">OS Label</label>
                <input value={newOs} onChange={e => setNewOs(e.target.value)} placeholder="Linux"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Default User (optional)</label>
                <input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="e.g. coder, lab, root"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Environment Variables (KEY=VALUE, one per line)</label>
              <textarea value={newEnvVars} onChange={e => setNewEnvVars(e.target.value)} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono"
                placeholder="PASSWORD=password&#10;JUPYTER_TOKEN=test123" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Screenshot URL (optional)</label>
                <input value={newScreenshotUrl} onChange={e => setNewScreenshotUrl(e.target.value)} placeholder="https://example.com/preview.png"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                <p className="text-[10px] text-gray-400 mt-1">Shown as a thumbnail on the template card.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">Description (optional)</label>
                <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Short summary of what the template provides"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>
            <button onClick={handleAddCustom} disabled={adding || !newName.trim() || !newImage.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
              {adding ? <FaSpinner className="animate-spin" /> : <FaPlus className="w-3 h-3" />}
              {adding ? 'Adding...' : 'Add Template'}
            </button>
          </div>
        )}
      </div>

      {/* Built-in templates */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">Built-in Templates ({builtInImages.length})</h3>
        </div>
        {loading ? (
          <div className="p-10 text-center"><FaSpinner className="animate-spin inline text-gray-400" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Image</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">OS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {builtInImages.map(img => (
                  <tr key={img.key} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{img.label}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{img.image}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700">{img.category}</span></td>
                    <td className="px-4 py-2.5 text-gray-600">{img.os}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custom templates */}
      {customImages.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3.5 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-800">Custom Templates ({customImages.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-16">Preview</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Image</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customImages.map(img => (
                  <tr key={img.key} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5">
                      {img.screenshotUrl ? (
                        <img src={img.screenshotUrl} alt="" loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          className="w-12 h-9 object-cover rounded border border-gray-200" />
                      ) : (
                        <div className="w-12 h-9 rounded border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[9px] text-gray-300">no img</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-800">{img.name}</div>
                      {img.description && <div className="text-[11px] text-gray-500 truncate max-w-[260px]" title={img.description}>{img.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{img.image}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">{img.category}</span></td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${img.isPulled ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                        {img.isPulled ? 'Ready' : 'Not Pulled'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {!img.isPulled && (
                          <button onClick={() => handlePull(img.key)} title="Pull image"
                            className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md transition-colors">
                            <FaDownload className="w-3 h-3" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(img.key, img.name)} title="Delete template"
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                          <FaTrash className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
