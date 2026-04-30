import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaSearch, FaPlus, FaEdit, FaClock, FaLayerGroup, FaRobot, FaFilePdf,
  FaFileCsv, FaTimes, FaSpinner, FaSave, FaCheck, FaChevronDown, FaWrench,
  FaPlay, FaServer, FaDownload, FaChartBar, FaCloud,
} from 'react-icons/fa';
import { BookOpen, Target, Cloud, Shield, Database, Code, Monitor, Globe, Upload, Sparkles, Zap, AlertCircle, Eye, Server } from 'lucide-react';

const DIFFICULTY_COLORS = {
  beginner: 'bg-green-100 text-green-700 border-green-200',
  intermediate: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  advanced: 'bg-red-100 text-red-700 border-red-200',
};

const CLOUD_ICONS = {
  azure: { icon: Cloud, color: 'text-blue-500' },
  aws: { icon: Cloud, color: 'text-orange-500' },
  gcp: { icon: Cloud, color: 'text-red-500' },
  container: { icon: Monitor, color: 'text-purple-500' },
  vm: { icon: Server, color: 'text-slate-600' },
};

const CLOUD_LABELS = {
  azure: 'Azure',
  aws: 'AWS',
  gcp: 'GCP',
  container: 'Container',
  vm: 'VM',
};

const CATEGORY_ICONS = {
  Compute: Monitor,
  Storage: Database,
  Networking: Globe,
  Security: Shield,
  Containers: Code,
  Development: Code,
};

const CLOUDS = ['azure', 'aws', 'gcp', 'container', 'vm'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

/* ===== AI Generate Modal ===== */
function AIGenerateModal({ onClose, onLabCreated }) {
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('generate'); // 'generate' | 'import'
  const [file, setFile] = useState(null);
  const [cloudHint, setCloudHint] = useState('auto');
  const [difficultyHint, setDifficultyHint] = useState('auto');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genStage, setGenStage] = useState(0);
  const [genElapsed, setGenElapsed] = useState(0);
  const [error, setError] = useState('');
  const [genMeta, setGenMeta] = useState(null);
  const [preview, setPreview] = useState(null); // generated lab data
  const [saving, setSaving] = useState(false);
  const [expandedStep, setExpandedStep] = useState(null);

  // Animated progress stages while generating
  const GEN_STAGES = mode === 'import' ? [
    'Extracting text from document...',
    'Parsing lab steps...',
    'Structuring step data...',
  ] : [
    'Extracting text from document...',
    'Analyzing modules and topics...',
    'Detecting infrastructure requirements...',
    'Generating lab steps and commands...',
    'Building verification commands...',
    'Adding troubleshooting guides...',
    'Finalizing lab structure...',
  ];
  useEffect(() => {
    if (!generating) { setGenStage(0); setGenElapsed(0); return; }
    const startTime = Date.now();
    const elapsed = setInterval(() => setGenElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    const stageMs = mode === 'import' ? 8000 : 20000;
    const stage = setInterval(() => setGenStage(s => (s + 1) % GEN_STAGES.length), stageMs);
    return () => { clearInterval(elapsed); clearInterval(stage); };
  }, [generating, mode]);

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    const name = f.name?.toLowerCase() || '';
    if (f.type === 'application/pdf' || f.type === 'text/csv' || name.endsWith('.pdf') || name.endsWith('.csv')) {
      setFile(f);
    }
  };

  const handleGenerate = async () => {
    if (!file) return setError('Please select a PDF or CSV file first');
    setGenerating(true);
    setError('');
    setGenMeta(null);
    setPreview(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (cloudHint !== 'auto') formData.append('cloudHint', cloudHint);
      if (difficultyHint !== 'auto') formData.append('difficultyHint', difficultyHint);
      if (customPrompt.trim()) formData.append('customPrompt', customPrompt.trim());

      const endpoint = mode === 'import' ? '/guided-labs/import-steps' : '/guided-labs/generate';
      const res = await apiCaller.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 420000, // 7 min timeout for AI generation
      });

      const generated = res.data.lab;
      // Normalize steps
      generated.steps = (generated.steps || []).map((s, i) => ({
        ...s,
        order: i + 1,
        troubleshooting: s.troubleshooting || [],
      }));
      generated.labTroubleshooting = generated.labTroubleshooting || [];
      generated.aiGenerated = true;

      setPreview(generated);
      setGenMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'AI generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveLab = async () => {
    if (!preview) return;
    setSaving(true);
    setError('');
    try {
      await apiCaller.post('/guided-labs', preview);
      onLabCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save lab');
    } finally {
      setSaving(false);
    }
  };

  const navigate = useNavigate();
  const handleEditInEditor = () => {
    // Store generated lab in sessionStorage and open editor
    sessionStorage.setItem('ai_generated_lab', JSON.stringify(preview));
    navigate('/guided-labs/editor?from=ai');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-blue-50">
          <div className="flex items-center gap-2">
            <FaRobot className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-bold text-slate-800">AI Lab Generator</h2>
            <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">Beta</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          {!preview ? (
            /* ─── Upload Phase ─── */
            <div className="space-y-4">
              {/* Mode tabs */}
              <div className="flex border-b border-slate-200">
                <button onClick={() => { setMode('generate'); setError(''); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mode === 'generate' ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  <Sparkles className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />AI Generate
                </button>
                <button onClick={() => { setMode('import'); setError(''); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mode === 'import' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  <Upload className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Direct Import
                </button>
              </div>

              <p className="text-sm text-slate-600">
                {mode === 'generate'
                  ? 'Upload a course TOC, syllabus, or topics list — AI will analyze it and generate a complete guided lab with steps, commands, hints, and troubleshooting.'
                  : 'Upload a PDF or CSV that already contains lab steps/instructions — they will be extracted and added directly without AI rewriting.'}
              </p>

              {/* Upload area */}
              <div
                className="border-2 border-dashed border-purple-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.csv"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    {file.name?.toLowerCase().endsWith('.csv')
                      ? <FaFileCsv className="w-8 h-8 text-green-600" />
                      : <FaFilePdf className="w-8 h-8 text-red-500" />
                    }
                    <div className="text-left">
                      <div className="text-sm font-semibold text-slate-800">{file.name}</div>
                      <div className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="ml-3 p-1 text-slate-400 hover:text-red-500">
                      <FaTimes className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-purple-300 mx-auto mb-2" />
                    <div className="text-sm font-medium text-purple-700">Click to upload or drag & drop</div>
                    <div className="text-xs text-purple-400 mt-1">PDF or CSV files up to 15 MB</div>
                  </>
                )}
              </div>

              {/* Options row */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cloud Hint</label>
                  <select value={cloudHint} onChange={(e) => setCloudHint(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-purple-400">
                    <option value="auto">Auto-detect from content</option>
                    {CLOUDS.map(c => <option key={c} value={c}>{CLOUD_LABELS[c] || c}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Difficulty Hint</label>
                  <select value={difficultyHint} onChange={(e) => setDifficultyHint(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-purple-400">
                    <option value="auto">Auto-detect from content</option>
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              {/* Custom prompt / instructions */}
              {mode === 'generate' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Custom Instructions <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g. Focus only on networking and security modules. Skip the intro chapters. Include Terraform examples for each step..."
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 resize-none placeholder:text-slate-400"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Guide the AI on what to include/exclude from the TOC, focus areas, or special requirements
                  </p>
                </div>
              )}

              {generating && (
                <div className="py-6 space-y-3">
                  {/* Progress bar */}
                  <div className="w-full bg-purple-100 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(95, (genStage / GEN_STAGES.length) * 80 + (genElapsed / 240) * 20)}%` }} />
                  </div>
                  {/* Stage text */}
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-5 h-5 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                    <div className="text-sm text-purple-700 font-medium">{GEN_STAGES[genStage]}</div>
                  </div>
                  <div className="text-center text-xs text-slate-400">
                    Elapsed: {Math.floor(genElapsed / 60)}:{String(genElapsed % 60).padStart(2, '0')} — AI generation can take up to 3-4 minutes for large documents
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ─── Preview Phase ─── */
            <div className="space-y-4">
              {/* Success badge + meta */}
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <FaCheck className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700">Lab Generated Successfully!</span>
                {genMeta && (
                  <span className="text-xs text-green-500 ml-auto flex items-center gap-2">
                    <Zap className="w-3 h-3" />
                    {(genMeta.elapsedMs / 1000).toFixed(1)}s
                    {genMeta.fileType && <> | {genMeta.fileType.toUpperCase()}</>}
                    {genMeta.pageCount > 0 && <> | {genMeta.pageCount} pages</>}
                  </span>
                )}
              </div>

              {/* Lab Overview Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-800">{preview.title}</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{preview.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                    <Cloud className="w-3 h-3" /> {preview.cloud?.toUpperCase() || 'Auto'}
                  </span>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    preview.difficulty === 'beginner' ? 'bg-green-100 text-green-700' :
                    preview.difficulty === 'intermediate' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {preview.difficulty}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <FaClock className="w-3 h-3" /> {preview.duration} min
                  </span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Target className="w-3 h-3" /> {preview.steps?.length || 0} steps
                  </span>
                  {preview.category && (
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-1 rounded-full">{preview.category}</span>
                  )}
                </div>

                {preview.tags?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {preview.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                )}

                {/* Environment info */}
                <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-xs font-semibold text-blue-700 mb-1">Environment:</div>
                  <div className="text-xs text-blue-600">
                    {preview.cloud === 'container' ? (
                      <span>Container (Docker) — No cloud sandbox required</span>
                    ) : preview.cloud === 'vm' ? (
                      <span>Virtual Machine — {preview.vmTemplateName || 'Template to be selected'}</span>
                    ) : (
                      <span>{preview.cloud?.toUpperCase()} Cloud Sandbox — Requires sandbox provisioning ({preview.cloud === 'azure' ? 'VM/Resources' : preview.cloud === 'aws' ? 'IAM + Services' : 'Project + Resources'})</span>
                    )}
                  </div>
                </div>

                {/* AI Infrastructure Recommendation */}
                {preview.cloudRecommendation?.reason && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> AI Recommendation
                    </div>
                    <div className="text-xs text-amber-700">{preview.cloudRecommendation.reason}</div>
                    {preview.cloudRecommendation.alternative && preview.cloudRecommendation.alternative !== 'none' && (
                      <div className="text-xs text-amber-600 mt-1 pl-2 border-l-2 border-amber-300">
                        <span className="font-medium">Alternative:</span> {preview.cloudRecommendation.alternative.toUpperCase()}
                        {preview.cloudRecommendation.alternativeReason && ` — ${preview.cloudRecommendation.alternativeReason}`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Steps Preview */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h4 className="text-sm font-semibold text-slate-700">Steps Preview ({preview.steps?.length || 0})</h4>
                </div>
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {preview.steps?.map((step, idx) => (
                    <div key={idx} className="px-4 py-2.5">
                      <button
                        className="w-full flex items-center gap-2 text-left"
                        onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
                      >
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-slate-700 flex-1">{step.title}</span>
                        <div className="flex items-center gap-1.5">
                          {step.verifyType === 'auto' && (
                            <span className="text-[9px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-medium">Auto-verify</span>
                          )}
                          {step.hint && (
                            <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">Hint</span>
                          )}
                          {step.troubleshooting?.length > 0 && (
                            <span className="text-[9px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">{step.troubleshooting.length} fixes</span>
                          )}
                          <FaChevronDown className={`w-2.5 h-2.5 text-slate-400 transition-transform ${expandedStep === idx ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {expandedStep === idx && (
                        <div className="mt-2 pl-7 space-y-2">
                          <div className="text-xs text-slate-600 whitespace-pre-wrap bg-white border border-slate-100 rounded-lg p-3 max-h-40 overflow-y-auto">
                            {step.description}
                          </div>
                          {step.hint && (
                            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                              <span className="font-medium">Hint:</span> {step.hint}
                            </div>
                          )}
                          {step.verifyCommand && (
                            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md p-2 font-mono">
                              <span className="font-medium font-sans">Verify:</span> {step.verifyCommand}
                            </div>
                          )}
                          {step.troubleshooting?.length > 0 && (
                            <div className="space-y-1">
                              {step.troubleshooting.map((t, i) => (
                                <div key={i} className="text-xs bg-orange-50 border border-orange-200 rounded-md p-2">
                                  <div className="font-medium text-orange-800">Issue: {t.issue}</div>
                                  <div className="text-orange-600 mt-0.5">Fix: {t.solution}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Lab-Level Troubleshooting Preview */}
              {preview.labTroubleshooting?.length > 0 && (
                <div className="border border-orange-200 rounded-xl p-4 bg-orange-50/50">
                  <div className="flex items-center gap-2 mb-2">
                    <FaWrench className="w-3.5 h-3.5 text-orange-500" />
                    <h4 className="text-sm font-semibold text-slate-700">Lab Troubleshooting ({preview.labTroubleshooting.length})</h4>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {preview.labTroubleshooting.map((t, i) => (
                      <div key={i} className="text-xs bg-white border border-orange-200 rounded-md p-2">
                        {t.category && <span className="text-[9px] font-semibold text-orange-500 uppercase">{t.category} — </span>}
                        <span className="font-medium text-orange-800">{t.issue}</span>
                        <div className="text-orange-600 mt-0.5">{t.solution}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
          {!preview ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating || !file}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                {generating ? (
                  <><FaSpinner className="w-3.5 h-3.5 animate-spin" /> {mode === 'import' ? 'Importing...' : 'Generating...'}</>
                ) : (
                  mode === 'import'
                    ? <><Upload className="w-3.5 h-3.5" /> Import Steps</>
                    : <><Sparkles className="w-3.5 h-3.5" /> Generate Lab</>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setPreview(null); setGenMeta(null); }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg"
              >
                Start Over
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleEditInEditor}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg"
                >
                  <FaEdit className="w-3.5 h-3.5" /> Edit First
                </button>
                <button
                  onClick={handleSaveLab}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <><FaSpinner className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                  ) : (
                    <><FaPlus className="w-3.5 h-3.5" /> Add Lab</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== Deploy Guided Lab Modal ===== */
function DeployGuidedLabModal({ lab, onClose }) {
  const navigate = useNavigate();
  const [trainingName, setTrainingName] = useState(
    lab.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
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
  const [sandboxJobId, setSandboxJobId] = useState(null);
  const [sandboxProgress, setSandboxProgress] = useState(null);

  const userType = (() => {
    try {
      const raw = localStorage.getItem('AH1apq12slurt5');
      if (raw === 'z829Sgry6AkYJ') return 'admin';
      if (raw === 'hpQ3s5dK247') return 'superadmin';
      return 'user';
    } catch { return 'user'; }
  })();

  // Fetch organizations for superadmin
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
      // Admin: get org from user info
      try {
        const org = localStorage.getItem('organization') || '';
        setOrganization(org);
      } catch {}
    }
  }, []);

  // Poll deploy status
  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiCaller.get(`/guided-labs/${lab._id}/deploy-status/${jobId}`);
        setProgress(res.data);
        if (res.data.status === 'done') clearInterval(interval);
      } catch {
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, lab._id]);

  // Poll sandbox job status (for Azure VM deploys where sandbox runs as separate background job)
  useEffect(() => {
    if (!sandboxJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiCaller.get(`/guided-labs/${lab._id}/deploy-status/${sandboxJobId}`);
        setSandboxProgress(res.data);
        if (res.data.status === 'done') clearInterval(interval);
      } catch {
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [sandboxJobId, lab._id]);

  const handleDeploy = async () => {
    if (!trainingName.trim() || !organization.trim()) {
      return setError('Training name and organization are required');
    }
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
        // Container/AWS/GCP deploy — poll for progress
        setJobId(res.data.jobId);
      } else {
        // Azure/cloud VM — immediate response (queued)
        setProgress({ status: 'done', message: res.data.message, cloud: res.data.cloud, total: res.data.total, workerWarning: res.data.workerWarning, hasSandbox: res.data.hasSandbox });
      }
      // If Azure VM deploy also has a sandbox background job, poll it separately
      if (res.data.sandboxJobId) {
        setSandboxJobId(res.data.sandboxJobId);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
      setDeploying(false);
    }
  };

  const isDone = progress?.status === 'done';
  const cloudLabel = lab.cloud === 'container' ? 'Container' : lab.cloud === 'vm' ? 'VM' : lab.cloud?.toUpperCase();

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

          {/* Lab info banner */}
          <div className="p-3 mb-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-sm font-semibold text-slate-800">{lab.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{lab.stepCount || lab.steps?.length || 0} steps | {lab.difficulty} | {lab.duration} min</div>
            {lab.cloud === 'container' && lab.containerImage && (
              <div className="text-xs text-purple-600 mt-1">Image: {lab.containerImage}</div>
            )}
            {lab.cloud === 'azure' && lab.vmTemplateName && (
              <div className="text-xs text-blue-600 mt-1">Template: {lab.vmTemplateName}</div>
            )}
            {lab.sandboxTemplateSlug && (
              <div className="flex items-center gap-1 text-xs text-amber-600 mt-1">
                <FaCloud className="w-3 h-3" /> Cloud Sandbox: {lab.sandboxTemplateSlug}
              </div>
            )}
          </div>

          {!isDone && !jobId ? (
            /* ─── Config Form ─── */
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
                      <input type="radio" name="remoteAccess" checked={remoteAccess === 'guacamole'} onChange={() => setRemoteAccess('guacamole')}
                        className="text-blue-600" />
                      Guacamole <span className="text-[10px] text-slate-400">— RDP/SSH via browser</span>
                    </label>
                    {(lab.vmTemplateName || '').toLowerCase().includes('windows') && (
                    <label className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg border transition-colors ${
                      remoteAccess === 'meshcentral' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="remoteAccess" checked={remoteAccess === 'meshcentral'} onChange={() => setRemoteAccess('meshcentral')}
                        className="text-emerald-600" />
                      MeshCentral <span className="text-[10px] text-slate-400">— agent-based, no extra cost</span>
                    </label>
                    )}
                    <label className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg border transition-colors ${
                      remoteAccess === 'none' ? 'border-slate-400 bg-slate-50 text-slate-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                      <input type="radio" name="remoteAccess" checked={remoteAccess === 'none'} onChange={() => setRemoteAccess('none')}
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
            /* ─── Progress Phase ─── */
            <div className="space-y-4 py-4">
              <div className="text-sm font-medium text-slate-700 text-center">
                {progress?.phase === 'sandbox' ? 'Provisioning cloud sandboxes...' : 'Deploying instances...'}
              </div>
              {/* Lab instances progress bar */}
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div className="bg-green-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progress?.progress || 0}%` }} />
              </div>
              <div className="text-center text-xs text-slate-500">
                {progress?.completed || 0} / {progress?.total || count} instances
                {progress?.failed > 0 && <span className="text-red-500 ml-2">({progress.failed} failed)</span>}
              </div>
              {/* Sandbox progress bar (shows during sandbox phase) */}
              {progress?.sandboxTotal > 0 && (
                <>
                  <div className="w-full bg-amber-100 rounded-full h-3 overflow-hidden">
                    <div className="bg-amber-500 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${progress.sandboxTotal > 0 ? Math.round(((progress.sandboxCompleted + progress.sandboxFailed) / progress.sandboxTotal) * 100) : 0}%` }} />
                  </div>
                  <div className="text-center text-xs text-amber-600">
                    {progress.sandboxCompleted || 0} / {progress.sandboxTotal} sandboxes
                    {progress.sandboxFailed > 0 && <span className="text-red-500 ml-2">({progress.sandboxFailed} failed)</span>}
                  </div>
                </>
              )}
              {progress?.current && (
                <div className="text-center text-xs text-slate-400 animate-pulse">{progress.current}</div>
              )}
            </div>
          ) : (
            /* ─── Done Phase ─── */
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

              {/* Sandbox provisioning summary — from main job or separate sandbox job */}
              {(() => {
                const sbDone = progress?.sandboxCompleted > 0 || progress?.sandboxFailed > 0;
                const sbSeparateDone = sandboxProgress?.status === 'done';
                const sbSeparateRunning = sandboxJobId && !sbSeparateDone;
                const sbCompleted = sbSeparateDone ? sandboxProgress.sandboxCompleted : progress?.sandboxCompleted || 0;
                const sbFailed = sbSeparateDone ? sandboxProgress.sandboxFailed : progress?.sandboxFailed || 0;

                if (sbSeparateRunning) {
                  return (
                    <div className="space-y-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-2">
                        <FaSpinner className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                        <span className="text-sm font-semibold text-amber-700">Provisioning Cloud Sandboxes...</span>
                      </div>
                      <div className="w-full bg-amber-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${sandboxProgress?.sandboxTotal > 0 ? Math.round(((sandboxProgress.sandboxCompleted + sandboxProgress.sandboxFailed) / sandboxProgress.sandboxTotal) * 100) : 0}%` }} />
                      </div>
                      <div className="text-xs text-amber-600">
                        {sandboxProgress?.sandboxCompleted || 0} / {sandboxProgress?.sandboxTotal || count} sandboxes
                      </div>
                      {sandboxProgress?.current && <div className="text-xs text-amber-500 animate-pulse">{sandboxProgress.current}</div>}
                    </div>
                  );
                }

                if (sbDone || sbSeparateDone || progress?.hasSandbox) {
                  return (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <FaCloud className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <div>
                        <span className="text-sm font-semibold text-amber-700">Cloud Sandbox</span>
                        <p className="text-xs text-amber-600 mt-0.5">
                          {sbCompleted > 0 && <>{sbCompleted} sandbox(es) provisioned.</>}
                          {sbFailed > 0 && <> {sbFailed} failed.</>}
                          {' '}Students can access cloud credentials on the <span className="font-semibold">My Sandboxes</span> page.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

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
              <button
                onClick={() => navigate('/vm/vmdetails')}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Monitor className="w-3.5 h-3.5" /> Open Lab Console
              </button>
            )}
            {!isDone && !jobId && (
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-50 transition-colors"
              >
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

/* ===== Sandbox Manage Modal ===== */
function SandboxManageModal({ lab, onClose }) {
  const [trainingName, setTrainingName] = useState('');
  const [sandboxes, setSandboxes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deletingEmails, setDeletingEmails] = useState(new Set());

  const fetchSandboxes = async () => {
    if (!trainingName.trim()) return setError('Enter a training name');
    setLoading(true);
    setError('');
    try {
      const res = await apiCaller.get(`/guided-labs/${lab._id}/sandboxes?training=${encodeURIComponent(trainingName.trim())}`);
      setSandboxes(res.data.sandboxes || []);
      setLoaded(true);
      if (res.data.message && res.data.sandboxes?.length === 0) setError(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load sandboxes');
    } finally {
      setLoading(false);
    }
  };

  // Auto-poll when any sandbox is in 'deleting' state
  useEffect(() => {
    const hasDeleting = sandboxes.some(s => s.deletionStatus === 'deleting');
    if (!hasDeleting || !loaded) return;
    const interval = setInterval(async () => {
      try {
        const res = await apiCaller.get(`/guided-labs/${lab._id}/sandboxes?training=${encodeURIComponent(trainingName.trim())}`);
        setSandboxes(res.data.sandboxes || []);
        // Clear deletingEmails for entries that are gone
        const currentEmails = new Set((res.data.sandboxes || []).map(s => s.email));
        setDeletingEmails(prev => {
          const next = new Set(prev);
          for (const e of prev) { if (!currentEmails.has(e)) next.delete(e); }
          return next;
        });
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [sandboxes, loaded, lab._id, trainingName]);

  const handleDelete = async (email) => {
    setDeleteConfirm(null);
    setDeletingEmails(prev => new Set(prev).add(email));
    try {
      await apiCaller.delete(`/guided-labs/${lab._id}/sandboxes/${encodeURIComponent(email)}`);
      // Mark as deleting in local state immediately
      setSandboxes(prev => prev.map(s => s.email === email ? { ...s, deletionStatus: 'deleting' } : s));
    } catch (err) {
      setDeletingEmails(prev => { const next = new Set(prev); next.delete(email); return next; });
      alert(err.response?.data?.message || 'Delete failed');
    }
  };

  const getStatusBadge = (sb) => {
    if (sb.deletionStatus === 'deleting') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700"><FaSpinner className="w-2.5 h-2.5 animate-spin" /> Deleting</span>;
    if (sb.deletionStatus === 'failed') return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Delete Failed</span>;
    if (sb.status === 'deleted') return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">Deleted</span>;
    if (sb.status === 'expired') return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Expired</span>;
    if (sb.expiresAt) {
      const diff = new Date(sb.expiresAt).getTime() - Date.now();
      if (diff <= 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Expired</span>;
      if (diff < 60 * 60 * 1000) return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">Expiring Soon</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">Active</span>;
  };

  const formatExpiry = (expiresAt) => {
    if (!expiresAt) return '—';
    const d = new Date(expiresAt);
    const diff = d.getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const cloudLabel = lab.sandboxTemplateSlug?.split('-')[0]?.toUpperCase() || lab.cloud?.toUpperCase() || 'Cloud';
  const activeCount = sandboxes.filter(s => s.status === 'active' && s.deletionStatus !== 'deleting').length;
  const expiredCount = sandboxes.filter(s => s.status === 'expired').length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-2">
            <FaCloud className="w-4 h-4 text-amber-600" />
            <h2 className="text-lg font-bold text-slate-800">Manage Sandboxes</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-600">{cloudLabel}</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Lab info */}
          <div className="p-3 mb-4 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-sm font-semibold text-slate-800">{lab.title}</div>
            <div className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
              <FaCloud className="w-3 h-3" /> Template: {lab.sandboxTemplateSlug}
            </div>
          </div>

          {/* Training name input */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={trainingName}
              onChange={e => setTrainingName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchSandboxes()}
              placeholder="Enter training name (e.g. terraformlab)"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              onClick={fetchSandboxes}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? <FaSpinner className="w-3.5 h-3.5 animate-spin" /> : 'Load'}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          {/* Results */}
          {loaded && sandboxes.length > 0 && (
            <>
              {/* Summary */}
              <div className="flex items-center gap-3 mb-3 text-xs text-slate-500">
                <span>{sandboxes.length} sandbox user(s)</span>
                {activeCount > 0 && <span className="text-green-600">{activeCount} active</span>}
                {expiredCount > 0 && <span className="text-red-500">{expiredCount} expired</span>}
              </div>

              {/* Table */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Email</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Username</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Region</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Expires</th>
                      <th className="text-right px-3 py-2 font-medium text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sandboxes.map((sb, i) => (
                      <tr key={`${sb.email}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700 font-mono">{sb.email}</td>
                        <td className="px-3 py-2 text-slate-600 font-mono">{sb.username}</td>
                        <td className="px-3 py-2 text-slate-500">{sb.region || '—'}</td>
                        <td className="px-3 py-2">{getStatusBadge(sb)}</td>
                        <td className="px-3 py-2 text-slate-500">{formatExpiry(sb.expiresAt)}</td>
                        <td className="px-3 py-2 text-right">
                          {sb.deletionStatus === 'deleting' ? (
                            <span className="text-[10px] text-yellow-600 animate-pulse">Cleaning up...</span>
                          ) : sb.deletionStatus === 'failed' ? (
                            <button
                              onClick={() => setDeleteConfirm(sb.email)}
                              className="text-[10px] font-medium text-red-600 hover:text-red-800 underline"
                            >
                              Retry Delete
                            </button>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(sb.email)}
                              className="text-[10px] font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {loaded && sandboxes.length === 0 && !error && (
            <div className="text-center py-8 text-slate-400 text-sm">
              No sandbox users found for this training.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg">
            Close
          </button>
        </div>

        {/* Delete confirmation overlay */}
        {deleteConfirm && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10 rounded-2xl">
            <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm mx-4">
              <p className="text-sm text-slate-700 mb-1">Delete sandbox for <span className="font-semibold">{deleteConfirm}</span>?</p>
              <p className="text-xs text-slate-500 mb-4">This will delete the cloud account and all resources. This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LabCard({ lab, isAdmin, isSuperAdmin, onEdit, onDeploy, onManageSandbox, orgs }) {
  const navigate = useNavigate();
  const CloudIcon = CLOUD_ICONS[lab.cloud]?.icon || Cloud;
  const cloudColor = CLOUD_ICONS[lab.cloud]?.color || 'text-slate-500';
  const CatIcon = CATEGORY_ICONS[lab.category] || BookOpen;
  const canDeploy = isSuperAdmin || isAdmin;
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const orgPickerRef = useRef(null);

  // Close org picker on outside click
  useEffect(() => {
    if (!showOrgPicker) return;
    const handler = (e) => { if (orgPickerRef.current && !orgPickerRef.current.contains(e.target)) setShowOrgPicker(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOrgPicker]);

  const downloadProgress = (org) => {
    setDownloading(true);
    setShowOrgPicker(false);
    apiCaller.get(`/guided-labs/${lab._id}/progress/export?org=${encodeURIComponent(org)}`, { responseType: 'blob' })
      .then(res => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${lab.title.replace(/[^a-zA-Z0-9]/g, '_')}_${org.replace(/[^a-zA-Z0-9]/g, '_')}_progress.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      })
      .catch(err => {
        const msg = err.response?.status === 404 ? `No deployments found for "${org}" on this lab.` : 'Export failed.';
        alert(msg);
      })
      .finally(() => setDownloading(false));
  };

  const handleDownloadClick = (e) => {
    e.stopPropagation();
    if (isSuperAdmin) {
      setShowOrgPicker(!showOrgPicker);
    } else {
      // Admin — auto-download for their org
      const userOrg = localStorage.getItem('organization') || '';
      if (!userOrg) return alert('Organization not found.');
      downloadProgress(userOrg);
    }
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all group ${(isSuperAdmin || isAdmin) ? 'cursor-pointer' : ''}`}
      onClick={() => (isSuperAdmin || isAdmin) && navigate(`/guided-labs/editor/${lab._id}`)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{lab.icon || '📘'}</span>
          <CloudIcon className={`w-4 h-4 ${cloudColor}`} />
        </div>
        {(canDeploy || isSuperAdmin) && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
            {canDeploy && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeploy(lab); }}
                className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-md"
                title="Deploy"
              >
                <FaPlay className="w-3 h-3" />
              </button>
            )}
            {canDeploy && (
              <div className="relative" ref={orgPickerRef}>
                <button
                  onClick={handleDownloadClick}
                  className={`p-1.5 rounded-md ${downloading ? 'text-purple-500 animate-pulse' : 'text-slate-400 hover:text-purple-600 hover:bg-purple-50'}`}
                  title="Download Progress Report"
                  disabled={downloading}
                >
                  <FaDownload className="w-3 h-3" />
                </button>
                {/* Superadmin org picker dropdown */}
                {showOrgPicker && isSuperAdmin && (
                  <div className="absolute right-0 top-8 z-50 bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[180px] max-h-48 overflow-y-auto"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Select Organization</div>
                    {(orgs || []).map(org => (
                      <button
                        key={org}
                        onClick={() => downloadProgress(org)}
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-purple-50 hover:text-purple-700 transition-colors"
                      >
                        {org}
                      </button>
                    ))}
                    {(!orgs || orgs.length === 0) && (
                      <div className="px-3 py-2 text-xs text-slate-400">No organizations found</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {canDeploy && lab.sandboxTemplateSlug && (
              <button
                onClick={(e) => { e.stopPropagation(); onManageSandbox(lab); }}
                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md"
                title="Manage Sandboxes"
              >
                <FaCloud className="w-3 h-3" />
              </button>
            )}
            {isSuperAdmin && (
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(lab._id); }}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                title="Edit"
              >
                <FaEdit className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <h3 className="text-sm font-semibold text-slate-800 mb-1 leading-tight">{lab.title}</h3>
      <p className="text-xs text-slate-500 mb-3 line-clamp-2">{lab.description}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${DIFFICULTY_COLORS[lab.difficulty] || DIFFICULTY_COLORS.beginner}`}>
          {lab.difficulty}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <FaClock className="w-2.5 h-2.5" /> {lab.duration} min
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <Target className="w-3 h-3" /> {lab.stepCount || lab.steps?.length || 0} steps
        </span>
        {lab.category && (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <CatIcon className="w-3 h-3" /> {lab.category}
          </span>
        )}
      </div>

      {lab.tags?.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {lab.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[9px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}

      {/* Org assignment badge (superadmin only) */}
      {isSuperAdmin && (
        <div className="mt-2">
          {!lab.assignedOrgs || lab.assignedOrgs.length === 0 ? (
            <span className="text-[9px] font-medium bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">All Orgs</span>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {lab.assignedOrgs.slice(0, 3).map(org => (
                <span key={org} className="text-[9px] font-medium bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{org}</span>
              ))}
              {lab.assignedOrgs.length > 3 && (
                <span className="text-[9px] font-medium bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">+{lab.assignedOrgs.length - 3}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GuidedLabs() {
  const navigate = useNavigate();
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCloud, setFilterCloud] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [showAIModal, setShowAIModal] = useState(false);
  const [deployLab, setDeployLab] = useState(null);
  const [sandboxManageLab, setSandboxManageLab] = useState(null);
  const [orgs, setOrgs] = useState([]);

  const userType = (() => {
    try {
      const raw = localStorage.getItem('AH1apq12slurt5');
      if (raw === 'z829Sgry6AkYJ') return 'admin';
      if (raw === 'hpQ3s5dK247') return 'superadmin';
      return 'user';
    } catch { return 'user'; }
  })();
  const isSuperAdmin = userType === 'superadmin';
  const isAdmin = ['admin', 'superadmin'].includes(userType);

  // Fetch org list for superadmin progress export
  useEffect(() => {
    if (isSuperAdmin) {
      apiCaller.get('/admin/organization')
        .then(res => setOrgs(res.data?.organization || []))
        .catch(() => {});
    }
  }, [isSuperAdmin]);

  const fetchLabs = useCallback(() => {
    setLoading(true);
    apiCaller.get('/guided-labs')
      .then(res => setLabs(res.data || []))
      .catch(() => setLabs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchLabs();
  }, [fetchLabs]);

  const filtered = useMemo(() => {
    let result = labs;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    if (filterCloud) result = result.filter(l => l.cloud === filterCloud);
    if (filterDifficulty) result = result.filter(l => l.difficulty === filterDifficulty);
    return result;
  }, [labs, searchTerm, filterCloud, filterDifficulty]);

  const clouds = [...new Set(labs.map(l => l.cloud))];
  const difficulties = [...new Set(labs.map(l => l.difficulty))];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" /> Guided Labs
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Step-by-step labs with progress tracking</p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin || isSuperAdmin) && (
            <button
              onClick={() => navigate('/guided-labs/analytics')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors"
            >
              <FaChartBar className="w-3.5 h-3.5" /> Analytics
            </button>
          )}
          {isSuperAdmin && (
            <>
              <button
                onClick={() => setShowAIModal(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg transition-colors"
              >
                <FaRobot className="w-3.5 h-3.5" /> AI Generate
              </button>
              <button
                onClick={() => navigate('/guided-labs/editor')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <FaPlus className="w-3 h-3" /> Create Lab
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search labs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <select
          value={filterCloud}
          onChange={(e) => setFilterCloud(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All clouds</option>
          {clouds.map(c => <option key={c} value={c}>{CLOUD_LABELS[c] || c}</option>)}
        </select>
        <select
          value={filterDifficulty}
          onChange={(e) => setFilterDifficulty(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All levels</option>
          {difficulties.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FaLayerGroup className="w-8 h-8 text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-600">
            {labs.length === 0 ? 'No guided labs yet' : 'No labs match your filters'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {labs.length === 0 && isSuperAdmin ? 'Click "Create Lab" to get started.' : 'Try adjusting your search or filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(lab => (
            <LabCard
              key={lab._id}
              lab={lab}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              orgs={orgs}
              onEdit={(id) => navigate(`/guided-labs/editor/${id}`)}
              onDeploy={(lab) => setDeployLab(lab)}
              onManageSandbox={(lab) => setSandboxManageLab(lab)}
            />
          ))}
        </div>
      )}

      {/* AI Generate Modal */}
      {showAIModal && (
        <AIGenerateModal
          onClose={() => setShowAIModal(false)}
          onLabCreated={fetchLabs}
        />
      )}

      {/* Deploy Modal */}
      {deployLab && (
        <DeployGuidedLabModal
          lab={deployLab}
          onClose={() => setDeployLab(null)}
        />
      )}

      {/* Sandbox Manage Modal */}
      {sandboxManageLab && (
        <SandboxManageModal
          lab={sandboxManageLab}
          onClose={() => setSandboxManageLab(null)}
        />
      )}
    </div>
  );
}
