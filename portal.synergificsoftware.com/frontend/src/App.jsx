import './App.css'
import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import Selector from './components/Selector'
import PrivateRoute from './components/PrivateRoute'
import LabChatbot from './components/LabChatbot'
import { apiOpenRoutes, apiRoutes, superadminApiRoutes } from './services/apiRoutes'
import { BrandingProvider, useBranding } from './contexts/BrandingContext'

// Eagerly-loaded auth-flow pages (small, on the critical path)
import Login from './pages/Login'
import Logout from './pages/Logout'
import Home from './pages/Home'
import PermissionError from './pages/PermissionError'
import NotFound from './pages/NotFound'
import LabConsole from './pages/LabConsole'

// All other pages are lazy-loaded so the initial JS bundle stays small.
// Each page becomes its own JS chunk fetched on first navigation.
const Dashboard            = lazy(() => import('./pages/Dashboard'))
const VmDetails            = lazy(() => import('./pages/vmDetails'))
const BillingDetails       = lazy(() => import('./pages/BillingDetails'))
const ViewLogs             = lazy(() => import('./pages/ViewLogs'))
const Ports                = lazy(() => import('./pages/Ports'))
const CreateVM             = lazy(() => import('./pages/CreateVM'))
const Controller           = lazy(() => import('./pages/Controller'))
const Quota                = lazy(() => import('./pages/Quota'))
const DeleteLogs           = lazy(() => import('./pages/DeleteLogs'))
const DeleteTraining       = lazy(() => import('./pages/DeleteTraining'))
const Azure                = lazy(() => import('./pages/sandbox/Azure'))
const AzureUsers           = lazy(() => import('./pages/sandbox/AzureUsers'))
const AwsSandbox           = lazy(() => import('./pages/sandbox/AwsSandbox'))
const Ledger               = lazy(() => import('./pages/Ledger'))
const Account              = lazy(() => import('./pages/Account'))
const SupportPage          = lazy(() => import('./pages/Support'))
const CostAnalytics        = lazy(() => import('./pages/CostAnalytics'))
const DeployContainer      = lazy(() => import('./pages/DeployContainer'))
const TemplateManager      = lazy(() => import('./pages/TemplateManager'))
const TemplateRouting      = lazy(() => import('./pages/TemplateRouting'))
const Workshop             = lazy(() => import('./pages/Workshop'))
const Analytics            = lazy(() => import('./pages/Analytics'))
const CostOptimization     = lazy(() => import('./pages/CostOptimization'))
const DeployRDS            = lazy(() => import('./pages/DeployRDS'))
const GcpSandbox           = lazy(() => import('./pages/sandbox/GcpSandbox'))
const GcpUsers             = lazy(() => import('./pages/sandbox/GcpUsers'))
const OciSandbox           = lazy(() => import('./pages/sandbox/OciSandbox'))
const Signup               = lazy(() => import('./pages/Signup'))
const ForgotPassword       = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword        = lazy(() => import('./pages/ResetPassword'))
const OrgLanding           = lazy(() => import('./pages/OrgLanding'))
const SelfServiceDashboard = lazy(() => import('./pages/SelfServiceDashboard'))
const CourseCatalog        = lazy(() => import('./pages/CourseCatalog'))
const CourseDetail         = lazy(() => import('./pages/CourseDetail'))
const MySandboxes          = lazy(() => import('./pages/MySandboxes'))
const AccessControl        = lazy(() => import('./pages/AccessControl'))
const GuidedLabs           = lazy(() => import('./pages/GuidedLabs'))
const GuidedLabEditor      = lazy(() => import('./pages/GuidedLabEditor'))
const GuidedLabAnalytics   = lazy(() => import('./pages/GuidedLabAnalytics'))
const TocLabSuiteEditor    = lazy(() => import('./pages/TocLabSuiteEditor'))
const SandboxTemplateBuilder = lazy(() => import('./pages/SandboxTemplateBuilder'))
const RosaCluster          = lazy(() => import('./pages/RosaCluster'))
const AroCluster           = lazy(() => import('./pages/AroCluster'))
const CreateFreshVM        = lazy(() => import('./pages/CreateFreshVM'))
const B2BCourseDetail      = lazy(() => import('./pages/b2b/B2BCourseDetail'))
const B2BCourseAnalyses    = lazy(() => import('./pages/b2b/B2BCourseAnalyses'))

// Tiny fallback shown while a lazy route's chunk is fetching.
// Plain centered spinner — keeps perceived latency low without a layout shift.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );
}

// ── Light splash screen after login ──────────────────────────────────────
const SPLASH_CSS = `
  @keyframes sp-fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sp-fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes sp-drift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes sp-orb1 {
    0%   { transform: translate(0,0) scale(1); }
    33%  { transform: translate(50px,-30px) scale(1.08); }
    66%  { transform: translate(-25px,40px) scale(0.95); }
    100% { transform: translate(0,0) scale(1); }
  }
  @keyframes sp-orb2 {
    0%   { transform: translate(0,0) scale(1); }
    33%  { transform: translate(-40px,25px) scale(1.05); }
    66%  { transform: translate(35px,-50px) scale(0.92); }
    100% { transform: translate(0,0) scale(1); }
  }
  @keyframes sp-orb3 {
    0%   { transform: translate(0,0) scale(1); }
    33%  { transform: translate(25px,35px) scale(1.06); }
    66%  { transform: translate(-40px,-15px) scale(0.94); }
    100% { transform: translate(0,0) scale(1); }
  }
  @keyframes sp-logoIn {
    from { opacity: 0; transform: scale(0.7); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes sp-ringDraw {
    from { stroke-dashoffset: 352; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes sp-ringPulse {
    0%, 100% { filter: drop-shadow(0 0 3px rgba(79,70,229,0.15)); }
    50%      { filter: drop-shadow(0 0 10px rgba(79,70,229,0.3)); }
  }
  @keyframes sp-textUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes sp-barFill {
    from { width: 0%; }
    to   { width: 100%; }
  }
  @keyframes sp-pulse {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 1; }
  }
  @keyframes sp-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-8px); }
  }
`;

function SplashScreen({ userDetails, fadeOut }) {
  const firstName = (userDetails?.email || '').split('@')[0].split(/[._-]/)[0];
  const displayName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : '';
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      style={{
        fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
        background: 'linear-gradient(135deg, #f0f4ff 0%, #e8eeff 30%, #f5f0ff 60%, #fdf2f8 100%)',
        backgroundSize: '200% 200%',
        animation: fadeOut
          ? 'sp-fadeOut 0.4s ease-in forwards'
          : 'sp-drift 12s ease infinite, sp-fadeIn 0.3s ease-out',
      }}
    >
      <style>{SPLASH_CSS}</style>

      {/* Soft gradient orbs */}
      <div className="absolute pointer-events-none" style={{
        width: 500, height: 500, top: '-5%', left: '-10%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        filter: 'blur(40px)',
        animation: 'sp-orb1 14s ease-in-out infinite',
      }} />
      <div className="absolute pointer-events-none" style={{
        width: 450, height: 450, bottom: '-5%', right: '-10%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)',
        filter: 'blur(40px)',
        animation: 'sp-orb2 16s ease-in-out infinite',
      }} />
      <div className="absolute pointer-events-none" style={{
        width: 350, height: 350, top: '50%', left: '50%',
        marginTop: -175, marginLeft: -175,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(236,72,153,0.07) 0%, transparent 70%)',
        filter: 'blur(40px)',
        animation: 'sp-orb3 18s ease-in-out infinite',
      }} />

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center" style={{
        animation: 'sp-float 4s ease-in-out infinite',
      }}>

        {/* Logo with circular progress ring */}
        <div className="relative" style={{
          width: 110, height: 110,
          animation: 'sp-logoIn 0.7s cubic-bezier(0.16,1,0.3,1) both',
          marginBottom: 28,
        }}>
          {/* Progress ring SVG */}
          <svg className="absolute inset-0" width="110" height="110" viewBox="0 0 110 110" style={{
            animation: 'sp-ringPulse 2.5s ease-in-out infinite',
          }}>
            <circle cx="55" cy="55" r="52" fill="none" stroke="rgba(99,102,241,0.08)" strokeWidth="2" />
            <circle cx="55" cy="55" r="52" fill="none"
              stroke="url(#sp-grad)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray="327" strokeDashoffset="327"
              style={{
                animation: 'sp-ringDraw 2.4s cubic-bezier(0.4,0,0.2,1) 0.3s forwards',
                transformOrigin: 'center',
                transform: 'rotate(-90deg)',
              }}
            />
            <defs>
              <linearGradient id="sp-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="50%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>

          {/* Inner frosted circle with logo */}
          <div className="absolute inset-0 flex items-center justify-center" style={{ padding: 10 }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.8)',
              boxShadow: '0 8px 32px rgba(99,102,241,0.08), 0 2px 8px rgba(0,0,0,0.03)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <img src="/logo/logo.png" alt="" style={{
                height: 40, width: 40, objectFit: 'contain',
              }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          </div>
        </div>

        {/* Welcome text */}
        <h2 style={{
          fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em',
          color: '#1e293b', marginBottom: 6,
          animation: 'sp-textUp 0.6s ease-out 0.3s both',
        }}>
          {displayName ? `Welcome, ${displayName}` : 'Welcome'}
        </h2>
        <p style={{
          fontSize: 14, color: '#94a3b8',
          fontWeight: 400,
          animation: 'sp-textUp 0.6s ease-out 0.5s both',
          marginBottom: 32,
        }}>
          Preparing your workspace
        </p>

        {/* Progress bar */}
        <div style={{
          width: 200, height: 3, borderRadius: 4,
          background: 'rgba(99,102,241,0.08)',
          overflow: 'hidden',
          animation: 'sp-textUp 0.6s ease-out 0.6s both',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0,
            height: '100%', borderRadius: 4,
            background: 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)',
            animation: 'sp-barFill 2.4s cubic-bezier(0.4,0,0.2,1) 0.4s forwards',
            width: '0%',
          }} />
        </div>

        {/* Status text */}
        <p style={{
          fontSize: 11, color: '#cbd5e1',
          marginTop: 14, fontWeight: 400,
          animation: 'sp-pulse 2s ease-in-out infinite',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          Loading
        </p>
      </div>
    </div>
  );
}

function AppInner() {
  // JWT tenant-host check removed — was causing unwanted auto-logouts for superadmin users.

  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("uid"));
  const [userDetails, setUserDetails] = useState({ organization: "", email: "", userType: "" });
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [splashFadeOut, setSplashFadeOut] = useState(false);
  const navigate = useNavigate();
  const { fetchBranding, resetBranding } = useBranding();

  // Auto-logout after 15 minutes of inactivity.
  //
  // The previous version of this effect had three bugs that in practice
  // kept users logged in forever:
  //   1. 'mousemove' was in the event list. Every pixel of cursor movement
  //      fired a handler that reset the timer — so the timer effectively
  //      never reached the 15-min mark as long as the mouse was alive.
  //      Fix: rely on real interaction (click / key / scroll / touch) only.
  //   2. The inner "final logout" setTimeout wasn't stored in a ref, so
  //      nothing could cancel it. Clicking "Stay logged in" didn't stop
  //      the already-scheduled logout.
  //   3. The `if (idleTimer.current)` guard inside the inner timer was
  //      always truthy (clearTimeout doesn't null the ref). Dead code.
  const IDLE_TIMEOUT = 15 * 60 * 1000;        // total inactivity → logout (15 min)
  const IDLE_WARN_AT = 13 * 60 * 1000;        // show warning here (13 min) — 2-min grace
  const warnTimer = useRef(null);
  const logoutTimer = useRef(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);

  const clearIdleTimers = useCallback(() => {
    if (warnTimer.current)   { clearTimeout(warnTimer.current);   warnTimer.current = null; }
    if (logoutTimer.current) { clearTimeout(logoutTimer.current); logoutTimer.current = null; }
  }, []);

  const resetIdleTimer = useCallback(() => {
    setShowIdleWarning(false);
    clearIdleTimers();
    if (!isLoggedIn) return;

    warnTimer.current = setTimeout(() => {
      setShowIdleWarning(true);
      logoutTimer.current = setTimeout(() => {
        localStorage.clear();
        setIsLoggedIn(false);
        setUserDetails(null);
        navigate("/login");
      }, IDLE_TIMEOUT - IDLE_WARN_AT);  // 2 min after warning
    }, IDLE_WARN_AT);
  }, [isLoggedIn, navigate, clearIdleTimers]);

  useEffect(() => {
    if (!isLoggedIn) return;
    // Superadmin sessions never expire — they manage the platform and need
    // uninterrupted access regardless of inactivity period.
    if (userDetails?.userType === 'superadmin') return;
    // Real-interaction events only. Explicitly NOT mousemove — it fires
    // constantly on a live cursor and defeats the timer.
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => resetIdleTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetIdleTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      clearIdleTimers();
    };
  }, [isLoggedIn, userDetails?.userType, resetIdleTimer, clearIdleTimers]);

  useEffect(() => {
    if (isLoggedIn) {
      const details = getUserDetails();
      setUserDetails(details);
      fetchBranding(details.organization);
    } else {
      resetBranding();
      // Don't redirect if already on login, signup, or a public org landing page
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/signup' && !path.startsWith('/welcome/')) {
        navigate("/login");
      }
    }
  }, [isLoggedIn, navigate, fetchBranding, resetBranding]);

  const handleLogout = () => {
    localStorage.clear();
    setIsLoggedIn(false);
    setUserDetails(null);
    resetBranding();
    navigate("/login");
  };

  const getUserDetails = () => ({
    organization: localStorage.getItem("organization") || "Unknown",
    email: localStorage.getItem("email") || "Unknown",
    userType: (() => {
      const userType = localStorage.getItem("AH1apq12slurt5");
      if (userType === "z829Sgry6AkYJ") return "admin";
      if (userType === "hpQ3s5dK247") return "superadmin";
      if (userType === "h1Qjasd233jd") return "sandboxuser";
      if (userType === "sS3lf5v1cE2b") return "selfservice";
      return "user";
    })()
  });

  const RoleBasedRoute = ({ allowedRoles, element }) => {
    return allowedRoles.includes(userDetails.userType) ? element : <PermissionError />;
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
    const details = getUserDetails();
    setUserDetails(details);
    // Show splash for 3 seconds, then navigate
    setShowSplash(true);
    setSplashFadeOut(false);
    setTimeout(() => {
      setSplashFadeOut(true);
      setTimeout(() => {
        setShowSplash(false);
        setSplashFadeOut(false);
        navigate(details.userType === 'selfservice' ? '/my-labs' : '/');
      }, 400); // fade-out duration
    }, 2600); // visible duration (total ~3s)
  };

  const sidebarWidth = sidebarCollapsed ? 72 : 260;
  const { pathname } = useLocation();
  const isAuthPage = pathname === '/login' || pathname === '/signup' || pathname.startsWith('/welcome/');
  const showChrome = isLoggedIn && !isAuthPage;

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Post-login splash screen */}
      {showSplash && <SplashScreen userDetails={userDetails} fadeOut={splashFadeOut} />}

      {showChrome && (
        <Sidebar
          userDetails={userDetails}
          onLogout={handleLogout}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />
      )}

      <div
        className="min-h-screen transition-all duration-300"
        style={{ marginLeft: showChrome ? sidebarWidth : 0 }}
      >
        {showChrome && <Navbar userDetails={userDetails} />}

        <main className={showChrome ? "px-6 py-5" : ""}>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login onLogin={handleLogin} apiRoutes={apiRoutes} />} />
            <Route path="/logout" element={<Logout setIsLoggedIn={setIsLoggedIn} setUserDetails={setUserDetails} />} />
            <Route path="/signup" element={<Signup onLogin={handleLogin} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password/:token" element={<ResetPassword />} />
            <Route path="/welcome/:orgSlug" element={<OrgLanding />} />
            <Route path="/lab/:vmName" element={<PrivateRoute isLoggedIn={isLoggedIn}><LabConsole /></PrivateRoute>} />

            <Route path="/" element={<PrivateRoute isLoggedIn={isLoggedIn}><Home userDetails={userDetails} /></PrivateRoute>} />
            <Route path="/dashboard" element={<PrivateRoute isLoggedIn={isLoggedIn}><Dashboard apiOpenRoutes={apiOpenRoutes} userDetails={userDetails} /></PrivateRoute>} />

            <Route path="/vm/*" element={<PrivateRoute isLoggedIn={isLoggedIn}><Selector userDetails={userDetails} apiRoutes={apiRoutes} setSelectedTraining={setSelectedTraining} setSelectedUser={setSelectedUser} /></PrivateRoute>}>
              <Route path="vmdetails" element={<VmDetails userDetails={userDetails} selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />
              <Route path='billing' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<BillingDetails selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='logs' element={<ViewLogs selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />
              <Route path='ports' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<Ports selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='quota' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<Quota selectedTraining={selectedTraining} superadminApiRoutes={superadminApiRoutes} />} />} />
              <Route path='deletelogs' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<DeleteLogs selectedTraining={selectedTraining} superadminApiRoutes={superadminApiRoutes} />} />} />
              <Route path='deletetraining' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<DeleteTraining selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
            </Route>

            <Route path='/sandbox/azure' element={<RoleBasedRoute allowedRoles={['sandboxuser']} element={<Azure userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path='/sandbox/azure/users' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AzureUsers userDetails={userDetails} apiRoutes={apiRoutes} superadminApiRoutes={superadminApiRoutes} />} />} />
            <Route path='/sandbox/aws/users' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AwsSandbox userDetails={userDetails} superadminApiRoutes={superadminApiRoutes} />} />} />
            <Route path='/sandbox/gcp' element={<RoleBasedRoute allowedRoles={['sandboxuser']} element={<GcpSandbox userDetails={userDetails} />} />} />
            <Route path='/sandbox/gcp/users' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<GcpUsers userDetails={userDetails} />} />} />
            <Route path='/sandbox/oci-sandbox' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<OciSandbox userDetails={userDetails} />} />} />

            <Route path='/createvm' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<CreateVM userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path='/create-fresh-vm' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<CreateFreshVM userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path='/containers' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<DeployContainer userDetails={userDetails} />} />} />
            <Route path='/templates' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<TemplateManager />} />} />
            <Route path='/template-routing' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<TemplateRouting />} />} />
            <Route path='/workshop' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<Workshop />} />} />
            <Route path='/rds' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<DeployRDS userDetails={userDetails} />} />} />
            <Route path='/overview' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<Controller superadminApiRoutes={superadminApiRoutes} />} />} />
            <Route path='/admin/access-control' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AccessControl />} />} />

            <Route path="/costs" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<CostAnalytics />} />} />
            <Route path="/analytics" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<Analytics />} />} />
            <Route path="/optimize" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<CostOptimization />} />} />
            <Route path="/ledger" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<Ledger userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path="/ledger/account" element={<RoleBasedRoute allowedRoles={["superadmin", "admin"]} element={<Account userDetails={userDetails} apiRoutes={apiRoutes} />} />} />

            {/* Self-service B2C */}
            <Route path="/my-labs" element={<PrivateRoute isLoggedIn={isLoggedIn}><SelfServiceDashboard /></PrivateRoute>} />

            {/* Student sandbox view — non-admin users see their admin-deployed sandboxes */}
            <Route path="/my-sandboxes" element={<PrivateRoute isLoggedIn={isLoggedIn}><RoleBasedRoute allowedRoles={['user', 'sandboxuser']} element={<MySandboxes />} /></PrivateRoute>} />

            {/* Course catalog — available to all authenticated users */}
            <Route path="/courses" element={<PrivateRoute isLoggedIn={isLoggedIn}><CourseCatalog /></PrivateRoute>} />
            <Route path="/courses/:slug" element={<PrivateRoute isLoggedIn={isLoggedIn}><CourseDetail /></PrivateRoute>} />


            <Route path="/support" element={<PrivateRoute isLoggedIn={isLoggedIn}><SupportPage /></PrivateRoute>} />

            {/* Guided Labs */}
            <Route path='/guided-labs' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<GuidedLabs />} />} />
            <Route path='/guided-labs/editor' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<GuidedLabEditor />} />} />
            <Route path='/guided-labs/editor/:id' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<GuidedLabEditor />} />} />
            <Route path='/guided-labs/analytics/:id' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<GuidedLabAnalytics />} />} />
            <Route path='/guided-labs/toc-suite' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<TocLabSuiteEditor />} />} />

            {/* ROSA & ARO */}
            <Route path='/rosa' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<RosaCluster />} />} />
            <Route path='/aro' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AroCluster />} />} />

            {/* B2B Courses */}
            <Route path='/b2b/courses' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<B2BCourseAnalyses />} />} />
            <Route path='/b2b/courses/:id' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<B2BCourseDetail />} />} />

            {/* Sandbox Template Builder */}
            <Route path='/sandbox-builder' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<SandboxTemplateBuilder />} />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </main>

        {/* Idle timeout warning */}
        {showIdleWarning && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white text-center py-2.5 text-sm font-medium shadow-lg">
            You'll be logged out in 2 minutes due to inactivity.
            <button onClick={resetIdleTimer} className="ml-3 underline font-semibold hover:no-underline">Stay logged in</button>
          </div>
        )}

        {showChrome && <LabChatbot />}
      </div>
    </div>
  )
}

function App() {
  return (
    <BrandingProvider>
      <AppInner />
    </BrandingProvider>
  );
}

export default App
