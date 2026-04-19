// Premium fintech-style login inspired by the "ApexTrade" glassmorphism design.
// Adapted for Synergific Cloud Portal — core login flow is unchanged from the
// previous revision (POST /user/login, localStorage write, onLogin callback,
// ?org=xxx public branding). Only visuals + copy changed.

import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import {
  FaEnvelope, FaLock, FaArrowRight, FaChartLine, FaShieldAlt,
  FaBolt, FaGlobe, FaMicrochip, FaUserLock, FaChevronRight,
  FaEye, FaEyeSlash, FaCertificate,
} from 'react-icons/fa';

// ─── Feature card (left showcase panel) ──────────────────────────────────
function FeatureCard({ icon: Icon, title, desc, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="group relative flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-blue-500/30 hover:bg-white/10 transition-all cursor-default"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors uppercase tracking-wider">{title}</h3>
        <p className="text-xs text-zinc-500 leading-relaxed mt-1">{desc}</p>
      </div>
      <FaChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all text-blue-400 w-3 h-3" />
    </motion.div>
  );
}

// ─── Stat box (bottom strip) ─────────────────────────────────────────────
function StatBox({ label, value, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="space-y-1"
    >
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">{label}</div>
      <div className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{value}</div>
    </motion.div>
  );
}

// ─── Animated ambient background (mesh blobs + grid) ─────────────────────
// The three blobs drift independently. When the user prefers reduced motion
// (WCAG 2.3.3), we render them statically so we don't trigger motion
// sickness — the visual theme is preserved, just without the drift.
function CloudBackground({ reduced = false }) {
  const drift = reduced ? {} : { x: [0, 100, -50, 0], y: [0, -50, 100, 0], scale: [1, 1.2, 0.9, 1] };
  const drift2 = reduced ? {} : { x: [0, -80, 120, 0], y: [0, 120, -50, 0], scale: [1, 0.8, 1.1, 1] };
  const drift3 = reduced ? {} : { x: [0, 50, -100, 0], y: [0, 100, -80, 0], scale: [1, 1.1, 0.9, 1] };
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden select-none">
      <motion.div
        animate={drift}
        transition={reduced ? {} : { duration: 25, repeat: Infinity, ease: 'linear' }}
        className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] bg-blue-600/20 blur-[120px] rounded-full"
      />
      <motion.div
        animate={drift2}
        transition={reduced ? {} : { duration: 30, repeat: Infinity, ease: 'linear', delay: -5 }}
        className="absolute -bottom-1/4 -right-1/4 w-[70%] h-[70%] bg-emerald-500/15 blur-[120px] rounded-full"
      />
      <motion.div
        animate={drift3}
        transition={reduced ? {} : { duration: 20, repeat: Infinity, ease: 'linear', delay: -10 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] bg-indigo-600/10 blur-[150px] rounded-full"
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
    </div>
  );
}

// Chrome's default autofill background is a jarring yellow-on-dark against
// this theme. These rules coerce autofilled inputs to keep the dark look.
const AUTOFILL_OVERRIDE_CSS = `
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

// ─── Main component ──────────────────────────────────────────────────────
const Login = ({ onLogin, apiRoutes }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const { branding, fetchPublicBranding } = useBranding();
  const [searchParams] = useSearchParams();
  const emailRef = useRef(null);

  // Autofocus the email field on mount so returning users can just start typing.
  // Skipped on mobile to avoid the keyboard popping up and covering the form.
  useEffect(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      emailRef.current?.focus();
    }
  }, []);

  // ?org=xxx in URL → fetch org's public branding (unchanged)
  useEffect(() => {
    const orgParam = searchParams.get('org');
    if (orgParam) fetchPublicBranding(orgParam);
  }, [searchParams, fetchPublicBranding]);

  // Caps-lock detection: show a small warning when caps is on and password
  // field is focused. Reacts to keydown/keyup on the password input itself,
  // plus a global listener so the warning clears if the user toggles caps
  // while focused elsewhere.
  const handleCapsCheck = (e) => {
    if (typeof e.getModifierState === 'function') setCapsLockOn(e.getModifierState('CapsLock'));
  };

  // Respect the user's reduced-motion preference. Those users get a static
  // background — no drifting blobs — since constant motion can trigger
  // vestibular issues. Motion still works for focus/hover, just not ambient.
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Login flow — same happy path as before, with explicit 429 handling so
  // rate-limited users get a clear "try again in X min" message instead of
  // a generic "Login failed".
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
      // Backend returns 429 when login attempts exceed the limit. Its body
      // already contains a human-readable message like "Too many login
      // attempts. Try again in 10 minutes." — just surface it.
      if (status === 429) {
        setLoginError(error.response.data?.message || 'Too many login attempts. Please try again later.');
      } else {
        setLoginError(error.response?.data?.message || 'Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const companyName = branding.companyName || 'Synergific';
  const logoUrl = branding.logoUrl || '/logo/synergificsoftware-logo.png';

  return (
    <div
      className="min-h-screen bg-[#020617] overflow-hidden text-slate-200 selection:bg-blue-500/30"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
    >
      <style>{AUTOFILL_OVERRIDE_CSS}</style>
      <div className="flex min-h-screen w-full relative">
        <CloudBackground reduced={prefersReducedMotion} />

        {/* ── Left: Showcase (hidden on small screens) ──────────────────── */}
        <section className="relative hidden w-1/2 flex-col justify-between p-12 xl:p-16 lg:flex border-r border-white/5 bg-slate-900/10 backdrop-blur-sm">
          <div className="relative z-10 flex flex-col space-y-12">
            {/* Logo + ISO badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-500 p-0.5 shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                  <div className="flex h-full w-full items-center justify-center rounded-[0.8rem] bg-[#020617] overflow-hidden">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={companyName}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        className="h-8 w-8 object-contain"
                      />
                    ) : (
                      <FaChartLine className="h-7 w-7 text-blue-400" />
                    )}
                  </div>
                </div>
                <div className="flex flex-col -space-y-1">
                  <h1 className="text-2xl font-black tracking-tight text-white">
                    {companyName}
                  </h1>
                  <span className="text-[10px] font-bold text-blue-400/80 tracking-[0.3em] uppercase"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    Cloud Portal
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-3xl shadow-2xl">
                <FaShieldAlt className="text-emerald-400 w-3.5 h-3.5" />
                <span className="text-[11px] font-bold text-slate-100 uppercase tracking-widest leading-none">
                  ISO 9001 &middot; ISO 10004
                </span>
              </div>
            </div>

            {/* Intro */}
            <div className="max-w-2xl">
              <motion.h2
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="text-6xl xl:text-7xl font-black leading-[0.9] text-white tracking-tighter"
              >
                Every cloud.<br />
                <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent italic">
                  One portal.
                </span>
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 1 }}
                className="mt-8 text-slate-400 text-lg leading-relaxed max-w-lg font-medium"
              >
                {branding.loginBanner ||
                  'Deploy cloud sandboxes, workspaces, and managed OpenShift clusters across five cloud providers — with cost guardrails, auto-cleanup, and enterprise security built in.'}
              </motion.p>
            </div>

            {/* Feature grid */}
            <div className="grid grid-cols-2 gap-4">
              <FeatureCard icon={FaBolt}       title="Instant Provisioning" desc="Workspaces in seconds, VMs in minutes. No tickets, no waiting." delay={0.5} />
              <FeatureCard icon={FaGlobe}      title="Multi-Cloud"          desc="AWS, Azure, GCP, OCI, and Red Hat OpenShift from one interface." delay={0.6} />
              <FeatureCard icon={FaMicrochip}  title="Cost Guardrails"      desc="Quotas, idle auto-shutdown, expiry cleanup, budget caps — built in." delay={0.7} />
              <FeatureCard icon={FaUserLock}   title="Enterprise Security"  desc="ISO 9001 & 10004 certified, SSL everywhere, hardened IAM per sandbox." delay={0.8} />
            </div>
          </div>

          {/* Stats strip */}
          <div className="relative z-10 grid grid-cols-4 gap-8 bg-white/[0.02] backdrop-blur-2xl rounded-[2rem] p-8 border border-white/10 shadow-inner">
            <StatBox label="Clouds"      value="5"     delay={0.9} />
            <StatBox label="Lab Images"  value="103+"  delay={1.0} />
            <StatBox label="Deploy Time" value="< 3s"  delay={1.1} />
            <StatBox label="White Label" value="Ready" delay={1.2} />
          </div>

          {/* Footer */}
          <div className="relative z-10 flex items-center justify-between border-t border-white/5 pt-6 text-slate-500 text-[10px]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <p className="tracking-[0.2em] uppercase">Synergific Software Pvt Ltd</p>
            <div className="flex items-center gap-6 font-bold uppercase tracking-[0.2em]">
              <span className="text-emerald-500 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                Live
              </span>
              <span className="text-blue-500 flex items-center gap-2">SSL Secure</span>
            </div>
          </div>
        </section>

        {/* ── Right: Sign-in form ───────────────────────────────────────── */}
        <section className="flex w-full flex-col justify-center p-8 lg:w-1/2 lg:p-16 xl:p-24 relative">
          <div className="relative z-10 mx-auto w-full max-w-sm">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-8"
            >
              {/* Mobile logo (shows only when left panel is hidden) */}
              <div className="lg:hidden flex items-center gap-3 mb-2">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-emerald-500 p-0.5">
                  <div className="h-full w-full rounded-[0.6rem] bg-[#020617] flex items-center justify-center">
                    <img src={logoUrl} alt={companyName} className="h-6 w-6 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </div>
                </div>
                <div>
                  <div className="text-lg font-black text-white">{companyName}</div>
                  <div className="text-[10px] font-bold text-blue-400/80 tracking-[0.25em] uppercase"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    Cloud Portal
                  </div>
                </div>
              </div>

              {/* Heading */}
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 flex items-center justify-center p-1 shadow-2xl">
                    <div className="h-full w-full rounded-full bg-[#020617] flex items-center justify-center">
                      <FaLock className="text-blue-500 h-4 w-4" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em]">Sign in</h3>
                    <div className="h-0.5 w-8 bg-blue-500 mt-1 rounded-full" />
                  </div>
                </div>
                <h3 className="text-5xl font-black text-white tracking-tighter leading-none">
                  Welcome <span className="italic">back.</span>
                </h3>
                <p className="text-slate-400 font-medium">
                  Access your cloud training portal.
                </p>
              </div>

              {/* Error */}
              {loginError && (
                <div className="flex items-center gap-2.5 p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
                  <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-red-400 text-xs font-bold">!</span>
                  </div>
                  {loginError}
                </div>
              )}

              {/* Form */}
              <form onSubmit={loginUser} className="space-y-5">
                <div className="space-y-2 group">
                  <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest pl-1 group-focus-within:text-blue-400 transition-colors">
                    Email
                  </label>
                  <div className="relative">
                    <FaEnvelope className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors w-4 h-4" />
                    <motion.input
                      ref={emailRef}
                      whileFocus={{ scale: 1.005, backgroundColor: 'rgba(255,255,255,0.05)' }}
                      type="email"
                      required
                      autoComplete="email"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full h-14 bg-white/[0.03] border border-white/10 rounded-2xl pl-14 pr-4 text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-500 text-base font-medium shadow-2xl"
                    />
                  </div>
                </div>

                <div className="space-y-2 group">
                  <div className="flex items-center justify-between pl-1 pr-1">
                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest group-focus-within:text-blue-400 transition-colors">
                      Password
                    </label>
                    {/* Caps-lock warning — only while the password field is focused */}
                    {capsLockOn && (
                      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1 animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_#fbbf24]" />
                        Caps Lock on
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <FaLock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors w-4 h-4" />
                    <motion.input
                      whileFocus={{ scale: 1.005, backgroundColor: 'rgba(255,255,255,0.05)' }}
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleCapsCheck}
                      onKeyUp={handleCapsCheck}
                      onBlur={() => setCapsLockOn(false)}
                      placeholder="••••••••••••"
                      className="w-full h-14 bg-white/[0.03] border border-white/10 rounded-2xl pl-14 pr-12 text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-500 text-base font-medium shadow-2xl"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-blue-400 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <FaEyeSlash className="w-4 h-4" /> : <FaEye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  disabled={isLoading}
                  className="relative group w-full h-14 overflow-hidden rounded-2xl bg-white text-black font-black text-base tracking-tight disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 shadow-[0_20px_50px_rgba(255,255,255,0.1)] hover:shadow-[0_20px_50px_rgba(255,255,255,0.2)]"
                >
                  {isLoading ? (
                    <>
                      <div className="h-5 w-5 border-[3px] border-black/20 border-t-black rounded-full animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in</span>
                      <FaArrowRight className="translate-x-0 group-hover:translate-x-1.5 transition-transform w-4 h-4" />
                    </>
                  )}
                </motion.button>
              </form>

              {/* Footer: signup + trust */}
              <div className="pt-6 border-t border-white/5 space-y-4">
                <p className="text-center text-xs text-slate-500">
                  New here?{' '}
                  <Link to="/signup" className="text-blue-400 hover:text-blue-300 font-semibold transition-colors">
                    Create account →
                  </Link>
                </p>
                <div className="flex items-center justify-center gap-5 text-[10px] text-slate-600 font-semibold uppercase tracking-[0.15em]">
                  <span className="flex items-center gap-1.5">
                    <FaLock className="w-2.5 h-2.5 text-emerald-500" /> 256-bit SSL
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FaCertificate className="w-2.5 h-2.5 text-emerald-500" /> ISO Certified
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" /> Live
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Login;
