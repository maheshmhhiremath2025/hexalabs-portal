// Clean sky/cloud login — centered glassmorphism card over airy gradient.
// Core login flow unchanged.

import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import DemoRequestModal from '../components/DemoRequestModal';
import {
  FaEnvelope, FaLock, FaArrowRight, FaShieldAlt,
  FaEye, FaEyeSlash, FaCertificate,
  FaAws, FaMicrosoft, FaGoogle, FaRedhat, FaCloud, FaDocker,
} from 'react-icons/fa';

const SUPPORTED_CLOUDS = [
  { icon: FaAws,       label: 'AWS',          color: '#FF9900' },
  { icon: FaMicrosoft, label: 'Azure',        color: '#00BCF2' },
  { icon: FaGoogle,    label: 'Google Cloud', color: '#4285F4' },
  { icon: FaCloud,     label: 'Oracle Cloud', color: '#F80000' },
  { icon: FaRedhat,    label: 'OpenShift',    color: '#EE0000' },
  { icon: FaDocker,    label: 'Containers',   color: '#2496ED' },
];

// Chrome autofill override — light card
const AUTOFILL_CSS = `
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px rgba(255,255,255,0.85) inset !important;
    -webkit-text-fill-color: #1e293b !important;
    caret-color: #1e293b !important;
    transition: background-color 5000s ease-in-out 0s;
  }
`;

// Chrome autofill override — whitelabel (light bg)
const AUTOFILL_CSS_WL = `
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

const PAGE_CSS = `
  @keyframes sky-drift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes sky-float1 {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.35; }
    50%      { transform: translate(30px, -20px) scale(1.1); opacity: 0.55; }
  }
  @keyframes sky-float2 {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.25; }
    50%      { transform: translate(-25px, 15px) scale(1.15); opacity: 0.45; }
  }
  @keyframes sky-float3 {
    0%, 100% { transform: translateX(0); opacity: 0.2; }
    50%      { transform: translateX(20px); opacity: 0.35; }
  }
  @keyframes sky-ring {
    from { transform: translate(-50%, -50%) rotate(0deg); }
    to   { transform: translate(-50%, -50%) rotate(360deg); }
  }
  @keyframes sky-fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes sky-pulse {
    0%, 100% { opacity: 0.4; }
    50%      { opacity: 0.7; }
  }

  .sky-bg {
    background: linear-gradient(135deg, #e0ecff 0%, #d4e4ff 20%, #c9dbff 40%, #dfe8f8 60%, #eef2fb 80%, #f0f4ff 100%);
    background-size: 300% 300%;
    animation: sky-drift 20s ease infinite;
  }

  /* Fluffy cloud shapes built from overlapping circles */
  .sky-cloud {
    position: absolute;
    pointer-events: none;
    filter: blur(2px);
    opacity: 0.9;
  }
  .sky-cloud::before, .sky-cloud::after, .sky-cloud span {
    content: '';
    position: absolute;
    background: rgba(255,255,255,0.85);
    border-radius: 50%;
  }
  /* Cloud 1 — large, top-right */
  .sky-cloud1 {
    width: 240px; height: 80px; top: 8%; right: 8%;
    background: rgba(255,255,255,0.8);
    border-radius: 80px;
    animation: sky-float1 22s ease-in-out infinite;
  }
  .sky-cloud1::before { width: 100px; height: 100px; top: -50px; left: 40px; background: rgba(255,255,255,0.85); border-radius: 50%; }
  .sky-cloud1::after  { width: 130px; height: 130px; top: -70px; left: 90px; background: rgba(255,255,255,0.8); border-radius: 50%; }
  .sky-cloud1 span    { width: 80px;  height: 80px;  top: -40px; left: 150px; background: rgba(255,255,255,0.85); border-radius: 50%; display: block; }

  /* Cloud 2 — medium, bottom-left */
  .sky-cloud2 {
    width: 180px; height: 60px; bottom: 12%; left: 5%;
    background: rgba(255,255,255,0.75);
    border-radius: 60px;
    animation: sky-float2 26s ease-in-out infinite;
  }
  .sky-cloud2::before { width: 80px; height: 80px; top: -40px; left: 30px; background: rgba(255,255,255,0.8); border-radius: 50%; }
  .sky-cloud2::after  { width: 100px; height: 100px; top: -55px; left: 65px; background: rgba(255,255,255,0.75); border-radius: 50%; }
  .sky-cloud2 span    { width: 60px;  height: 60px;  top: -30px; left: 110px; background: rgba(255,255,255,0.8); border-radius: 50%; display: block; }

  /* Cloud 3 — small, top-left */
  .sky-cloud3 {
    width: 140px; height: 48px; top: 18%; left: 12%;
    background: rgba(255,255,255,0.7);
    border-radius: 48px;
    animation: sky-float3 18s ease-in-out infinite;
  }
  .sky-cloud3::before { width: 65px; height: 65px; top: -32px; left: 20px; background: rgba(255,255,255,0.75); border-radius: 50%; }
  .sky-cloud3::after  { width: 80px; height: 80px; top: -42px; left: 50px; background: rgba(255,255,255,0.7); border-radius: 50%; }

  /* Cloud 4 — tiny, mid-right */
  .sky-cloud4 {
    width: 110px; height: 38px; top: 55%; right: 10%;
    background: rgba(255,255,255,0.65);
    border-radius: 38px;
    animation: sky-float1 20s ease-in-out infinite reverse;
  }
  .sky-cloud4::before { width: 55px; height: 55px; top: -28px; left: 15px; background: rgba(255,255,255,0.7); border-radius: 50%; }
  .sky-cloud4::after  { width: 65px; height: 65px; top: -35px; left: 40px; background: rgba(255,255,255,0.65); border-radius: 50%; }

  /* Cloud 5 — small, bottom-right */
  .sky-cloud5 {
    width: 160px; height: 52px; bottom: 22%; right: 18%;
    background: rgba(255,255,255,0.6);
    border-radius: 52px;
    animation: sky-float2 24s ease-in-out infinite reverse;
  }
  .sky-cloud5::before { width: 70px; height: 70px; top: -36px; left: 25px; background: rgba(255,255,255,0.65); border-radius: 50%; }
  .sky-cloud5::after  { width: 85px; height: 85px; top: -45px; left: 60px; background: rgba(255,255,255,0.6); border-radius: 50%; }

  /* Orbital rings behind card */
  .sky-ring1 {
    position: absolute; width: 520px; height: 520px; top: 50%; left: 50%;
    border-radius: 50%;
    border: 1px solid rgba(99,130,241,0.08);
    animation: sky-ring 25s linear infinite;
    pointer-events: none;
  }
  .sky-ring2 {
    position: absolute; width: 620px; height: 620px; top: 50%; left: 50%;
    border-radius: 50%;
    border: 1px solid rgba(139,152,246,0.06);
    animation: sky-ring 35s linear infinite reverse;
    pointer-events: none;
  }
  .sky-ring3 {
    position: absolute; width: 440px; height: 440px; top: 50%; left: 50%;
    border-radius: 50%;
    border: 1.5px dashed rgba(99,130,241,0.05);
    animation: sky-ring 18s linear infinite;
    pointer-events: none;
  }

  .sky-fade-up { animation: sky-fadeUp 0.6s ease-out both; }
  .sky-d1 { animation-delay: 0.05s; }
  .sky-d2 { animation-delay: 0.15s; }
  .sky-d3 { animation-delay: 0.25s; }
  .sky-d4 { animation-delay: 0.35s; }
  .sky-d5 { animation-delay: 0.45s; }

  .sky-card {
    background: rgba(255,255,255,0.65);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255,255,255,0.5);
    box-shadow:
      0 8px 32px rgba(99,130,241,0.08),
      0 2px 8px rgba(0,0,0,0.04),
      inset 0 1px 0 rgba(255,255,255,0.8);
  }

  .sky-input {
    background: rgba(255,255,255,0.7);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(148,163,184,0.25);
    transition: all 0.2s ease;
  }
  .sky-input:focus {
    background: rgba(255,255,255,0.9);
    border-color: rgba(99,102,241,0.5);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.1), 0 2px 8px rgba(99,102,241,0.08);
  }

  .sky-btn {
    background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
    box-shadow: 0 4px 14px rgba(30,41,59,0.25), 0 2px 6px rgba(0,0,0,0.08);
    transition: all 0.2s ease;
  }
  .sky-btn:hover {
    box-shadow: 0 6px 20px rgba(30,41,59,0.35), 0 3px 8px rgba(0,0,0,0.12);
    transform: translateY(-1px);
  }
  .sky-btn:active { transform: translateY(0); }

  @media (prefers-reduced-motion: reduce) {
    .sky-bg, .sky-cloud1, .sky-cloud2, .sky-cloud3, .sky-cloud4, .sky-cloud5,
    .sky-ring1, .sky-ring2, .sky-ring3 { animation: none !important; }
    .sky-fade-up { animation: none !important; opacity: 1; }
  }
`;

// ─── Main component ─────────────────────────────────────────────────────
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

  // ─── Whitelabel layout (unchanged) ──────────────────────────────────
  if (branding && (branding.customDomain || branding.organization)) {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row bg-white" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        <style>{AUTOFILL_CSS_WL}</style>
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

  // ─── Corporate — Sky / cloud centered layout ──────────────────────────
  return (
    <div
      className="sky-bg min-h-screen relative overflow-hidden flex flex-col items-center justify-center selection:bg-indigo-500/20"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{AUTOFILL_CSS}{PAGE_CSS}</style>

      {/* Fluffy cloud shapes */}
      <div className="sky-cloud sky-cloud1"><span /></div>
      <div className="sky-cloud sky-cloud2"><span /></div>
      <div className="sky-cloud sky-cloud3" />
      <div className="sky-cloud sky-cloud4" />
      <div className="sky-cloud sky-cloud5" />

      {/* Orbital rings */}
      <div className="sky-ring1" />
      <div className="sky-ring2" />
      <div className="sky-ring3" />

      {/* Top navigation bar */}
      <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 lg:px-10 py-4">
        <div className="flex items-center gap-2.5">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              onError={(e) => { e.currentTarget.outerHTML = `<span class="text-sm font-bold text-slate-700">${companyName}</span>`; }}
              className="h-7 w-auto object-contain"
            />
          ) : (
            <span className="text-sm font-bold text-slate-700">{companyName}</span>
          )}
          <div className="h-4 w-px bg-slate-300/50" />
          <span className="text-[10px] text-slate-400 font-medium tracking-wide">Cloud Portal</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDemoOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-200/60 hover:border-slate-300 bg-white/50 hover:bg-white/80 backdrop-blur-sm rounded-lg transition-all"
          >
            Book demo
          </button>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-200/60 hover:border-slate-300 bg-white/50 hover:bg-white/80 backdrop-blur-sm rounded-lg transition-all"
          >
            Sign up
          </Link>
        </div>
      </nav>

      {/* ── Centered card ──────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-md px-5">

        {/* Login icon */}
        <div className="sky-fade-up sky-d1 flex justify-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <FaLock className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Card */}
        <div className="sky-card rounded-2xl p-7 sm:p-8 sky-fade-up sky-d2">

          {/* Heading */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-800">
              {hasPriorLogin
                ? <>Welcome back{priorEmailFirstName ? <>, <span className="text-indigo-600">{priorEmailFirstName}</span></> : ''}</>
                : 'Sign in with email'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {hasPriorLogin
                ? 'Access your cloud training portal.'
                : 'Enter your credentials to get started'}
            </p>
          </div>

          {/* Error */}
          {loginError && (
            <div className="mb-4 flex items-center gap-2.5 p-3 bg-red-50/80 border border-red-200/60 rounded-xl text-sm text-red-600 backdrop-blur-sm">
              <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <span className="text-red-500 text-xs font-bold">!</span>
              </div>
              {loginError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={loginUser} className="space-y-3.5">
            <div className="relative">
              <FaEnvelope className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 z-10" />
              <input
                ref={emailRef}
                type="email"
                required
                autoComplete="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Email address"
                className="sky-input w-full h-11 rounded-xl pl-11 pr-4 text-slate-800 text-sm placeholder:text-slate-400 focus:outline-none"
              />
            </div>

            <div className="relative">
              <FaLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5 z-10" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleCapsCheck}
                onKeyUp={handleCapsCheck}
                onBlur={() => setCapsLockOn(false)}
                placeholder="Password"
                className="sky-input w-full h-11 rounded-xl pl-11 pr-11 text-slate-800 text-sm placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors z-10"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <FaEyeSlash className="w-3.5 h-3.5" /> : <FaEye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {capsLockOn && (
              <div className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Caps Lock is on
              </div>
            )}

            <div className="flex items-center justify-end">
              <Link to="/forgot-password" className="text-xs font-medium text-indigo-500 hover:text-indigo-600 transition-colors">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="sky-btn w-full h-11 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Get Started
                  <FaArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-slate-200/60" />
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Deploy across</span>
            <div className="flex-1 h-px bg-slate-200/60" />
          </div>

          {/* Cloud providers */}
          <div className="flex items-center justify-center gap-4">
            {SUPPORTED_CLOUDS.map(({ icon: Icon, label, color }) => (
              <div key={label} className="group cursor-default" title={label}>
                <div className="w-9 h-9 rounded-xl bg-white/60 border border-slate-200/40 flex items-center justify-center group-hover:border-slate-300/60 group-hover:bg-white/80 group-hover:shadow-sm transition-all">
                  <Icon className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-all" style={{ color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trust footer below card */}
        <div className="sky-fade-up sky-d4 mt-5 flex items-center justify-center gap-4 text-[10px] text-slate-400 font-medium">
          <span className="flex items-center gap-1"><FaShieldAlt className="w-2.5 h-2.5 text-indigo-400/60" /> ISO Certified</span>
          <span className="h-2.5 w-px bg-slate-300/40" />
          <span className="flex items-center gap-1"><FaLock className="w-2.5 h-2.5 text-indigo-400/60" /> 256-bit SSL</span>
          <span className="h-2.5 w-px bg-slate-300/40" />
          <span className="flex items-center gap-1"><FaCertificate className="w-2.5 h-2.5 text-indigo-400/60" /> White Label</span>
        </div>
      </div>

      {/* Demo request modal */}
      <DemoRequestModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
};

export default Login;
