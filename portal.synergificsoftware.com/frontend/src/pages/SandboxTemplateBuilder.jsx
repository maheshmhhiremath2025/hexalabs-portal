import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaUpload, FaFilePdf, FaTimes, FaSpinner, FaCheckCircle, FaExclamationTriangle,
  FaArrowRight, FaSave, FaCloud, FaCogs, FaShieldAlt, FaTrash, FaRocket,
  FaMagic, FaEye, FaServer, FaToggleOn, FaToggleOff, FaPlus, FaExternalLinkAlt,
} from 'react-icons/fa';

// ─── Main Page ──────────────────────────────────────────────────────────

export default function SandboxTemplateBuilder() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('upload'); // upload | analyzing | review | creating | done
  const [file, setFile] = useState(null);
  const [providerHint, setProviderHint] = useState('aws');
  const [ttlHours, setTtlHours] = useState(4);
  const [error, setError] = useState('');

  // Analysis result from B2B endpoint
  const [analysisId, setAnalysisId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [feasibility, setFeasibility] = useState(null);
  const [meta, setMeta] = useState(null);

  // Editable services/sizes state (derived from analysis)
  const [enabledServices, setEnabledServices] = useState({});
  const [instanceTypes, setInstanceTypes] = useState({ aws: [], azure: [], gcp: [] });
  const [customService, setCustomService] = useState('');

  // Created template
  const [template, setTemplate] = useState(null);

  const fileRef = useRef();

  // ─── Upload + Analyze ─────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!file) return;
    setError('');
    setStage('analyzing');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('providerHint', providerHint);
      formData.append('requestedTtlHours', ttlHours);
      formData.append('forceType', 'cloud_sandbox');

      const res = await apiCaller.post('/b2b/courses/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const { id, analysis: a, feasibility: f, meta: m } = res.data;
      setAnalysisId(id);
      setAnalysis(a);
      setFeasibility(f);
      setMeta(m);

      // Build editable service toggle map from modules
      const svcMap = {};
      for (const mod of a.modules || []) {
        for (const svc of mod.services || []) {
          const key = (svc.name || '').toLowerCase().trim();
          if (key && !svcMap[key]) {
            svcMap[key] = { enabled: true, usage: svc.usage || '', module: mod.name };
          }
        }
      }
      setEnabledServices(svcMap);

      // Default instance types
      setInstanceTypes({
        aws: ['t3.micro', 't3.small', 't3.medium', 't3.large'],
        azure: ['Standard_B1s', 'Standard_B2s', 'Standard_D2s_v3'],
        gcp: ['e2-micro', 'e2-small', 'e2-medium'],
      });

      setStage('review');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setStage('upload');
    }
  };

  // ─── Create Template ──────────────────────────────────────────────────

  const handleCreateTemplate = async () => {
    if (!analysisId) return;
    setError('');
    setStage('creating');

    try {
      // First, if user toggled services, send an override
      const enabledList = Object.entries(enabledServices).filter(([, v]) => v.enabled).map(([k]) => k);
      const disabledList = Object.entries(enabledServices).filter(([, v]) => !v.enabled).map(([k]) => k);

      if (disabledList.length > 0) {
        // Override the analysis to remove disabled services from modules
        const overrideAnalysis = {
          ...analysis,
          modules: (analysis.modules || []).map(mod => ({
            ...mod,
            services: (mod.services || []).filter(s =>
              enabledList.includes((s.name || '').toLowerCase().trim())
            ),
          })),
        };
        await apiCaller.patch(`/b2b/courses/${analysisId}/override`, {
          analysis: overrideAnalysis,
          recompute: true,
        });
      }

      // Generate template
      const res = await apiCaller.post(`/b2b/courses/${analysisId}/generate-template`);
      setTemplate(res.data.template || res.data);
      setStage('done');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setStage('review');
    }
  };

  // ─── Delete Template ──────────────────────────────────────────────────

  const handleDeleteTemplate = async () => {
    if (!template?.slug) return;
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;

    try {
      await apiCaller.delete(`/sandbox-templates/${template.slug}`);
      // Also delete the analysis record
      if (analysisId) {
        await apiCaller.delete(`/b2b/courses/${analysisId}`).catch(() => {});
      }
      setTemplate(null);
      setStage('upload');
      setFile(null);
      setAnalysis(null);
      setAnalysisId(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  // ─── Toggle service ───────────────────────────────────────────────────

  const toggleService = (svcName) => {
    setEnabledServices(prev => ({
      ...prev,
      [svcName]: { ...prev[svcName], enabled: !prev[svcName].enabled },
    }));
  };

  const addCustomService = () => {
    const key = customService.toLowerCase().trim();
    if (!key || enabledServices[key]) return;
    setEnabledServices(prev => ({
      ...prev,
      [key]: { enabled: true, usage: 'Manually added', module: 'Custom' },
    }));
    setCustomService('');
  };

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FaMagic className="text-blue-600" /> AI Sandbox Template Builder
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Upload a course TOC — AI detects required AWS services, instance sizes, and generates IAM policies automatically
          </p>
        </div>
      </div>

      {/* Stage indicator */}
      <div className="flex items-center gap-1 mb-6">
        {[
          { key: 'upload', label: 'Upload TOC' },
          { key: 'review', label: 'Review Services' },
          { key: 'done', label: 'Template Ready' },
        ].map((s, i, arr) => {
          const stageOrder = { upload: 0, analyzing: 0, review: 1, creating: 1, done: 2 };
          const current = stageOrder[stage] || 0;
          const done = i < current;
          const active = i === current;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <div className={`h-0.5 flex-1 ${done ? 'bg-blue-500' : 'bg-gray-200'}`} />}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
                ${active ? 'bg-indigo-600 text-white' : done ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
                {done ? <FaCheckCircle className="text-[10px]" /> : <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px]">{i + 1}</span>}
                <span>{s.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-4 flex items-center gap-2">
          <FaExclamationTriangle />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600"><FaTimes /></button>
        </div>
      )}

      {/* ═══ UPLOAD STAGE ═══ */}
      {(stage === 'upload' || stage === 'analyzing') && (
        <div className="max-w-xl mx-auto">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4
              ${file ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) setFile(f); }}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FaFilePdf className="text-red-500 text-2xl" />
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="p-1 text-gray-400 hover:text-red-500">
                  <FaTimes />
                </button>
              </div>
            ) : (
              <div>
                <FaUpload className="text-3xl text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-600">Drop a course TOC / syllabus PDF here</p>
                <p className="text-xs text-gray-400 mt-1">AI will detect required cloud services and instance types</p>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Cloud Provider</label>
              <select value={providerHint} onChange={(e) => setProviderHint(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
                <option value="auto">Auto-detect</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Sandbox TTL (hours)</label>
              <input type="number" value={ttlHours} onChange={(e) => setTtlHours(Number(e.target.value))} min={1} max={48}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>

          <button onClick={handleAnalyze} disabled={!file || stage === 'analyzing'}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors">
            {stage === 'analyzing'
              ? <><FaSpinner className="animate-spin" /> Analyzing TOC...</>
              : <><FaMagic /> Analyze & Detect Services</>}
          </button>
        </div>
      )}

      {/* ═══ REVIEW STAGE ═══ */}
      {(stage === 'review' || stage === 'creating') && analysis && (
        <div>
          {/* Course summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{analysis.courseName || 'Course'}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{analysis.description?.slice(0, 150)}{analysis.description?.length > 150 ? '...' : ''}</p>
              </div>
              <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium uppercase">
                  {analysis.detectedProvider || providerHint}
                </span>
                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-medium">
                  {analysis.difficulty || 'intermediate'}
                </span>
                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-medium">
                  {analysis.totalHours || '?'}h
                </span>
              </div>
            </div>
            {meta && (
              <div className="flex gap-4 mt-2 text-[10px] text-gray-400">
                <span>Model: {meta.model}</span>
                <span>Analyzed in {Math.round(meta.elapsedMs / 1000)}s</span>
                <span>{analysis.modules?.length || 0} modules detected</span>
              </div>
            )}
          </div>

          {/* Feasibility verdict */}
          {feasibility && (
            <div className={`border rounded-lg px-4 py-2 mb-4 flex items-center gap-2 text-sm ${
              feasibility.verdict === 'feasible' ? 'bg-green-50 border-green-200 text-green-700' :
              feasibility.verdict === 'needs_review' ? 'bg-amber-50 border-amber-200 text-amber-700' :
              'bg-red-50 border-red-200 text-red-700'
            }`}>
              {feasibility.verdict === 'feasible' ? <FaCheckCircle /> : <FaExclamationTriangle />}
              <span className="font-medium capitalize">{feasibility.verdict?.replace('_', ' ')}</span>
              {feasibility.supported?.length > 0 && <span className="text-xs ml-2">({feasibility.supported.length} supported services)</span>}
              {feasibility.unsupported?.length > 0 && <span className="text-xs ml-2">({feasibility.unsupported.length} unsupported)</span>}
            </div>
          )}

          {/* Modules */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Detected Modules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(analysis.modules || []).map((mod, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800">{mod.name}</span>
                    <span className="text-xs text-gray-400">{mod.hours}h</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(mod.services || []).map((svc, j) => (
                      <span key={j} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">{svc.name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editable services */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
              AWS Services for Sandbox ({Object.values(enabledServices).filter(v => v.enabled).length} enabled)
            </h3>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                {Object.entries(enabledServices).sort(([a], [b]) => a.localeCompare(b)).map(([svc, info]) => (
                  <button key={svc} onClick={() => toggleService(svc)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                      info.enabled
                        ? 'border-green-200 bg-green-50 text-green-800'
                        : 'border-gray-200 bg-gray-50 text-gray-400 line-through'
                    }`}>
                    {info.enabled
                      ? <FaToggleOn className="text-green-500 flex-shrink-0" />
                      : <FaToggleOff className="text-gray-300 flex-shrink-0" />}
                    <span className="flex-1 truncate font-medium">{svc}</span>
                  </button>
                ))}
              </div>
              {/* Add custom service */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <input value={customService} onChange={(e) => setCustomService(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomService()}
                  placeholder="Add service (e.g., kinesis)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                <button onClick={addCustomService} disabled={!customService.trim()}
                  className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 disabled:opacity-50">
                  <FaPlus className="inline mr-1" /> Add
                </button>
              </div>
            </div>
          </div>

          {/* Instance types */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
              <FaServer className="inline mr-1" /> Allowed Instance Types
            </h3>
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              {['aws', 'azure', 'gcp'].map(cloud => (
                <div key={cloud} className="mb-2 last:mb-0">
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">{cloud}</label>
                  <input
                    value={instanceTypes[cloud]?.join(', ') || ''}
                    onChange={(e) => setInstanceTypes(prev => ({ ...prev, [cloud]: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono"
                    placeholder={`e.g., t3.micro, t3.small`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Special requirements */}
          {analysis.specialRequirements?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-4">
              <h4 className="text-xs font-semibold text-amber-700 mb-1">Special Requirements</h4>
              <div className="flex flex-wrap gap-1.5">
                {analysis.specialRequirements.map((req, i) => (
                  <span key={i} className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">{req}</span>
                ))}
              </div>
            </div>
          )}

          {/* Create button */}
          <button onClick={handleCreateTemplate} disabled={stage === 'creating' || Object.values(enabledServices).filter(v => v.enabled).length === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors">
            {stage === 'creating'
              ? <><FaSpinner className="animate-spin" /> Creating template & IAM policy...</>
              : <><FaShieldAlt /> Create Sandbox Template with IAM Policy</>}
          </button>
        </div>
      )}

      {/* ═══ DONE STAGE ═══ */}
      {stage === 'done' && template && (
        <div>
          <div className="max-w-xl mx-auto text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaCheckCircle className="text-3xl text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Sandbox Template Created</h2>
            <p className="text-sm text-gray-500">Students can now deploy AWS sandboxes from this template</p>
          </div>

          {/* Template card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{template.name}</h3>
                <p className="text-xs font-mono text-gray-400 mt-0.5">{template.slug}</p>
              </div>
              <span className="bg-green-100 text-green-700 px-2.5 py-1 rounded-full text-xs font-medium">Active</span>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div>
                <span className="text-xs text-gray-500 block">Cloud</span>
                <span className="font-medium uppercase">{template.cloud}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">TTL</span>
                <span className="font-medium">{template.sandboxConfig?.ttlHours || ttlHours}h</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Services</span>
                <span className="font-medium">{template.allowedServices?.length || 0} allowed</span>
              </div>
            </div>

            {/* Services chips */}
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Allowed Services</h4>
              <div className="flex flex-wrap gap-1.5">
                {(template.allowedServices || []).map((svc, i) => (
                  <span key={i} className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded text-xs font-medium">
                    {svc.service}
                  </span>
                ))}
              </div>
            </div>

            {template.blockedServices?.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Blocked Services</h4>
                <div className="flex flex-wrap gap-1.5">
                  {template.blockedServices.map((svc, i) => (
                    <span key={i} className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded text-xs font-medium">
                      {svc.service}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* IAM Policy preview */}
            {template.iamPolicy && (
              <ExpandablePolicy policy={template.iamPolicy} />
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => navigate(`/courses/${template.slug}`)}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm transition-colors">
              <FaRocket /> Deploy Sandboxes
            </button>
            <button onClick={() => { setStage('upload'); setFile(null); setAnalysis(null); setTemplate(null); setAnalysisId(null); setError(''); }}
              className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-medium">
              <FaPlus className="inline mr-1" /> Create Another
            </button>
            <button onClick={handleDeleteTemplate}
              className="px-4 py-2.5 border border-red-300 text-red-600 rounded-xl hover:bg-red-50 text-sm font-medium">
              <FaTrash className="inline mr-1" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IAM Policy Expandable ───────────────────────────────────────────────

function ExpandablePolicy({ policy }) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <button onClick={() => setShow(!show)}
        className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1 mb-1.5 hover:text-blue-600">
        <FaEye /> {show ? 'Hide' : 'Show'} IAM Policy JSON
      </button>
      {show && (
        <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-[11px] max-h-80 overflow-y-auto leading-relaxed">
          {typeof policy === 'string' ? policy : JSON.stringify(policy, null, 2)}
        </pre>
      )}
    </div>
  );
}
