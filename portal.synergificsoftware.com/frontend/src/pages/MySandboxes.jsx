import React, { useEffect, useState, useCallback, useRef } from 'react';
import apiCaller from '../services/apiCaller';
import {
  FaAws, FaCloud, FaGoogle,
  FaCopy, FaCheck, FaExternalLinkAlt, FaChevronDown, FaChevronUp,
  FaCheckCircle, FaTimesCircle, FaCubes, FaRedo,
} from 'react-icons/fa';

/* ------------------------------------------------------------------ */
/*  Cloud badge config                                                 */
/* ------------------------------------------------------------------ */
const CLOUD_META = {
  aws:   { label: 'AWS',   Icon: FaAws,            color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
  azure: { label: 'Azure', Icon: FaCloud,   color: 'text-blue-500',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  gcp:   { label: 'GCP',   Icon: FaGoogle,  color: 'text-red-500',    bg: 'bg-red-50',    border: 'border-red-200' },
  oci:   { label: 'OCI',   Icon: FaCloud,   color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
};

/* ------------------------------------------------------------------ */
/*  Copy button                                                        */
/* ------------------------------------------------------------------ */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may fail in insecure contexts */ }
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 p-1 rounded text-surface-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
      title="Copy"
    >
      {copied ? <FaCheck className="text-green-500 text-xs" /> : <FaCopy className="text-xs" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Countdown timer                                                    */
/* ------------------------------------------------------------------ */
function ExpiryTimer({ expiresAt }) {
  const calcRemaining = useCallback(() => {
    if (!expiresAt) return null;
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return { h: 0, m: 0, s: 0, total: 0 };
    return {
      h: Math.floor(diff / 3600000),
      m: Math.floor((diff % 3600000) / 60000),
      s: Math.floor((diff % 60000) / 1000),
      total: diff,
    };
  }, [expiresAt]);

  const [remaining, setRemaining] = useState(calcRemaining);

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setRemaining(calcRemaining()), 1000);
    return () => clearInterval(id);
  }, [expiresAt, calcRemaining]);

  if (!remaining || !expiresAt) return <span className="text-surface-400 text-sm">No expiry set</span>;
  if (remaining.total <= 0) return <span className="text-red-600 font-medium text-sm">Access ended</span>;

  const isUrgent = remaining.total < 30 * 60 * 1000; // under 30 min
  const colorClass = isUrgent ? 'text-red-600' : 'text-surface-700';

  const pad = (n) => String(n).padStart(2, '0');
  return (
    <span className={`font-mono text-sm font-medium ${colorClass}`}>
      {pad(remaining.h)}:{pad(remaining.m)}:{pad(remaining.s)} remaining
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */
function StatusBadge({ status, expiresAt }) {
  const now = Date.now();
  const expMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const isExpired = expMs && expMs <= now;
  const isExpiringSoon = expMs && !isExpired && (expMs - now) < 60 * 60 * 1000; // under 1 hour

  // Two distinct lifecycles:
  //   - Session: a single sandbox launch (4h TTL). After it ends → "Session ended"
  //     (user can relaunch within the access window).
  //   - Access: the engagement window itself (endDate). When that passes the IAM
  //     user/sandbox doc is fully torn down — different state, different label.
  let label, classes;
  if (isExpired || status === 'expired') {
    label = 'Session ended';
    classes = 'bg-red-100 text-red-700';
  } else if (isExpiringSoon) {
    label = 'Expiring Soon';
    classes = 'bg-amber-100 text-amber-700';
  } else {
    label = 'Active';
    classes = 'bg-green-100 text-green-700';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible service list                                           */
/* ------------------------------------------------------------------ */
function ServiceList({ title, items, type }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;

  const isAllowed = type === 'allowed';
  const iconColor = isAllowed ? 'text-green-500' : 'text-red-400';
  const Icon = isAllowed ? FaCheckCircle : FaTimesCircle;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium text-surface-600 hover:text-surface-800 transition-colors"
      >
        {open ? <FaChevronUp className="text-[10px]" /> : <FaChevronDown className="text-[10px]" />}
        {title} ({items.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Icon className={`mt-0.5 text-xs flex-shrink-0 ${iconColor}`} />
              <div>
                <span className="text-surface-700">{item.service}</span>
                {item.category && (
                  <span className="ml-1.5 text-xs text-surface-400">({item.category})</span>
                )}
                {item.restrictions && (
                  <span className="ml-1.5 text-xs text-surface-500">- {item.restrictions}</span>
                )}
                {item.reason && (
                  <span className="ml-1.5 text-xs text-red-400">- {item.reason}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Daily usage indicator                                              */
/* ------------------------------------------------------------------ */
function UsageIndicator({ hoursUsedToday = 0, dailyCapHours = 12 }) {
  const pct = dailyCapHours > 0 ? Math.min((hoursUsedToday / dailyCapHours) * 100, 100) : 0;
  // Color shifts from blue to red as usage increases
  const barColor = pct < 50 ? 'bg-blue-500' : pct < 80 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="mt-1">
      <span className="text-xs text-surface-500">
        Today: {hoursUsedToday}h / {dailyCapHours}h
      </span>
      <div className="w-full h-1.5 bg-surface-100 rounded-full mt-0.5">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sandbox card                                                       */
/* ------------------------------------------------------------------ */
function SandboxCard({ sandbox, onRelaunch, relaunchingId, resetProgress }) {
  const meta = CLOUD_META[sandbox.cloud] || CLOUD_META.aws;
  const { Icon, label, color, bg, border } = meta;

  const expMs = sandbox.expiresAt ? new Date(sandbox.expiresAt).getTime() : null;
  const isExpired = sandbox.status === 'expired' || (expMs && expMs <= Date.now());
  const isRelaunching = relaunchingId === `${sandbox.cloud}-${sandbox.templateSlug}`;
  const rp = resetProgress && resetProgress[sandbox.projectId];
  const isResetting = !!rp && (rp.status === 'resetting' || rp.status === 'queued');

  return (
    <div className={`rounded-xl border ${border} bg-white shadow-sm`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-3 rounded-t-xl ${bg}`}>
        <div className="flex items-center gap-2.5">
          <Icon className={`text-xl ${color}`} />
          <span className="font-semibold text-surface-800 text-sm">{label} Sandbox</span>
          {sandbox.templateName && (
            <span className="text-xs text-surface-500">- {sandbox.templateName}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={sandbox.status} expiresAt={sandbox.expiresAt} />
          {isExpired && sandbox.templateSlug && (
            <button
              onClick={() => onRelaunch(sandbox)}
              disabled={isRelaunching}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium
                bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRelaunching ? (
                <>
                  <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                  Deploying...
                </>
              ) : (
                <>
                  <FaRedo className="text-[10px]" />
                  Launch Again
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {isResetting && (
        <div className="px-5 py-4 border-b border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
              <span className="text-sm font-semibold text-blue-900">Resetting sandbox</span>
            </div>
            <span className="text-sm font-bold text-blue-700 tabular-nums">{rp.percent || 0}%</span>
          </div>
          <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
                 style={{ width: (rp.percent || 0) + "%" }} />
          </div>
          <div className="mt-2 text-xs text-blue-800">
            <div className="font-medium">{rp.currentPhase || 'Preparing…'}</div>
            {rp.currentStep && <div className="text-blue-700/80">→ {rp.currentStep}</div>}
            <div className="mt-1 text-blue-700/60">{rp.completed || 0} / {rp.total || 0} steps</div>
          </div>
          {Array.isArray(rp.log) && rp.log.length > 0 && (
            <details className="mt-2">
              <summary className="text-[11px] text-blue-700 cursor-pointer select-none">recent activity</summary>
              <div className="mt-1 max-h-24 overflow-y-auto text-[11px] font-mono text-blue-900/80 space-y-0.5">
                {rp.log.slice(-8).reverse().map((e, i) => (
                  <div key={i} className={e.ok ? '' : 'text-red-700'}>
                    {e.ok ? '✓' : '✗'} {e.phase} / {e.step}{e.message ? ' — ' + e.message : ''}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="px-5 py-4 space-y-4">
        {/* Credentials */}
        <div className="space-y-2.5">
          {sandbox.accessUrl && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-500 w-20 flex-shrink-0">Login URL</span>
              <a
                href={sandbox.accessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline truncate flex items-center gap-1"
              >
                {sandbox.accessUrl}
                <FaExternalLinkAlt className="text-[10px] flex-shrink-0" />
              </a>
              <CopyButton text={sandbox.accessUrl} />
            </div>
          )}
          {sandbox.username && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-500 w-20 flex-shrink-0">Username</span>
              <code className="bg-surface-50 px-2 py-0.5 rounded text-surface-800 text-xs">
                {sandbox.username}
              </code>
              <CopyButton text={sandbox.username} />
            </div>
          )}
          {sandbox.password && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-500 w-20 flex-shrink-0">Password</span>
              <code className="bg-surface-50 px-2 py-0.5 rounded text-surface-800 text-xs">
                {sandbox.password}
              </code>
              <CopyButton text={sandbox.password} />
            </div>
          )}
          {sandbox.accessKeyId && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-500 w-20 flex-shrink-0">Access Key</span>
              <code className="bg-surface-50 px-2 py-0.5 rounded text-surface-800 text-xs break-all">
                {sandbox.accessKeyId}
              </code>
              <CopyButton text={sandbox.accessKeyId} />
            </div>
          )}
          {sandbox.secretAccessKey && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-surface-500 w-20 flex-shrink-0">Secret Key</span>
              <code className="bg-surface-50 px-2 py-0.5 rounded text-surface-800 text-xs break-all">
                {sandbox.secretAccessKey}
              </code>
              <CopyButton text={sandbox.secretAccessKey} />
            </div>
          )}
        </div>

        {/* Region + Expiry */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 border-t border-surface-100">
          {sandbox.region && (
            <div className="text-sm">
              <span className="text-surface-500">Region: </span>
              <span className="text-surface-700 font-medium">{sandbox.region}</span>
            </div>
          )}
          <div className="text-sm">
            <span className="text-surface-500">Access ends: </span>
            <ExpiryTimer expiresAt={sandbox.expiresAt} />
          </div>
        </div>

        {/* Daily usage indicator */}
        {(sandbox.dailyCapHours > 0) && (
          <UsageIndicator
            hoursUsedToday={sandbox.hoursUsedToday || 0}
            dailyCapHours={sandbox.dailyCapHours || 12}
          />
        )}

        {/* Services */}
        <ServiceList title="Allowed Services" items={sandbox.allowedServices} type="allowed" />
        <ServiceList title="Restricted Services" items={sandbox.blockedServices} type="blocked" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */
export default function MySandboxes() {
  const [sandboxes, setSandboxes] = useState([]);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [relaunchingId, setRelaunchingId] = useState(null);
  const [relaunchMsg, setRelaunchMsg] = useState(null);
  const [relaunchStartedAt, setRelaunchStartedAt] = useState(null);
  const relaunchInFlightRef = useRef(false);
  const [, setProgressTick] = useState(0);
  const [resetProgress, setResetProgress] = useState({});

  const fetchSandboxes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiCaller.get('/user/my-sandboxes');
      setSandboxes(res.data.sandboxes || []);
    } catch (err) {
      console.error('Failed to fetch sandboxes:', err);
      setError('Unable to load your sandboxes. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailableTemplates = useCallback(async () => {
    try {
      const res = await apiCaller.get('/user/available-sandbox-templates');
      setAvailableTemplates(res.data.templates || []);
    } catch {
      // Non-critical — empty list just means no first-deploy buttons
    }
  }, []);

  useEffect(() => { fetchSandboxes(); fetchAvailableTemplates(); }, [fetchSandboxes, fetchAvailableTemplates]);

  // Path 3 — poll reset progress every 2s for any GCP sandbox that is resetting
  useEffect(() => {
    const gcpResetting = (sandboxes || []).filter(
      s => s.cloud === 'gcp' && s.projectId && (s.reset?.status === 'resetting' || s.reset?.status === 'queued')
    );
    if (gcpResetting.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const updates = {};
      await Promise.all(gcpResetting.map(async (s) => {
        try {
          const r = await apiCaller.get('/user/sandbox-reset-progress', { params: { cloud: 'gcp', projectId: s.projectId } });
          updates[s.projectId] = r.data;
        } catch { /* ignore transient */ }
      }));
      if (!cancelled) {
        setResetProgress(prev => ({ ...prev, ...updates }));
        // If all done, refresh sandbox list
        const allDone = Object.values(updates).every(u => u.status === 'ready' || u.status === 'failed');
        if (allDone && Object.keys(updates).length > 0) await fetchSandboxes();
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sandboxes, fetchSandboxes]);


  // Tick every 1s while a relaunch is in flight so the progress label updates
  useEffect(() => {
    if (!relaunchingId) return;
    const t = setInterval(() => setProgressTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [relaunchingId]);

  const handleRelaunch = async (sandbox) => {
    // Synchronous guard against rapid double-clicks. The disabled-prop on the
    // button only takes effect on the next render (~16ms gap), and a fast
    // clicker can fire two events before that. A ref reads instantly.
    if (relaunchInFlightRef.current) return;
    relaunchInFlightRef.current = true;

    const id = `${sandbox.cloud}-${sandbox.templateSlug}`;
    setRelaunchingId(id);
    setRelaunchStartedAt(Date.now());
    setRelaunchMsg(null);

    try {
      const body = { cloud: sandbox.cloud, templateSlug: sandbox.templateSlug };
      if (sandbox.cloud === 'gcp') body.email = sandbox.username || sandbox.googleEmail;

      const res = await apiCaller.post('/user/relaunch-sandbox', body);
      setRelaunchMsg({
        type: 'success',
        text: `Sandbox re-launched. Expires at ${new Date(res.data.sandbox.expiresAt).toLocaleTimeString()}.`,
      });
      await fetchSandboxes();
    } catch (err) {
      const data = err.response?.data;
      if (data?.error === 'Daily limit reached') {
        setRelaunchMsg({
          type: 'error',
          text: `Daily limit reached (${data.hoursUsedToday}h used today / ${data.dailyCapHours}h max). Try again tomorrow at 12:00 AM IST.`,
        });
      } else if (data?.error === 'Total engagement hours exhausted') {
        setRelaunchMsg({
          type: 'error',
          text: `Total hours exhausted (${data.totalHoursUsed}h / ${data.totalCapHours}h). Contact your administrator.`,
        });
      } else {
        setRelaunchMsg({
          type: 'error',
          text: data?.message || 'Failed to re-launch sandbox. Please try again.',
        });
      }
    } finally {
      setRelaunchingId(null);
      setRelaunchStartedAt(null);
      relaunchInFlightRef.current = false;
    }
  };

  // Estimated provisioning progress label — shown under the relaunch spinner
  const provisioningProgress = (cloud) => {
    if (!relaunchStartedAt) return null;
    const sec = (Date.now() - relaunchStartedAt) / 1000;
    const ESTIMATED = cloud === 'gcp' ? 180 : 90;   // GCP projects take ~3 min, others ~90s
    let label = 'Submitting request...';
    if (cloud === 'gcp') {
      if (sec > 120) label = 'Finalizing IAM bindings...';
      else if (sec > 60) label = 'Applying org policies...';
      else if (sec > 20) label = 'Creating GCP project...';
    } else if (cloud === 'azure') {
      if (sec > 60) label = 'Assigning IAM role...';
      else if (sec > 30) label = 'Creating resource group...';
      else if (sec > 10) label = 'Creating Azure AD user...';
    } else if (cloud === 'aws') {
      if (sec > 30) label = 'Attaching IAM policies...';
      else if (sec > 10) label = 'Creating IAM user...';
    } else if (cloud === 'oci') {
      if (sec > 60) label = 'Provisioning compartment policies...';
      else if (sec > 20) label = 'Creating OCI compartment...';
    }
    return { sec, pct: Math.min(95, Math.round((sec / ESTIMATED) * 100)), label };
  };

  // First-sandbox deploy — same code path as relaunch but synthesized from a template
  const handleDeployFirst = async (template) => {
    const cloud = template.cloud;
    const fakeSandbox = { cloud, templateSlug: template.slug };
    return handleRelaunch(fakeSandbox);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full mb-4" />
        <p className="text-surface-500 text-sm">Loading your sandboxes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 bg-red-50 border border-red-200 rounded-xl text-center">
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-800">My Sandboxes</h1>
        <p className="text-sm text-surface-500 mt-1">
          Cloud sandbox environments assigned to you. Use the credentials below to log in.
        </p>
      </div>

      {/* Relaunch feedback message */}
      {relaunchMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
          relaunchMsg.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {relaunchMsg.text}
          <button
            onClick={() => setRelaunchMsg(null)}
            className="ml-3 text-xs underline opacity-70 hover:opacity-100"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Provisioning progress indicator — shown above cards while a relaunch/first-deploy is in flight */}
      {relaunchingId && relaunchStartedAt && (() => {
        const cloudPart = relaunchingId.split('-')[0];
        const p = provisioningProgress(cloudPart);
        if (!p) return null;
        return (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-blue-800">{p.label}</span>
              <span className="text-xs text-blue-600 tabular-nums">{p.pct}% · {Math.floor(p.sec)}s elapsed</span>
            </div>
            <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
              <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${p.pct}%` }} />
            </div>
            <p className="text-[11px] text-blue-700 mt-1.5">Provisioning a fresh cloud sandbox for you. Don't refresh — this typically takes 1-3 minutes.</p>
          </div>
        );
      })()}

      {sandboxes.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-surface-200">
          <FaCubes className="mx-auto text-3xl text-surface-300 mb-3" />
          <p className="text-surface-500 text-sm">No active sandboxes yet.</p>
          {availableTemplates.length > 0 ? (
            <>
              <p className="text-surface-400 text-xs mt-1 mb-4">Click below to deploy your first sandbox. It auto-cleans after its TTL.</p>
              <div className="flex flex-col items-center gap-2">
                {availableTemplates.map(tpl => {
                  const id = `${tpl.cloud}-${tpl.slug}`;
                  const isInFlight = relaunchingId === id;
                  return (
                    <button
                      key={tpl.slug}
                      onClick={() => handleDeployFirst(tpl)}
                      disabled={!!relaunchingId}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {isInFlight ? <FaRedo className="animate-spin w-3 h-3" /> : <FaCubes className="w-3 h-3" />}
                      Deploy {tpl.name} ({tpl.cloud.toUpperCase()})
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-surface-400 text-xs mt-1">Your instructor will provision sandboxes when your lab session begins.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {sandboxes.map((sb, i) => (
            <SandboxCard
              key={`${sb.cloud}-${i}`}
              sandbox={sb}
              onRelaunch={handleRelaunch}
              relaunchingId={relaunchingId}
              resetProgress={resetProgress}
            />
          ))}
        </div>
      )}
    </div>
  );
}
