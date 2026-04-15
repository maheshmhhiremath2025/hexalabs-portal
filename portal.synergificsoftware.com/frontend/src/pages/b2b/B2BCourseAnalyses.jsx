import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaFilePdf, FaCloudUploadAlt, FaSpinner, FaCheckCircle,
  FaExclamationTriangle, FaTimesCircle, FaSearch, FaRupeeSign,
  FaPlus, FaAws, FaMicrosoft, FaGoogle, FaTrash, FaCloud, FaCubes,
} from 'react-icons/fa';
import apiCaller from '../../services/apiCaller';
import { b2bCourseApiRoutes } from '../../services/b2bApiRoutes';

const PROVIDERS = [
  { value: 'auto',  label: 'Auto-detect', icon: null },
  { value: 'aws',   label: 'AWS',   icon: FaAws },
  { value: 'azure', label: 'Azure', icon: FaMicrosoft },
  { value: 'gcp',   label: 'GCP',   icon: FaGoogle },
];

const VERDICT_STYLES = {
  feasible:     { bg: 'bg-emerald-50',  text: 'text-emerald-700',  ring: 'ring-emerald-200',  icon: FaCheckCircle,        label: 'Feasible' },
  needs_review: { bg: 'bg-amber-50',    text: 'text-amber-700',    ring: 'ring-amber-200',    icon: FaExclamationTriangle, label: 'Needs review' },
  partial:      { bg: 'bg-orange-50',   text: 'text-orange-700',   ring: 'ring-orange-200',   icon: FaExclamationTriangle, label: 'Partial' },
  infeasible:   { bg: 'bg-rose-50',     text: 'text-rose-700',     ring: 'ring-rose-200',     icon: FaTimesCircle,        label: 'Infeasible' },
};

const STATUS_STYLES = {
  pending:            { bg: 'bg-surface-100', text: 'text-surface-700', label: 'Pending' },
  analyzing:          { bg: 'bg-blue-50',     text: 'text-blue-700',    label: 'Analyzing…' },
  analyzed:           { bg: 'bg-emerald-50',  text: 'text-emerald-700', label: 'Analyzed' },
  failed:             { bg: 'bg-rose-50',     text: 'text-rose-700',    label: 'Failed' },
  template_generated: { bg: 'bg-indigo-50',   text: 'text-indigo-700',  label: 'Template ready' },
};

function ProviderIcon({ name }) {
  if (name === 'aws')   return <FaAws className="text-[#FF9900]" />;
  if (name === 'azure') return <FaMicrosoft className="text-[#0078D4]" />;
  if (name === 'gcp')   return <FaGoogle className="text-[#4285F4]" />;
  return <span className="text-surface-400 text-xs">—</span>;
}

function VerdictBadge({ verdict }) {
  if (!verdict) return <span className="text-surface-400 text-xs">—</span>;
  const style = VERDICT_STYLES[verdict] || VERDICT_STYLES.partial;
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${style.bg} ${style.text} ${style.ring}`}>
      <Icon className="text-[10px]" />
      {style.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function formatInr(n) {
  if (!n && n !== 0) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/* ------------------------------ Upload modal ------------------------------ */

function UploadModal({ open, onClose, onUploaded, initialForceType = null }) {
  const [forceType, setForceType] = useState(initialForceType);
  const [inputMode, setInputMode] = useState('pdf'); // 'pdf' or 'text'
  const [file, setFile] = useState(null);
  const [rawText, setRawText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [seats, setSeats] = useState(25);
  const [providerHint, setProviderHint] = useState('auto');
  const [requestedTtlHours, setRequestedTtlHours] = useState(4);
  const [marginPercent] = useState(65);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // When the modal opens with a pre-selected type (from a tab CTA), honor it
  useEffect(() => {
    if (open) setForceType(initialForceType);
  }, [open, initialForceType]);

  const reset = () => {
    setForceType(initialForceType);
    setInputMode('pdf'); setFile(null); setRawText('');
    setCustomerName(''); setSeats(25); setProviderHint('auto');
    setRequestedTtlHours(4); setError(null);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') setFile(f);
    else setError('Please upload a PDF file.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!forceType) { setError('Pick an analysis type first.'); return; }
    if (inputMode === 'pdf' && !file) { setError('Select a PDF first.'); return; }
    if (inputMode === 'text' && !rawText.trim()) { setError('Paste or type the lab requirements.'); return; }
    setSubmitting(true); setError(null);
    try {
      const fd = new FormData();
      if (inputMode === 'pdf') {
        fd.append('file', file);
      } else {
        // Send raw text as a fake text file so the backend multer accepts it,
        // OR send via a separate field. We'll use a rawText field.
        fd.append('rawText', rawText.trim());
        // Create a minimal placeholder file so multer doesn't reject (file is optional now)
        fd.append('file', new Blob([''], { type: 'text/plain' }), 'pasted-text.txt');
      }
      fd.append('seats', String(seats));
      fd.append('providerHint', providerHint);
      fd.append('customerName', customerName);
      fd.append('requestedTtlHours', String(requestedTtlHours));
      fd.append('marginPercent', String(marginPercent));
      fd.append('forceType', forceType);
      fd.append('inputMode', inputMode);
      const res = await apiCaller.post(b2bCourseApiRoutes.analyze, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      reset();
      onUploaded?.(res.data);
      onClose();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Upload failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 flex-shrink-0">
          <div>
            <div className="text-base font-semibold text-surface-900">
              {forceType === 'cloud_sandbox' && 'Analyze cloud sandbox course'}
              {forceType === 'container_lab' && 'Analyze workspace lab course'}
              {!forceType && 'Analyze course PDF'}
            </div>
            <div className="text-xs text-surface-500 mt-0.5">
              {forceType === 'cloud_sandbox' && 'For courses that need real AWS/Azure/GCP accounts (cert prep, cloud-services).'}
              {forceType === 'container_lab' && 'For courses that need a Linux workspace with software preinstalled (Kafka/Spark, MEAN, ELK, etc.).'}
              {!forceType && "First, tell us what kind of course this is — that determines how we analyze it."}
            </div>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-700 text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Type picker — required, must be selected before anything else is editable */}
          <div>
            <label className="block text-[11px] font-semibold text-surface-700 uppercase tracking-wider mb-2">
              What kind of course is this? <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForceType('cloud_sandbox')}
                className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                  forceType === 'cloud_sandbox'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-surface-200 hover:border-surface-300 bg-white'
                }`}
              >
                <FaCloud className={`text-xl flex-shrink-0 mt-0.5 ${forceType === 'cloud_sandbox' ? 'text-blue-600' : 'text-surface-400'}`} />
                <div className="min-w-0">
                  <div className={`text-sm font-semibold ${forceType === 'cloud_sandbox' ? 'text-blue-900' : 'text-surface-800'}`}>
                    Cloud Sandbox
                  </div>
                  <div className="text-[11px] text-surface-500 mt-0.5 leading-tight">
                    AWS / Azure / GCP cert prep, cloud-services courses. Each student gets a real cloud account with a locked-down IAM policy.
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setForceType('container_lab')}
                className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                  forceType === 'container_lab'
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-surface-200 hover:border-surface-300 bg-white'
                }`}
              >
                <FaCubes className={`text-xl flex-shrink-0 mt-0.5 ${forceType === 'container_lab' ? 'text-indigo-600' : 'text-surface-400'}`} />
                <div className="min-w-0">
                  <div className={`text-sm font-semibold ${forceType === 'container_lab' ? 'text-indigo-900' : 'text-surface-800'}`}>
                    Workspace Lab
                  </div>
                  <div className="text-[11px] text-surface-500 mt-0.5 leading-tight">
                    Linux workspace with software preinstalled. Kafka/Spark, MEAN/MERN, ELK, Docker, K8s. Each student gets a workspace, no cloud account.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Everything below is disabled until forceType is picked */}
          <fieldset disabled={!forceType} className={!forceType ? 'opacity-40 pointer-events-none' : ''}>
          <div className="space-y-4">
          {/* Input mode toggle */}
          <div>
            <div className="flex items-center gap-1 bg-surface-100 border border-surface-200 rounded-lg p-0.5 mb-3">
              <button type="button" onClick={() => setInputMode('pdf')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputMode === 'pdf' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'
                }`}>
                <FaFilePdf className="text-[10px]" /> Upload PDF
              </button>
              <button type="button" onClick={() => setInputMode('text')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputMode === 'text' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'
                }`}>
                <FaCloudUploadAlt className="text-[10px]" /> Paste Text
              </button>
            </div>

            {inputMode === 'pdf' ? (
              /* PDF dropzone */
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-6 cursor-pointer transition-colors ${
                  dragOver ? 'border-primary-400 bg-primary-50' : 'border-surface-300 hover:border-primary-300 hover:bg-surface-50'
                }`}
              >
                <FaCloudUploadAlt className="text-2xl text-primary-500" />
                {file ? (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium text-surface-800">
                      <FaFilePdf className="text-rose-500" /> {file.name}
                    </div>
                    <div className="text-[11px] text-surface-500">{(file.size / 1024).toFixed(0)} KB · click to change</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium text-surface-700">Drop PDF here or click to browse</div>
                    <div className="text-[11px] text-surface-500">Max 15 MB · TOC, course outline, or module list</div>
                  </>
                )}
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setError(null); }} />
              </label>
            ) : (
              /* Text paste area */
              <div>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={"Paste the lab requirements, course outline, TOC, or module list here...\n\nExample:\n- Course: Big Data Engineering with Kafka & Spark\n- Duration: 3 days\n- VM Specs: 4 vCPU, 16 GB RAM, Ubuntu 22.04\n- Software needed: Kafka, Spark, MySQL, Java 17, Python 3.10\n- Students need SSH access and network connectivity between VMs"}
                  rows={7}
                  className="w-full px-3 py-2.5 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none font-mono"
                />
                <div className="flex items-center justify-between mt-1.5">
                  <div className="text-[11px] text-surface-500">Paste any format — bullet points, email text, course outline, requirements doc</div>
                  <div className="text-[11px] text-surface-400">{rawText.length} chars</div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Customer</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="AcmeCorp"
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Seats</label>
              <input
                type="number" min={1}
                value={seats}
                onChange={(e) => setSeats(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>

          {/* Cloud provider hint — only relevant for cloud_sandbox courses.
              For container labs we hide this entirely; the analyzer will pick
              the catalog image based on the requested software stack. */}
          {forceType === 'cloud_sandbox' && (
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Cloud provider hint</label>
              <div className="grid grid-cols-4 gap-2">
                {PROVIDERS.map((p) => {
                  const Icon = p.icon;
                  const active = providerHint === p.value;
                  return (
                    <button
                      type="button"
                      key={p.value}
                      onClick={() => setProviderHint(p.value)}
                      className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        active
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-surface-300 text-surface-700 hover:border-surface-400'
                      }`}
                    >
                      {Icon && <Icon className="text-base" />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* For container labs, show a small hint instead so ops sees what's
              about to happen. */}
          {forceType === 'container_lab' && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
              <strong>How container lab analysis works:</strong> we'll extract the software list from the PDF (Kafka, Spark, Java, etc.), then walk our container catalog to find the best-fit prebuilt image. You'll see coverage %, missing items, and the recommended image to deploy.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-surface-600 uppercase tracking-wide mb-1">Cleanup TTL (hours)</label>
              <input
                type="number" min={1}
                value={requestedTtlHours}
                onChange={(e) => setRequestedTtlHours(parseInt(e.target.value) || 4)}
                className="w-full px-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            {/* Margin handled internally */}
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          </div>
          </fieldset>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !file || !forceType}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <><FaSpinner className="animate-spin" /> Analyzing…</> : <>Analyze course</>}
            </button>
          </div>
          {submitting && (
            <div className="text-[11px] text-surface-500 text-right">
              This takes ~15–30s while Claude reads the PDF.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

/* ------------------------------ Main page ------------------------------ */

export default function B2BCourseAnalyses() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadInitialType, setUploadInitialType] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // 'all' | 'cloud_sandbox' | 'container_lab'
  const [typeTab, setTypeTab] = useState('all');

  const fetchItems = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await apiCaller.get(b2bCourseApiRoutes.list, { params });
      setItems(res.data.items || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load course analyses');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const filtered = items.filter((it) => {
    // Filter by type tab — older records may not have recommendedDeployment set;
    // treat them as cloud_sandbox by default for backward compatibility.
    if (typeTab !== 'all') {
      const itemType = it.analysis?.recommendedDeployment || 'cloud_sandbox';
      if (itemType !== typeTab) return false;
    }
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (it.originalFilename || '').toLowerCase().includes(q) ||
      (it.customerName || '').toLowerCase().includes(q) ||
      (it.analysis?.courseName || '').toLowerCase().includes(q)
    );
  });

  const counts = {
    all: items.length,
    cloud_sandbox: items.filter((it) => (it.analysis?.recommendedDeployment || 'cloud_sandbox') === 'cloud_sandbox').length,
    container_lab: items.filter((it) => it.analysis?.recommendedDeployment === 'container_lab').length,
  };

  const handleUploaded = (data) => {
    if (data?.id) {
      navigate(`/b2b/courses/${data.id}`);
    } else {
      fetchItems();
    }
  };

  const handleDelete = async (e, item) => {
    e.stopPropagation(); // don't trigger row click
    const label = item.analysis?.courseName || item.originalFilename;
    if (!window.confirm(`Delete analysis for "${label}"?\n\nThis won't delete any SandboxTemplate that was generated from it.`)) return;
    setDeletingId(item._id);
    try {
      await apiCaller.delete(b2bCourseApiRoutes.delete(item._id));
      setItems((prev) => prev.filter((it) => it._id !== item._id));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">B2B Course Analyses</h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Upload a customer course PDF — pick the analysis type that matches the course (cloud sandbox or container lab).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { setUploadInitialType('cloud_sandbox'); setUploadOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
          >
            <FaCloud className="text-xs" /> New cloud sandbox
          </button>
          <button
            onClick={() => { setUploadInitialType('container_lab'); setUploadOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
          >
            <FaCubes className="text-xs" /> New workspace lab
          </button>
        </div>
      </div>

      {/* Type tabs */}
      <div className="flex items-center gap-1 border-b border-surface-200">
        <TypeTab id="all" label="All" count={counts.all} active={typeTab === 'all'} onClick={() => setTypeTab('all')} />
        <TypeTab id="cloud_sandbox" label="Cloud Sandboxes" count={counts.cloud_sandbox} active={typeTab === 'cloud_sandbox'} icon={FaCloud} accent="blue" onClick={() => setTypeTab('cloud_sandbox')} />
        <TypeTab id="container_lab" label="Workspace Labs" count={counts.container_lab} active={typeTab === 'container_lab'} icon={FaCubes} accent="indigo" onClick={() => setTypeTab('container_lab')} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-xs" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by filename, customer, course name…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-surface-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        >
          <option value="">All statuses</option>
          <option value="analyzing">Analyzing</option>
          <option value="analyzed">Analyzed</option>
          <option value="template_generated">Template ready</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* List */}
      <div className="bg-white border border-surface-200 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-surface-400">
            <FaSpinner className="animate-spin text-xl" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FaFilePdf className="mx-auto text-3xl text-surface-300 mb-2" />
            <div className="text-sm font-medium text-surface-700">No course analyses yet</div>
            <div className="text-xs text-surface-500 mt-1">Upload a PDF to get started</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
              <tr>
                <th className="text-left px-4 py-3">Course / File</th>
                <th className="text-left px-4 py-3">Customer</th>
                <th className="text-center px-4 py-3">Cloud</th>
                <th className="text-right px-4 py-3">Seats</th>
                <th className="text-right px-4 py-3">Per seat</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-left px-4 py-3">Verdict</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Uploaded</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {filtered.map((it) => (
                <tr
                  key={it._id}
                  onClick={() => navigate(`/b2b/courses/${it._id}`)}
                  className="hover:bg-surface-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-surface-900 truncate max-w-xs">
                      {it.analysis?.courseName || it.originalFilename}
                    </div>
                    {it.analysis?.courseName && (
                      <div className="text-[11px] text-surface-500 truncate max-w-xs">{it.originalFilename}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-surface-700">{it.customerName || '—'}</td>
                  <td className="px-4 py-3 text-center text-base">
                    <ProviderIcon name={it.analysis?.detectedProvider} />
                  </td>
                  <td className="px-4 py-3 text-right text-surface-700">{it.seats || 1}</td>
                  <td className="px-4 py-3 text-right text-surface-800">
                    {it.cost?.perSeatInr ? (<><FaRupeeSign className="inline text-[10px] mr-0.5" />{formatInr(it.cost.perSeatInr)}</>) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-surface-900">
                    {it.cost?.totalInr ? (<><FaRupeeSign className="inline text-[10px] mr-0.5" />{formatInr(it.cost.totalInr)}</>) : '—'}
                  </td>
                  <td className="px-4 py-3"><VerdictBadge verdict={it.feasibility?.verdict} /></td>
                  <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                  <td className="px-4 py-3 text-[11px] text-surface-500">{formatDate(it.createdAt)}</td>
                  <td className="px-2 py-3 text-right">
                    <button
                      onClick={(e) => handleDelete(e, it)}
                      disabled={deletingId === it._id}
                      title="Delete analysis"
                      className="p-1.5 text-surface-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors disabled:opacity-50"
                    >
                      {deletingId === it._id
                        ? <FaSpinner className="animate-spin text-xs" />
                        : <FaTrash className="text-xs" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        initialForceType={uploadInitialType}
        onClose={() => { setUploadOpen(false); setUploadInitialType(null); }}
        onUploaded={handleUploaded}
      />
    </div>
  );
}

function TypeTab({ id, label, count, active, icon: Icon, accent, onClick }) {
  const accentColors = {
    blue:   { active: 'border-blue-600 text-blue-700',     idle: 'text-surface-600 hover:text-blue-700' },
    indigo: { active: 'border-indigo-600 text-indigo-700', idle: 'text-surface-600 hover:text-indigo-700' },
  }[accent] || { active: 'border-surface-700 text-surface-900', idle: 'text-surface-600 hover:text-surface-900' };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? accentColors.active : 'border-transparent ' + accentColors.idle}`}
    >
      {Icon && <Icon className="text-xs" />}
      {label}
      <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${active ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600'}`}>{count}</span>
    </button>
  );
}
