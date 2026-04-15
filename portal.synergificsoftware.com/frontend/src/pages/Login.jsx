import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import {
  FaEye, FaEyeSlash, FaCloud, FaDocker, FaAws, FaMicrosoft, FaGoogle,
  FaServer, FaRobot, FaShieldAlt, FaCubes, FaWindows, FaChartLine,
  FaDatabase, FaCertificate, FaLock,
} from 'react-icons/fa';

const Login = ({ onLogin, apiRoutes }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { branding, fetchPublicBranding } = useBranding();
  const [searchParams] = useSearchParams();

  // If ?org=xxx is in the URL, fetch that org's branding (public endpoint)
  useEffect(() => {
    const orgParam = searchParams.get('org');
    if (orgParam) {
      fetchPublicBranding(orgParam);
    }
  }, [searchParams, fetchPublicBranding]);

  const loginUser = async (e) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setLoginError(null);
      const response = await apiCaller.post(apiRoutes.loginApi, { email: username, password });

      if (response.status === 200) {
        const { email, AH1apq12slurt5, organization, uid } = response.data;
        localStorage.setItem("email", email);
        localStorage.setItem("AH1apq12slurt5", AH1apq12slurt5);
        localStorage.setItem("organization", organization);
        localStorage.setItem("uid", uid);
        onLogin();
      } else {
        setLoginError(`Login failed. ${response.data.message}`);
      }
    } catch (error) {
      setLoginError(error.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-50">
      {/* Left panel — platform showcase */}
      <div className="hidden lg:flex lg:w-[52%] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex-col justify-between px-12 py-10 relative overflow-hidden">
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        {/* Gradient glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />

        <div className="relative z-10">
          <img
            src={branding.logoUrl || '/logo/synergificsoftware-logo.png'}
            onError={(e) => { e.currentTarget.src = '/logo/synergificsoftware-logo.png'; }}
            alt={branding.companyName || 'Synergific'}
            className="h-10 object-contain"
          />
        </div>

        <div className="relative z-10 flex-1 flex flex-col justify-center -mt-8">
          {/* ISO Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 border border-white/15 rounded-full text-[11px] text-blue-200 mb-6 w-fit">
            <FaCertificate className="w-3 h-3 text-green-400" />
            ISO 9001:2015 & ISO 10004:2018 Certified
          </div>

          {branding.loginBanner ? (
            <h1 className="text-3xl font-bold tracking-tight leading-tight">
              {branding.loginBanner}
            </h1>
          ) : (
            <h1 className="text-3xl font-bold tracking-tight leading-tight">
              One platform.<br />
              <span style={{ color: branding.primaryColor }}>Every cloud lab.</span>
            </h1>
          )}
          <p className="text-slate-400 text-sm leading-relaxed mt-4 max-w-md">
            Deploy cloud sandboxes, workspaces, and managed OpenShift clusters across 5 cloud providers. 33+ pre-built lab images. Instant provisioning. Auto-cleanup.
          </p>

          {/* Offering grid */}
          <div className="grid grid-cols-3 gap-2.5 mt-8">
            <OfferingChip icon={FaAws} label="AWS Sandboxes" color="text-[#FF9900]" />
            <OfferingChip icon={FaMicrosoft} label="Azure Labs" color="text-[#0078d4]" />
            <OfferingChip icon={FaGoogle} label="GCP Projects" color="text-[#4285F4]" />
            <OfferingChip icon={FaDatabase} label="OCI Sandboxes" color="text-[#F80000]" />
            <OfferingChip icon={FaCubes} label="OpenShift (ROSA/ARO)" color="text-[#EE0000]" />
            <OfferingChip icon={FaDocker} label="Workspaces" color="text-[#2496ED]" />
            <OfferingChip icon={FaWindows} label="Windows Desktop" color="text-[#00BCF2]" />
            <OfferingChip icon={FaShieldAlt} label="Cybersecurity Labs" color="text-emerald-400" />
            <OfferingChip icon={FaRobot} label="AI Course Analyzer" color="text-violet-400" />
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-6 mt-8 pt-6 border-t border-white/10">
            <LoginStat value="5" label="Cloud providers" />
            <LoginStat value="33+" label="Lab images" />
            <LoginStat value="10s" label="Deploy time" />
            <LoginStat value="500+" label="Active users" />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            {branding.companyName && branding.companyName !== 'Synergific'
              ? `Powered by ${branding.companyName}`
              : 'Powered by Synergific Software'}
          </span>
          <div className="flex items-center gap-3 text-[10px] text-slate-600">
            <span className="flex items-center gap-1"><FaCertificate className="text-green-500" /> ISO 9001</span>
            <span className="flex items-center gap-1"><FaCertificate className="text-green-500" /> ISO 10004</span>
            <span className="flex items-center gap-1"><FaLock className="text-slate-500" /> SSL</span>
          </div>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div className="flex-1 flex flex-col bg-gray-50/50">
        {/* Top bar — sign up link */}
        <div className="flex justify-end px-8 py-5">
          <span className="text-sm text-gray-500">
            New here?{' '}
            <Link to="/signup" className="text-blue-600 font-semibold hover:text-blue-700 transition-colors">Create account →</Link>
          </span>
        </div>

        {/* Centered form */}
        <div className="flex-1 flex items-center justify-center px-8 pb-12">
          <div className="w-full max-w-sm">
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-10">
              <img
                src="/logo/logo.png"
                onError={(e) => { e.currentTarget.src = '/logo/logo.png'; }}
                alt={branding.companyName || 'Synergific'}
                className="h-12 object-contain mx-auto"
              />
            </div>

            {/* Greeting */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back</h2>
              <p className="text-gray-500 text-sm mt-1.5">Enter your credentials to access your portal</p>
            </div>

            {/* Error */}
            {loginError && (
              <div className="mb-5 flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-red-500 text-xs font-bold">!</span>
                </div>
                {loginError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={loginUser} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder-gray-400"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder-gray-400 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <FaEyeSlash className="text-sm" /> : <FaEye className="text-sm" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white rounded-xl shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-2"
                style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.accentColor})` }}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in...
                  </>
                ) : 'Sign in'}
              </button>
            </form>

            {/* Trust signals */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-center gap-5">
                <TrustBadge icon={FaLock} label="256-bit SSL" />
                <TrustBadge icon={FaCertificate} label="ISO Certified" />
                <TrustBadge icon={FaServer} label="99.9% Uptime" />
              </div>
            </div>

            <p className="text-center text-[11px] text-gray-400 mt-6">
              {branding.companyName || 'Synergific'} Cloud Portal
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

function TrustBadge({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3 h-3 text-gray-400" />
      <span className="text-[11px] text-gray-500 font-medium">{label}</span>
    </div>
  );
}

function OfferingChip({ icon: Icon, label, color }) {
  return (
    <div className="flex items-center gap-2.5 bg-white/5 border border-white/8 rounded-lg px-3 py-2.5 hover:bg-white/10 transition-colors">
      <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
      <span className="text-xs font-medium text-slate-300 truncate">{label}</span>
    </div>
  );
}

function LoginStat({ value, label }) {
  return (
    <div>
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

export default Login;
