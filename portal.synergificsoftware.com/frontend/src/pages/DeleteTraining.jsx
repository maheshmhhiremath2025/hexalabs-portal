import React, { useEffect, useMemo, useRef, useState } from "react";
import apiCaller from "../services/apiCaller";

/**
 * DeleteTraining.jsx — Modern destructive-action flow (modal, 2 steps, dry-run, a11y)
 *
 * Props:
 *  - selectedTraining: string | null
 *  - apiRoutes: { killTrainingApi: string }
 *  - onCancel?: () => void
 *  - onDeleted?: () => void
 *  - onArchive?: (trainingName: string | null) => void
 *
 * Behavior:
 *  - Shows a compact warning card with a "Delete Training" button.
 *  - Clicking it opens a modal with a 2-step flow: Review → Confirm.
 *  - Supports optional dry-run preview (calls same endpoint with `?dryRun=true`).
 *  - Type-to-confirm (exact training name) + mandatory checkbox to enable Delete.
 *  - ESC to close, Enter to submit (on confirm step when eligible).
 *  - Focus trap & ARIA attributes for accessibility.
 *  - Minimal inline Toaster (no external deps) for success/error feedback.
 */

const brandGradient = "linear-gradient(110deg, #3840b2, #7954ca)";

const DeleteTraining = ({ selectedTraining, apiRoutes, onCancel, onDeleted, onArchive }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1); // 1=Review, 2=Confirm
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [consent, setConsent] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [preview, setPreview] = useState(null);
  const [resourceCounts, setResourceCounts] = useState(null); // pre-delete resource counts
  const [purgeResult, setPurgeResult] = useState(null);

  const isEligible = useMemo(() => {
    return (
      !!selectedTraining &&
      step === 2 &&
      consent &&
      confirmText.trim() === String(selectedTraining).trim() &&
      !isLoading
    );
  }, [selectedTraining, step, consent, confirmText, isLoading]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Close helpers
  const closeAll = () => {
    setOpen(false);
    setTimeout(() => {
      setStep(1);
      setError("");
      setConfirmText("");
      setConsent(false);
      setDryRun(false);
      setPreview(null);
    }, 200);
  };

  const handleOpen = async () => {
    if (!selectedTraining) {
      toast("Select a training first.", true);
      return;
    }
    setOpen(true);
    // Fetch resource counts
    try {
      const res = await apiCaller.get(`${apiRoutes.killTrainingApi}/preview?trainingName=${encodeURIComponent(selectedTraining)}`);
      setResourceCounts(res.data);
    } catch { setResourceCounts(null); }
  };

  const handleCancel = () => {
    closeAll();
    onCancel?.();
  };

  // Dry-run preview (optional capability on your API)
  const runPreview = async () => {
    if (!selectedTraining) return;
    setIsLoading(true);
    setError("");
    try {
      const url = `${apiRoutes.killTrainingApi}?trainingName=${encodeURIComponent(
        selectedTraining
      )}&dryRun=true`;
      const res = await apiCaller.delete(url);
      setPreview(res?.data ?? { message: "No preview payload." });
      toast("Dry-run completed.");
    } catch (e) {
      console.error("Dry-run failed", e);
      setPreview(null);
      setError(
        e?.response?.data?.message ||
          "Dry-run is not supported on the server or failed."
      );
      toast("Dry-run failed.", true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedTraining) {
      toast("Please select a training to delete.", true);
      return;
    }

    setIsLoading(true);
    setError("");
    setPurgeResult(null);

    try {
      const url = `${apiRoutes.killTrainingApi}?trainingName=${encodeURIComponent(
        selectedTraining
      )}${dryRun ? "&dryRun=true" : ""}`;
      const response = await apiCaller.delete(url);

      if (dryRun) {
        setPreview(response?.data ?? { message: "No preview payload." });
        toast("Dry-run completed.");
        setStep(1);
        return;
      }

      // Show purge results before closing
      setPurgeResult(response?.data);
      toast(response?.data?.message || "Training deleted successfully.");

      // Auto-close after 5 seconds
      setTimeout(() => {
        closeAll();
        setPurgeResult(null);
        onDeleted?.();
      }, 5000);
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message ||
        "An error occurred while deleting the training. Please try again.";
      setError(errorMessage);
      toast(errorMessage, true);
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard: ESC to cancel; Enter to submit (only on step 2 when eligible)
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && isEligible) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isEligible]);

  // Focus trap within modal
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const focusable = node.querySelectorAll(
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handleTab = (e) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    node.addEventListener("keydown", handleTab);
    return () => node.removeEventListener("keydown", handleTab);
  }, [open]);

  return (
    <div className="w-full">
      {/* Surface card */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-12 h-12 rounded-xl grid place-items-center text-white"
               style={{ background: "linear-gradient(110deg,#ef4444,#f59e0b)" }}>
            <IconWarning className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Delete Training</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              Permanently delete a training and all related resources. This cannot be undone.
            </p>
            <ul className="mt-3 text-sm text-rose-700 dark:text-rose-300 list-disc pl-5 space-y-1">
              <li>Azure VMs &amp; Docker Containers</li>
              <li>RDS Servers &amp; all user sessions</li>
              <li>AVD Host Pools</li>
              <li>Guacamole connections &amp; port rules</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Selected: <span className="font-medium text-slate-700 dark:text-slate-200">{selectedTraining || "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onArchive?.(selectedTraining ?? null)}
              className="px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-100 hover:bg-slate-50"
            >
              Archive instead
            </button>
            <button
              onClick={handleOpen}
              disabled={!selectedTraining}
              className={`px-4 py-2 rounded-xl text-sm text-white shadow-sm ${
                selectedTraining
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-rose-300 cursor-not-allowed"
              }`}
            >
              Delete training
            </button>
          </div>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50"
          aria-labelledby="delete-training-title"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={handleCancel} />
          <div className="relative z-10 min-h-full flex items-center justify-center p-4">
            <div
              ref={dialogRef}
              className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden"
            >
              {/* Header */}
              <div className="p-5 text-white" style={{ background: brandGradient }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 id="delete-training-title" className="text-lg font-semibold">Delete training</h3>
                    <p className="text-xs opacity-90 mt-0.5">This action is permanent.</p>
                  </div>
                  <button onClick={handleCancel} className="bg-white/15 hover:bg-white/25 rounded-lg p-2">
                    <IconClose className="h-4 w-4" />
                  </button>
                </div>
                <Stepper step={step} />
              </div>

              {/* Content */}
              <div className="p-5">
                {error && (
                  <div className="mb-3 p-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-100 text-sm dark:bg-rose-900/20 dark:text-rose-100 dark:border-rose-900/40">
                    {error}
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div className="text-sm text-slate-700 dark:text-slate-200">
                      You're about to delete <strong>{selectedTraining}</strong> and the following resources:
                    </div>
                    {/* Dynamic resource counts */}
                    {resourceCounts ? (
                      <div className="grid sm:grid-cols-2 gap-2">
                        {resourceCounts.azureVms > 0 && <ImpactItem label="Azure VMs" count={resourceCounts.azureVms} />}
                        {resourceCounts.containers > 0 && <ImpactItem label="Docker Containers" count={resourceCounts.containers} />}
                        {resourceCounts.rdsServers > 0 && <ImpactItem label="RDS Servers" count={resourceCounts.rdsServers} />}
                        {resourceCounts.rdsSessions > 0 && <ImpactItem label="RDS User Sessions" count={resourceCounts.rdsSessions} />}
                        {resourceCounts.total === 0 && <div className="text-sm text-slate-500 col-span-2">No active resources found for this training.</div>}
                      </div>
                    ) : <div className="text-sm text-slate-400">Loading resource counts...</div>}

                    {/* Dry-run toggle + preview */}
                    <div className="mt-2">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                          checked={dryRun}
                          onChange={(e) => setDryRun(e.target.checked)}
                        />
                        Perform a dry-run first (no resources will be deleted)
                      </label>
                      {dryRun && (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={runPreview}
                            disabled={isLoading}
                            className={`px-3 py-2 rounded-xl text-sm border shadow-sm ${
                              isLoading
                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                            }`}
                          >
                            {isLoading ? "Running…" : "Run dry-run"}
                          </button>
                          {preview && (
                            <span className="text-xs text-slate-500">Preview ready below</span>
                          )}
                        </div>
                      )}

                      {preview && (
                        <div className="mt-3">
                          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Dry-run preview</div>
                          <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 max-h-40 overflow-auto text-xs">
                            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(preview, null, 2)}</pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    {/* Purging in progress */}
                    {isLoading && (
                      <div className="space-y-3 py-4">
                        <div className="flex items-center gap-3">
                          <Spinner />
                          <span className="text-sm font-medium text-slate-700">
                            Purging {resourceCounts?.total || ''} resources for <strong>{selectedTraining}</strong>...
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div className="h-2 bg-rose-500 rounded-full transition-all duration-1000" style={{ width: '100%' }} />
                        </div>
                        <div className="text-xs text-slate-500">
                          {[
                            resourceCounts?.azureVms > 0 && `${resourceCounts.azureVms} VMs`,
                            resourceCounts?.containers > 0 && `${resourceCounts.containers} containers`,
                            resourceCounts?.rdsServers > 0 && `${resourceCounts.rdsServers} RDS servers`,
                            resourceCounts?.rdsSessions > 0 && `${resourceCounts.rdsSessions} RDS sessions`,
                          ].filter(Boolean).join(', ') || 'Cleaning up resources...'}
                        </div>
                      </div>
                    )}

                    {/* Purge results */}
                    {purgeResult && !isLoading && (
                      <div className="space-y-3 py-2">
                        <div className="flex items-center gap-2 text-green-700">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                          <span className="text-sm font-semibold">{purgeResult.message}</span>
                        </div>
                        {purgeResult.details && (() => {
                          const items = [
                            purgeResult.details.azureVms > 0 && { count: purgeResult.details.azureVms, label: 'Azure VMs' },
                            purgeResult.details.containers > 0 && { count: purgeResult.details.containers, label: 'Workspaces' },
                            purgeResult.details.rdsServers > 0 && { count: purgeResult.details.rdsServers, label: 'RDS Servers' },
                            purgeResult.details.rdsSessions > 0 && { count: purgeResult.details.rdsSessions, label: 'RDS Sessions' },
                            purgeResult.details.avd > 0 && { count: purgeResult.details.avd, label: 'AVD Pools' },
                          ].filter(Boolean);
                          return items.length > 0 ? (
                            <div className={`grid gap-2 ${items.length <= 2 ? 'grid-cols-2' : 'grid-cols-' + Math.min(items.length, 4)}`}>
                              {items.map((item, i) => (
                                <div key={i} className="bg-slate-50 rounded-lg p-2 text-center">
                                  <div className="text-lg font-bold text-slate-800">{item.count}</div>
                                  <div className="text-[10px] text-slate-500 uppercase">{item.label}</div>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}
                        {purgeResult.details?.errors?.length > 0 && (
                          <div className="text-xs text-rose-600 bg-rose-50 rounded-lg p-2">
                            {purgeResult.details.errors.length} error(s): {purgeResult.details.errors.join(', ')}
                          </div>
                        )}
                        <div className="text-xs text-slate-400">Closing in 5 seconds...</div>
                      </div>
                    )}

                    {/* Confirm form — only show when not loading and no result yet */}
                    {!isLoading && !purgeResult && (
                      <>
                        <div className="text-sm text-slate-700 dark:text-slate-200">
                          To confirm, type the training name exactly and acknowledge permanence.
                        </div>
                        <div className="grid gap-3">
                          <label className="text-xs text-slate-500">Training name</label>
                          <input
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder={selectedTraining || "training-name"}
                            className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700"
                          />
                          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 mt-1">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                              checked={consent}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            I understand this action is permanent and cannot be undone.
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {step > 1 ? (
                      <button
                        onClick={() => setStep(1)}
                        className="px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-100 hover:bg-slate-50"
                      >
                        Back
                      </button>
                    ) : (
                      <button
                        onClick={handleCancel}
                        className="px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-100 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={() => onArchive?.(selectedTraining ?? null)}
                      className="px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-100 hover:bg-slate-50"
                    >
                      Archive instead
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {step === 1 && (
                      <button
                        onClick={() => setStep(2)}
                        className="px-4 py-2 rounded-xl text-sm text-white bg-slate-900 hover:opacity-90 shadow-sm"
                      >
                        Continue
                      </button>
                    )}
                    {step === 2 && (
                      <button
                        onClick={handleSubmit}
                        disabled={!isEligible}
                        className={`px-4 py-2 rounded-xl text-sm text-white shadow-sm inline-flex items-center gap-2 ${
                          isEligible ? "bg-rose-600 hover:bg-rose-700" : "bg-rose-300 cursor-not-allowed"
                        }`}
                      >
                        {isLoading && <Spinner />}
                        {dryRun ? "Run dry-run" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
};

// Impact list with badges — swap with live counts when available
const ImpactList = () => (
  <div className="grid sm:grid-cols-2 gap-3">
    <ImpactItem label="Azure VMs" />
    <ImpactItem label="Docker Containers" />
    <ImpactItem label="RDS Servers & Sessions" />
    <ImpactItem label="AVD Host Pools" />
    <ImpactItem label="Guacamole connections" />
    <ImpactItem label="Port & firewall rules" />
  </div>
);

const ImpactItem = ({ label, count }) => (
  <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
    <div className="text-sm text-slate-700">{label}</div>
    <span className="text-xs bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full font-semibold">{count}</span>
  </div>
);

const Stepper = ({ step }) => (
  <div className="mt-4">
    <div className="flex items-center gap-2 text-xs">
      <div className={`px-2 py-1 rounded-full ${step >= 1 ? "bg-white/25" : "bg-white/10"}`}>Review</div>
      <div className="h-px flex-1 bg-white/25" />
      <div className={`px-2 py-1 rounded-full ${step >= 2 ? "bg-white/25" : "bg-white/10"}`}>Confirm</div>
    </div>
  </div>
);

const Spinner = () => (
  <span className="inline-block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
);

const IconWarning = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
    <path d="M12 2l9 16H3L12 2z" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
    <path d="M12 8v5" />
  </svg>
);

const IconClose = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
  </svg>
);

// ── Minimal toast system (no external deps) ──────────────────────────────────
const listeners = new Set();
const toast = (message, isError = false) => {
  listeners.forEach((fn) => fn({ message, isError }));
};
const Toaster = () => {
  const [t, setT] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    const sub = (payload) => {
      setT(payload);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(null), 2600);
    };
    listeners.add(sub);
    return () => listeners.delete(sub);
  }, []);
  if (!t) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className={`px-4 py-2.5 rounded-xl shadow-sm text-sm ${
        t.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"
      }`}>
        {t.message}
      </div>
    </div>
  );
};

export default DeleteTraining;
