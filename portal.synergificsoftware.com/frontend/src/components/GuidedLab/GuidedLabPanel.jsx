import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import apiCaller from '../../services/apiCaller';
import {
  FaCheck, FaChevronDown, FaChevronRight, FaChevronLeft,
  FaLightbulb, FaPlay, FaTrophy, FaSpinner, FaWrench, FaCopy,
  FaCloud, FaExternalLinkAlt, FaRedo,
} from 'react-icons/fa';
import { BookOpen, Target, Clock, ChevronRight } from 'lucide-react';

/* ===== Copy to clipboard with fallback ===== */
function copyToClipboard(text) {
  // Try modern API first
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(textarea);
  return Promise.resolve();
}

/* ===== Code block with copy button (per-line + full block) ===== */
function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const [copiedLine, setCopiedLine] = useState(null);
  const code = String(children).replace(/\n$/, '');
  const lines = code.split('\n');
  const isMultiLine = lines.length > 1;

  const handleCopyAll = (e) => {
    e.stopPropagation();
    copyToClipboard(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      window.dispatchEvent(new CustomEvent('lab-clipboard', { detail: { text: code } }));
    });
  };

  const handleCopyLine = (line, idx, e) => {
    e.stopPropagation();
    copyToClipboard(line).then(() => {
      setCopiedLine(idx);
      setTimeout(() => setCopiedLine(null), 2000);
      window.dispatchEvent(new CustomEvent('lab-clipboard', { detail: { text: line } }));
    });
  };

  return (
    <div className="relative my-2 group/block">
      <button
        onClick={handleCopyAll}
        className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-600 text-slate-200 hover:bg-slate-500 hover:text-white transition-colors z-10 flex items-center gap-1"
        title="Copy all to clipboard"
      >
        {copied ? (
          <><FaCheck className="w-2.5 h-2.5 text-green-400" /><span className="text-[9px] text-green-400">Copied!</span></>
        ) : (
          <><FaCopy className="w-2.5 h-2.5" /><span className="text-[9px]">Copy</span></>
        )}
      </button>
      <pre className="bg-slate-800 text-slate-100 text-[11px] rounded-md p-3 pr-16 overflow-x-auto">
        <code>{isMultiLine ? lines.map((line, idx) => (
          <span key={idx} className="group/line flex items-center hover:bg-slate-700/50 -mx-3 px-3 rounded relative">
            <span className="flex-1">{line}{idx < lines.length - 1 ? '\n' : ''}</span>
            {line.trim() && (
              <button
                onClick={(e) => handleCopyLine(line, idx, e)}
                className={`absolute right-1 flex-shrink-0 p-0.5 rounded transition-all ${copiedLine === idx ? 'opacity-100 text-green-400' : 'opacity-0 group-hover/line:opacity-100 text-slate-400 hover:text-white'}`}
                title="Copy this command"
              >
                {copiedLine === idx ? <FaCheck className="w-2.5 h-2.5" /> : <FaCopy className="w-2.5 h-2.5" />}
              </button>
            )}
          </span>
        )) : code}</code>
      </pre>
    </div>
  );
}

/* ===== Inline code ===== */
function InlineCode({ children }) {
  return (
    <code className="bg-slate-100 text-slate-800 text-[11px] px-1 py-0.5 rounded font-mono">{children}</code>
  );
}

/* ===== Markdown renderer components ===== */
const mdComponents = {
  // Fenced code blocks: ```bash ... ```
  pre({ children }) {
    // Extract text content from the nested <code> element
    const codeEl = React.Children.toArray(children).find(c => c?.type === 'code' || c?.props);
    const text = codeEl?.props?.children ? String(codeEl.props.children) : String(children);
    return <CodeBlock>{text}</CodeBlock>;
  },
  // Inline `code`
  code({ children }) {
    return <InlineCode>{children}</InlineCode>;
  },
  // Other elements styled for the compact panel
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-slate-800">{children}</strong>;
  },
  ul({ children }) {
    return <ul className="list-disc list-inside space-y-0.5 mb-2">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside space-y-0.5 mb-2">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-xs">{children}</li>;
  },
  h1({ children }) { return <h4 className="font-bold text-slate-800 text-xs mb-1">{children}</h4>; },
  h2({ children }) { return <h4 className="font-bold text-slate-800 text-xs mb-1">{children}</h4>; },
  h3({ children }) { return <h4 className="font-semibold text-slate-800 text-xs mb-1">{children}</h4>; },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{children}</a>;
  },
};

/* ===== Sandbox expiry countdown ===== */
function SandboxCountdown({ expiresAt }) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!expiresAt) return;
    const calc = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) return { h: 0, m: 0, s: 0, total: 0 };
      return { h: Math.floor(diff / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000), total: diff };
    };
    setRemaining(calc());
    const id = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!remaining || remaining.total <= 0) return <span className="text-red-600 font-medium">Expired</span>;
  const pad = (n) => String(n).padStart(2, '0');
  const isUrgent = remaining.total < 30 * 60 * 1000;
  return (
    <span className={`font-mono font-medium ${isUrgent ? 'text-red-600' : 'text-slate-600'}`}>
      {pad(remaining.h)}:{pad(remaining.m)}:{pad(remaining.s)}
    </span>
  );
}

const DIFFICULTY_COLORS = {
  beginner: 'bg-green-100 text-green-700',
  intermediate: 'bg-yellow-100 text-yellow-700',
  advanced: 'bg-red-100 text-red-700',
};

/* ===== Step Card ===== */
function StepCard({ step, stepProgress, index, isActive, onSelect, onComplete, onVerify, onHint, verifying, vms }) {
  const [expanded, setExpanded] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const completed = stepProgress?.completed;

  useEffect(() => {
    setExpanded(isActive);
  }, [isActive]);

  return (
    <div
      className={`border rounded-lg transition-all ${
        completed ? 'border-green-200 bg-green-50/50' :
        isActive ? 'border-blue-300 bg-blue-50/30 shadow-sm' :
        'border-slate-200 bg-white'
      }`}
    >
      {/* Header */}
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => { setExpanded(!expanded); onSelect(index); }}
      >
        {/* Step number / checkmark */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          completed ? 'bg-green-500 text-white' :
          isActive ? 'bg-blue-500 text-white' :
          'bg-slate-200 text-slate-500'
        }`}>
          {completed ? <FaCheck className="w-3 h-3" /> : index + 1}
        </div>

        <span className={`text-sm font-medium flex-1 ${completed ? 'text-green-700 line-through' : 'text-slate-800'}`}>
          {step.title}
        </span>

        {expanded ? <FaChevronDown className="w-3 h-3 text-slate-400" /> : <FaChevronRight className="w-3 h-3 text-slate-400" />}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">
          {/* Description (rendered as Markdown with copyable code blocks) */}
          <div className="text-xs text-slate-600 leading-relaxed pl-8">
            <Markdown components={mdComponents}>{step.description}</Markdown>
          </div>

          {/* Hint */}
          {step.hint && (
            <div className="pl-8">
              {stepProgress?.hintViewed ? (
                <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
                  <FaLightbulb className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-700 flex-1"><Markdown components={mdComponents}>{step.hint}</Markdown></div>
                </div>
              ) : (
                <button
                  onClick={() => onHint(step._id)}
                  className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium"
                >
                  <FaLightbulb className="w-3 h-3" /> Show hint
                </button>
              )}
            </div>
          )}

          {/* Troubleshooting */}
          {step.troubleshooting?.length > 0 && (
            <div className="pl-8">
              <button
                onClick={() => setShowTroubleshoot(!showTroubleshoot)}
                className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-700 font-medium"
              >
                <FaWrench className="w-2.5 h-2.5" />
                Troubleshooting ({step.troubleshooting.length})
                <FaChevronDown className={`w-2 h-2 transition-transform ${showTroubleshoot ? 'rotate-180' : ''}`} />
              </button>
              {showTroubleshoot && (
                <div className="space-y-1.5 mt-1.5">
                  {step.troubleshooting.map((t, i) => (
                    <div key={i} className="p-2 bg-orange-50 border border-orange-200 rounded-md">
                      <div className="text-xs font-medium text-orange-800">Issue: {t.issue}</div>
                      <div className="text-xs text-orange-700 mt-0.5"><Markdown components={mdComponents}>{t.solution}</Markdown></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {!completed && (
            <div className="pl-8 flex gap-2">
              {step.verifyType === 'auto' && step.verifyCommand ? (
                <button
                  onClick={() => onVerify(step._id)}
                  disabled={verifying || vms.filter(v => v.isRunning).length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {verifying ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaPlay className="w-3 h-3" />}
                  Verify
                </button>
              ) : null}
              {step.verifyType !== 'none' && (
                <button
                  onClick={() => onComplete(step._id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-md"
                >
                  <FaCheck className="w-3 h-3" /> Mark Complete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== Progress Ring ===== */
function ProgressRing({ completed, total, size = 40, strokeWidth = 3 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percent = total > 0 ? completed / total : 0;
  const offset = circumference - percent * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={percent >= 1 ? '#22c55e' : '#3b82f6'}
          strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-500" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700">
        {completed}/{total}
      </span>
    </div>
  );
}

/* ===== Main Panel ===== */
// embedded=true: rendered inside LabView overlay (skip outer wrapper, width, border, sticky)
export default function GuidedLabPanel({ lab, trainingName, userEmail, vms, embedded = false }) {
  const [progress, setProgress] = useState(null);
  const [activeStep, setActiveStep] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [showLabTroubleshoot, setShowLabTroubleshoot] = useState(false);

  // Admin detection
  const isAdmin = useMemo(() => {
    try {
      const ut = localStorage.getItem('AH1apq12slurt5');
      return ut === 'admin' || ut === 'superadmin';
    } catch { return false; }
  }, []);

  // Sandbox credentials state
  const [mySandbox, setMySandbox] = useState(null);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxExpanded, setSandboxExpanded] = useState(true);
  const [relaunching, setRelaunching] = useState(false);
  const [activating, setActivating] = useState(false);
  const [relaunchMsg, setRelaunchMsg] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  const completedCount = progress?.steps?.filter(s => s.completed).length || 0;
  const totalSteps = lab.steps?.length || 0;
  const allDone = completedCount === totalSteps && totalSteps > 0;

  // Fetch progress on mount
  const fetchProgress = useCallback(async () => {
    try {
      const res = await apiCaller.get(`/guided-labs/${lab._id}/progress`, {
        params: { trainingName },
      });
      setProgress(res.data);
      // Auto-advance to first incomplete step
      if (res.data?.steps) {
        const firstIncomplete = res.data.steps.findIndex(s => !s.completed);
        if (firstIncomplete >= 0) setActiveStep(firstIncomplete);
      }
    } catch (err) {
      console.error('Failed to fetch lab progress:', err);
    }
  }, [lab._id, trainingName]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // Fetch sandbox credentials if lab has a sandbox template (skip for admins)
  const fetchSandbox = useCallback(async () => {
    if (!lab.sandboxTemplateSlug || isAdmin) return;
    setSandboxLoading(true);
    try {
      const res = await apiCaller.get('/user/my-sandboxes');
      const all = res.data?.sandboxes || [];
      // Find sandbox matching this lab's template
      const match = all.find(s => s.templateSlug === lab.sandboxTemplateSlug);
      setMySandbox(match || null);
    } catch (err) {
      console.error('Failed to fetch sandbox:', err);
    } finally {
      setSandboxLoading(false);
    }
  }, [lab.sandboxTemplateSlug, isAdmin]);

  useEffect(() => {
    fetchSandbox();
  }, [fetchSandbox]);

  // Handle sandbox relaunch
  const handleRelaunch = async () => {
    if (!mySandbox) return;
    setRelaunching(true);
    setRelaunchMsg(null);
    try {
      const body = { cloud: mySandbox.cloud, templateSlug: mySandbox.templateSlug };
      if (mySandbox.cloud === 'gcp') body.email = mySandbox.username;
      const res = await apiCaller.post('/user/relaunch-sandbox', body);
      setRelaunchMsg({ type: 'success', text: `Sandbox relaunched. Expires at ${new Date(res.data.sandbox.expiresAt).toLocaleTimeString()}.` });
      await fetchSandbox();
    } catch (err) {
      const data = err.response?.data;
      if (data?.error === 'Daily limit reached') {
        setRelaunchMsg({ type: 'error', text: `Daily limit reached (${data.hoursUsedToday}h / ${data.dailyCapHours}h). Try again tomorrow.` });
      } else if (data?.error === 'Total engagement hours exhausted') {
        setRelaunchMsg({ type: 'error', text: `Total hours exhausted (${data.totalHoursUsed}h / ${data.totalCapHours}h). Contact administrator.` });
      } else {
        setRelaunchMsg({ type: 'error', text: data?.message || 'Failed to relaunch sandbox.' });
      }
    } finally {
      setRelaunching(false);
    }
  };

  // Activate a provisioned (deferred) sandbox — starts the timer
  const handleActivate = async () => {
    if (!mySandbox) return;
    setActivating(true);
    setRelaunchMsg(null);
    try {
      const body = { cloud: mySandbox.cloud, templateSlug: mySandbox.templateSlug };
      const res = await apiCaller.post('/user/activate-sandbox', body);
      setRelaunchMsg({ type: 'success', text: `Sandbox started! Expires at ${new Date(res.data.sandbox.expiresAt).toLocaleTimeString()}.` });
      await fetchSandbox();
    } catch (err) {
      const data = err.response?.data;
      if (data?.error === 'Daily limit reached') {
        setRelaunchMsg({ type: 'error', text: `Daily limit reached (${data.hoursUsedToday}h / ${data.dailyCapHours}h). Try again tomorrow.` });
      } else if (data?.error === 'Total engagement hours exhausted') {
        setRelaunchMsg({ type: 'error', text: `Total hours exhausted (${data.totalHoursUsed}h / ${data.totalCapHours}h). Contact administrator.` });
      } else {
        setRelaunchMsg({ type: 'error', text: data?.message || 'Failed to activate sandbox.' });
      }
    } finally {
      setActivating(false);
    }
  };

  // Copy helper for sandbox credentials
  const handleSandboxCopy = (text, field) => {
    copyToClipboard(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  // Mark step complete (manual)
  const handleComplete = async (stepId) => {
    try {
      const res = await apiCaller.post(`/guided-labs/${lab._id}/steps/${stepId}/complete`, { trainingName });
      setProgress(res.data);
      // Advance to next incomplete
      const nextIncomplete = res.data.steps.findIndex(s => !s.completed);
      if (nextIncomplete >= 0) setActiveStep(nextIncomplete);
    } catch (err) {
      console.error('Failed to complete step:', err);
    }
  };

  // Auto-verify step
  const handleVerify = async (stepId) => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const runningVm = vms.find(v => v.isRunning);
      if (!runningVm) return;
      const res = await apiCaller.post(`/guided-labs/${lab._id}/steps/${stepId}/verify`, {
        trainingName,
        vmName: runningVm.name,
      });
      setVerifyResult(res.data);
      if (res.data.passed) {
        await fetchProgress();
      }
    } catch (err) {
      setVerifyResult({ passed: false, output: err.response?.data?.message || err.message });
    } finally {
      setVerifying(false);
    }
  };

  // Mark hint viewed
  const handleHint = async (stepId) => {
    try {
      const res = await apiCaller.post(`/guided-labs/${lab._id}/steps/${stepId}/hint`, { trainingName });
      setProgress(res.data);
    } catch (err) {
      console.error('Failed to mark hint:', err);
    }
  };

  // Get step progress by stepId
  const getStepProgress = (step) => {
    return progress?.steps?.find(s => s.stepId === step._id);
  };

  // Collapsed state — just show a toggle button (only for non-embedded mode)
  if (!embedded && !panelOpen) {
    return (
      <div className="flex-shrink-0">
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 text-xs font-medium"
          title="Open Lab Guide"
        >
          <BookOpen className="w-4 h-4" />
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Embedded mode: no outer wrapper — LabView provides its own container
  // Standalone mode: full self-contained sidebar widget
  const Wrapper = embedded ? React.Fragment : ({ children }) => (
    <div className="flex-shrink-0 w-80 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-120px)] sticky top-4">
      {children}
    </div>
  );

  return (
    <Wrapper>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Lab Guide</span>
          </div>
          <div className="flex items-center gap-2">
            <ProgressRing completed={completedCount} total={totalSteps} />
            {!embedded && (
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-slate-600 p-1" title="Collapse">
                <FaChevronLeft className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <h3 className="text-xs font-semibold text-slate-700 leading-tight">{lab.title}</h3>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${DIFFICULTY_COLORS[lab.difficulty] || DIFFICULTY_COLORS.beginner}`}>
            {lab.difficulty}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Clock className="w-3 h-3" /> ~{lab.duration} min
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Target className="w-3 h-3" /> {totalSteps} steps
          </span>
        </div>
      </div>

      {/* Sandbox credentials card */}
      {lab.sandboxTemplateSlug && (
        <div className="px-3 pt-3 flex-shrink-0">
          {sandboxLoading ? (
            <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <FaSpinner className="w-3 h-3 text-amber-500 animate-spin" />
              <span className="text-[11px] text-amber-600">Loading cloud credentials...</span>
            </div>
          ) : mySandbox ? (() => {
            const CLOUD_COLORS = { aws: 'text-orange-500 bg-orange-50 border-orange-200', azure: 'text-blue-500 bg-blue-50 border-blue-200', gcp: 'text-red-500 bg-red-50 border-red-200' };
            const cc = CLOUD_COLORS[mySandbox.cloud] || CLOUD_COLORS.azure;
            const isProvisioned = mySandbox.status === 'provisioned';
            const expMs = mySandbox.expiresAt ? new Date(mySandbox.expiresAt).getTime() : null;
            const isExpired = !isProvisioned && (mySandbox.status === 'expired' || (expMs && expMs <= Date.now()));
            const isExpiringSoon = expMs && !isExpired && !isProvisioned && (expMs - Date.now()) < 60 * 60 * 1000;

            return (
              <div className={`border rounded-lg overflow-hidden ${cc.split(' ').slice(2).join(' ')}`}>
                {/* Sandbox header */}
                <button
                  onClick={() => setSandboxExpanded(!sandboxExpanded)}
                  className={`w-full flex items-center justify-between px-3 py-2 ${cc.split(' ').slice(1, 2).join(' ')}`}
                >
                  <div className="flex items-center gap-1.5">
                    <FaCloud className={`w-3 h-3 ${cc.split(' ')[0]}`} />
                    <span className="text-[11px] font-semibold text-slate-700">
                      {mySandbox.cloud?.toUpperCase()} Sandbox
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isProvisioned ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Ready</span>
                    ) : isExpired ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Expired</span>
                    ) : isExpiringSoon ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Expiring Soon</span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Active</span>
                    )}
                    <FaChevronDown className={`w-2 h-2 text-slate-400 transition-transform ${sandboxExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {sandboxExpanded && (
                  <div className="px-3 py-2 space-y-1.5 bg-white">
                    {isProvisioned ? (
                      /* ── Deferred activation: show Start button, hide credentials ── */
                      <div className="space-y-2">
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Your {mySandbox.cloud?.toUpperCase()} sandbox is provisioned and ready. Click <strong>Start</strong> to begin — the timer will start once you activate.
                        </p>
                        <button
                          onClick={handleActivate}
                          disabled={activating}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {activating ? (
                            <><FaSpinner className="w-3 h-3 animate-spin" /> Starting...</>
                          ) : (
                            <><FaPlay className="w-3 h-3" /> Start Sandbox</>
                          )}
                        </button>
                        {relaunchMsg && (
                          <div className={`p-2 rounded-md text-[10px] ${relaunchMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {relaunchMsg.text}
                            <button onClick={() => setRelaunchMsg(null)} className="ml-2 underline opacity-70">dismiss</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ── Active/expired: show credentials ── */
                      <>
                        {mySandbox.accessUrl && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-slate-400 w-14 flex-shrink-0">Login</span>
                            <a href={mySandbox.accessUrl} target="_blank" rel="noopener noreferrer"
                              className="text-blue-600 hover:underline truncate flex items-center gap-1 min-w-0 flex-1">
                              <span className="truncate">{mySandbox.accessUrl.replace(/^https?:\/\//, '')}</span>
                              <FaExternalLinkAlt className="w-2 h-2 flex-shrink-0" />
                            </a>
                            <button onClick={() => handleSandboxCopy(mySandbox.accessUrl, 'url')} className="p-0.5 text-slate-400 hover:text-blue-600 flex-shrink-0">
                              {copiedField === 'url' ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
                            </button>
                          </div>
                        )}
                        {mySandbox.username && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-slate-400 w-14 flex-shrink-0">User</span>
                            <code className="bg-slate-50 px-1.5 py-0.5 rounded text-slate-700 text-[10px] truncate flex-1 min-w-0">{mySandbox.username}</code>
                            <button onClick={() => handleSandboxCopy(mySandbox.username, 'user')} className="p-0.5 text-slate-400 hover:text-blue-600 flex-shrink-0">
                              {copiedField === 'user' ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
                            </button>
                          </div>
                        )}
                        {mySandbox.password && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-slate-400 w-14 flex-shrink-0">Pass</span>
                            <code className="bg-slate-50 px-1.5 py-0.5 rounded text-slate-700 text-[10px] truncate flex-1 min-w-0">{mySandbox.password}</code>
                            <button onClick={() => handleSandboxCopy(mySandbox.password, 'pass')} className="p-0.5 text-slate-400 hover:text-blue-600 flex-shrink-0">
                              {copiedField === 'pass' ? <FaCheck className="w-2.5 h-2.5 text-green-500" /> : <FaCopy className="w-2.5 h-2.5" />}
                            </button>
                          </div>
                        )}

                        {/* Region + Expiry */}
                        <div className="flex items-center gap-3 pt-1 border-t border-slate-100 text-[10px] text-slate-500">
                          {mySandbox.region && <span>Region: <span className="font-medium text-slate-600">{mySandbox.region}</span></span>}
                          {mySandbox.expiresAt && !isExpired && (
                            <SandboxCountdown expiresAt={mySandbox.expiresAt} />
                          )}
                        </div>

                        {/* Usage indicator */}
                        {mySandbox.dailyCapHours > 0 && (
                          <div className="pt-1">
                            <div className="flex justify-between text-[9px] text-slate-400">
                              <span>Today: {mySandbox.hoursUsedToday || 0}h / {mySandbox.dailyCapHours}h</span>
                            </div>
                            <div className="w-full h-1 bg-slate-100 rounded-full mt-0.5">
                              <div className={`h-full rounded-full transition-all ${
                                ((mySandbox.hoursUsedToday || 0) / mySandbox.dailyCapHours) < 0.5 ? 'bg-blue-500' :
                                ((mySandbox.hoursUsedToday || 0) / mySandbox.dailyCapHours) < 0.8 ? 'bg-amber-500' : 'bg-red-500'
                              }`} style={{ width: `${Math.min(((mySandbox.hoursUsedToday || 0) / mySandbox.dailyCapHours) * 100, 100)}%` }} />
                            </div>
                          </div>
                        )}

                        {/* Relaunch button for expired */}
                        {isExpired && mySandbox.templateSlug && (
                          <div className="pt-1">
                            <button
                              onClick={handleRelaunch}
                              disabled={relaunching}
                              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              {relaunching ? (
                                <><FaSpinner className="w-2.5 h-2.5 animate-spin" /> Deploying...</>
                              ) : (
                                <><FaRedo className="w-2.5 h-2.5" /> Launch Again</>
                              )}
                            </button>
                          </div>
                        )}

                        {/* Relaunch message */}
                        {relaunchMsg && (
                          <div className={`p-2 rounded-md text-[10px] ${relaunchMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {relaunchMsg.text}
                            <button onClick={() => setRelaunchMsg(null)} className="ml-2 underline opacity-70">dismiss</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })() : lab.sandboxTemplateSlug && !sandboxLoading ? (
            isAdmin ? (
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-700 text-center space-y-1">
                <div className="flex items-center justify-center gap-1.5 font-semibold">
                  <FaCloud className="w-3 h-3" />
                  Sandbox: {lab.sandboxTemplateSlug}
                </div>
                <p className="text-[10px] text-blue-500">Students see their credentials and Start button here.</p>
              </div>
            ) : (
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-500 text-center">
                No cloud sandbox assigned yet.
              </div>
            )
          ) : null}
        </div>
      )}

      {/* Steps list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {lab.steps
          .sort((a, b) => a.order - b.order)
          .map((step, idx) => (
            <StepCard
              key={step._id}
              step={step}
              stepProgress={getStepProgress(step)}
              index={idx}
              isActive={activeStep === idx}
              onSelect={setActiveStep}
              onComplete={handleComplete}
              onVerify={handleVerify}
              onHint={handleHint}
              verifying={verifying}
              vms={vms}
            />
          ))}
      </div>

      {/* Verify result toast */}
      {verifyResult && (
        <div className={`mx-3 mb-2 p-2 rounded-md text-xs ${verifyResult.passed ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          <div className="font-medium">{verifyResult.passed ? 'Verification passed!' : 'Verification failed'}</div>
          {verifyResult.output && (
            <pre className="mt-1 text-[10px] whitespace-pre-wrap max-h-20 overflow-auto">{verifyResult.output}</pre>
          )}
          <button onClick={() => setVerifyResult(null)} className="mt-1 text-[10px] underline opacity-70">Dismiss</button>
        </div>
      )}

      {/* Lab-Level Troubleshooting */}
      {lab.labTroubleshooting?.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-100">
          <button
            onClick={() => setShowLabTroubleshoot(!showLabTroubleshoot)}
            className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 w-full"
          >
            <FaWrench className="w-3 h-3" />
            <span className="flex-1 text-left">Troubleshooting Guide ({lab.labTroubleshooting.length})</span>
            <FaChevronDown className={`w-2.5 h-2.5 transition-transform ${showLabTroubleshoot ? 'rotate-180' : ''}`} />
          </button>
          {showLabTroubleshoot && (
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
              {lab.labTroubleshooting.map((t, i) => (
                <div key={i} className="p-2 bg-orange-50 border border-orange-200 rounded-md">
                  {t.category && (
                    <span className="text-[9px] font-semibold text-orange-500 uppercase tracking-wider">{t.category}</span>
                  )}
                  <div className="text-xs font-medium text-orange-800">Issue: {t.issue}</div>
                  <div className="text-xs text-orange-700 mt-0.5">Fix: {t.solution}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-100 flex-shrink-0">
        {allDone ? (
          <div className="flex items-center gap-2 text-green-600">
            <FaTrophy className="w-4 h-4" />
            <span className="text-sm font-semibold">Lab Complete!</span>
          </div>
        ) : (
          <div className="w-full bg-slate-100 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>
    </Wrapper>
  );
}
