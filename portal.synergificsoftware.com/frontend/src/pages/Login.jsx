// Corporate enterprise login — animated dark left panel + clean white right.
// Split two-panel layout. Core login flow unchanged.

import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import DemoRequestModal from '../components/DemoRequestModal';
import {
  FaEnvelope, FaLock, FaArrowRight, FaShieldAlt,
  FaBolt, FaGlobe, FaMicrochip, FaUserLock,
  FaEye, FaEyeSlash, FaCertificate, FaCheckCircle,
  FaAws, FaMicrosoft, FaGoogle, FaRedhat, FaCloud, FaDocker,
} from 'react-icons/fa';

const SUPPORTED_CLOUDS = [
  { icon: FaAws,       label: 'AWS',            color: '#FF9900' },
  { icon: FaMicrosoft, label: 'Azure',          color: '#00BCF2' },
  { icon: FaGoogle,    label: 'Google Cloud',   color: '#4285F4' },
  { icon: FaCloud,     label: 'Oracle Cloud',   color: '#F80000' },
  { icon: FaRedhat,    label: 'OpenShift',      color: '#EE0000' },
  { icon: FaDocker,    label: 'Containers',     color: '#2496ED' },
];

const FEATURES = [
  { icon: FaBolt,      title: 'Instant Provisioning', desc: 'Workspaces in seconds, VMs in minutes. No tickets, no waiting.' },
  { icon: FaGlobe,     title: 'Multi-Cloud',          desc: 'AWS, Azure, GCP, OCI, and Red Hat OpenShift from one interface.' },
  { icon: FaMicrochip, title: 'Cost Guardrails',      desc: 'Quotas, idle auto-shutdown, expiry cleanup, budget caps — built in.' },
  { icon: FaUserLock,  title: 'Enterprise Security',  desc: 'ISO 9001 & 10004 certified, SSL everywhere, hardened IAM per sandbox.' },
];

const STATS = [
  { label: 'Clouds', value: '5' },
  { label: 'Lab Images', value: '103+' },
  { label: 'Deploy Time', value: '< 3s' },
  { label: 'White Label', value: 'Ready' },
];

// Chrome autofill override for the white-background form
const AUTOFILL_OVERRIDE_CSS = `
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px #f9fafb inset !important;
    -webkit-text-fill-color: #111827 !important;
    caret-color: #111827 !important;
    transition: background-color 5000s ease-in-out 0s;
  }
`;

const AUTOFILL_OVERRIDE_CSS_WL = `
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px rgba(255,255,255,0.03) inset !important;
    -webkit-text-fill-color: #fff !important;
    caret-color: #fff !important;
    transition: background-color 5000s ease-in-out 0s;
  }
`;

// ─── Left panel animated background CSS ──────────────────────────────────
const LEFT_PANEL_CSS = `
  @keyframes aurora {
    0%   { background-position: 0% 50%; }
    25%  { background-position: 100% 30%; }
    50%  { background-position: 60% 100%; }
    75%  { background-position: 20% 0%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes float1 {
    0%, 100% { transform: translate(0, 0) scale(1);    opacity: 0.5; }
    33%       { transform: translate(55px, -35px) scale(1.18); opacity: 0.7; }
    66%       { transform: translate(-25px, 28px) scale(0.88); opacity: 0.4; }
  }
  @keyframes float2 {
    0%, 100% { transform: translate(0, 0) scale(1);    opacity: 0.4; }
    33%       { transform: translate(-45px, 45px) scale(1.12); opacity: 0.6; }
    66%       { transform: translate(38px, -22px) scale(0.82); opacity: 0.3; }
  }
  @keyframes float3 {
    0%, 100% { transform: translate(-50%,-50%) scale(1);    opacity: 0.3; }
    50%       { transform: translate(-50%,-50%) scale(1.25); opacity: 0.5; }
  }
  @keyframes shimmer {
    0%   { transform: translateX(-120%) skewX(-15deg); }
    100% { transform: translateX(220%)  skewX(-15deg); }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 18px rgba(20,184,166,0.12); }
    50%       { box-shadow: 0 0 36px rgba(20,184,166,0.28), 0 0 56px rgba(251,146,60,0.08); }
  }

  /* ── Background: deep charcoal → rich teal-emerald → warm midnight ── */
  .lp-aurora-bg {
    background: linear-gradient(-45deg,
      #0b1a17,
      #0d2b22,
      #112418,
      #0a1f1c,
      #13241a,
      #0c1e18
    );
    background-size: 400% 400%;
    animation: aurora 22s ease infinite;
  }

  /* Orb 1 — warm amber/orange glow, top-left */
  .lp-orb-1 {
    position: absolute;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(251,146,60,0.28) 0%, rgba(245,101,32,0.12) 50%, transparent 70%);
    filter: blur(65px);
    top: -8%; left: -12%;
    animation: float1 19s ease-in-out infinite;
    pointer-events: none;
  }

  /* Orb 2 — teal/cyan glow, bottom-right */
  .lp-orb-2 {
    position: absolute;
    width: 240px; height: 240px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(20,184,166,0.32) 0%, rgba(6,182,212,0.12) 50%, transparent 70%);
    filter: blur(55px);
    bottom: 8%; right: -10%;
    animation: float2 24s ease-in-out infinite;
    pointer-events: none;
  }

  /* Orb 3 — emerald pulse, centre */
  .lp-orb-3 {
    position: absolute;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(52,211,153,0.2) 0%, transparent 70%);
    filter: blur(48px);
    top: 42%; left: 50%;
    animation: float3 16s ease-in-out infinite;
    pointer-events: none;
  }

  /* Dot-grid overlay */
  .lp-grid {
    position: absolute; inset: 0;
    background-image: radial-gradient(circle, rgba(134,239,172,0.07) 1px, transparent 1px);
    background-size: 30px 30px;
    pointer-events: none;
    mask-image: radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 100%);
    -webkit-mask-image: radial-gradient(ellipse 75% 65% at 50% 45%, black 25%, transparent 100%);
  }

  /* Diagonal shimmer sweep */
  .lp-shimmer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .lp-shimmer::after {
    content: '';
    position: absolute;
    top: -50%; left: -50%;
    width: 200%; height: 200%;
    background: linear-gradient(
      105deg,
      transparent 0%,
      rgba(255,255,255,0.015) 44%,
      rgba(255,255,255,0.04)  50%,
      rgba(255,255,255,0.015) 56%,
      transparent 100%
    );
    animation: shimmer 9s ease-in-out infinite;
  }

  /* Staggered content fade-up */
  .lp-fade-up { animation: fadeUp 0.65s ease-out both; }
  .lp-fade-d1 { animation-delay: 0.1s; }
  .lp-fade-d2 { animation-delay: 0.22s; }
  .lp-fade-d3 { animation-delay: 0.38s; }
  .lp-fade-d4 { animation-delay: 0.52s; }
  .lp-fade-d5 { animation-delay: 0.68s; }

  /* Feature cards */
  .lp-feature-card {
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    background: linear-gradient(135deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.008) 100%);
    border: 1px solid rgba(255,255,255,0.055);
    transition: all 0.28s ease;
  }
  .lp-feature-card:hover {
    background: linear-gradient(135deg, rgba(20,184,166,0.09) 0%, rgba(52,211,153,0.04) 100%);
    border-color: rgba(20,184,166,0.25);
    box-shadow: 0 4px 20px rgba(20,184,166,0.1);
    transform: translateX(4px);
  }
  .lp-feature-card:hover .lp-icon-box {
    background: rgba(20,184,166,0.18);
    box-shadow: 0 0 14px rgba(20,184,166,0.35);
    color: #2dd4bf;
  }

  /* Stats / trust bar */
  .lp-stats-card {
    animation: pulse-glow 4.5s ease-in-out infinite;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Big metric cards (3-column row) */
  .lp-metric-card {
    background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%);
    border: 1px solid rgba(255,255,255,0.07);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: all 0.25s ease;
  }
  .lp-metric-card:hover {
    border-color: rgba(20,184,166,0.22);
    background: linear-gradient(135deg, rgba(20,184,166,0.07) 0%, rgba(52,211,153,0.02) 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(20,184,166,0.1);
  }

  /* Compact capability rows */
  .lp-capability {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    transition: all 0.22s ease;
  }
  .lp-capability:hover {
    background: rgba(20,184,166,0.06);
    border-color: rgba(20,184,166,0.16);
    transform: translateX(4px);
  }
  .lp-capability:hover .lp-icon-box {
    background: rgba(20,184,166,0.18);
    color: #2dd4bf;
    box-shadow: 0 0 12px rgba(20,184,166,0.3);
  }

  /* Respect reduced-motion */
  @media (prefers-reduced-motion: reduce) {
    .lp-aurora-bg, .lp-orb-1, .lp-orb-2, .lp-orb-3,
    .lp-stats-card { animation: none !important; }
    .lp-shimmer::after { animation: none !important; }
    .lp-fade-up { animation: none !important; opacity: 1; }
  }
`;

// ─── Main component ──────────────────────────────────────────────────────
const Login = ({ onLogin, apiRoutes }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const { branding, fetchPublicBranding } = useBranding();
  const [searchParams] = useSearchParams();
  const emailRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      emailRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const orgParam = searchParams.get('org');
    if (orgParam) fetchPublicBranding(orgParam);
  }, [searchParams, fetchPublicBranding]);

  const handleCapsCheck = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLockOn(e.getModifierState('CapsLock'));
  };

  const hasPriorLogin =
    typeof window !== 'undefined' && !!localStorage.getItem('email');
  const priorEmailFirstName = hasPriorLogin
    ? (localStorage.getItem('email') || '').split('@')[0].split(/[._-]/)[0]
    : '';

  const loginUser = async (e) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setLoginError(null);
      const response = await apiCaller.post(apiRoutes.loginApi, { email: username, password });
      if (response.status === 200) {
        const { email, AH1apq12slurt5, organization, uid } = response.data;
        localStorage.setItem('email', email);
        localStorage.setItem('AH1apq12slurt5', AH1apq12slurt5);
        localStorage.setItem('organization', organization);
        localStorage.setItem('uid', uid);
        onLogin();
      } else {
        setLoginError(`Login failed. ${response.data.message}`);
      }
    } catch (error) {
      const status = error.response?.status;
      if (status === 429) {
        setLoginError(error.response.data?.message || 'Too many login attempts. Please try again later.');
      } else {
        setLoginError(error.response?.data?.message || 'Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const companyName = branding.companyName || 'Hexalabs';
  const logoUrl = branding.logoUrl || '/logo/logo.png';

  // ─── Whitelabel split layout ─────────────────────────────────────────
  if (branding && (branding.customDomain || branding.organization)) {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row bg-white" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        <style>{AUTOFILL_OVERRIDE_CSS_WL}</style>
        <section className="flex flex-1 items-center justify-center px-6 py-12 lg:px-16">
          <div className="w-full max-w-md">
            <div className="flex justify-center mb-10">
              <img
                src={branding.logoUrl}
                alt={branding.companyName || 'Lab Portal'}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                className="h-16 object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2 text-center">Login to Your Account</h1>
            {branding.loginBanner && (
              <p className="text-sm text-slate-500 mb-8 text-center">{branding.loginBanner}</p>
            )}
            {loginError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
                {loginError}
              </div>
            )}
            <form onSubmit={loginUser} className="space-y-4">
              <div className="relative">
                <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  ref={emailRef}
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Email"
                  autoComplete="username"
                  required
                  className="w-full pl-12 pr-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] focus:border-transparent transition"
                />
              </div>
              <div className="relative">
                <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  onKeyDown={(e) => setCapsLockOn(e.getModifierState && e.getModifierState('CapsLock'))}
                  className="w-full pl-12 pr-12 py-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] focus:border-transparent transition"
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <FaEyeSlash className="w-4 h-4" /> : <FaEye className="w-4 h-4" />}
                </button>
              </div>
              {capsLockOn && <div className="text-xs text-amber-600">Caps Lock is ON</div>}
              <div className="flex items-center justify-between text-sm">
                <span></span>
                <Link to="/forgot-password" className="font-medium" style={{ color: 'var(--brand-primary)' }}>
                  Forgot Password?
                </Link>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 rounded-lg text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ background: 'var(--brand-primary)' }}
              >
                {isLoading ? 'Signing in...' : 'Login'}
              </button>
            </form>
            <p className="text-xs text-slate-400 text-center mt-8">
              Need help? Contact{' '}
              <a href={'mailto:' + (branding.supportEmail || 'labs@hexalabs.online')} className="font-medium" style={{ color: 'var(--brand-primary)' }}>
                {branding.supportEmail || 'labs@hexalabs.online'}
              </a>
            </p>
          </div>
        </section>
        <section className="hidden lg:flex flex-1 items-center justify-center relative overflow-hidden"
                 style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 12%, white), color-mix(in srgb, var(--brand-accent) 20%, white))' }}>
          <svg viewBox="0 0 600 600" className="w-4/5 max-w-xl" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="wlGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--brand-primary)" />
                <stop offset="100%" stopColor="var(--brand-accent)" />
              </linearGradient>
            </defs>
            <rect x="180" y="120" width="260" height="380" rx="30" fill="#ffffff" stroke="url(#wlGrad)" strokeWidth="4" />
            <circle cx="310" cy="210" r="40" fill="url(#wlGrad)" />
            <circle cx="310" cy="195" r="14" fill="#ffffff" />
            <path d="M285 235 Q310 215 335 235" fill="#ffffff" />
            <rect x="220" y="290" width="180" height="14" rx="7" fill="#e2e8f0" />
            <rect x="220" y="320" width="180" height="14" rx="7" fill="#e2e8f0" />
            <rect x="220" y="360" width="180" height="32" rx="8" fill="url(#wlGrad)" />
            <g transform="translate(80 80)">
              <path d="M40 0 L80 18 V46 Q80 70 40 90 Q0 70 0 46 V18 Z" fill="url(#wlGrad)" opacity="0.85" />
              <path d="M28 44 L36 52 L54 32" stroke="#ffffff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <g transform="translate(440 420)">
              <rect x="0" y="32" width="80" height="60" rx="10" fill="url(#wlGrad)" />
              <path d="M14 32 V20 a26 26 0 0 1 52 0 V32" stroke="url(#wlGrad)" strokeWidth="8" fill="none" />
              <circle cx="40" cy="60" r="6" fill="#ffffff" />
              <rect x="38" y="64" width="4" height="12" fill="#ffffff" />
            </g>
            <g transform="translate(420 100)">
              <ellipse cx="60" cy="40" rx="55" ry="24" fill="#ffffff" />
              <circle cx="30" cy="28" r="22" fill="#ffffff" />
              <circle cx="70" cy="20" r="28" fill="#ffffff" />
              <circle cx="100" cy="32" r="20" fill="#ffffff" />
            </g>
          </svg>
        </section>
      </div>
    );
  }

  // ─── Corporate enterprise layout (canonical domain) ────────────────────
  return (
    <div
      className="min-h-screen overflow-hidden selection:bg-blue-500/30"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{AUTOFILL_OVERRIDE_CSS}{LEFT_PANEL_CSS}</style>
      <div className="flex min-h-screen w-full">

        {/* ── Left: Animated branding panel ──────────────────────────── */}
        <section className="lp-aurora-bg relative hidden w-1/2 lg:flex flex-col justify-between p-8 xl:p-10 h-screen overflow-hidden">
          {/* Animated background layers */}
          <div className="lp-orb-1" />
          <div className="lp-orb-2" />
          <div className="lp-orb-3" />
          <div className="lp-grid" />
          <div className="lp-shimmer" />

          {/* Content — z-10 above background effects */}
          <div className="relative z-10 flex flex-col space-y-4 min-h-0">

            {/* ── Header: logo + live status ── */}
            <div className="flex items-center justify-between lp-fade-up lp-fade-d1">
              <div className="flex items-center gap-2.5">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={companyName}
                    onError={(e) => { e.currentTarget.outerHTML = `<span class="text-base font-bold text-white">${companyName}</span>`; }}
                    className="h-7 w-auto object-contain"
                  />
                ) : (
                  <span className="text-base font-bold text-white">{companyName}</span>
                )}
                <div className="h-4 w-px bg-white/15" />
                <span className="text-[11px] text-slate-500 font-medium tracking-wide">Cloud Portal</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-teal-500/25 bg-teal-500/10 px-3 py-1 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                <span className="text-[10px] font-semibold text-teal-300 tracking-wide">All systems live</span>
              </div>
            </div>

            {/* ── Hero copy ── */}
            <div className="lp-fade-up lp-fade-d2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 mb-3">
                <FaBolt className="w-2.5 h-2.5 text-orange-400" />
                <span className="text-[10px] font-bold text-orange-300 uppercase tracking-widest">Enterprise Ready</span>
              </div>
              <h2 className="text-3xl xl:text-[2.4rem] font-black leading-[1.1] text-white">
                Train teams on<br />
                <span className="bg-gradient-to-r from-teal-300 via-emerald-300 to-orange-300 bg-clip-text text-transparent">
                  real cloud.
                </span>
              </h2>
              <p className="mt-2.5 text-slate-400 text-[13px] leading-relaxed max-w-sm">
                {branding.loginBanner ||
                  'Provision per-student sandboxes across AWS, Azure, GCP & OCI in seconds. Auto-cleanup. Cost controls. Your brand.'}
              </p>
            </div>

            {/* ── 3 big metric cards ── */}
            <div className="grid grid-cols-3 gap-2.5 lp-fade-up lp-fade-d3">
              {[
                { value: '5', label: 'Cloud Providers', color: 'text-white' },
                { value: '103+', label: 'Lab Images', color: 'text-teal-300' },
                { value: '< 3s', label: 'Deploy Time', color: 'text-orange-300' },
              ].map(({ value, label, color }) => (
                <div key={label} className="lp-metric-card rounded-xl p-3 text-center">
                  <div className={`text-2xl font-black ${color} leading-none`}>{value}</div>
                  <div className="text-[10px] text-slate-500 font-medium mt-1">{label}</div>
                </div>
              ))}
            </div>

            {/* ── Compact capability rows ── */}
            <div className="space-y-1.5 lp-fade-up lp-fade-d4">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="lp-capability flex items-center gap-3 px-3 py-2 rounded-lg">
                  <div className="lp-icon-box flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-400 transition-all duration-300">
                    <Icon size={12} />
                  </div>
                  <div className="flex-1 min-w-0 flex items-baseline justify-between">
                    <span className="text-[12px] font-semibold text-white">{title}</span>
                    <span className="text-[10px] text-teal-500 font-medium ml-2 shrink-0">✓ Included</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Cloud provider logos ── */}
            <div className="lp-fade-up lp-fade-d5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">Supported Platforms</div>
              <div className="flex items-center gap-4">
                {SUPPORTED_CLOUDS.map(({ icon: Icon, label, color }) => (
                  <div key={label} className="flex flex-col items-center gap-1 group cursor-default" title={label}>
                    <Icon className="w-5 h-5 transition-all duration-300 group-hover:scale-125 group-hover:drop-shadow-lg" style={{ color }} />
                    <span className="text-[9px] text-slate-600 group-hover:text-slate-300 font-medium transition-colors">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Bottom: trust bar + footer ── */}
          <div className="relative z-10 space-y-3 mt-auto pt-3">
            {/* Trust badges row */}
            <div className="lp-stats-card flex items-center justify-between rounded-xl px-4 py-3 bg-white/[0.03] border border-white/[0.07]">
              <div className="flex items-center gap-1.5">
                <FaShieldAlt className="text-teal-400 w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold text-slate-300">ISO 9001 · 10004</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <FaLock className="text-teal-400 w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold text-slate-300">256-bit SSL</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <FaCertificate className="text-orange-400 w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold text-slate-300">White Label</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.9)]" />
                <span className="text-[10px] font-semibold text-orange-300">Live</span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/[0.05] pt-3 text-[10px]">
              <span className="font-semibold text-slate-500">{companyName}</span>
              <span className="text-slate-600">Enterprise Cloud Training Platform</span>
            </div>
          </div>
        </section>

        {/* ── Right: Sign-in form (white bg) ──────────────────────── */}
        <section className="flex w-full flex-col justify-center p-8 lg:w-1/2 lg:p-16 xl:p-24 bg-white relative">
          {/* Top-right CTAs */}
          <div className="absolute top-5 right-5 lg:top-8 lg:right-8 z-20 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="hidden md:inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Book demo
              <FaArrowRight className="w-3 h-3" />
            </button>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Create account
              <FaArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="mx-auto w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <div className="h-10 w-10 rounded-lg bg-slate-900 flex items-center justify-center">
                <img src={logoUrl} alt={companyName} className="h-6 w-6 object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
              <div>
                {logoUrl ? (
                  <img src={logoUrl} alt={companyName} className="h-7 w-auto object-contain"
                    onError={(e) => { e.currentTarget.outerHTML = `<div class="text-lg font-semibold text-gray-900">${companyName}</div>`; }} />
                ) : (
                  <div className="text-lg font-semibold text-gray-900">{companyName}</div>
                )}
                <div className="text-xs text-gray-500 font-medium">Cloud Portal</div>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                {hasPriorLogin
                  ? `Welcome back${priorEmailFirstName ? `, ${priorEmailFirstName}` : ''}`
                  : 'Sign in to your account'}
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                {hasPriorLogin
                  ? 'Access your cloud training portal.'
                  : 'Enter your credentials to access the portal.'}
              </p>
            </div>

            {/* Error */}
            {loginError && (
              <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-red-500 text-xs font-bold">!</span>
                </div>
                {loginError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={loginUser} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                <div className="relative">
                  <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    ref={emailRef}
                    type="email"
                    required
                    autoComplete="email"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full h-12 bg-gray-50 border border-gray-300 rounded-lg pl-12 pr-4 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition placeholder:text-gray-400 text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <Link to="/forgot-password" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <FaLock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleCapsCheck}
                    onKeyUp={handleCapsCheck}
                    onBlur={() => setCapsLockOn(false)}
                    placeholder="Enter your password"
                    className="w-full h-12 bg-gray-50 border border-gray-300 rounded-lg pl-12 pr-12 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition placeholder:text-gray-400 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <FaEyeSlash className="w-4 h-4" /> : <FaEye className="w-4 h-4" />}
                  </button>
                </div>
                {capsLockOn && (
                  <div className="mt-1.5 text-xs text-amber-600 font-medium flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Caps Lock is on
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <FaArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>

            {/* Cloud providers */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wider text-center mb-4">
                Deploy across
              </div>
              <div className="flex items-center justify-center gap-5">
                {SUPPORTED_CLOUDS.map(({ icon: Icon, label, color }) => (
                  <div key={label} className="flex flex-col items-center gap-1" title={label}>
                    <Icon className="w-6 h-6 transition-colors" style={{ color }} />
                    <span className="text-[10px] text-gray-400 font-medium">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer trust badges */}
            <div className="mt-8 pt-5 border-t border-gray-100">
              <div className="flex items-center justify-center gap-5 text-[11px] text-gray-400 font-medium">
                <span className="flex items-center gap-1.5">
                  <FaLock className="w-3 h-3 text-green-500" /> 256-bit SSL
                </span>
                <span className="flex items-center gap-1.5">
                  <FaCertificate className="w-3 h-3 text-green-500" /> ISO Certified
                </span>
                <span className="flex items-center gap-1.5">
                  <FaCheckCircle className="w-3 h-3 text-green-500" /> Live
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Demo request modal */}
      <DemoRequestModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
};

export default Login;
