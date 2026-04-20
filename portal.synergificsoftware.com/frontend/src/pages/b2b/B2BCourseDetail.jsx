import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  FaArrowLeft, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaTimesCircle,
  FaRupeeSign, FaAws, FaMicrosoft, FaGoogle, FaPencilAlt, FaSave, FaPlus,
  FaTrash, FaRocket, FaFilePdf, FaShieldAlt, FaClock, FaUsers, FaFlag,
  FaChevronDown, FaChevronRight, FaTrashAlt, FaCubes, FaServer, FaMemory, FaHdd,
  FaDocker, FaHammer, FaLock, FaUnlock, FaChartLine,
} from 'react-icons/fa';
import apiCaller from '../../services/apiCaller';
import { b2bCourseApiRoutes } from '../../services/b2bApiRoutes';

const VERDICT_STYLES = {
  feasible:     { bg: 'bg-emerald-50',  text: 'text-emerald-800',  border: 'border-emerald-200', icon: FaCheckCircle,        label: 'Feasible',      dot: 'bg-emerald-500' },
  needs_review: { bg: 'bg-amber-50',    text: 'text-amber-800',    border: 'border-amber-200',   icon: FaExclamationTriangle, label: 'Needs review', dot: 'bg-amber-500' },
  partial:      { bg: 'bg-orange-50',   text: 'text-orange-800',   border: 'border-orange-200',  icon: FaExclamationTriangle, label: 'Partial',       dot: 'bg-orange-500' },
  infeasible:   { bg: 'bg-rose-50',     text: 'text-rose-800',     border: 'border-rose-200',    icon: FaTimesCircle,        label: 'Infeasible',    dot: 'bg-rose-500' },
};

const RISK_TIER_STYLES = {
  safe:      { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  moderate:  { bg: 'bg-amber-100',   text: 'text-amber-700' },
  dangerous: { bg: 'bg-rose-100',    text: 'text-rose-700' },
  blocked:   { bg: 'bg-surface-200', text: 'text-surface-700' },
};

function ProviderIcon({ name, className = '' }) {
  if (name === 'aws')   return <FaAws className={`text-[#FF9900] ${className}`} />;
  if (name === 'azure') return <FaMicrosoft className={`text-[#0078D4] ${className}`} />;
  if (name === 'gcp')   return <FaGoogle className={`text-[#4285F4] ${className}`} />;
  if (name === 'multi') return <span className={`text-surface-700 font-semibold ${className}`}>Multi</span>;
  return <span className="text-surface-400">—</span>;
}

function formatInr(n) {
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function Card({ title, subtitle, right, children, className = '' }) {
  return (
    <div className={`bg-white border border-surface-200 rounded-xl shadow-sm ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-100">
          <div>
            {title && <div className="text-sm font-semibold text-surface-900">{title}</div>}
            {subtitle && <div className="text-[11px] text-surface-500 mt-0.5">{subtitle}</div>}
          </div>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent = 'text-surface-900' }) {
  return (
    <div className="flex items-center gap-3">
      {Icon && <div className="h-9 w-9 rounded-lg bg-primary-50 flex items-center justify-center text-primary-600"><Icon className="text-sm" /></div>}
      <div>
        <div className="text-[11px] font-medium text-surface-500 uppercase tracking-wider">{label}</div>
        <div className={`text-base font-semibold ${accent}`}>{value}</div>
      </div>
    </div>
  );
}

/* ------------------------- Override editor modal ------------------------- */

function OverrideEditor({ analysis, onSave, onCancel, saving }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(analysis || {})));

  const updateField = (key, val) => setDraft((d) => ({ ...d, [key]: val }));

  const updateModule = (idx, key, val) => {
    setDraft((d) => {
      const modules = [...(d.modules || [])];
      modules[idx] = { ...modules[idx], [key]: val };
      return { ...d, modules };
    });
  };

  const addModule = () => {
    setDraft((d) => ({
      ...d,
      modules: [...(d.modules || []), { name: 'New module', hours: 1, services: [] }],
    }));
  };

  const removeModule = (idx) => {
    setDraft((d) => ({ ...d, modules: d.modules.filter((_, i) => i !== idx) }));
  };

  const addService = (modIdx) => {
    setDraft((d) => {
      const modules = [...d.modules];
      const services = [...(modules[modIdx].services || []), { name: 'new-service' }];
      modules[modIdx] = { ...modules[modIdx], services };
      return { ...d, modules };
    });
  };

  const updateService = (modIdx, svcIdx, val) => {
    setDraft((d) => {
      const modules = [...d.modules];
      const services = [...modules[modIdx].services];
      services[svcIdx] = { ...services[svcIdx], name: val };
      modules[modIdx] = { ...modules[modIdx], services };
      return { ...d, modules };
    });
  };

  const removeService = (modIdx, svcIdx) => {
    setDraft((d) => {
      const modules = [...d.modules];
      modules[modIdx] = {
        ...modules[modIdx],
        services: modules[modIdx].services.filter((_, i) => i !== svcIdx),
      };
      return { ...d, modules };
    });
  };

  const totalHours = (draft.modules || []).reduce((s, m) => s + (Number(m.hours) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] bg-white rounded-xl shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 flex-shrink-0">
          <div>
            <div className="text-base font-semibold text-surface-900">Edit analysis</div>
            <div className="text-xs text-surface-500 mt-0.5">Your changes will recompute feasibility and cost. Original LLM output is preserved.</div>
          </div>
          <button onClick={onCancel} className="text-surface-400 hover:text-surface-700 text-lg leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Top fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Course name</label>
              <input
                type="text"
                value={draft.courseName || ''}
                onChange={(e) => updateField('courseName', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Provider</label>
              <select
                value={draft.detectedProvider || 'aws'}
                onChange={(e) => updateField('detectedProvider', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
                <option value="multi">Multi-cloud</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Description</label>
            <textarea
              value={draft.description || ''}
              onChange={(e) => updateField('description', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
            />
          </div>

          {/* Modules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-surface-900">
                Modules <span className="text-surface-500 font-normal text-xs">· {draft.modules?.length || 0} · total {totalHours}h</span>
              </div>
              <button onClick={addModule} className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-md">
                <FaPlus className="text-[10px]" /> Add module
              </button>
            </div>

            <div className="space-y-2">
              {(draft.modules || []).map((mod, idx) => (
                <div key={idx} className="border border-surface-200 rounded-lg p-3 bg-surface-50">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={mod.name || ''}
                      onChange={(e) => updateModule(idx, 'name', e.target.value)}
                      placeholder="Module name"
                      className="flex-1 px-2 py-1.5 text-sm border border-surface-300 rounded-md bg-white focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                    <input
                      type="number" min={0} step={0.5}
                      value={mod.hours || 0}
                      onChange={(e) => updateModule(idx, 'hours', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1.5 text-sm border border-surface-300 rounded-md bg-white focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                    <span className="text-xs text-surface-500">hrs</span>
                    <button onClick={() => removeModule(idx)} className="text-rose-500 hover:text-rose-700 p-1.5">
                      <FaTrash className="text-xs" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(mod.services || []).map((svc, svcIdx) => (
                      <div key={svcIdx} className="flex items-center gap-1 bg-white border border-surface-300 rounded-md pl-2 pr-1 py-0.5">
                        <input
                          type="text"
                          value={svc.name || ''}
                          onChange={(e) => updateService(idx, svcIdx, e.target.value)}
                          className="text-xs bg-transparent outline-none w-24"
                        />
                        <button onClick={() => removeService(idx, svcIdx)} className="text-surface-400 hover:text-rose-600 text-xs leading-none px-0.5">
                          &times;
                        </button>
                      </div>
                    ))}
                    <button onClick={() => addService(idx)} className="flex items-center gap-1 text-[11px] text-primary-600 hover:bg-primary-50 px-2 py-0.5 rounded-md">
                      <FaPlus className="text-[9px]" /> service
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-200 flex-shrink-0">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={() => onSave({ ...draft, totalHours })}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
          >
            {saving ? <FaSpinner className="animate-spin" /> : <FaSave />}
            Save & recompute
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Main page ------------------------------ */

export default function B2BCourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [showCostDetails, setShowCostDetails] = useState(false);
  const isSuperAdmin = localStorage.getItem('AH1apq12slurt5') === 'hpQ3s5dK247';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await apiCaller.get(b2bCourseApiRoutes.get(id));
      setDoc(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const currentAnalysis = doc?.overrides?.analysis || doc?.analysis;

  const handleSaveOverride = async (updatedAnalysis) => {
    setSaving(true); setActionMsg(null);
    try {
      const res = await apiCaller.patch(b2bCourseApiRoutes.override(id), {
        analysis: updatedAnalysis,
        recompute: true,
      });
      setDoc((d) => ({
        ...d,
        overrides: res.data.overrides,
        feasibility: res.data.feasibility,
        cost: res.data.cost,
      }));
      setEditing(false);
      setActionMsg({ kind: 'success', text: 'Analysis updated and recomputed.' });
    } catch (err) {
      setActionMsg({ kind: 'error', text: err?.response?.data?.error || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    const label = currentAnalysis?.courseName || doc.originalFilename;
    const warn = doc.generatedTemplateId
      ? `\n\nNote: the generated SandboxTemplate will NOT be deleted — remove it separately if unused.`
      : '';
    if (!window.confirm(`Delete analysis for "${label}"?${warn}`)) return;
    setDeleting(true); setActionMsg(null);
    try {
      await apiCaller.delete(b2bCourseApiRoutes.delete(id));
      navigate('/b2b/courses');
    } catch (err) {
      setActionMsg({ kind: 'error', text: err?.response?.data?.error || 'Failed to delete' });
      setDeleting(false);
    }
  };

  const handleGenerateTemplate = async (force = false) => {
    if (!doc) return;
    const verdict = doc.feasibility?.verdict;
    if (verdict === 'infeasible' && !force) {
      if (!window.confirm('This analysis is marked infeasible. Generate the template anyway?')) return;
      return handleGenerateTemplate(true);
    }
    setGenerating(true); setActionMsg(null);
    try {
      const res = await apiCaller.post(b2bCourseApiRoutes.generateTemplate(id), force ? { force: true } : {});
      setActionMsg({ kind: 'success', text: `SandboxTemplate created (${res.data.templateId}).` });
      await load();
    } catch (err) {
      setActionMsg({ kind: 'error', text: err?.response?.data?.error || 'Failed to generate template' });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-surface-400">
        <FaSpinner className="animate-spin text-2xl" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate('/b2b/courses')} className="flex items-center gap-2 text-sm text-surface-600 hover:text-surface-900 mb-4">
          <FaArrowLeft /> Back
        </button>
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          {error || 'Not found'}
        </div>
      </div>
    );
  }

  const verdict = doc.feasibility?.verdict || 'partial';
  const vStyle = VERDICT_STYLES[verdict] || VERDICT_STYLES.partial;
  const VIcon = vStyle.icon;
  const isOverridden = !!doc.overrides?.analysis;
  const templateGenerated = doc.status === 'template_generated';

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button onClick={() => navigate('/b2b/courses')} className="flex items-center gap-2 text-sm text-surface-600 hover:text-surface-900 mb-3">
          <FaArrowLeft className="text-xs" /> Back to analyses
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <ProviderIcon name={currentAnalysis?.detectedProvider} className="text-2xl" />
              <h1 className="text-xl font-semibold text-surface-900 truncate">
                {currentAnalysis?.courseName || doc.originalFilename}
              </h1>
              {isOverridden && (
                <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">EDITED</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-surface-500">
              <span className="flex items-center gap-1"><FaFilePdf className="text-rose-500" /> {doc.originalFilename}</span>
              {doc.pageCount && <span>· {doc.pageCount} pages</span>}
              {doc.customerName && <span>· Customer: <span className="text-surface-700 font-medium">{doc.customerName}</span></span>}
              <span>· Uploaded by {doc.uploadedBy}</span>
            </div>
            {currentAnalysis?.description && (
              <p className="text-sm text-surface-600 mt-3 max-w-3xl">{currentAnalysis.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                apiCaller.get(b2bCourseApiRoutes.get(id).replace(/\/[^/]+$/, `/${id}/pdf`), { responseType: 'blob' })
                  .then(res => {
                    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                    const a = document.createElement('a');
                    a.href = url; a.download = `analysis-${id}.pdf`; a.click();
                    URL.revokeObjectURL(url);
                  }).catch(() => {});
              }}
              title="Download analysis as PDF"
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100 rounded-lg border border-surface-300"
            >
              <FaFilePdf className="text-xs text-rose-500" /> PDF
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Delete this analysis"
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-surface-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-surface-300 hover:border-rose-200 disabled:opacity-50"
            >
              {deleting ? <FaSpinner className="animate-spin text-xs" /> : <FaTrashAlt className="text-xs" />}
              Delete
            </button>
            {!templateGenerated && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100 rounded-lg border border-surface-300"
              >
                <FaPencilAlt className="text-xs" /> Edit
              </button>
            )}
            {currentAnalysis?.recommendedDeployment === 'container_lab' ? (
              <div className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg border border-indigo-200">
                <FaCubes /> Workspace lab — see panel below
              </div>
            ) : !templateGenerated ? (
              <button
                onClick={() => handleGenerateTemplate(false)}
                disabled={generating || !doc.analysis}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 shadow-sm"
              >
                {generating ? <FaSpinner className="animate-spin" /> : <FaRocket />}
                Lock deal & generate template
              </button>
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200">
                <FaCheckCircle /> Template generated
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm border ${
          actionMsg.kind === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-rose-50 border-rose-200 text-rose-700'
        }`}>
          {actionMsg.text}
        </div>
      )}

      {/* Container lab recommendation banner — renders ONLY when analyzer
          classified the course as container_lab. Shown above the standard
          cloud-sandbox verdict banner so ops sees it first. */}
      {currentAnalysis?.recommendedDeployment === 'container_lab' && currentAnalysis?.containerLab && (
        <ContainerLabPanel cl={currentAnalysis.containerLab} seats={doc.seats} />
      )}

      {/* Container feasibility — deterministic catalog match. Shown only for
          container_lab analyses. The verdict here is computed by the engine,
          not the LLM, so it's reproducible and auditable. */}
      {currentAnalysis?.recommendedDeployment === 'container_lab' && doc.containerFeasibility && (
        <ContainerFeasibilityCard cf={doc.containerFeasibility} />
      )}

      {/* Verdict banner — only meaningful for cloud_sandbox courses. */}
      {currentAnalysis?.recommendedDeployment !== 'container_lab' && (
        <div className={`rounded-xl border ${vStyle.border} ${vStyle.bg} px-5 py-4`}>
          <div className="flex items-center gap-3">
            <VIcon className={`text-2xl ${vStyle.text}`} />
            <div className="flex-1">
              <div className={`text-base font-semibold ${vStyle.text}`}>Verdict: {vStyle.label}</div>
              <div className="text-xs mt-0.5 text-surface-600">
                {verdict === 'feasible'     && 'All services supported with safe defaults. Ready to ship.'}
                {verdict === 'needs_review' && 'Everything supported, but some services are expensive/moderate — eyeball the budget.'}
                {verdict === 'partial'      && 'Some services unsupported. Can ship if customer accepts the gap.'}
                {verdict === 'infeasible'   && 'Core services missing. Review carefully before locking.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top stats — hidden for container labs since the cost model differs. */}
      {currentAnalysis?.recommendedDeployment !== 'container_lab' && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {showCostDetails && (
          <>
          <Card>
            <Stat
              label="Per seat"
              value={<><FaRupeeSign className="inline text-xs" />{formatInr(doc.cost?.perSeatInr)}</>}
              icon={FaRupeeSign}
            />
          </Card>
          <Card>
            <Stat
              label="Total quote"
              value={<><FaRupeeSign className="inline text-xs" />{formatInr(doc.cost?.totalInr)}</>}
              icon={FaRupeeSign}
              accent="text-primary-700"
            />
          </Card>
          </>
          )}
          <Card><Stat label="Seats" value={doc.seats || 1} icon={FaUsers} /></Card>
          <Card><Stat label="Lab hours" value={`${currentAnalysis?.totalHours || 0}h`} icon={FaClock} /></Card>
          <Card><Stat label="Cleanup TTL" value={`${doc.requestedTtlHours || 4}h`} icon={FaClock} /></Card>
        </div>
      )}

      {/* Cost Simulator */}
      <CostSimulator
        basePerSeatInr={doc.cost?.perSeatInr || 0}
        baseTotalInr={doc.cost?.totalInr || 0}
        baseSeats={doc.seats || 1}
        baseTotalHours={currentAnalysis?.totalHours || 0}
        baseTtlHours={doc.requestedTtlHours || 4}
        breakdown={doc.cost?.breakdown || []}
        marginPercent={doc.cost?.marginPercent || 40}
        baselineSeatInr={doc.cost?.baselineSeatInr || 20}
        isContainerLab={currentAnalysis?.recommendedDeployment === 'container_lab'}
        containerRate={currentAnalysis?.containerLab?.resourcesPerSeat ? 0.68 : 0}
      />

      {currentAnalysis?.recommendedDeployment !== 'container_lab' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Feasibility */}
        <Card title="Feasibility" subtitle={`${doc.feasibility?.supported?.length || 0} ok · ${doc.feasibility?.needsReview?.length || 0} review · ${doc.feasibility?.unsupported?.length || 0} blocked`} className="lg:col-span-2">
          <div className="space-y-4">
            {doc.feasibility?.riskFlags?.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 mb-1.5">
                  <FaFlag /> Risk flags
                </div>
                <ul className="space-y-1">
                  {doc.feasibility.riskFlags.map((f, i) => (
                    <li key={i} className="text-xs text-amber-700">• {f}</li>
                  ))}
                </ul>
              </div>
            )}

            <FeasibilityGroup
              title="Supported"
              items={doc.feasibility?.supported || []}
              tint="emerald"
            />
            <FeasibilityGroup
              title="Needs review"
              items={doc.feasibility?.needsReview || []}
              tint="amber"
            />
            <FeasibilityGroup
              title="Unsupported / blocked"
              items={doc.feasibility?.unsupported || []}
              tint="rose"
            />

            {doc.cost?.unpriced?.length > 0 && (
              <div className="text-[11px] text-surface-500 italic pt-2 border-t border-surface-100">
                Unpriced (not in catalog, excluded from cost): {doc.cost.unpriced.map((u) => u.service).join(', ')}
              </div>
            )}
          </div>
        </Card>

        {/* Cost toggle — only superadmin sees the lock icon */}
        {isSuperAdmin && (
          <div className="flex justify-end -mb-2">
            <button
              onClick={() => setShowCostDetails(!showCostDetails)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
              title={showCostDetails ? 'Hide cost details' : 'Show cost details (superadmin only)'}
            >
              {showCostDetails ? <FaUnlock className="w-2.5 h-2.5" /> : <FaLock className="w-2.5 h-2.5" />}
              {showCostDetails ? 'Hide costs' : ''}
            </button>
          </div>
        )}

        {/* Cost breakdown — hidden by default, superadmin toggle */}
        {showCostDetails && (
        <Card title="Cost breakdown" subtitle={`Margin: ${doc.cost?.marginPercent || 0}% · baseline per seat: ₹${doc.cost?.baselineSeatInr || 0}`}>
          {doc.cost?.breakdown?.length > 0 ? (
            <div className="max-h-80 overflow-y-auto -mx-2">
              <table className="w-full text-xs">
                <thead className="text-surface-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-2 py-1">Service</th>
                    <th className="text-right px-2 py-1">Hrs</th>
                    <th className="text-right px-2 py-1">₹/hr</th>
                    <th className="text-right px-2 py-1">Sub</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.cost.breakdown.map((b, i) => (
                    <tr key={i} className="border-t border-surface-100">
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-surface-800">{b.service}</div>
                        <div className="text-[10px] text-surface-500 truncate max-w-[120px]">{b.module}</div>
                      </td>
                      <td className="text-right px-2 py-1.5 text-surface-700">{b.hours}</td>
                      <td className="text-right px-2 py-1.5 text-surface-700">{b.rate}</td>
                      <td className="text-right px-2 py-1.5 font-medium text-surface-900">{b.subtotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-surface-500">No cost breakdown</div>
          )}
        </Card>
        )}
      </div>
      )}

      {/* Modules */}
      <Card title="Modules" subtitle={`${currentAnalysis?.modules?.length || 0} modules · ${currentAnalysis?.totalHours || 0}h total`}>
        {currentAnalysis?.modules?.length > 0 ? (
          <div className="space-y-2">
            {currentAnalysis.modules.map((m, i) => (
              <ModuleRow key={i} module={m} />
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-surface-500">No modules extracted</div>
        )}
      </Card>

      {/* Special requirements */}
      {currentAnalysis?.specialRequirements?.length > 0 && (
        <Card title="Special requirements">
          <div className="flex flex-wrap gap-2">
            {currentAnalysis.specialRequirements.map((r, i) => (
              <span key={i} className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full">
                {r}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Generated template — prominent CTA */}
      {templateGenerated && doc.generatedTemplateId && (
        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
              <FaCheckCircle className="text-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider mb-1">Sandbox template ready</div>
              <div className="text-base font-semibold text-surface-900 truncate">
                {doc.generatedTemplateName || currentAnalysis?.courseName || 'Course template'}
              </div>
              <div className="text-xs text-surface-600 mt-1">
                {doc.feasibility?.supported?.length || 0} allowed services · {doc.feasibility?.unsupported?.length || 0} blocked · TTL {doc.requestedTtlHours}h
              </div>
              <div className="text-[11px] text-surface-500 mt-1 font-mono truncate">
                slug: {doc.generatedTemplateSlug || doc.generatedTemplateId}
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              {doc.generatedTemplateSlug ? (
                <Link
                  to={`/courses/${doc.generatedTemplateSlug}`}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm whitespace-nowrap"
                >
                  <FaRocket /> Open & deploy
                </Link>
              ) : (
                <Link
                  to="/courses"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm whitespace-nowrap"
                >
                  <FaRocket /> Open Course Catalog
                </Link>
              )}
              <Link
                to="/courses"
                className="text-[11px] text-center text-surface-500 hover:text-surface-700"
              >
                View all templates →
              </Link>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-emerald-200/60 text-xs text-surface-600 space-y-1">
            <div className="font-semibold text-surface-700">How to deploy for the customer:</div>
            <div>1. Click <strong>Open & deploy</strong> above — this opens the template in your Course Catalog.</div>
            <div>2. On the catalog page, click the <strong>Deploy</strong> button to provision a real AWS/Azure/GCP sandbox for a student.</div>
            <div>3. Credentials, access URL, region, TTL, and budget are shown immediately. Copy and share with the customer.</div>
            <div>4. For bulk deployment (e.g. 25 seats), use your existing bulk sandbox creation flow with this template's slug.</div>
          </div>
        </div>
      )}

      {editing && (
        <OverrideEditor
          analysis={currentAnalysis}
          onSave={handleSaveOverride}
          onCancel={() => setEditing(false)}
          saving={saving}
        />
      )}
    </div>
  );
}

/* -------------------------- Small subcomponents -------------------------- */

function FeasibilityGroup({ title, items, tint }) {
  const [open, setOpen] = useState(true);
  if (!items || items.length === 0) return null;
  const palette = {
    emerald: { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    amber:   { dot: 'bg-amber-500',   pill: 'bg-amber-50 text-amber-700 border-amber-200' },
    rose:    { dot: 'bg-rose-500',    pill: 'bg-rose-50 text-rose-700 border-rose-200' },
  }[tint];

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs font-semibold text-surface-700 mb-2 hover:text-surface-900"
      >
        <span className={`h-2 w-2 rounded-full ${palette.dot}`} />
        {title} <span className="text-surface-500 font-normal">({items.length})</span>
        {open ? <FaChevronDown className="text-[9px] ml-auto" /> : <FaChevronRight className="text-[9px] ml-auto" />}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5 pl-4">
          {items.map((it, i) => (
            <div
              key={i}
              title={it.reason || ''}
              className={`px-2 py-0.5 text-[11px] font-medium rounded-md border ${palette.pill}`}
            >
              {it.service}
              {it.category && <span className="text-surface-500 ml-1 font-normal">· {it.category}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerLabPanel({ cl, seats }) {
  const totalRamGb = (cl.resourcesPerSeat?.memoryGb || 0) * (seats || 1);
  const totalVcpu = (cl.resourcesPerSeat?.vcpu || 0) * (seats || 1);
  return (
    <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 p-6">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
          <FaCubes className="text-xl" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-indigo-700 uppercase tracking-wider mb-1">Workspace Lab Recommended</div>
          <div className="text-base font-semibold text-surface-900">
            This course should be deployed as a workspace lab, not cloud accounts
          </div>
          <div className="text-xs text-surface-700 mt-1">
            The customer asked for VMs preloaded with software (not cloud-service exposure). Workspaces start in seconds and give each student a fully isolated environment with all tools pre-installed.
          </div>
        </div>
      </div>

      {/* Customer's requested VM spec */}
      {cl.requestedVmSpec && (
        <div className="mt-4 pt-4 border-t border-indigo-200/60">
          <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide mb-2">What the customer asked for</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {cl.requestedVmSpec.vcpu && <SpecChip icon={FaServer} label="vCPU" value={cl.requestedVmSpec.vcpu} />}
            {cl.requestedVmSpec.ramGb && <SpecChip icon={FaMemory} label="RAM" value={cl.requestedVmSpec.ramGb} />}
            {cl.requestedVmSpec.storageGb && <SpecChip icon={FaHdd} label="Storage" value={cl.requestedVmSpec.storageGb} />}
            {cl.requestedVmSpec.os && <SpecChip icon={FaServer} label="OS" value={cl.requestedVmSpec.os} />}
          </div>
          {cl.requestedVmSpec.software?.length > 0 && (
            <div className="mt-2">
              <span className="text-[11px] text-surface-500 mr-2">Software:</span>
              {cl.requestedVmSpec.software.map((s, i) => (
                <span key={i} className="inline-block mr-1 mb-1 px-2 py-0.5 text-[11px] font-medium bg-white border border-indigo-200 rounded-md text-indigo-700">{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Platform recommendation */}
      <div className="mt-4 pt-4 border-t border-indigo-200/60">
        <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide mb-2">Recommended</div>
        {cl.recommendedImageKey && (
          <div className="bg-white border border-indigo-200 rounded-lg px-4 py-3 mb-3">
            <div className="text-xs text-surface-500">Catalog image</div>
            <div className="text-sm font-semibold text-surface-900 font-mono">{cl.recommendedImageKey}</div>
            {cl.recommendedImageLabel && <div className="text-xs text-surface-600 mt-0.5">{cl.recommendedImageLabel}</div>}
          </div>
        )}

        {cl.proposedStack?.length > 0 && (
          <div className="space-y-1.5 mb-3">
            <div className="text-[11px] text-surface-500">Pre-installed components:</div>
            {cl.proposedStack.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {s.preInstalled !== false ? <FaCheckCircle className="text-emerald-500 flex-shrink-0" /> : <FaExclamationTriangle className="text-amber-500 flex-shrink-0" />}
                <span className="font-medium text-surface-800">{s.component}</span>
                <span className="text-surface-500">— {s.purpose}</span>
              </div>
            ))}
          </div>
        )}

        {/* Per-seat resources + total host budget */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          {cl.resourcesPerSeat?.vcpu !== undefined && (
            <SpecChip icon={FaServer} label="Per-seat vCPU" value={cl.resourcesPerSeat.vcpu} indigo />
          )}
          {cl.resourcesPerSeat?.memoryGb !== undefined && (
            <SpecChip icon={FaMemory} label="Per-seat RAM" value={`${cl.resourcesPerSeat.memoryGb} GB`} indigo />
          )}
          {cl.resourcesPerSeat?.storageGb !== undefined && (
            <SpecChip icon={FaHdd} label="Per-seat disk" value={`${cl.resourcesPerSeat.storageGb} GB`} indigo />
          )}
          {cl.estimatedSavingsVsVmPercent !== undefined && (
            <SpecChip icon={FaRupeeSign} label="Savings vs VM" value={`~${cl.estimatedSavingsVsVmPercent}%`} indigo />
          )}
        </div>

        {/* Host budget for the batch */}
        {seats > 1 && totalRamGb > 0 && (
          <div className="mt-3 px-3 py-2 bg-white border border-indigo-200 rounded-md text-xs text-surface-700">
            <strong>Host needed for {seats} seats:</strong> ~{totalVcpu} vCPU, ~{totalRamGb} GB RAM (one beefy host or 2-3 medium ones).
          </div>
        )}

        {cl.notes && (
          <div className="mt-3 text-xs text-surface-700 italic">{cl.notes}</div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-indigo-200/60 text-xs text-surface-700 space-y-1">
        <div className="font-semibold text-surface-800">How to deploy:</div>
        <div>1. Open the existing Container Catalog in the sidebar (Infrastructure → Containers).</div>
        <div>2. Pick the <strong>{cl.recommendedImageKey || 'recommended'}</strong> image.</div>
        <div>3. Deploy {seats} container{seats === 1 ? '' : 's'} with the per-seat resources above.</div>
        <div>4. Each student gets a browser terminal with the full stack pre-installed and ready to use.</div>
      </div>
    </div>
  );
}

function SpecChip({ icon: Icon, label, value, indigo }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${indigo ? 'bg-white border-indigo-200' : 'bg-white border-surface-200'}`}>
      <Icon className={`text-sm ${indigo ? 'text-indigo-600' : 'text-surface-500'}`} />
      <div className="min-w-0">
        <div className={`text-[10px] font-medium uppercase tracking-wider ${indigo ? 'text-indigo-700' : 'text-surface-500'}`}>{label}</div>
        <div className="text-xs font-semibold text-surface-900 truncate">{value}</div>
      </div>
    </div>
  );
}

/**
 * Container feasibility card — renders the deterministic engine result.
 * Shows: verdict banner, best-match image with coverage breakdown
 * (preinstalled / addable at runtime / missing), risk flags, and up to 3
 * alternative images for ops to consider.
 */
function ContainerFeasibilityCard({ cf }) {
  const verdict = cf.verdict || 'needs_review';
  const vStyle = VERDICT_STYLES[verdict] || VERDICT_STYLES.partial;
  const VIcon = vStyle.icon;
  const best = cf.bestMatch;

  return (
    <Card title="Workspace catalog feasibility" subtitle="Walked all 24 catalog images. Best-fit is shown below; alternatives are listed underneath.">
      {/* Verdict banner */}
      <div className={`rounded-lg border ${vStyle.border} ${vStyle.bg} px-4 py-3 mb-4`}>
        <div className="flex items-center gap-3">
          <VIcon className={`text-xl ${vStyle.text}`} />
          <div className="flex-1">
            <div className={`text-sm font-semibold ${vStyle.text}`}>Verdict: {vStyle.label}</div>
            <div className="text-xs text-surface-600 mt-0.5">
              {verdict === 'feasible'    && 'All requested software is preinstalled in the best-match image. Deploy as-is.'}
              {verdict === 'needs_review' && 'Best-match image covers everything, but some items need to be installed at container start. Verify the start time impact.'}
              {verdict === 'partial'     && 'Best-match image covers most of the stack. Some items have no catalog support — review the gap with the customer.'}
              {verdict === 'infeasible'  && 'No catalog image is a good fit. Either build a custom image or use the multi-container compose mode.'}
            </div>
          </div>
        </div>
      </div>

      {/* Risk flags */}
      {cf.riskFlags?.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 mb-1">
            <FaFlag /> Risk flags
          </div>
          <ul className="space-y-1">
            {cf.riskFlags.map((f, i) => (
              <li key={i} className="text-xs text-amber-700">• {f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Best match */}
      {best && (
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4 mb-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
                <FaCheckCircle />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Best match</div>
                <div className="text-sm font-semibold text-surface-900">{best.label}</div>
                <div className="text-[11px] text-surface-500 font-mono mt-0.5">key: {best.imageKey}</div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-bold text-emerald-700">{best.coveragePercent}%</div>
              <div className="text-[10px] text-surface-500 uppercase tracking-wider">preinstalled</div>
              {best.softCoveragePercent !== best.coveragePercent && (
                <div className="text-[11px] text-emerald-600 mt-0.5">+{best.softCoveragePercent - best.coveragePercent}% addable</div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {best.matched?.length > 0 && (
              <CoverageRow label="Preinstalled" items={best.matched} icon={FaCheckCircle} color="emerald" />
            )}
            {best.addable?.length > 0 && (
              <CoverageRow label="Addable at runtime" items={best.addable} icon={FaPlus} color="amber" />
            )}
            {best.missing?.length > 0 && (
              <CoverageRow label="Missing (no catalog support)" items={best.missing} icon={FaTimesCircle} color="rose" />
            )}
          </div>
        </div>
      )}

      {/* Build Custom Image — shows when there are missing items */}
      {best?.missing?.length > 0 && verdict !== 'feasible' && (
        <BuildCustomImageButton
          software={cf.requestedSoftware || []}
          courseName={cf.requestedSoftwareRaw?.[0] || 'Custom Lab'}
        />
      )}

      {/* Alternatives */}
      {cf.alternatives?.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider mb-2">Alternative images</div>
          <div className="space-y-1.5">
            {cf.alternatives.map((alt) => (
              <div key={alt.imageKey} className="flex items-center justify-between px-3 py-2 bg-surface-50 border border-surface-200 rounded-md">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-surface-800 truncate">{alt.label}</div>
                  <div className="text-[10px] text-surface-500 font-mono">{alt.imageKey}</div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className="text-sm font-semibold text-surface-700">{alt.coveragePercent}%</div>
                  {alt.softCoveragePercent !== alt.coveragePercent && (
                    <div className="text-[10px] text-surface-500">+{alt.softCoveragePercent - alt.coveragePercent}% addable</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cf.requestedSoftware?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-surface-100 text-[11px] text-surface-500">
          <strong>Requested software ({cf.requestedSoftware.length}):</strong>{' '}
          {cf.requestedSoftware.join(', ')}
        </div>
      )}
    </Card>
  );
}

function CoverageRow({ label, items, icon: Icon, color }) {
  const palette = {
    emerald: { dot: 'text-emerald-500', pill: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    amber:   { dot: 'text-amber-500',   pill: 'bg-amber-100 text-amber-800 border-amber-200' },
    rose:    { dot: 'text-rose-500',    pill: 'bg-rose-100 text-rose-700 border-rose-200' },
  }[color];
  return (
    <div className="flex items-start gap-2">
      <Icon className={`text-xs mt-1 flex-shrink-0 ${palette.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-surface-600 mb-1">{label} ({items.length})</div>
        <div className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <span key={i} className={`px-2 py-0.5 text-[11px] font-medium rounded-md border ${palette.pill}`}>
              {it}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleRow({ module: mod }) {
  const [open, setOpen] = useState(false);
  const serviceCount = mod.services?.length || 0;
  return (
    <div className="border border-surface-200 rounded-lg">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50"
      >
        {open ? <FaChevronDown className="text-[10px] text-surface-400" /> : <FaChevronRight className="text-[10px] text-surface-400" />}
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-surface-900">{mod.name}</div>
          <div className="text-[11px] text-surface-500">{serviceCount} service{serviceCount === 1 ? '' : 's'}</div>
        </div>
        <div className="text-sm font-medium text-surface-700">{mod.hours || 0}h</div>
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-surface-100 bg-surface-50">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(mod.services || []).map((s, i) => (
              <span key={i} title={s.usage || ''} className="px-2 py-0.5 text-[11px] font-medium bg-white border border-surface-200 rounded-md text-surface-700">
                {s.name}
              </span>
            ))}
          </div>
          {mod.notes && <div className="text-xs text-surface-600 italic">{mod.notes}</div>}
        </div>
      )}
    </div>
  );
}

/* ----------------------- Cost Simulator (What-If) ----------------------- */

function CostSimulator({ basePerSeatInr, baseTotalInr, baseSeats, baseTotalHours, baseTtlHours, breakdown, marginPercent, baselineSeatInr, isContainerLab, containerRate }) {
  const [simSeats, setSimSeats] = useState(baseSeats);
  const [simTotalHours, setSimTotalHours] = useState(baseTotalHours);
  const [simTtlHours, setSimTtlHours] = useState(baseTtlHours);
  const [open, setOpen] = useState(false);

  // Recalculate cost based on changed parameters
  const hourRatio = baseTotalHours > 0 ? simTotalHours / baseTotalHours : 1;

  let simPerSeat, simTotal;
  if (isContainerLab) {
    // Container: rate per hour × total hours
    simPerSeat = Math.ceil((containerRate || 0.68) * simTotalHours);
    simTotal = simPerSeat * simSeats;
  } else {
    // Cloud sandbox: scale the per-seat cost proportionally to hours
    simPerSeat = Math.ceil(basePerSeatInr * hourRatio);
    simTotal = simPerSeat * simSeats;
  }

  // TTL impact: more cleanup cycles = slightly more overhead cost
  const baseSessions = baseTotalHours / Math.max(baseTtlHours, 1);
  const simSessions = simTotalHours / Math.max(simTtlHours, 1);
  const sessionOverhead = Math.ceil((simSessions - baseSessions) * 5); // ₹5 per extra session overhead
  const adjustedPerSeat = Math.max(simPerSeat + sessionOverhead, simPerSeat);
  const adjustedTotal = adjustedPerSeat * simSeats;

  const changed = simSeats !== baseSeats || simTotalHours !== baseTotalHours || simTtlHours !== baseTtlHours;

  return (
    <Card
      title={<span className="flex items-center gap-2"><FaChartLine className="text-indigo-500" /> Cost Simulator</span>}
      subtitle="Adjust seats, lab hours, and cleanup TTL to see instant cost impact"
      right={
        <button onClick={() => setOpen(!open)} className="text-xs text-indigo-600 hover:underline">
          {open ? 'Collapse' : 'Expand'}
        </button>
      }
    >
      {open && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Seats slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Seats</label>
                <span className="text-sm font-bold text-surface-900">{simSeats}</span>
              </div>
              <input type="range" min={1} max={500} value={simSeats} onChange={e => setSimSeats(+e.target.value)}
                className="w-full accent-indigo-600" />
              <div className="flex justify-between text-[10px] text-surface-400 mt-1"><span>1</span><span>500</span></div>
              <input type="number" min={1} max={999} value={simSeats} onChange={e => setSimSeats(Math.max(1, +e.target.value))}
                className="w-full mt-2 px-3 py-1.5 text-sm border border-surface-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>

            {/* Total hours slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Total Lab Hours</label>
                <span className="text-sm font-bold text-surface-900">{simTotalHours}h</span>
              </div>
              <input type="range" min={1} max={500} value={simTotalHours} onChange={e => setSimTotalHours(+e.target.value)}
                className="w-full accent-indigo-600" />
              <div className="flex justify-between text-[10px] text-surface-400 mt-1"><span>1h</span><span>500h</span></div>
              <input type="number" min={1} max={999} value={simTotalHours} onChange={e => setSimTotalHours(Math.max(1, +e.target.value))}
                className="w-full mt-2 px-3 py-1.5 text-sm border border-surface-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>

            {/* TTL selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Cleanup TTL</label>
                <span className="text-sm font-bold text-surface-900">{simTtlHours}h</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[2, 4, 8, 12, 24, 48, 72, 96].map(h => (
                  <button key={h} onClick={() => setSimTtlHours(h)}
                    className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                      simTtlHours === h ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-surface-700 border-surface-200 hover:border-indigo-400'
                    }`}>
                    {h}h
                  </button>
                ))}
              </div>
              <input type="number" min={1} max={999} value={simTtlHours} onChange={e => setSimTtlHours(Math.max(1, +e.target.value))}
                className="w-full mt-2 px-3 py-1.5 text-sm border border-surface-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </div>
          </div>

          {/* Results comparison */}
          <div className={`rounded-xl p-5 border-2 ${changed ? 'border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50' : 'border-surface-200 bg-surface-50'}`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Per Seat</div>
                <div className="text-lg font-bold text-surface-900 mt-1">
                  <FaRupeeSign className="inline text-xs" />{formatInr(adjustedPerSeat)}
                </div>
                {changed && basePerSeatInr > 0 && (
                  <div className="text-[11px] text-surface-400 line-through mt-0.5">
                    <FaRupeeSign className="inline text-[9px]" />{formatInr(basePerSeatInr)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Total Quote</div>
                <div className="text-lg font-bold text-indigo-700 mt-1">
                  <FaRupeeSign className="inline text-xs" />{formatInr(adjustedTotal)}
                </div>
                {changed && baseTotalInr > 0 && (
                  <div className="text-[11px] text-surface-400 line-through mt-0.5">
                    <FaRupeeSign className="inline text-[9px]" />{formatInr(baseTotalInr)}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Sessions/Student</div>
                <div className="text-lg font-bold text-surface-900 mt-1">{Math.ceil(simSessions)}</div>
                <div className="text-[11px] text-surface-500 mt-0.5">{simTotalHours}h / {simTtlHours}h TTL</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Daily Schedule</div>
                <div className="text-lg font-bold text-surface-900 mt-1">
                  {simTtlHours <= 24 ? `${Math.floor(24/simTtlHours)} sessions/day` : `${Math.ceil(simTtlHours/24)}d per session`}
                </div>
                <div className="text-[11px] text-surface-500 mt-0.5">{Math.ceil(simTotalHours / (simTtlHours <= 8 ? simTtlHours * 2 : simTtlHours))} working days</div>
              </div>
            </div>

            {changed && (
              <div className="mt-4 pt-3 border-t border-indigo-200/50 flex items-center justify-between">
                <div className="text-xs text-surface-600">
                  {adjustedTotal > baseTotalInr
                    ? <span className="text-rose-600 font-medium">+<FaRupeeSign className="inline text-[9px]" />{formatInr(adjustedTotal - baseTotalInr)} vs original</span>
                    : adjustedTotal < baseTotalInr
                    ? <span className="text-emerald-600 font-medium">-<FaRupeeSign className="inline text-[9px]" />{formatInr(baseTotalInr - adjustedTotal)} vs original ({Math.round((1 - adjustedTotal/baseTotalInr) * 100)}% savings)</span>
                    : <span className="text-surface-500">Same as original</span>
                  }
                </div>
                <button onClick={() => { setSimSeats(baseSeats); setSimTotalHours(baseTotalHours); setSimTtlHours(baseTtlHours); }}
                  className="text-xs text-indigo-600 hover:underline">
                  Reset to original
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Build Custom Image button — triggers AI Dockerfile generation + Docker build
 * + catalog registration. Shows progress inline.
 */
function BuildCustomImageButton({ software, courseName }) {
  const [building, setBuilding] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  const startBuild = async () => {
    if (!window.confirm(`Build a custom container image with:\n${software.join(', ')}\n\nThis uses AI to generate a Dockerfile, builds it (~5-10 min), and registers it in the catalog.`)) return;
    setBuilding(true); setError(null);
    try {
      const res = await apiCaller.post('/admin/build-image', { software, courseName });
      const interval = setInterval(async () => {
        try {
          const r = await apiCaller.get(`/admin/build-image/${res.data.jobId}`);
          setJob(r.data);
          if (r.data.status === 'done' || r.data.status === 'failed') {
            clearInterval(interval);
            setBuilding(false);
          }
        } catch { clearInterval(interval); setBuilding(false); }
      }, 3000);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to start build');
      setBuilding(false);
    }
  };

  if (job?.status === 'done') {
    return (
      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4 mt-4">
        <div className="flex items-center gap-3">
          <FaCheckCircle className="text-emerald-600 text-lg flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-800">Custom image built and registered</div>
            <div className="text-xs text-emerald-600 mt-0.5 font-mono">{job.imageKey} · built in {job.duration}s</div>
            <div className="text-xs text-emerald-700 mt-1">Now available in the container catalog. Refresh to see updated feasibility.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-surface-100">
      {!building && !job && (
        <button onClick={startBuild}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">
          <FaDocker /> Build custom image with AI
        </button>
      )}
      {(building || (job && job.status !== 'done' && job.status !== 'failed')) && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <FaSpinner className="animate-spin text-indigo-600" />
            <div className="text-sm font-semibold text-indigo-800">{job?.phase || 'Starting...'}</div>
          </div>
          {job?.logs?.length > 0 && (
            <div className="max-h-28 overflow-y-auto bg-white border border-indigo-100 rounded-md p-2 mt-2">
              {job.logs.slice(-8).map((log, i) => (
                <div key={i} className="text-[10px] font-mono text-gray-600 truncate">{log}</div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-indigo-600 mt-2">{job?.duration ? `${job.duration}s elapsed` : 'Takes 3-10 minutes...'}</div>
        </div>
      )}
      {job?.status === 'failed' && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mt-2">
          <div className="text-sm text-rose-700">{job.phase}</div>
          <button onClick={() => setJob(null)} className="text-xs text-rose-600 font-medium mt-1 hover:underline">Try again</button>
        </div>
      )}
      {error && <div className="text-sm text-rose-600 mt-2">{error}</div>}
      <div className="text-[11px] text-surface-500 mt-2">AI generates a Dockerfile → builds the image → registers in catalog. No manual steps.</div>
    </div>
  );
}
