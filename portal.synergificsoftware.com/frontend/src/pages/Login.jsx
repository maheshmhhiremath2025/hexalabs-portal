// Corporate enterprise login — clean, professional, trust-focused.
// Split layout: dark left branding panel + light right login form.
// All logic unchanged: POST /user/login, localStorage, onLogin callback,
// ?org=xxx public branding, caps-lock detection, demo modal.

import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
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
  { icon: FaAws,       label: 'AWS',               color: '#FF9900' },
  { icon: FaMicrosoft, label: 'Azure',              color: '#0078D4' },
  { icon: FaGoogle,    label: 'Google Cloud',       color: '#4285F4' },
  { icon: FaCloud,     label: 'Oracle Cloud',       color: '#F80000' },
  { icon: FaRedhat,    label: 'Red Hat OpenShift',  color: '#EE0000' },
  { icon: FaDocker,    label: 'Containers',         color: '#2496ED' },
];

const FEATURES = [
  { icon: FaBolt,      title: 'Instant Provisioning', desc: 'Workspaces in seconds, VMs in minutes. No tickets, no waiting.' },
  { icon: FaGlobe,     title: 'Multi-Cloud Support',  desc: 'AWS, Azure, GCP, OCI, and Red Hat OpenShift from one interface.' },
  { icon: FaMicrochip, title: 'Cost Guardrails',      desc: 'Quotas, idle auto-shutdown, expiry cleanup, and budget caps built in.' },
  { icon: FaUserLock,  title: 'Enterprise Security',  desc: 'ISO 9001 & 10004 certified. SSL everywhere, hardened IAM per sandbox.' },
];

// Light-theme autofill override for the right panel
const AUTOFILL_CSS = `
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

  const companyName = branding.companyName || 'HexaLabs';
  const logoUrl = branding.logoUrl || '/logo/logo.png';

  return (
    <div
      className="min-h-screen overflow-hidden selection:bg-blue-500/30"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{AUTOFILL_CSS}</style>
      <div className="flex min-h-screen w-full">

        {/* ── Left Panel: Branding & Features (desktop only) ────────────── */}
        <section className="relative hidden w-[52%] flex-col justify-between lg:flex overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
          {/* Subtle background pattern */}
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)',
              backgroundSize: '32px 32px',
            }}
          />

          <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">
            {/* Header: Logo + badges */}
            <div className="flex items-center justify-between mb-12">
              <div className="flex items-center gap-3.5">
                <div className="h-11 w-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden">
                  <img
                    src={logoUrl}
                    alt={companyName}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    className="h-7 w-7 object-contain"
                  />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white tracking-tight">{companyName}</h1>
                  <p className="text-[10px] font-semibold text-blue-300/70 uppercase tracking-[0.2em]">Cloud Portal</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
                  <FaShieldAlt className="text-emerald-400 w-3 h-3" />
                  <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wider">ISO 9001</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">Live</span>
                </div>
              </div>
            </div>

            {/* Headline */}
            <div className="mb-10 max-w-xl">
              <motion.h2
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="text-4xl xl:text-5xl font-extrabold leading-tight text-white"
              >
                Enterprise Cloud
                <br />
                <span className="text-blue-400">Training Platform</span>
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.6 }}
                className="mt-5 text-slate-400 text-[15px] leading-relaxed max-w-md"
              >
                {branding.loginBanner ||
                  'Provision per-student cloud sandboxes across AWS, Azure, GCP, and OCI in seconds. Enforce cost caps, auto-clean when the batch ends \u2014 all under your own brand.'}
              </motion.p>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-2 gap-3 mb-10">
              {FEATURES.map(({ icon: Icon, title, desc }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.5 }}
                  className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] transition-colors"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-400">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[13px] font-semibold text-white leading-tight">{title}</h3>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Cloud providers */}
            <div className="mb-auto">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.15em] mb-3">Supported Platforms</p>
              <div className="flex items-center gap-5">
                {SUPPORTED_CLOUDS.map(({ icon: Icon, label, color }) => (
                  <div key={label} className="flex items-center gap-1.5 group cursor-default" title={label}>
                    <Icon className="w-5 h-5 opacity-50 group-hover:opacity-90 transition-opacity" style={{ color }} />
                    <span className="text-[10px] font-medium text-slate-500 group-hover:text-slate-300 transition-colors hidden xl:inline">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-4 gap-6 rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 mb-6">
              {[
                { label: 'Clouds', value: '5' },
                { label: 'Lab Images', value: '103+' },
                { label: 'Deploy Time', value: '< 3s' },
                { label: 'White Label', value: 'Ready' },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-xl font-bold text-white" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-[10px] text-slate-600 pt-4 border-t border-white/[0.06]">
              <span className="font-medium">HexaLabs Cloud Solutions Pvt Ltd</span>
              <span className="font-medium">SSL Secured &middot; ISO 9001 &middot; 10004</span>
            </div>
          </div>
        </section>

        {/* ── Right Panel: Login Form ───────────────────────────────────── */}
        <section className="flex w-full flex-col lg:w-[48%] bg-white relative">
          {/* Top-right actions */}
          <div className="absolute top-5 right-5 lg:top-6 lg:right-8 z-20 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              Book a Demo
            </button>
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Create Account
              <FaArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center px-8 py-16 lg:px-16">
            <div className="w-full max-w-[400px]">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                {/* Mobile logo */}
                <div className="lg:hidden flex items-center gap-3 mb-8">
                  <div className="h-10 w-10 rounded-lg bg-slate-900 flex items-center justify-center overflow-hidden">
                    <img src={logoUrl} alt={companyName} className="h-6 w-6 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </div>
                  <div>
                    <div className="text-base font-bold text-gray-900">{companyName}</div>
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Cloud Portal</div>
                  </div>
                </div>

                {/* Heading */}
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
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
                  <div className="flex items-start gap-2.5 p-3.5 mb-6 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-500 text-xs font-bold">!</span>
                    </div>
                    <span>{loginError}</span>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={loginUser} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">
                      Email address
                    </label>
                    <div className="relative">
                      <FaEnvelope className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        ref={emailRef}
                        type="email"
                        required
                        autoComplete="email"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full h-11 bg-gray-50 border border-gray-300 rounded-lg pl-11 pr-4 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-gray-700">
                        Password
                      </label>
                      {capsLockOn && (
                        <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Caps Lock on
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <FaLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
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
                        className="w-full h-11 bg-gray-50 border border-gray-300 rounded-lg pl-11 pr-11 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <FaEyeSlash className="w-4 h-4" /> : <FaEye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm"
                  >
                    {isLoading ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign in</span>
                        <FaArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </form>

                {/* Cloud providers */}
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <p className="text-center text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-4">
                    Deploy across leading cloud platforms
                  </p>
                  <div className="flex items-center justify-center gap-5">
                    {SUPPORTED_CLOUDS.map(({ icon: Icon, label, color }) => (
                      <div key={label} title={label} className="opacity-40 hover:opacity-80 transition-opacity cursor-default">
                        <Icon className="w-6 h-6" style={{ color }} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Trust badges */}
                <div className="mt-6 pt-5 border-t border-gray-100">
                  <div className="flex items-center justify-center gap-5 text-[11px] text-gray-400 font-medium">
                    <span className="flex items-center gap-1.5">
                      <FaLock className="w-3 h-3 text-green-500" /> 256-bit SSL
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FaCertificate className="w-3 h-3 text-green-500" /> ISO Certified
                    </span>
                    <span className="flex items-center gap-1.5">
                      <FaCheckCircle className="w-3 h-3 text-green-500" /> SOC 2
                    </span>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      </div>

      <DemoRequestModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
};

export default Login;
