// HexaLabs Cloud Portal — premium login page.
// Split layout: dark showcase left + clean white form right.
// Logic preserved: POST /user/login, localStorage, onLogin, ?org=xxx branding,
// caps-lock detection, demo modal.

import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import DemoRequestModal from '../components/DemoRequestModal';
import {
  FaEnvelope, FaLock, FaArrowRight, FaShieldAlt,
  FaBolt, FaGlobe, FaMicrochip, FaUserLock, FaCheck,
  FaEye, FaEyeSlash, FaCertificate, FaCheckCircle,
  FaAws, FaMicrosoft, FaGoogle, FaRedhat, FaCloud, FaDocker,
} from 'react-icons/fa';

const CLOUDS = [
  { icon: FaAws,       label: 'AWS',              color: '#FF9900' },
  { icon: FaMicrosoft, label: 'Azure',             color: '#00A4EF' },
  { icon: FaGoogle,    label: 'Google Cloud',      color: '#4285F4' },
  { icon: FaCloud,     label: 'Oracle Cloud',      color: '#F80000' },
  { icon: FaRedhat,    label: 'OpenShift',         color: '#EE0000' },
  { icon: FaDocker,    label: 'Containers',        color: '#2496ED' },
];

const CAPABILITIES = [
  'Instant sandbox provisioning across 5 clouds',
  'Per-student cost caps and budget guardrails',
  'Auto-cleanup when training batches end',
  'White-label portal under your own brand',
  'ISO 9001 & 10004 certified infrastructure',
  '100+ pre-built lab images ready to deploy',
];

const AUTOFILL_CSS = `
  input:-webkit-autofill,
  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 30px #fff inset !important;
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

        {/* ── Left Panel ───────────────────────────────────────────────── */}
        <section className="relative hidden w-[54%] lg:flex flex-col overflow-hidden" style={{ background: '#0c1222' }}>
          {/* Ambient gradient mesh */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full opacity-40" style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }} />
            <div className="absolute bottom-[-15%] right-[-5%] w-[55%] h-[55%] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }} />
            <div className="absolute top-[40%] right-[20%] w-[40%] h-[40%] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }} />
          </div>
          {/* Fine grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          <div className="relative z-10 flex flex-col h-full p-10 xl:p-14">

            {/* Logo row */}
            <div className="flex items-center gap-3 mb-16">
              <div className="h-10 w-10 rounded-xl bg-white/[0.08] border border-white/[0.08] flex items-center justify-center overflow-hidden backdrop-blur-sm">
                <img
                  src={logoUrl}
                  alt={companyName}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  className="h-6 w-6 object-contain"
                />
              </div>
              <div>
                <h1 className="text-base font-semibold text-white/90 tracking-tight leading-none">{companyName}</h1>
                <p className="text-[10px] font-medium text-white/30 uppercase tracking-[0.15em] mt-0.5">Cloud Portal</p>
              </div>
            </div>

            {/* Hero copy */}
            <div className="flex-1 flex flex-col justify-center max-w-lg -mt-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-[0.2em] mb-4">Enterprise-Grade Platform</p>
                <h2 className="text-[40px] xl:text-[46px] font-extrabold leading-[1.1] text-white tracking-tight">
                  Cloud training labs,{' '}
                  <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
                    delivered at scale.
                  </span>
                </h2>
                <p className="mt-5 text-[15px] text-slate-400 leading-relaxed max-w-md">
                  {branding.loginBanner ||
                    'The platform training companies trust to run instructor-led cloud certification batches across AWS, Azure, GCP, and OCI.'}
                </p>
              </motion.div>

              {/* Capability checklist */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="mt-10 grid grid-cols-1 gap-2.5"
              >
                {CAPABILITIES.map((item) => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="h-5 w-5 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                      <FaCheck className="w-2.5 h-2.5 text-blue-400" />
                    </div>
                    <span className="text-[13px] text-slate-300 font-medium">{item}</span>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Bottom section */}
            <div className="mt-auto pt-8">
              {/* Cloud logos */}
              <div className="flex items-center gap-6 mb-8">
                {CLOUDS.map(({ icon: Icon, label, color }) => (
                  <div key={label} className="group cursor-default" title={label}>
                    <Icon className="w-[22px] h-[22px] text-white/20 group-hover:text-white/60 transition-colors duration-200" />
                  </div>
                ))}
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-8 py-5 border-t border-white/[0.06]">
                {[
                  { value: '5', label: 'Cloud Providers' },
                  { value: '103+', label: 'Lab Images' },
                  { value: '<3s', label: 'Deploy Time' },
                  { value: '99.9%', label: 'Uptime SLA' },
                ].map(({ value, label }) => (
                  <div key={label}>
                    <div className="text-lg font-bold text-white tracking-tight" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
                    <div className="text-[10px] text-slate-500 font-medium mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
                <span className="text-[10px] text-slate-600 font-medium">HexaLabs Cloud Solutions Pvt Ltd</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium">
                    <FaShieldAlt className="w-2.5 h-2.5 text-slate-500" /> ISO 9001 &middot; 10004
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> All Systems Live
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Right Panel: Login Form ───────────────────────────────────── */}
        <section className="flex w-full flex-col lg:w-[46%] bg-[#fafbfc] relative">
          {/* Top-right actions */}
          <div className="absolute top-5 right-5 lg:top-7 lg:right-8 z-20 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="hidden md:inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 bg-white hover:bg-blue-50 rounded-lg transition-colors shadow-sm"
            >
              Book a Demo
            </button>
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 rounded-lg transition-colors shadow-sm"
            >
              Create Account
              <FaArrowRight className="w-2.5 h-2.5" />
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center px-8 py-16 lg:px-16">
            <div className="w-full max-w-[380px]">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                {/* Mobile logo */}
                <div className="lg:hidden flex items-center gap-3 mb-10">
                  <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center overflow-hidden">
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
                  <h2 className="text-[26px] font-bold text-gray-900 tracking-tight leading-tight">
                    {hasPriorLogin
                      ? `Welcome back${priorEmailFirstName ? `, ${priorEmailFirstName}` : ''}`
                      : 'Sign in to your account'}
                  </h2>
                  <p className="mt-2 text-[14px] text-gray-500 leading-relaxed">
                    {hasPriorLogin
                      ? 'Access your cloud training portal.'
                      : 'Enter your credentials to continue to the portal.'}
                  </p>
                </div>

                {/* Error */}
                {loginError && (
                  <div className="flex items-start gap-2.5 p-3.5 mb-6 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-red-500 text-xs font-bold">!</span>
                    </div>
                    <span>{loginError}</span>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={loginUser} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[13px] font-medium text-gray-700">
                      Email address
                    </label>
                    <div className="relative">
                      <FaEnvelope className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-[15px] h-[15px]" />
                      <input
                        ref={emailRef}
                        type="email"
                        required
                        autoComplete="email"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="you@company.com"
                        className="w-full h-[46px] bg-white border border-gray-200 rounded-xl pl-11 pr-4 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400 shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-[13px] font-medium text-gray-700">
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
                      <FaLock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-[15px] h-[15px]" />
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
                        className="w-full h-[46px] bg-white border border-gray-200 rounded-xl pl-11 pr-11 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400 shadow-sm"
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
                    className="w-full h-[46px] bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-sm mt-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign in</span>
                        <FaArrowRight className="w-3 h-3" />
                      </>
                    )}
                  </button>
                </form>

                {/* Divider */}
                <div className="flex items-center gap-3 my-7">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Trusted by training companies</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Cloud provider logos */}
                <div className="flex items-center justify-between px-2">
                  {CLOUDS.map(({ icon: Icon, label, color }) => (
                    <div key={label} title={label} className="opacity-30 hover:opacity-70 transition-opacity cursor-default">
                      <Icon className="w-6 h-6" style={{ color }} />
                    </div>
                  ))}
                </div>

                {/* Trust badges */}
                <div className="mt-8 flex items-center justify-center gap-5 text-[11px] text-gray-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <FaLock className="w-3 h-3 text-gray-400" /> 256-bit SSL
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FaCertificate className="w-3 h-3 text-gray-400" /> ISO Certified
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FaCheckCircle className="w-3 h-3 text-gray-400" /> SOC 2
                  </span>
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
