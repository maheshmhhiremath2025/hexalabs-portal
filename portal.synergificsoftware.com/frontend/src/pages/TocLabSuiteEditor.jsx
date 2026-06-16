import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaUpload, FaFilePdf, FaTimes, FaSpinner, FaCheckCircle, FaExclamationTriangle,
  FaArrowRight, FaArrowLeft, FaSave, FaFlask, FaCloud, FaCogs, FaLayerGroup,
  FaChevronDown, FaChevronUp, FaEdit, FaEye, FaRocket, FaMagic, FaFileAlt,
  FaTrash,
} from 'react-icons/fa';

const STAGES = ['Upload', 'Analysis', 'Generating', 'Review', 'Saved'];

// ─── Stage indicator ────────────────────────────────────────────────────

function StageBar({ current }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STAGES.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={`h-0.5 flex-1 ${done ? 'bg-blue-500' : 'bg-gray-200'}`} />}
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
              ${active ? 'bg-blue-600 text-white' : done ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-400'}`}>
              {done ? <FaCheckCircle className="text-[10px]" /> : <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px]">{i + 1}</span>}
              <span>{label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Upload Stage ────────────────────────────────────────────────────────

function UploadStage({ onAnalyze }) {
  const [file, setFile] = useState(null);
  const [difficultyHint, setDifficultyHint] = useState('auto');
  const [customPrompt, setCustomPrompt] = useState('');
  const [ttlHours, setTtlHours] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type === 'application/pdf') setFile(f);
  }, []);

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('providerHint', 'aws');
      formData.append('difficultyHint', difficultyHint);
      formData.append('customPrompt', customPrompt);
      formData.append('ttlHours', ttlHours);

      const res = await apiCaller.post('/guided-labs/toc-pipeline', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onAnalyze(res.data.jobId);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-purple-50 rounded-full mb-4">
          <FaMagic className="text-blue-600" />
          <span className="text-sm font-medium text-blue-800">AI-Powered Lab Suite Generator</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Upload Course TOC</h2>
        <p className="text-sm text-gray-500 mt-1">Upload a course syllabus or TOC PDF. AI will analyze the modules and generate hands-on AWS labs for each topic.</p>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4
          ${file ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
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
            <p className="text-sm text-gray-600">Drop a course PDF here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">Supports course syllabi, TOCs, exam guides, training outlines</p>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Difficulty</label>
          <select value={difficultyHint} onChange={(e) => setDifficultyHint(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="auto">Auto-detect</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Sandbox TTL (hours)</label>
          <input type="number" value={ttlHours} onChange={(e) => setTtlHours(Number(e.target.value))} min={1} max={24}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs font-medium text-gray-600 mb-1 block">Custom Instructions (optional)</label>
        <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2} placeholder="e.g., Focus on S3 and EC2 exercises, use us-west-2 region..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mb-4 flex items-center gap-2">
          <FaExclamationTriangle /> {error}
        </div>
      )}

      <button onClick={handleSubmit} disabled={!file || loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-colors">
        {loading ? <><FaSpinner className="animate-spin" /> Starting analysis...</> : <><FaRocket /> Analyze TOC & Generate Labs</>}
      </button>
    </div>
  );
}

// ─── Analysis + Generation Stage (combined with polling) ─────────────────

function GeneratingStage({ jobId, onComplete }) {
  const [status, setStatus] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await apiCaller.get(`/guided-labs/toc-pipeline/${jobId}`);
        if (cancelled) return;
        setStatus(res.data);

        if (res.data.status === 'done' || res.data.status === 'failed') {
          // Fetch full result
          const result = await apiCaller.get(`/guided-labs/toc-pipeline/${jobId}/result`);
          onComplete(result.data);
          return;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
      if (!cancelled) setTimeout(poll, 3000);
    };

    poll();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000);

    return () => { cancelled = true; clearInterval(timer); };
  }, [jobId, onComplete]);

  const stageLabel = status?.stage || 'Starting pipeline...';
  const progress = status?.progress || { total: 0, completed: 0, current: '' };
  const modules = status?.modules || [];
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const isAnalyzing = status?.status === 'extracting' || status?.status === 'analyzing';
  const isGenerating = status?.status === 'generating';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <FaSpinner className="text-3xl text-blue-600 animate-spin mx-auto mb-3" />
        <h2 className="text-xl font-semibold text-gray-900">{isAnalyzing ? 'Analyzing Course TOC' : 'Generating Labs'}</h2>
        <p className="text-sm text-gray-500 mt-1">{stageLabel}</p>
      </div>

      {/* Overall progress */}
      {isGenerating && progress.total > 0 && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{progress.completed}/{progress.total} modules</span>
            <span>{elapsed}s elapsed</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          {progress.current && (
            <p className="text-xs text-gray-400 mt-1">Current: {progress.current}</p>
          )}
        </div>
      )}

      {/* Module cards */}
      {modules.length > 0 && (
        <div className="space-y-2">
          {modules.map((mod, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${
              mod.status === 'done' ? 'border-green-200 bg-green-50' :
              mod.status === 'generating' ? 'border-blue-200 bg-blue-50' :
              mod.status === 'failed' ? 'border-red-200 bg-red-50' :
              'border-gray-100 bg-gray-50'
            }`}>
              <div className="w-6 h-6 flex items-center justify-center">
                {mod.status === 'done' ? <FaCheckCircle className="text-green-500" /> :
                 mod.status === 'generating' ? <FaSpinner className="text-blue-500 animate-spin" /> :
                 mod.status === 'failed' ? <FaExclamationTriangle className="text-red-500" /> :
                 <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{mod.name}</p>
                <div className="flex gap-2 text-xs text-gray-500">
                  {mod.services?.slice(0, 4).map((s, j) => (
                    <span key={j} className="bg-gray-200 px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                  {mod.services?.length > 4 && <span>+{mod.services.length - 4}</span>}
                </div>
              </div>
              {mod.status === 'done' && <span className="text-xs text-green-600">{mod.stepCount} steps</span>}
              {mod.status === 'failed' && <span className="text-xs text-red-600">Failed</span>}
            </div>
          ))}
        </div>
      )}

      {!status && (
        <div className="flex items-center justify-center gap-2 text-gray-400 text-sm mt-4">
          <FaSpinner className="animate-spin" /> Connecting to pipeline...
        </div>
      )}
    </div>
  );
}

// ─── Review Stage ────────────────────────────────────────────────────────

function ReviewStage({ result, onSave, onBack }) {
  const [activeTab, setActiveTab] = useState(0);
  const [labs, setLabs] = useState(result?.labs?.filter(l => l) || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedSteps, setExpandedSteps] = useState({});

  const template = result?.template;
  const analysis = result?.analysis;
  const tabCount = labs.length + (template ? 1 : 0);

  const toggleStep = (labIdx, stepIdx) => {
    const key = `${labIdx}-${stepIdx}`;
    setExpandedSteps(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateLabField = (labIdx, field, value) => {
    setLabs(prev => {
      const copy = [...prev];
      copy[labIdx] = { ...copy[labIdx], [field]: value };
      return copy;
    });
  };

  const updateStep = (labIdx, stepIdx, field, value) => {
    setLabs(prev => {
      const copy = [...prev];
      const steps = [...(copy[labIdx].steps || [])];
      steps[stepIdx] = { ...steps[stepIdx], [field]: value };
      copy[labIdx] = { ...copy[labIdx], steps };
      return copy;
    });
  };

  const removeStep = (labIdx, stepIdx) => {
    setLabs(prev => {
      const copy = [...prev];
      const steps = (copy[labIdx].steps || []).filter((_, i) => i !== stepIdx);
      copy[labIdx] = { ...copy[labIdx], steps: steps.map((s, i) => ({ ...s, order: i + 1 })) };
      return copy;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(labs);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Summary bar */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FaLayerGroup className="text-blue-600" />
          <span className="text-sm font-medium">{labs.length} labs generated</span>
        </div>
        {template && (
          <div className="flex items-center gap-2">
            <FaCloud className="text-blue-600" />
            <span className="text-sm font-medium">{template.allowedServices?.length || 0} AWS services</span>
          </div>
        )}
        {analysis && (
          <div className="flex items-center gap-2">
            <FaFileAlt className="text-blue-600" />
            <span className="text-sm font-medium">{analysis.courseName}</span>
          </div>
        )}
        {result?.errors?.length > 0 && (
          <div className="flex items-center gap-2">
            <FaExclamationTriangle className="text-amber-500" />
            <span className="text-sm text-amber-700">{result.errors.length} warnings</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {labs.map((lab, i) => (
          <button key={i} onClick={() => setActiveTab(i)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            Lab {i + 1}: {(lab.title || '').slice(0, 25)}{(lab.title || '').length > 25 ? '...' : ''}
          </button>
        ))}
        {template && (
          <button onClick={() => setActiveTab(labs.length)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === labs.length ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <FaCogs className="inline mr-1" /> AWS Template
          </button>
        )}
      </div>

      {/* Tab content */}
      <div className="min-h-[400px]">
        {activeTab < labs.length ? (
          <LabReview
            lab={labs[activeTab]}
            labIdx={activeTab}
            expandedSteps={expandedSteps}
            toggleStep={toggleStep}
            updateLabField={updateLabField}
            updateStep={updateStep}
            removeStep={removeStep}
          />
        ) : template ? (
          <TemplateReview template={template} />
        ) : null}
      </div>

      {/* Actions */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm mt-4 flex items-center gap-2">
          <FaExclamationTriangle /> {error}
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button onClick={onBack} className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-medium">
          <FaArrowLeft className="inline mr-1" /> Start Over
        </button>
        <button onClick={handleSave} disabled={saving || labs.length === 0}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors text-sm">
          {saving ? <><FaSpinner className="animate-spin" /> Saving...</> : <><FaSave /> Save All Labs & Template</>}
        </button>
      </div>
    </div>
  );
}

// ─── Lab Review Component ─────────────────────────────────────────────────

function LabReview({ lab, labIdx, expandedSteps, toggleStep, updateLabField, updateStep, removeStep }) {
  return (
    <div>
      {/* Lab metadata */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Title</label>
          <input value={lab.title || ''} onChange={(e) => updateLabField(labIdx, 'title', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 block mb-1">Cloud</label>
            <input value={lab.cloud || 'aws'} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 block mb-1">Difficulty</label>
            <select value={lab.difficulty || 'intermediate'} onChange={(e) => updateLabField(labIdx, 'difficulty', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-gray-500 block mb-1">Duration (min)</label>
            <input type="number" value={lab.duration || 60} onChange={(e) => updateLabField(labIdx, 'duration', Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs font-medium text-gray-500 block mb-1">Description</label>
        <textarea value={lab.description || ''} onChange={(e) => updateLabField(labIdx, 'description', e.target.value)} rows={2}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
      </div>

      {/* Steps */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <FaFlask className="text-blue-500" /> Steps ({(lab.steps || []).length})
      </h3>
      <div className="space-y-2">
        {(lab.steps || []).map((step, si) => {
          const key = `${labIdx}-${si}`;
          const expanded = expandedSteps[key];
          return (
            <div key={si} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100" onClick={() => toggleStep(labIdx, si)}>
                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-bold">{step.order || si + 1}</span>
                <span className="flex-1 text-sm font-medium text-gray-800 truncate">{step.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${step.verifyType === 'auto' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {step.verifyType || 'manual'}
                </span>
                <button onClick={(e) => { e.stopPropagation(); removeStep(labIdx, si); }} className="text-gray-400 hover:text-red-500 p-1">
                  <FaTrash className="text-[10px]" />
                </button>
                {expanded ? <FaChevronUp className="text-gray-400 text-xs" /> : <FaChevronDown className="text-gray-400 text-xs" />}
              </div>
              {expanded && (
                <div className="p-3 space-y-2 border-t border-gray-200">
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Title</label>
                    <input value={step.title || ''} onChange={(e) => updateStep(labIdx, si, 'title', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Description (Markdown)</label>
                    <textarea value={step.description || ''} onChange={(e) => updateStep(labIdx, si, 'description', e.target.value)} rows={6}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Hint</label>
                    <input value={step.hint || ''} onChange={(e) => updateStep(labIdx, si, 'hint', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1">Verify Type</label>
                      <select value={step.verifyType || 'manual'} onChange={(e) => updateStep(labIdx, si, 'verifyType', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        <option value="manual">Manual</option>
                        <option value="auto">Auto</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-gray-500 block mb-1">Verify Command</label>
                      <input value={step.verifyCommand || ''} onChange={(e) => updateStep(labIdx, si, 'verifyCommand', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-xs" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Template Review Component ────────────────────────────────────────────

function TemplateReview({ template }) {
  const [showPolicy, setShowPolicy] = useState(false);

  return (
    <div>
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 mb-4">
        <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2 mb-2">
          <FaCloud /> AWS Sandbox Template
        </h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs text-gray-500 block">Name</span>
            <span className="font-medium">{template.name}</span>
          </div>
          <div>
            <span className="text-xs text-gray-500 block">Slug</span>
            <span className="font-mono text-xs">{template.slug}</span>
          </div>
          <div>
            <span className="text-xs text-gray-500 block">Cloud</span>
            <span className="font-medium uppercase">{template.cloud}</span>
          </div>
        </div>
      </div>

      {/* Allowed Services */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Allowed Services ({template.allowedServices?.length || 0})</h4>
        <div className="flex flex-wrap gap-1.5">
          {(template.allowedServices || []).map((svc, i) => (
            <span key={i} className="bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded text-xs font-medium">
              {svc.service}
            </span>
          ))}
        </div>
      </div>

      {/* Blocked Services */}
      {template.blockedServices?.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wider">Blocked Services ({template.blockedServices.length})</h4>
          <div className="flex flex-wrap gap-1.5">
            {template.blockedServices.map((svc, i) => (
              <span key={i} className="bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded text-xs font-medium">
                {svc.service}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* IAM Policy */}
      {template.iamPolicy && (
        <div>
          <button onClick={() => setShowPolicy(!showPolicy)}
            className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1 mb-2 hover:text-blue-600">
            <FaEye /> {showPolicy ? 'Hide' : 'Show'} IAM Policy JSON
          </button>
          {showPolicy && (
            <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
              {JSON.stringify(template.iamPolicy, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Saved Stage ─────────────────────────────────────────────────────────

function SavedStage({ saveResult }) {
  const navigate = useNavigate();

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <FaCheckCircle className="text-3xl text-green-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 mb-2">Lab Suite Saved</h2>
      <p className="text-sm text-gray-500 mb-6">{saveResult?.message}</p>

      {/* Saved labs */}
      {saveResult?.labs?.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4 mb-4 text-left">
          <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Guided Labs</h3>
          <div className="space-y-1.5">
            {saveResult.labs.map((lab, i) => (
              <div key={i} className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-200">
                <span className="text-sm font-medium text-gray-800">{lab.title}</span>
                <button onClick={() => navigate(`/guided-labs/editor/${lab.id}`)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
                  <FaEdit /> Edit
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved template */}
      {saveResult?.template && (
        <div className="bg-amber-50 rounded-xl p-4 mb-6 text-left">
          <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">AWS Sandbox Template</h3>
          <div className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-amber-200">
            <div>
              <span className="text-sm font-medium text-gray-800">{saveResult.template.name}</span>
              <span className="text-xs text-gray-500 ml-2 font-mono">{saveResult.template.slug}</span>
            </div>
            <button onClick={() => navigate(`/courses/${saveResult.template.slug}`)}
              className="text-xs text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1">
              <FaEye /> View
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => navigate('/guided-labs')}
          className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 text-sm font-medium">
          View All Labs
        </button>
        <button onClick={() => window.location.reload()}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm">
          Generate Another Suite
        </button>
      </div>
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────

export default function TocLabSuiteEditor() {
  const [stage, setStage] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  const handleAnalyze = (newJobId) => {
    setJobId(newJobId);
    setStage(2); // Skip to generating (analysis is part of the pipeline)
  };

  const handleGenerationComplete = useCallback((result) => {
    setPipelineResult(result);
    setStage(result.status === 'failed' && !result.labs?.some(l => l) ? 2 : 3);
  }, []);

  const handleSave = async (editedLabs) => {
    const res = await apiCaller.post(`/guided-labs/toc-pipeline/${jobId}/save`, {
      labs: editedLabs,
    });
    setSaveResult(res.data);
    setStage(4);
  };

  const handleStartOver = () => {
    setStage(0);
    setJobId(null);
    setPipelineResult(null);
    setSaveResult(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FaMagic className="text-blue-600" /> AI Lab Suite Generator
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Upload a course TOC and generate a full suite of hands-on AWS labs</p>
        </div>
      </div>

      <StageBar current={stage} />

      {stage === 0 && <UploadStage onAnalyze={handleAnalyze} />}
      {stage === 2 && <GeneratingStage jobId={jobId} onComplete={handleGenerationComplete} />}
      {stage === 3 && pipelineResult && (
        <ReviewStage result={pipelineResult} onSave={handleSave} onBack={handleStartOver} />
      )}
      {stage === 4 && <SavedStage saveResult={saveResult} />}
    </div>
  );
}
