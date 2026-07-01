import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiCaller from '../services/apiCaller';
import { parseEmailFile } from '../utils/csvEmailParser';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, CheckCircle, RefreshCw, Users, Clock, Monitor, Mail, Zap,
  Shield, Upload, Server, MapPin, Network, HardDrive, Cloud,
  BookOpen, AlertTriangle, Undo2, RotateCcw, ChevronRight,
  Cpu, MemoryStick, Globe, ArrowRight, Sparkles,
} from 'lucide-react';

/* ─── OS icon URLs ─── */
const OS_ICONS = {
  ubuntu:  'https://cdn.simpleicons.org/ubuntu/E95420',
  windows: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  rocky:   'https://cdn.simpleicons.org/rockylinux/10B981',
  rhel:    'https://cdn.simpleicons.org/redhat/EE0000',
};

/* ─── Brand accent per OS (gradient tints for cards) ─── */
const OS_ACCENT = {
  ubuntu:  { from: '#FFF7ED', to: '#FED7AA', border: '#FB923C', text: '#C2410C', ring: 'rgba(251,146,60,.15)' },
  windows: { from: '#EFF6FF', to: '#BFDBFE', border: '#60A5FA', text: '#1D4ED8', ring: 'rgba(96,165,250,.15)' },
  rocky:   { from: '#ECFDF5', to: '#A7F3D0', border: '#34D399', text: '#047857', ring: 'rgba(52,211,153,.15)' },
  rhel:    { from: '#FEF2F2', to: '#FECACA', border: '#F87171', text: '#B91C1C', ring: 'rgba(248,113,113,.15)' },
};
const DEFAULT_ACCENT = { from: '#F8FAFC', to: '#E2E8F0', border: '#94A3B8', text: '#475569', ring: 'rgba(148,163,184,.15)' };

const FALLBACK_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="0.8" fill="#475569"/><circle cx="7" cy="17" r="0.8" fill="#475569"/></svg>'
);

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const VM_SIZES = [
  { value: 'Standard_D2ls_v5', label: 'D2ls v5 — 2 vCPU · 4 GB',  memory: 4,  rate: 15, cpu: 2 },
  { value: 'Standard_D2s_v3',  label: 'D2s v3 — 2 vCPU · 8 GB',   memory: 8,  rate: 25, cpu: 2 },
  { value: 'Standard_D2s_v5',  label: 'D2s v5 — 2 vCPU · 8 GB',   memory: 8,  rate: 25, cpu: 2 },
  { value: 'Standard_B2ms',    label: 'B2ms  — 2 vCPU · 8 GB',     memory: 8,  rate: 25, cpu: 2 },
  { value: 'Standard_D4s_v5',  label: 'D4s v5 — 4 vCPU · 16 GB',  memory: 16, rate: 35, cpu: 4 },
  { value: 'Standard_D8s_v5',  label: 'D8s v5 — 8 vCPU · 32 GB',  memory: 32, rate: 50, cpu: 8 },
];

const REGIONS = [
  { value: 'southeastasia', label: 'Southeast Asia' },
  { value: 'southindia',    label: 'South India' },
  { value: 'centralindia',  label: 'Central India' },
  { value: 'westus2',       label: 'West US 2' },
  { value: 'eastus',        label: 'East US' },
  { value: 'westeurope',    label: 'West Europe' },
];

const STORAGE_RATE_PER_30GB = 10; // ₹10/hr per 30 GB beyond default
const STORAGE_OPTIONS = [
  { value: 0,    label: 'Default' },
  { value: 64,   label: '64 GB' },
  { value: 128,  label: '128 GB' },
  { value: 256,  label: '256 GB' },
  { value: 512,  label: '512 GB' },
  { value: 1024, label: '1 TB' },
];

const STEPS = [
  { num: 1, label: 'Select OS',  desc: 'Choose image & infra' },
  { num: 2, label: 'Configure',  desc: 'Training & participants' },
  { num: 3, label: 'Deploy',     desc: 'Review & launch' },
];

/* ─── Reusable sub-components ─── */

const StepBar = ({ current }) => (
  <div className="flex items-center gap-1 mb-8">
    {STEPS.map((s, i) => {
      const done = s.num < current;
      const active = s.num === current;
      return (
        <React.Fragment key={s.num}>
          <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-all duration-300 ${
            active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
            : done  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-slate-50 text-slate-400 border border-slate-100'
          }`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              active ? 'bg-white/20' : done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'
            }`}>
              {done ? <CheckCircle className="w-3.5 h-3.5" /> : s.num}
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold leading-tight">{s.label}</div>
              <div className={`text-[10px] leading-tight ${active ? 'text-indigo-200' : done ? 'text-emerald-500' : 'text-slate-400'}`}>{s.desc}</div>
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div className="flex-1 flex items-center justify-center">
              <ChevronRight className={`w-4 h-4 ${done ? 'text-emerald-400' : 'text-slate-300'}`} />
            </div>
          )}
        </React.Fragment>
      );
    })}
  </div>
);

const EmailToken = ({ email, isValid, onRemove, index }) => (
  <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
    className={`flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-lg transition-all duration-150 ${
      isValid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
              : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
    }`}
  >
    <Mail className="w-3 h-3 flex-shrink-0 opacity-50" />
    <span className="max-w-[130px] truncate">{email}</span>
    <button onClick={() => onRemove(index)} className="opacity-40 hover:opacity-100 transition-opacity ml-0.5">
      <X className="w-3 h-3" />
    </button>
  </motion.div>
);

const ConfirmationModal = ({ payload, onCancel }) => (
  <AnimatePresence>
    {payload && (
      <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
          className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-white/20"><Zap className="w-5 h-5 text-white" /></div>
              <h4 className="text-base font-semibold text-white">Confirm Deployment</h4>
            </div>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-slate-600 leading-relaxed">{payload.message}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onCancel}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={() => payload.onConfirm?.()}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm">
                Deploy Now
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

/* ─── Main component ─── */
export default function CreateFreshVM({ userDetails = {}, apiRoutes = {} }) {
  const [images, setImages] = useState([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [vmSize, setVmSize] = useState('Standard_D2ls_v5');
  const [region, setRegion] = useState('southeastasia');
  const [resourceGroup, setResourceGroup] = useState('VirtualMachines');
  const [vnet, setVnet] = useState('rhel-vnet');
  const [diskSizeGB, setDiskSizeGB] = useState(0); // 0 = use OS default
  const [trainingName, setTrainingName] = useState('');
  const [emailTokens, setEmailTokens] = useState([]);
  const [allocatedHours, setAllocatedHours] = useState(1);
  const [guacamole, setGuacamole] = useState(false);
  const [autoShutdown, setAutoShutdown] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [labExpiry, setLabExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const emailInputRef = useRef(null);
  const emailContainerRef = useRef(null);
  const csvFileRef = useRef(null);
  const [csvUploadStatus, setCsvUploadStatus] = useState(null);

  /* deploy tracking */
  const DEPLOY_KEY = 'getlabs.freshVmDeploy';
  const MAX_AGE = 2 * 60 * 60 * 1000;
  const [deployProgress, setDeployProgress] = useState(() => {
    try {
      const raw = localStorage.getItem(DEPLOY_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p?.startedAt || Date.now() - p.startedAt > MAX_AGE) { localStorage.removeItem(DEPLOY_KEY); return null; }
      return p;
    } catch { return null; }
  });
  const deployPollRef = useRef(null);

  useEffect(() => {
    if (!deployProgress) { try { localStorage.removeItem(DEPLOY_KEY); } catch {} return; }
    try { localStorage.setItem(DEPLOY_KEY, JSON.stringify(deployProgress)); } catch {}
  }, [deployProgress]);
  useEffect(() => () => { if (deployPollRef.current) clearInterval(deployPollRef.current); }, []);

  const startDeployTracking = useCallback((name, count, startedAt = Date.now()) => {
    setDeployProgress({ trainingName: name, expectedCount: count, ready: 0, total: 0, startedAt, vms: [], finished: false });
    if (deployPollRef.current) clearInterval(deployPollRef.current);
    const tick = async () => {
      try {
        const res = await apiCaller.get('/azure/machines', { params: { trainingName: name } });
        const vms = (res.data || []).filter(v => v.isAlive);
        const ready = vms.filter(v => v.publicIp && v.adminPass).length;
        const finished = vms.length >= count && ready >= count;
        setDeployProgress(p => p && ({ ...p, ready, total: vms.length, vms, finished }));
        if (finished) { clearInterval(deployPollRef.current); deployPollRef.current = null; }
      } catch {}
    };
    tick();
    deployPollRef.current = setInterval(tick, 12000);
  }, []);

  useEffect(() => {
    if (deployProgress && !deployProgress.finished && !deployPollRef.current)
      startDeployTracking(deployProgress.trainingName, deployProgress.expectedCount, deployProgress.startedAt);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [, setUiTick] = useState(0);
  useEffect(() => {
    if (!deployProgress || deployProgress.finished) return;
    const id = setInterval(() => setUiTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [deployProgress?.startedAt, deployProgress?.finished]);

  const stopDeployTracking = useCallback(() => {
    if (deployPollRef.current) { clearInterval(deployPollRef.current); deployPollRef.current = null; }
    setDeployProgress(null);
  }, []);

  /* fetch images */
  const fetchImages = useCallback(async () => {
    try { setLoadingImages(true); setError('');
      const res = await apiCaller.get(apiRoutes.marketplaceImagesApi || '/azure/marketplace-images');
      setImages(res.data || []);
    } catch (err) { console.error(err); setError('Failed to load marketplace images.'); }
    finally { setLoadingImages(false); }
  }, [apiRoutes.marketplaceImagesApi]);
  useEffect(() => { fetchImages(); }, [fetchImages]);

  /* email helpers */
  const validateEmail = (e) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/.test(String(e).toLowerCase());
  const processEmailInput = (input) => {
    const list = input.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (list.length) setEmailTokens(prev => [...prev, ...list.map(email => ({ email, isValid: validateEmail(email) }))]);
  };
  const removeEmail = (idx) => setEmailTokens(s => s.filter((_, i) => i !== idx));
  const removeLastEmail = () => setEmailTokens(prev => prev.slice(0, -1));
  const resetAllEmails = () => { setEmailTokens([]); setCsvUploadStatus(null); if (emailInputRef.current) { emailInputRef.current.value = ''; emailInputRef.current.focus(); } };
  const handleCsvUpload = (file) => {
    if (!file) return;
    parseEmailFile(file, ({ valid, invalidCount }) => {
      const existing = new Set(emailTokens.map(t => t.email.toLowerCase()));
      const added = [];
      for (const em of valid) { const k = em.toLowerCase(); if (!existing.has(k)) { existing.add(k); added.push({ email: em, isValid: true }); } }
      if (added.length) setEmailTokens(prev => [...prev, ...added]);
      setCsvUploadStatus({ valid: added.length, invalid: invalidCount });
      if (csvFileRef.current) csvFileRef.current.value = '';
    });
  };
  const pushToast = (msg, variant = 'info') => setToast({ id: Date.now(), msg, variant });

  /* submit */
  const handleSubmitCreate = async () => {
    const validEmails = emailTokens.filter(t => t.isValid).map(t => t.email);
    if (!selectedImage) { pushToast('Select an OS first', 'error'); return; }
    if (!trainingName) { pushToast('Enter a training name', 'error'); return; }
    if (!validEmails.length) { pushToast('Add at least one valid email', 'error'); return; }
    const si = VM_SIZES.find(s => s.value === vmSize) || VM_SIZES[0];
    const payload = {
      marketplaceImageId: selectedImage.id, email: validEmails, trainingName,
      allocatedHours: (Number(allocatedHours) || 0) * 60, createVmCount: validEmails.length,
      guacamole, autoShutdown, idleMinutes: autoShutdown ? idleMinutes : 0,
      vmSize, resourceGroup, location: region, vnet,
      expiresAt: labExpiry && expiryDate ? new Date(expiryDate).toISOString() : null,
      rate: si.rate + storageSurcharge,
      diskSizeGB: diskSizeGB > 0 ? diskSizeGB : undefined,
    };
    setConfirm({
      message: `Deploy ${validEmails.length} × ${selectedImage.label} VM(s) (${effectiveDiskGB} GB disk) in ${REGIONS.find(r => r.value === region)?.label} for training "${trainingName}"?`,
      async onConfirm() {
        setConfirm(null);
        try { setSubmitting(true);
          const res = await apiCaller.post(apiRoutes.marketplaceVmApi || '/azure/marketplace-vm', payload);
          pushToast(res?.data?.message ?? 'VM creation started', 'success');
          startDeployTracking(trainingName, validEmails.length);
          setCurrentStep(1); setSelectedImage(null); setTrainingName(''); setEmailTokens([]);
        } catch (err) { console.error(err); pushToast(err?.response?.data?.message || 'Failed to create VMs', 'error'); }
        finally { setSubmitting(false); }
      },
    });
  };

  const validCount = emailTokens.filter(t => t.isValid).length;
  const sizeInfo = VM_SIZES.find(s => s.value === vmSize) || VM_SIZES[0];
  const isAdmin = userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin';

  // Storage pricing
  const defaultDisk = selectedImage?.defaultDiskGB || 30;
  const filteredStorage = STORAGE_OPTIONS.filter(o => o.value === 0 || o.value >= defaultDisk);
  const effectiveDiskGB = diskSizeGB || defaultDisk;
  const extraGB = Math.max(0, effectiveDiskGB - defaultDisk);
  const storageSurcharge = Math.ceil(extraGB / 30) * STORAGE_RATE_PER_30GB;

  /* ─── Render ─── */
  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ──── Header ──── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-200/50">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Fresh VM</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Deploy directly from Azure Marketplace
              {userDetails.organization ? <span className="text-gray-400"> · {userDetails.organization}</span> : ''}
            </p>
          </div>
        </div>
        <button onClick={() => { fetchImages(); pushToast('Refreshed', 'success'); }}
          className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-gray-600 bg-white/80 border border-gray-200 rounded-xl hover:bg-white hover:shadow-sm transition-all backdrop-blur-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* ──── Deploy progress ──── */}
      {deployProgress && (() => {
        const sec = Math.floor((Date.now() - deployProgress.startedAt) / 1000);
        const min = Math.floor(sec / 60), secR = sec % 60;
        const EST = 8;
        const pT = Math.min(95, Math.round(sec / 60 / EST * 100));
        const pA = deployProgress.expectedCount > 0 ? Math.round(deployProgress.ready / deployProgress.expectedCount * 100) : 0;
        const pct = deployProgress.finished ? 100 : Math.max(pA, pT);
        const done = deployProgress.finished;
        return (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border p-5 backdrop-blur-sm ${done ? 'bg-emerald-50/80 border-emerald-200' : 'bg-blue-50/80 border-blue-200'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                {done ? <CheckCircle className="w-5 h-5 text-emerald-600" />
                  : <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />}
                <span className={`font-semibold text-sm ${done ? 'text-emerald-900' : 'text-blue-900'}`}>
                  {done ? `All ${deployProgress.expectedCount} VMs ready` : `Provisioning ${deployProgress.expectedCount} VM${deployProgress.expectedCount > 1 ? 's' : ''}...`}
                  {' '}— "{deployProgress.trainingName}"
                </span>
              </div>
              <button onClick={stopDeployTracking} className={`text-xs font-medium hover:underline ${done ? 'text-emerald-700' : 'text-blue-700'}`}>
                {done ? 'Dismiss' : 'Hide'}
              </button>
            </div>
            <div className={`text-xs mb-2.5 tabular-nums ${done ? 'text-emerald-700' : 'text-blue-700'}`}>
              {deployProgress.ready}/{deployProgress.expectedCount} ready · {deployProgress.total} created · {min}m {secR}s
              {!done && ` · ~${Math.max(0, EST - min)}m left`}
            </div>
            <div className={`w-full rounded-full h-2 overflow-hidden ${done ? 'bg-emerald-100' : 'bg-blue-100'}`}>
              <motion.div className={`h-2 rounded-full ${done ? 'bg-emerald-500' : 'bg-blue-500'}`}
                initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
            </div>
            {deployProgress.vms?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {deployProgress.vms.map(vm => {
                  const r = vm.publicIp && vm.adminPass;
                  return <span key={vm._id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium ${r ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r ? '✓' : '⋯'} {vm.name}</span>;
                })}
              </div>
            )}
            <p className={`text-[11px] mt-2 ${done ? 'text-emerald-600' : 'text-blue-600'}`}>
              View credentials on Lab Console once VMs are ready.
            </p>
          </motion.div>
        );
      })()}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loadingImages && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-6 bg-white rounded-2xl border border-slate-200">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl bg-slate-100 h-36" />
          ))}
        </div>
      )}

      {/* ──── Main wizard ──── */}
      {!loadingImages && images.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Step bar header */}
          <div className="px-6 pt-6 pb-0 border-b border-slate-100 bg-slate-50/50">
            <StepBar current={currentStep} />
          </div>

          <div className="p-6">
            {/* ═══ STEP 1 ═══ */}
            {currentStep === 1 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <div className="mb-5">
                  <h2 className="text-lg font-bold text-slate-900">Choose your operating system</h2>
                  <p className="text-sm text-slate-500 mt-1">Select a base image from Azure Marketplace to deploy fresh VMs</p>
                </div>

                {/* OS Grid — brand-tinted cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {images.map(img => {
                    const iconUrl = OS_ICONS[img.icon] || FALLBACK_ICON;
                    const accent = OS_ACCENT[img.icon] || DEFAULT_ACCENT;
                    const sel = selectedImage?.id === img.id;
                    return (
                      <motion.div key={img.id}
                        whileHover={{ y: -3, boxShadow: `0 8px 25px ${accent.ring}` }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { setSelectedImage(img); setVmSize(img.defaultVmSize || 'Standard_D2ls_v5'); setDiskSizeGB(0); }}
                        className="cursor-pointer rounded-2xl border-2 transition-all duration-200 relative overflow-hidden"
                        style={{
                          borderColor: sel ? accent.border : '#e2e8f0',
                          background: sel
                            ? `linear-gradient(135deg, ${accent.from}, ${accent.to}40)`
                            : '#fff',
                        }}
                      >
                        {/* Selection badge */}
                        {sel && (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                            className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: accent.border }}>
                            <CheckCircle className="w-3.5 h-3.5 text-white" />
                          </motion.div>
                        )}

                        {/* Card body */}
                        <div className="p-4 pb-3.5">
                          <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                            style={{ backgroundColor: sel ? `${accent.border}15` : '#f8fafc' }}>
                            <img src={iconUrl} alt={img.label} className="w-8 h-8 object-contain"
                              onError={e => { if (e.target.src !== FALLBACK_ICON) e.target.src = FALLBACK_ICON; }} />
                          </div>
                          <h3 className="font-bold text-[13px] text-slate-800 leading-snug">{img.label}</h3>
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              img.os === 'Linux' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                            }`}>{img.os}</span>
                            {img.planRequired && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Plan</span>
                            )}
                          </div>
                        </div>

                        {/* Bottom accent stripe when selected */}
                        {sel && <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent.border}, ${accent.border}60)` }} />}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Infrastructure config */}
                <AnimatePresence>
                  {selectedImage && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden">
                      <div className="mt-6 p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                            <Server className="w-3.5 h-3.5 text-indigo-600" />
                          </div>
                          <h3 className="text-sm font-bold text-slate-700">Infrastructure</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* VM Size — special card */}
                          <div className="sm:col-span-2 p-4 rounded-xl bg-white border border-slate-200">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              <Cpu className="w-3.5 h-3.5" /> VM Size & Pricing
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {VM_SIZES.map(s => {
                                const active = vmSize === s.value;
                                return (
                                  <button key={s.value} onClick={() => setVmSize(s.value)}
                                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                                      active
                                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                                        : 'border-slate-150 hover:border-slate-300 bg-white'
                                    }`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`text-xs font-bold ${active ? 'text-indigo-700' : 'text-slate-700'}`}>
                                        {s.cpu} vCPU · {s.memory} GB
                                      </span>
                                      {active && <CheckCircle className="w-3.5 h-3.5 text-indigo-500" />}
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-slate-400">{s.value.replace('Standard_', '')}</span>
                                      <span className={`text-xs font-bold ${active ? 'text-indigo-600' : 'text-slate-500'}`}>
                                        {INR.format(s.rate)}/hr
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* OS Disk Storage — card selector */}
                          <div className="sm:col-span-2 p-4 rounded-xl bg-white border border-slate-200">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                              <HardDrive className="w-3.5 h-3.5" /> OS Disk Storage
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {filteredStorage.map(opt => {
                                const active = diskSizeGB === opt.value;
                                const optEffective = opt.value || defaultDisk;
                                const optExtra = Math.max(0, optEffective - defaultDisk);
                                const optCost = Math.ceil(optExtra / 30) * STORAGE_RATE_PER_30GB;
                                return (
                                  <button key={opt.value} onClick={() => setDiskSizeGB(opt.value)}
                                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                                      active
                                        ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                                        : 'border-slate-150 hover:border-slate-300 bg-white'
                                    }`}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`text-xs font-bold ${active ? 'text-indigo-700' : 'text-slate-700'}`}>
                                        {opt.value === 0 ? `${defaultDisk} GB` : opt.label}
                                      </span>
                                      {active && <CheckCircle className="w-3.5 h-3.5 text-indigo-500" />}
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-slate-400">
                                        {opt.value === 0 ? 'Default' : `+${optExtra} GB`}
                                      </span>
                                      <span className={`text-xs font-bold ${active ? 'text-indigo-600' : 'text-slate-500'}`}>
                                        {optCost === 0 ? 'Included' : `+${INR.format(optCost)}/hr`}
                                      </span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                              <Globe className="w-3.5 h-3.5" /> Region
                            </label>
                            <select value={region} onChange={e => setRegion(e.target.value)}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none">
                              {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                              <Server className="w-3.5 h-3.5" /> Resource Group
                            </label>
                            <input value={resourceGroup} onChange={e => setResourceGroup(e.target.value)}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none" />
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                              <Network className="w-3.5 h-3.5" /> Virtual Network
                            </label>
                            <input value={vnet} onChange={e => setVnet(e.target.value)}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none" />
                          </div>

                          {/* Quick summary chip */}
                          <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                            <Zap className="w-4 h-4 text-indigo-500" />
                            <span className="text-xs text-indigo-700 font-medium">
                              {selectedImage.label} · {sizeInfo.cpu} vCPU · {sizeInfo.memory} GB RAM · {effectiveDiskGB} GB disk · {REGIONS.find(r => r.value === region)?.label} · Spot VM
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Next button */}
                <div className="flex justify-end mt-6">
                  <button onClick={() => { if (!selectedImage) { pushToast('Select an OS first', 'error'); return; } setCurrentStep(2); }}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      selectedImage
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 hover:shadow-lg'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}>
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══ STEP 2 ═══ */}
            {currentStep === 2 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
                {/* Selection summary pill */}
                {selectedImage && (() => {
                  const accent = OS_ACCENT[selectedImage.icon] || DEFAULT_ACCENT;
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-xl border"
                      style={{ backgroundColor: `${accent.from}80`, borderColor: `${accent.border}40` }}>
                      <img src={OS_ICONS[selectedImage.icon] || FALLBACK_ICON} alt="" className="w-7 h-7 object-contain"
                        onError={e => { if (e.target.src !== FALLBACK_ICON) e.target.src = FALLBACK_ICON; }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-slate-800">{selectedImage.label}</span>
                        <span className="text-xs text-slate-500 ml-2">{sizeInfo.cpu} vCPU · {sizeInfo.memory} GB · {effectiveDiskGB} GB disk · {REGIONS.find(r => r.value === region)?.label}</span>
                      </div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-lg" style={{ backgroundColor: `${accent.border}15`, color: accent.text }}>
                        {INR.format(sizeInfo.rate + storageSurcharge)}/hr
                      </span>
                      <button onClick={() => setCurrentStep(1)} className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold ml-1">Change</button>
                    </div>
                  );
                })()}

                {/* Training name */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                    <BookOpen className="w-4 h-4 text-slate-400" /> Training Name
                  </label>
                  <input value={trainingName} onChange={e => setTrainingName(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                    placeholder="e.g. linux-workshop-june"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none bg-white" />
                  <p className="text-xs text-slate-400 mt-1.5">Alphanumeric and hyphens only — used as VM name prefix</p>
                </div>

                {/* Emails */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <Users className="w-4 h-4 text-slate-400" /> Participant Emails
                    </label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => csvFileRef.current?.click()}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 font-medium transition-colors">
                        <Upload className="w-3 h-3" /> CSV
                      </button>
                      <input ref={csvFileRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={e => handleCsvUpload(e.target.files[0])} />
                      {emailTokens.length > 0 && (
                        <>
                          <button onClick={removeLastEmail}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-amber-600 hover:bg-amber-50 font-medium transition-colors">
                            <Undo2 className="w-3 h-3" /> Undo
                          </button>
                          <button onClick={resetAllEmails}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-50 font-medium transition-colors">
                            <RotateCcw className="w-3 h-3" /> Clear
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="max-h-[192px] overflow-auto [&::-webkit-scrollbar]:w-0">
                    <div ref={emailContainerRef}
                      className="min-h-[72px] border border-slate-200 p-3 rounded-xl bg-white focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-400 transition-all">
                      <div className="flex flex-wrap gap-1.5">
                        {emailTokens.map((t, i) => <EmailToken key={i} email={t.email} isValid={t.isValid} onRemove={removeEmail} index={i} />)}
                        <input ref={emailInputRef}
                          placeholder={emailTokens.length === 0 ? "Type email(s) — press Enter, comma, or semicolon to add" : "Add more..."}
                          className="flex-grow min-w-[180px] bg-transparent outline-none text-sm px-2 py-1 placeholder-slate-400"
                          onKeyDown={e => {
                            if (['Enter', ',', ';'].includes(e.key)) {
                              e.preventDefault(); processEmailInput(e.target.value); e.target.value = '';
                              setTimeout(() => { if (emailContainerRef.current) emailContainerRef.current.scrollTop = emailContainerRef.current.scrollHeight; }, 0);
                            }
                            if (e.key === 'Backspace' && !e.target.value && emailTokens.length) removeLastEmail();
                          }}
                          onBlur={e => { if (e.target.value.trim()) { processEmailInput(e.target.value); e.target.value = ''; } }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-slate-400">
                      {validCount} valid{csvUploadStatus?.valid > 0 ? ` · ${csvUploadStatus.valid} from CSV` : ''}
                      {csvUploadStatus?.invalid > 0 ? ` · ${csvUploadStatus.invalid} invalid` : ''}
                    </span>
                    <span className="text-xs text-slate-400">1 VM per email</span>
                  </div>
                </div>

                {/* Duration + toggles in 2-column grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Duration */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                      <Clock className="w-4 h-4 text-slate-400" /> Duration
                    </label>
                    <div className="flex items-center gap-3">
                      <input type="number" min="1" max="720" value={allocatedHours} onChange={e => setAllocatedHours(e.target.value)}
                        className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none bg-white" />
                      <span className="text-sm text-slate-500 whitespace-nowrap">hours/VM</span>
                    </div>
                  </div>

                  {/* Guacamole */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                      <Monitor className="w-4 h-4 text-slate-400" /> Access
                    </label>
                    <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      guacamole ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 bg-white hover:bg-slate-50/50'
                    }`}>
                      <input type="checkbox" checked={guacamole} onChange={e => setGuacamole(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded mt-0.5 focus:ring-indigo-200" />
                      <div>
                        <div className="text-sm font-medium text-slate-700">Browser Access (Guacamole)</div>
                        <div className="text-xs text-slate-500">Web-based RDP/SSH</div>
                        {isAdmin && <div className="text-xs text-indigo-600 font-semibold mt-0.5">+{INR.format(5)}/hr/VM</div>}
                      </div>
                    </label>
                  </div>

                  {/* Auto-shutdown */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                      <Zap className="w-4 h-4 text-slate-400" /> Auto-Shutdown
                    </label>
                    <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      autoShutdown ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 bg-white hover:bg-slate-50/50'
                    }`}>
                      <input type="checkbox" checked={autoShutdown} onChange={e => setAutoShutdown(e.target.checked)}
                        className="w-4 h-4 text-emerald-600 rounded mt-0.5 focus:ring-emerald-200" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-700">Stop idle VMs</div>
                        <div className="text-xs text-slate-500">Deallocate when CPU &lt; 5%</div>
                        {autoShutdown && (
                          <select value={idleMinutes} onChange={e => setIdleMinutes(Number(e.target.value))}
                            className="mt-2 text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100">
                            <option value={30}>30 min</option><option value={60}>1 hour</option><option value={120}>2 hours</option>
                          </select>
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Lab expiry */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                      <Clock className="w-4 h-4 text-slate-400" /> Lab Expiry
                    </label>
                    <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                      labExpiry ? 'border-amber-400 bg-amber-50/50' : 'border-slate-200 bg-white hover:bg-slate-50/50'
                    }`}>
                      <input type="checkbox" checked={labExpiry} onChange={e => setLabExpiry(e.target.checked)}
                        className="w-4 h-4 text-amber-600 rounded mt-0.5 focus:ring-amber-200" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-700">Auto-delete all VMs</div>
                        <div className="text-xs text-slate-500">Resources removed at set time</div>
                        {labExpiry && (
                          <div className="mt-2">
                            <input type="datetime-local" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                              min={new Date().toISOString().slice(0, 16)}
                              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-100" />
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between pt-2">
                  <button onClick={() => setCurrentStep(1)}
                    className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors">Back</button>
                  <button onClick={() => {
                    if (!trainingName) { pushToast('Enter a training name', 'error'); return; }
                    if (!validCount) { pushToast('Add at least one valid email', 'error'); return; }
                    setCurrentStep(3);
                  }} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    trainingName && validCount
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}>
                    Review <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══ STEP 3 ═══ */}
            {currentStep === 3 && selectedImage && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-6">
                {/* Hero */}
                <div className="text-center py-3">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
                    <Zap className="w-8 h-8 text-white" />
                  </motion.div>
                  <h2 className="text-xl font-bold text-slate-900">Ready to Deploy</h2>
                  <p className="text-sm text-slate-500 mt-1.5">
                    <span className="font-semibold text-slate-700">{validCount}</span> × {selectedImage.label} in {REGIONS.find(r => r.value === region)?.label}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Summary */}
                  <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                      <h5 className="text-sm font-bold text-slate-700">Deployment Summary</h5>
                    </div>
                    <div className="p-5 space-y-3">
                      {[
                        { icon: Monitor, label: 'OS', val: selectedImage.label, color: 'text-blue-500' },
                        { icon: Cpu, label: 'VM Size', val: `${sizeInfo.cpu} vCPU · ${sizeInfo.memory} GB`, color: 'text-purple-500' },
                        { icon: HardDrive, label: 'Disk', val: `${effectiveDiskGB} GB${storageSurcharge > 0 ? ` (+${INR.format(storageSurcharge)}/hr)` : ' (default)'}`, color: 'text-orange-500' },
                        { icon: Globe, label: 'Region', val: REGIONS.find(r => r.value === region)?.label, color: 'text-emerald-500' },
                        { icon: Network, label: 'Network', val: `${resourceGroup} / ${vnet}`, color: 'text-amber-500' },
                        { icon: BookOpen, label: 'Training', val: trainingName, color: 'text-indigo-500' },
                        { icon: Users, label: 'Participants', val: `${validCount} VM${validCount > 1 ? 's' : ''}`, color: 'text-pink-500' },
                        { icon: Clock, label: 'Duration', val: `${allocatedHours}h per VM`, color: 'text-sky-500' },
                        { icon: Shield, label: 'Access', val: guacamole ? 'Guacamole' : 'Direct SSH/RDP', color: 'text-violet-500' },
                        ...(autoShutdown ? [{ icon: Zap, label: 'Auto-Stop', val: `${idleMinutes} min idle`, color: 'text-emerald-500' }] : []),
                        ...(labExpiry && expiryDate ? [{
                          icon: AlertTriangle, label: 'Expiry',
                          val: new Date(expiryDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
                          color: 'text-amber-500'
                        }] : []),
                      ].map(({ icon: Icon, label, val, color }, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                          <span className="text-sm text-slate-500 w-24 flex-shrink-0">{label}</span>
                          <span className="text-sm font-medium text-slate-800 truncate">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Cost */}
                  {isAdmin && (() => {
                    const base = sizeInfo.rate;
                    const guac = guacamole ? 5 : 0;
                    const perVm = base + storageSurcharge + guac;
                    const hrs = Number(allocatedHours) || 1;
                    const total = perVm * validCount * hrs;
                    return (
                      <div className="rounded-2xl overflow-hidden border border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50">
                        <div className="px-5 py-3 bg-indigo-100/50 border-b border-indigo-200">
                          <h5 className="text-sm font-bold text-indigo-800">Cost Estimate</h5>
                        </div>
                        <div className="p-5 space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">VM ({sizeInfo.memory} GB RAM)</span>
                            <span className="font-semibold">{INR.format(base)}/hr</span>
                          </div>
                          {storageSurcharge > 0 && <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Storage (+{extraGB} GB)</span>
                            <span className="font-semibold">+{INR.format(storageSurcharge)}/hr</span>
                          </div>}
                          {guacamole && <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Guacamole</span>
                            <span className="font-semibold">+{INR.format(5)}/hr</span>
                          </div>}
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">VMs</span>
                            <span className="font-semibold">× {validCount}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">Duration</span>
                            <span className="font-semibold">× {hrs}h</span>
                          </div>
                          <div className="border-t border-indigo-200 pt-4 mt-4">
                            <div className="flex justify-between items-end">
                              <span className="text-sm font-bold text-slate-700">Total</span>
                              <div className="text-right">
                                <div className="text-2xl font-extrabold text-indigo-600">{INR.format(total)}</div>
                                <div className="text-[11px] text-indigo-400 font-medium">{INR.format(perVm)}/hr × {validCount} × {hrs}h</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {!isAdmin && (
                    <div className="rounded-2xl border border-slate-200 p-8 flex items-center justify-center bg-slate-50">
                      <div className="text-center">
                        <Shield className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">Azure Spot instances</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <button onClick={() => setCurrentStep(2)}
                    className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors">Back</button>
                  <div className="flex items-center gap-3">
                    <button onClick={() => { setCurrentStep(1); setSelectedImage(null); }}
                      className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-500 text-sm font-medium hover:bg-slate-50 transition-colors">Start Over</button>
                    <button onClick={handleSubmitCreate} disabled={submitting}
                      className={`flex items-center gap-2 px-7 py-2.5 rounded-xl text-sm font-bold text-white transition-all ${
                        submitting
                          ? 'bg-indigo-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg shadow-indigo-200 hover:shadow-xl'
                      }`}>
                      {submitting
                        ? <><RefreshCw className="w-4 h-4 animate-spin" /> Deploying...</>
                        : <><Zap className="w-4 h-4" /> Deploy {validCount} VM{validCount > 1 ? 's' : ''}</>
                      }
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loadingImages && images.length === 0 && !error && (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <HardDrive className="w-12 h-12 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No marketplace images available</p>
          <p className="text-xs text-slate-400 mt-1">Check backend configuration</p>
        </div>
      )}

      {/* Toast */}
      <div className="fixed right-6 top-6 z-50">
        <AnimatePresence>
          {toast && (
            <motion.div key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.95 }}
              onAnimationComplete={() => setTimeout(() => setToast(null), 3000)}
              className={`rounded-xl px-4 py-3 shadow-xl text-sm font-medium flex items-center gap-2 backdrop-blur-sm ${
                toast.variant === 'success' ? 'bg-emerald-600 text-white'
                : toast.variant === 'error' ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-white'
              }`}
            >
              {toast.variant === 'success' && <CheckCircle className="w-4 h-4" />}
              {toast.variant === 'error' && <AlertTriangle className="w-4 h-4" />}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConfirmationModal payload={confirm} onCancel={() => setConfirm(null)} />
    </div>
  );
}
