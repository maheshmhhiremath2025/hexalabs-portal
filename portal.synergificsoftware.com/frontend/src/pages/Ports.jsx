import React, { useState, useEffect, useRef } from 'react';
import apiCaller from '../services/apiCaller';
import ConfirmDialog from '../components/modal/ConfirmDialog';

// Mirrors the backend parser so invalid input is caught before we hit the API.
// Accepts "80", "4000-5000", or comma-separated like "80, 443, 4000-5000".
function parsePortInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) throw new Error('Enter at least one port.');

    const out = [];
    for (const chunk of text.split(',')) {
        const piece = chunk.trim();
        if (!piece) continue;

        if (piece.includes('-')) {
            const [aStr, bStr, ...rest] = piece.split('-');
            if (rest.length) throw new Error(`Invalid port range: ${piece}`);
            const a = Number(aStr);
            const b = Number(bStr);
            if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid port range: ${piece}`);
            if (a < 1 || b > 65535 || a >= b) throw new Error(`Range must be 1–65535, start < end: ${piece}`);
            out.push(`${a}-${b}`);
        } else {
            const n = Number(piece);
            if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Invalid port: ${piece}`);
            out.push(String(n));
        }
    }
    if (!out.length) throw new Error('Enter at least one port.');
    return out;
}

const isRange = (p) => String(p).includes('-');

export default function Ports({ selectedTraining, apiRoutes }) {
    const [existingPorts, setExistingPorts] = useState([]); // [{port, direction}]
    const [showModal, setShowModal] = useState(false);
    const [newPort, setNewPort] = useState('');
    const [portDirection, setPortDirection] = useState('inbound');
    const [inputError, setInputError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [confirmState, setConfirmState] = useState({ open: false, port: null });

    const openModal = () => {
        setNewPort('');
        setPortDirection('inbound');
        setInputError('');
        setShowModal(true);
    };
    const closeModal = () => {
        if (submitting) return;
        setShowModal(false);
    };

    const refresh = () => {
        if (!selectedTraining) return;
        setIsLoading(true);
        apiCaller
            .get(`${apiRoutes.portsApi}?trainingName=${encodeURIComponent(selectedTraining)}`)
            .then((res) => {
                // Backend can't remember which direction existing rules use, so we
                // display them as inbound by default. Close-by-port still strips
                // every matching rule on the VM regardless of direction.
                const ports = (res.data?.ports || []).map((p) => ({ port: String(p), direction: 'inbound' }));
                setExistingPorts(ports);
            })
            .catch(() => setExistingPorts([]))
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        if (selectedTraining) refresh();
        else setExistingPorts([]);
    }, [selectedTraining]);

    const submitOpen = async () => {
        let ports;
        try {
            ports = parsePortInput(newPort);
        } catch (e) {
            setInputError(e.message);
            return;
        }
        setInputError('');
        setSubmitting(true);
        try {
            const res = await apiCaller.post(apiRoutes.portsApi, {
                trainingName: selectedTraining,
                port: ports.join(','),
                direction: portDirection,
            });
            toast(res.data?.message || `Opened ${ports.length} rule(s).`);
            setShowModal(false);
            refresh();
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Failed to open port';
            setInputError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const confirmClose = (port) => setConfirmState({ open: true, port });
    const cancelClose = () => setConfirmState({ open: false, port: null });

    const doClose = async () => {
        const port = confirmState.port;
        if (!port) return;
        setSubmitting(true);
        try {
            const res = await apiCaller.delete(apiRoutes.portsApi, {
                data: { trainingName: selectedTraining, port: port.port, direction: port.direction },
            });
            toast(res.data?.message || `Closed port ${port.port}.`);
            setExistingPorts((prev) => prev.filter((p) => p.port !== port.port));
        } catch (err) {
            toast(err.response?.data?.error || err.message || 'Failed to close port', true);
        } finally {
            setSubmitting(false);
            cancelClose();
        }
    };

    const directionBadge = (direction) => {
        const styles = {
            inbound: 'bg-blue-50 text-blue-700 ring-blue-200',
            outbound: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
            both: 'bg-violet-50 text-violet-700 ring-violet-200',
        };
        const label = direction === 'both' ? 'Both' : direction === 'outbound' ? 'Outbound' : 'Inbound';
        return { cls: styles[direction] || styles.inbound, label };
    };

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Networking</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Manage firewall port rules for your training VMs</p>
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                    onClick={openModal}
                    disabled={!selectedTraining || isLoading}
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Open Port
                </button>
            </div>

            {!selectedTraining && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-50 to-blue-50 border border-gray-200 flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700">Select a training</p>
                    <p className="text-xs text-gray-400 mt-1">Choose a training from the dropdown to manage its firewall rules.</p>
                </div>
            )}

            {selectedTraining && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-gray-900">Open ports</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{selectedTraining} · {existingPorts.length} rule{existingPorts.length !== 1 ? 's' : ''}</div>
                        </div>
                        <button onClick={refresh} disabled={isLoading}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors" title="Refresh">
                            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex justify-center items-center py-16">
                            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                        </div>
                    ) : existingPorts.length > 0 ? (
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                                    <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Port</th>
                                    <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Direction</th>
                                    <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                    <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {existingPorts.map((p, idx) => {
                                    const badge = directionBadge(p.direction);
                                    return (
                                        <tr key={`${p.port}-${idx}`} className="hover:bg-gray-50/50">
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base font-mono font-semibold text-gray-900">{p.port}</span>
                                                    <span className="text-[11px] text-gray-400">TCP</span>
                                                    {isRange(p.port) && (
                                                        <span className="text-[10px] uppercase tracking-wide bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-1.5 py-0.5 rounded-md">Range</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ${badge.cls}`}>
                                                    {badge.label}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                                    <span className="text-xs text-green-700 font-medium">Active</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                <button
                                                    onClick={() => confirmClose(p)}
                                                    className="text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 px-2.5 py-1 rounded-md transition-colors"
                                                >
                                                    Close
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <div className="text-center py-14">
                            <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-3">
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            </div>
                            <p className="text-sm font-medium text-gray-700">No open ports</p>
                            <p className="text-xs text-gray-400 mt-1">Click "Open Port" to add a firewall rule.</p>
                        </div>
                    )}
                </div>
            )}

            {showModal && (
                <div className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/50 backdrop-blur-sm" onClick={closeModal}>
                    <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-gray-200" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-base font-semibold text-gray-900">Open port</h3>
                                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Port, range, or list
                                    </label>
                                    <input
                                        type="text"
                                        autoFocus
                                        placeholder="80, 443, 3000, 4000-5000"
                                        value={newPort}
                                        onChange={(e) => { setNewPort(e.target.value); if (inputError) setInputError(''); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) submitOpen(); }}
                                        className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all text-base font-mono ${inputError ? 'border-rose-300 focus:ring-rose-400' : 'border-gray-300 focus:ring-blue-500'}`}
                                    />
                                    {inputError ? (
                                        <p className="text-xs text-rose-600 mt-2">{inputError}</p>
                                    ) : (
                                        <p className="text-xs text-gray-500 mt-2">
                                            Single port <span className="font-mono">80</span>, a range <span className="font-mono">4000-5000</span>, or a list <span className="font-mono">80, 443, 3000-3005</span>.
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { value: 'inbound', label: 'Inbound', desc: 'To VM' },
                                            { value: 'outbound', label: 'Outbound', desc: 'From VM' },
                                            { value: 'both', label: 'Both', desc: 'In & Out' },
                                        ].map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => setPortDirection(option.value)}
                                                className={`p-2.5 border rounded-xl text-center transition-all ${
                                                    portDirection === option.value
                                                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                                                        : 'border-gray-200 hover:border-gray-400'
                                                }`}
                                            >
                                                <div className="text-sm font-medium text-gray-900">{option.label}</div>
                                                <div className="text-[11px] text-gray-500 mt-0.5">{option.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 mt-6 pt-5 border-t border-gray-200">
                                <button onClick={closeModal} disabled={submitting}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50">
                                    Cancel
                                </button>
                                <button onClick={submitOpen} disabled={!newPort.trim() || submitting}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                                    {submitting ? 'Opening…' : 'Open Port'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={confirmState.open}
                title="Close port rule"
                message={confirmState.port ? (
                    <>Close rule for port <span className="font-mono font-semibold">{confirmState.port.port}</span> on training <span className="font-semibold">{selectedTraining}</span>? Azure may take a few minutes to apply the change.</>
                ) : ''}
                confirmLabel={submitting ? 'Closing…' : 'Close port'}
                loading={submitting}
                onConfirm={doClose}
                onClose={cancelClose}
            />

            <Toaster />
        </div>
    );
}

// ── Minimal toast (same pattern used elsewhere in the app) ────────────────
const listeners = new Set();
const toast = (message, isError = false) => { listeners.forEach((fn) => fn({ message, isError })); };
function Toaster() {
    const [t, setT] = useState(null);
    const timer = useRef(null);
    useEffect(() => {
        const sub = (payload) => {
            setT(payload);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setT(null), 2800);
        };
        listeners.add(sub);
        return () => listeners.delete(sub);
    }, []);
    if (!t) return null;
    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
            <div className={`px-4 py-2.5 rounded-xl shadow-lg text-sm ${t.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
                {t.message}
            </div>
        </div>
    );
}
