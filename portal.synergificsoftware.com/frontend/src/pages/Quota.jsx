import React, { useEffect, useMemo, useRef, useState } from "react";
import apiCaller from "../services/apiCaller";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts"; // npm i recharts

/**
 * Quota.jsx — Modern, professional quota manager
 *
 * Props:
 *  - selectedTraining: string | null
 *  - superadminApiRoutes: { quotaApi: string }
 *
 * API:
 *  - GET    `${quotaApi}?trainingName=${selectedTraining}` -> { total: minutes, consumed: minutes }
 *  - POST   quotaApi, body { trainingName, increaseBy: minutes }
 */

const brandGradient = "none"; /* disabled — enterprise design uses flat colors */

const number2 = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0.00";
  const v = typeof n === "string" ? parseFloat(n) : n;
  return isFinite(v) ? v.toFixed(2) : "0.00";
};

const clamp2dp = (val) => {
  // allow up to 2 decimals, positive only
  const s = String(val);
  const m = s.match(/^\d*(?:\.\d{0,2})?$/);
  return !!m;
};

const COLORS = ["#3840b2", "#d1d5db"]; // used vs remaining

const Quota = ({ selectedTraining, superadminApiRoutes }) => {
  const [quota, setQuota] = useState({ totalH: 0, consumedH: 0 });
  const [increaseByH, setIncreaseByH] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const percentUsed = useMemo(() => {
    const t = quota.totalH || 0;
    const c = quota.consumedH || 0;
    if (t <= 0) return 0;
    const p = (c / t) * 100;
    return Math.max(0, Math.min(100, p));
  }, [quota]);

  const updatedTotalH = useMemo(() => {
    const base = quota.totalH || 0;
    const inc = parseFloat(increaseByH);
    if (!isFinite(inc)) return base;
    return +(base + inc).toFixed(2);
  }, [quota.totalH, increaseByH]);

  // ── Fetch current quota ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTraining) return;
    fetchCurrentQuota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTraining]);

  const fetchCurrentQuota = async () => {
    if (!selectedTraining) return;
    setFetching(true);
    setError("");
    try {
      const res = await apiCaller.get(
        `${superadminApiRoutes.quotaApi}?trainingName=${encodeURIComponent(
          selectedTraining
        )}`
      );
      const totalH = (res?.data?.total || 0) / 60;
      const consumedH = (res?.data?.consumed || 0) / 60;
      setQuota({ totalH, consumedH: +number2(consumedH) });
      setLastUpdated(Date.now());
    } catch (e) {
      console.error("Error fetching quota:", e);
      setError(e?.response?.data?.message || "Failed to fetch quota.");
    } finally {
      setFetching(false);
    }
  };

  // ── Form handlers ─────────────────────────────────────────────────────────
  const onChangeHours = (v) => {
    if (v === "") {
      setIncreaseByH("");
      setFieldError("");
      return;
    }
    if (!clamp2dp(v)) return; // ignore invalid keystroke
    const n = parseFloat(v);
    setIncreaseByH(v);
    if (!isFinite(n) || n <= 0) setFieldError("Enter a positive number (max 2 decimals).");
    else setFieldError("");
  };

  const quickAdd = (h) => {
    const current = parseFloat(increaseByH || "0");
    const next = isFinite(current) ? (current + h) : h;
    const fixed = next.toFixed(2).replace(/\.00$/, ".0").replace(/\.0$/, ".0");
    onChangeHours(fixed);
  };

  const resetForm = () => {
    setIncreaseByH("");
    setFieldError("");
  };

  const handleSubmit = async () => {
    if (!selectedTraining) {
      toast("Select a training first.", true);
      return;
    }
    const n = parseFloat(increaseByH);
    if (!isFinite(n) || n <= 0) {
      setFieldError("Enter a valid positive number in hours.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const increaseByMin = Math.round(n * 60);
      await apiCaller.post(superadminApiRoutes.quotaApi, {
        trainingName: selectedTraining,
        increaseBy: increaseByMin,
      });
      toast(`Quota increased by ${number2(n)} hours successfully.`);
      resetForm();
      await fetchCurrentQuota();
    } catch (e) {
      console.error("Error updating quota:", e);
      const msg = e?.response?.data?.message || "Failed to update quota.";
      setError(msg);
      toast(msg, true);
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard helpers: Enter submit, Esc reset
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter") {
        // Only submit if input is focused or within the component
        if (rootRef.current && rootRef.current.contains(document.activeElement)) {
          e.preventDefault();
          handleSubmit();
        }
      } else if (e.key === "Escape") {
        if (rootRef.current && rootRef.current.contains(document.activeElement)) {
          e.preventDefault();
          resetForm();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Chart data
  const donutData = useMemo(() => {
    const used = Math.max(0, Math.min(quota.consumedH, quota.totalH));
    const remaining = Math.max(0, quota.totalH - used);
    return [
      { name: "Used", value: +number2(used) },
      { name: "Remaining", value: +number2(remaining) },
    ];
  }, [quota]);

  const disabled = !selectedTraining || submitting || fetching;

  return (
    <div
      ref={rootRef}
      className="w-full max-w-4xl mx-auto px-4 md:px-6 py-6 md:py-8"
    >
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Quotas</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage compute-hour allocation for <span className="font-medium text-gray-700">{selectedTraining || "—"}</span>
              {lastUpdated && <span className="ml-2 text-gray-400">· updated {new Date(lastUpdated).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchCurrentQuota}
              disabled={!selectedTraining || fetching}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                selectedTraining && !fetching
                  ? "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                  : "bg-white/10 cursor-not-allowed"
              }`}
              aria-label="Refresh quota"
            >
              <IconRefresh className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-100 text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* KPIs & visuals */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <KpiCard label="Total (hrs)" value={number2(quota.totalH)} />
            <KpiCard label="Consumed (hrs)" value={number2(quota.consumedH)} />
          </div>

          <div className="rounded-xl border border-slate-100 bg-white p-4 md:p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-800 mb-2">Usage</div>
            {fetching ? (
              <SkeletonBar />
            ) : (
              <Progress percent={percentUsed} />
            )}
            <div className="text-xs text-slate-500 mt-2">
              {number2(quota.consumedH)}h used of {number2(quota.totalH)}h — {number2(percentUsed)}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white p-4 md:p-5 shadow-sm">
            <div className="text-sm font-semibold text-slate-800 mb-2">Quota Distribution</div>
            <div className="h-56 md:h-64">
              {fetching ? (
                <SkeletonChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip />
                    <Legend />
                    <Pie data={donutData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={45}>
                      {donutData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-100 bg-white p-4 md:p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Increase Quota</div>
                <div className="text-xs text-slate-500">Enter hours — converted to minutes on submit</div>
              </div>
            </div>

            <label className="block text-xs text-slate-500 mb-1">Increase by (hours)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g., 2 or 1.5"
              value={increaseByH}
              onChange={(e) => onChangeHours(e.target.value)}
              disabled={disabled}
              className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 ${
                disabled ? "bg-slate-50 text-slate-400 border-slate-200" : "bg-white border-slate-300"
              }`}
              aria-invalid={!!fieldError}
              aria-describedby="quota-error"
            />
            {fieldError && (
              <div id="quota-error" className="text-xs text-rose-600 mt-1">{fieldError}</div>
            )}

            {/* Quick add chips */}
            <div className="flex flex-wrap gap-2 mt-3">
              {[1, 2, 4, 8].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => quickAdd(h)}
                  disabled={!selectedTraining}
                  className={`px-3 py-1.5 rounded-full text-xs border shadow-sm ${
                    selectedTraining ? "bg-white hover:bg-slate-50 border-slate-200" : "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  +{h}h
                </button>
              ))}
            </div>

            {/* Preview */}
            <div className="mt-3 text-sm text-slate-700">
              Updated Total (hrs): <span className="font-semibold">{number2(updatedTotalH)}</span>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={handleSubmit}
                disabled={!selectedTraining || !!fieldError || !increaseByH || submitting}
                className={`px-4 py-2 rounded-xl text-sm text-white shadow-sm ${
                  !selectedTraining || !!fieldError || !increaseByH || submitting
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-slate-900 hover:opacity-90"
                }`}
              >
                {submitting ? <Spinner /> : <IconPlus className="h-4 w-4 mr-2 inline" />} Increase
              </button>
              <button
                onClick={resetForm}
                disabled={disabled && !increaseByH}
                className="px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          </div>

          <InfoAlert />
        </div>
      </div>

      <Toaster />
    </div>
  );
};

// ── UI atoms ────────────────────────────────────────────────────────────────
const KpiCard = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 md:p-5" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{label}</div>
    <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
  </div>
);

const Progress = ({ percent }) => (
  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
    <div
      className="h-full bg-slate-900 transition-all"
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    />
  </div>
);

const SkeletonBar = () => (
  <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
    <div className="h-full w-1/2 bg-slate-200 animate-pulse" />
  </div>
);

const SkeletonChart = () => (
  <div className="h-full w-full grid place-items-center">
    <div className="h-24 w-24 rounded-full border-8 border-slate-200 animate-pulse" />
  </div>
);

const InfoAlert = () => (
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 shadow-sm">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-amber-100 grid place-items-center">
        <IconInfo className="h-5 w-5" />
      </div>
      <div className="text-sm">
        <div className="font-semibold mb-0.5">What this action does</div>
        <p>
          Increasing the training quota will <strong>increase the quota of all VMs</strong> in the selected training.
          This <strong>won’t work on deleted trainings</strong>.
        </p>
      </div>
    </div>
  </div>
);

const Spinner = () => (
  <span className="inline-block align-[-2px] h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin mr-1" />
);

const IconRefresh = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M20 8a8 8 0 1 0 2 5" />
  </svg>
);
const IconPlus = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
  </svg>
);
const IconInfo = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8h.01" />
    <path d="M11 12h2v5h-2z" />
  </svg>
);

// ── Minimal toast system (no external deps) ─────────────────────────────────
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
      <div className={`px-4 py-2.5 rounded-xl shadow-lg text-sm ${
        t.isError ? "bg-rose-600 text-white" : "bg-slate-900 text-white"
      }`}>
        {t.message}
      </div>
    </div>
  );
};

export default Quota;
