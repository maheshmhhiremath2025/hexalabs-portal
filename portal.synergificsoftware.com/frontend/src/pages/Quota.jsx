import React, { useEffect, useMemo, useState, useCallback } from "react";
import apiCaller from "../services/apiCaller";

/**
 * Quota.jsx — per-VM quota manager (2026-06-06 rewrite).
 *
 * What changed vs the old single-knob page:
 *  - Per-VM rows with inline ± and Set-cap controls; bulk panel still available
 *    for "+24h to everyone" workflows.
 *  - Decrement and absolute-set modes (decrement is superadmin-only server-side).
 *  - Server validates new cap >= current usage; UX surfaces the failed VMs.
 *  - Right-rail history feed lists the last 25 mutations with admin email + ts.
 *
 * Props:
 *  - selectedTraining: string | null
 *  - superadminApiRoutes: { quotaApi: string }   ← still used for legacy fall-back
 *
 * Endpoints used:
 *  - GET    /admin/quota?trainingName=          → training summary
 *  - GET    /admin/quota/vms?trainingName=      → per-VM rows
 *  - GET    /admin/quota/history?trainingName=  → audit log
 *  - POST   /admin/quota body: { trainingName, vmName?, mode, deltaHours, reason }
 */

const MIN_PER_H = 60;
const fmtH = (h, dp = 1) => {
  const n = Number(h);
  if (!isFinite(n)) return "0";
  return n.toFixed(dp).replace(/\.0+$/, "");
};
const minToH = (m) => (Number(m) || 0) / 60;
const quotaPct = (consumedH, totalMin) => {
  if (!totalMin) return 0;
  const used = (consumedH || 0) * 60;
  return Math.max(0, Math.min(100, (used / totalMin) * 100));
};
const band = (p) => (p >= 85 ? "high" : p >= 60 ? "mid" : "low");
const bandColors = {
  low: { text: "text-green-600", fill: "bg-green-500" },
  mid: { text: "text-amber-600", fill: "bg-amber-500" },
  high: { text: "text-red-600", fill: "bg-red-500" },
};

const Toast = ({ t, onClose }) => {
  if (!t) return null;
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${t.type === "success" ? "bg-green-600" : t.type === "warn" ? "bg-amber-600" : "bg-red-600"}`}>
        {t.message}
        <button onClick={onClose} className="ml-1 opacity-70 hover:opacity-100">&times;</button>
      </div>
    </div>
  );
};

const Quota = ({ selectedTraining, superadminApiRoutes }) => {
  const [summary, setSummary] = useState(null);
  const [vms, setVms] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = "success") => setToast({ message, type, id: Date.now() }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // Bulk panel state
  const [bulkMode, setBulkMode] = useState("inc"); // inc | dec | set
  const [bulkHours, setBulkHours] = useState("");
  const [bulkReason, setBulkReason] = useState("");

  // Per-VM step setting — what +/- buttons add/subtract
  const [step, setStep] = useState(1); // 1, 5, 10, 24 hrs

  // Edit-cap inline state per VM
  const [editingCap, setEditingCap] = useState(null); // vm.name
  const [capDraft, setCapDraft] = useState("");

  const fetchAll = useCallback(async () => {
    if (!selectedTraining) { setSummary(null); setVms([]); setHistory([]); return; }
    setLoading(true);
    try {
      const [s, v, h] = await Promise.all([
        apiCaller.get(`/admin/quota?trainingName=${encodeURIComponent(selectedTraining)}`),
        apiCaller.get(`/admin/quota/vms?trainingName=${encodeURIComponent(selectedTraining)}`),
        apiCaller.get(`/admin/quota/history?trainingName=${encodeURIComponent(selectedTraining)}&limit=25`).catch(() => ({ data: { history: [] } })),
      ]);
      setSummary(s.data);
      setVms(v.data?.vms || []);
      setHistory(h.data?.history || []);
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to load quota data", "error");
    } finally {
      setLoading(false);
    }
  }, [selectedTraining, showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const applyAction = useCallback(async ({ vmName, mode, deltaHours, reason }) => {
    if (busy) return;
    setBusy(true);
    try {
      const body = { trainingName: selectedTraining, mode, deltaHours: Number(deltaHours) };
      if (vmName) body.vmName = vmName;
      if (reason) body.reason = reason;
      const res = await apiCaller.post("/admin/quota", body);
      showToast(res.data?.message || "Quota updated", "success");
      await fetchAll();
    } catch (e) {
      const msg = e?.response?.data?.message || "Action failed";
      const failures = e?.response?.data?.failures;
      if (failures?.length) {
        showToast(`${msg}: ${failures.slice(0, 3).map(f => f.vm).join(", ")}${failures.length > 3 ? ` +${failures.length - 3}` : ""}`, "warn");
      } else {
        showToast(msg, "error");
      }
    } finally {
      setBusy(false);
    }
  }, [selectedTraining, busy, fetchAll, showToast]);

  const stepFor = (vm, sign) => () => applyAction({ vmName: vm.name, mode: sign > 0 ? "inc" : "dec", deltaHours: step });
  const commitCap = async (vm) => {
    const v = parseFloat(capDraft);
    setEditingCap(null);
    if (!isFinite(v) || v < 0) { showToast("Invalid value", "error"); return; }
    await applyAction({ vmName: vm.name, mode: "set", deltaHours: v });
  };

  const bulkSubmit = async () => {
    const v = parseFloat(bulkHours);
    if (!isFinite(v) || v < 0) { showToast("Enter a valid hour value", "error"); return; }
    if (!window.confirm(`Apply ${bulkMode.toUpperCase()} ${v}h to ALL ${vms.length} VMs in ${selectedTraining}?`)) return;
    await applyAction({ mode: bulkMode, deltaHours: v, reason: bulkReason });
    setBulkHours("");
    setBulkReason("");
  };

  if (!selectedTraining) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p className="text-sm">Select a customer and lab module above to manage quota.</p>
      </div>
    );
  }

  /* ─────────── HEADER ─────────── */
  const summaryTotalH = summary ? minToH(summary.totalMin) : 0;
  const summaryConsumedH = summary?.consumedH || 0;
  const summaryPct = summary ? Math.min(100, (summaryConsumedH / Math.max(summaryTotalH, 1)) * 100) : 0;
  const summaryBand = band(summaryPct);

  return (
    <div className="p-6">
      <Toast t={toast} onClose={() => setToast(null)} />

      {/* Header summary strip */}
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Quota Management</h1>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Per-instance compute-hour allocation for <span className="font-semibold">{selectedTraining}</span>
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading || busy}
          className="text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* KPI strip — mirrors Lab Console aesthetic */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Instances</div>
          <div className="text-xl font-bold text-gray-900 tabular-nums">{summary?.vmCount ?? "—"}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Total Cap</div>
          <div className="text-xl font-bold text-gray-900 tabular-nums">{fmtH(summaryTotalH, 0)}<span className="text-xs text-gray-400 font-medium ml-1">h</span></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Consumed</div>
          <div className="text-xl font-bold text-gray-900 tabular-nums">{fmtH(summaryConsumedH, 1)}<span className="text-xs text-gray-400 font-medium ml-1">h</span></div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 font-semibold">Cohort utilization</div>
          <div className={`text-xl font-bold tabular-nums ${bandColors[summaryBand].text}`}>{fmtH(summaryPct, 0)}<span className="text-xs text-gray-400 font-medium">%</span></div>
          <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${bandColors[summaryBand].fill}`} style={{ width: `${summaryPct}%` }} />
          </div>
        </div>
      </div>

      {/* Two-column layout: per-VM table (left), history (right) */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px" }}>
        <div>
          {/* Bulk panel */}
          <div className="mb-3 bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Bulk apply to all instances</div>
              <div className="text-[10px] text-gray-400">Acts on all {vms.length} VMs in this training</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                {["inc", "dec", "set"].map(m => (
                  <button key={m} onClick={() => setBulkMode(m)}
                    className={`text-[11px] font-semibold px-3 py-1 rounded ${bulkMode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                    {m === "inc" ? "+ Add" : m === "dec" ? "− Subtract" : "= Set"}
                  </button>
                ))}
              </div>
              <input type="number" min="0" step="0.5" placeholder="hours"
                value={bulkHours} onChange={e => setBulkHours(e.target.value)}
                className="w-28 px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400" />
              <input type="text" placeholder="reason (optional, audit-logged)"
                value={bulkReason} onChange={e => setBulkReason(e.target.value)}
                className="flex-1 min-w-[160px] px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400" />
              <button onClick={bulkSubmit} disabled={busy || !bulkHours}
                className="text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                Apply
              </button>
            </div>
            <div className="mt-2 text-[10px] text-gray-500">
              {bulkMode === "dec" && "Subtract is superadmin-only and will be refused if the new cap is below current usage."}
              {bulkMode === "set" && "Sets every VM's cap to this exact value. Each VM's used-hours stay intact."}
              {bulkMode === "inc" && "Adds the same amount of hours to every VM in this training."}
            </div>
          </div>

          {/* Per-VM controls */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Per-instance quota</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">Step:</span>
                <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-md p-0.5">
                  {[1, 5, 10, 24].map(s => (
                    <button key={s} onClick={() => setStep(s)}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${step === s ? "bg-rose-50 text-rose-700" : "text-gray-500 hover:text-gray-700"}`}>
                      ±{s}h
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <table className="w-full text-[12px]">
              <thead className="bg-gray-50/60 border-b border-gray-200">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                  <th className="px-4 py-2.5">Instance</th>
                  <th className="px-3 py-2.5">Used</th>
                  <th className="px-3 py-2.5">Cap</th>
                  <th className="px-3 py-2.5">Utilization</th>
                  <th className="px-3 py-2.5 text-right">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {loading && !vms.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-[12px]">Loading…</td></tr>
                )}
                {!loading && !vms.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-[12px]">No active instances in this training.</td></tr>
                )}
                {vms.map(vm => {
                  const totalH = minToH(vm.quota?.total || 0);
                  const consumedH = vm.quota?.consumed || 0;
                  const pct = quotaPct(consumedH, vm.quota?.total);
                  const b = band(pct);
                  const isEditing = editingCap === vm.name;
                  return (
                    <tr key={vm.name} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${vm.isRunning ? "bg-green-500" : "bg-gray-300"}`} />
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate max-w-[200px]">{vm.name}</div>
                            {vm.email && <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{vm.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-gray-700">{fmtH(consumedH, 1)}h</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input type="number" min="0" step="0.5"
                              value={capDraft}
                              onChange={e => setCapDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") commitCap(vm); if (e.key === "Escape") setEditingCap(null); }}
                              autoFocus
                              className="w-20 text-[11px] border border-rose-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-rose-200" />
                            <button onClick={() => commitCap(vm)} className="text-green-600 text-[11px] font-semibold px-1">Set</button>
                            <button onClick={() => setEditingCap(null)} className="text-gray-400 text-[11px] px-1">✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setCapDraft(fmtH(totalH, 1)); setEditingCap(vm.name); }}
                            className="text-gray-900 font-semibold hover:text-rose-600 hover:underline underline-offset-2 cursor-pointer"
                            title="Click to set absolute value">
                            {fmtH(totalH, 0)}h
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${bandColors[b].fill}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-[11px] font-bold tabular-nums w-10 text-right ${bandColors[b].text}`}>{fmtH(pct, 0)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={stepFor(vm, -1)}
                            disabled={busy}
                            title={`Subtract ${step}h (superadmin)`}
                            className="w-7 h-7 inline-flex items-center justify-center text-gray-600 bg-white border border-gray-200 rounded hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed">−</button>
                          <button
                            onClick={stepFor(vm, +1)}
                            disabled={busy}
                            title={`Add ${step}h`}
                            className="w-7 h-7 inline-flex items-center justify-center text-gray-600 bg-white border border-gray-200 rounded hover:bg-green-50 hover:text-green-600 hover:border-green-200 disabled:opacity-40 disabled:cursor-not-allowed">+</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* HISTORY RAIL */}
        <div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Recent changes</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Last {history.length || 0} actions</div>
            </div>
            <div className="max-h-[640px] overflow-y-auto">
              {!history.length && (
                <div className="px-4 py-8 text-center text-gray-400 text-[12px]">No changes yet.</div>
              )}
              {history.map((h, i) => (
                <div key={i} className="px-4 py-3 border-b border-gray-50 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      h.mode === "inc" ? "bg-green-50 text-green-700" :
                      h.mode === "dec" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                    }`}>
                      {h.mode === "inc" ? `+${fmtH(h.deltaHours, 1)}h` : h.mode === "dec" ? `−${fmtH(h.deltaHours, 1)}h` : `=${fmtH(h.deltaHours, 1)}h`}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums">
                      {new Date(h.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-gray-700 font-medium truncate">
                    {h.scope === "bulk" ? `All ${h.affectedVms} VMs` : h.vmName || "—"}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-500 truncate">by {h.byEmail || "?"} · {h.byUserType || "?"}</div>
                  {h.reason && <div className="mt-1 text-[10px] text-gray-500 italic truncate" title={h.reason}>"{h.reason}"</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Quota;
