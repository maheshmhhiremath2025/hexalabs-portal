import './App.css'
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Selector from './components/Selector'
import VmDetails from './pages/vmDetails'
import Login from './pages/Login'
import PrivateRoute from './components/PrivateRoute'
import { apiOpenRoutes, apiRoutes, superadminApiRoutes } from './services/apiRoutes'
import BillingDetails from './pages/BillingDetails'
import PermissionError from './pages/PermissionError'
import ViewLogs from './pages/ViewLogs'
import Ports from './pages/Ports'
import Scheduler from './pages/Scheduler'
import CreateVM from './pages/CreateVM'
import AccessRestriction from './pages/AccessRestriction'
import Controller from './pages/Controller'
import Quota from './pages/Quota'
import DeleteLogs from './pages/DeleteLogs'
import DeleteTraining from './pages/DeleteTraining'
import Azure from './pages/sandbox/Azure'
import AzureUsers from './pages/sandbox/AzureUsers'
import AwsSandbox from './pages/sandbox/AwsSandbox'
import Ledger from './pages/Ledger'
import Account from './pages/Account'
import SupportPage from './pages/Support'
import Chatbot from './components/Chatbot'
import LabChatbot from './components/LabChatbot'
import NotFound from './pages/NotFound'
import CostAnalytics from './pages/CostAnalytics'
import DeployContainer from './pages/DeployContainer'
import Analytics from './pages/Analytics'
import CostOptimization from './pages/CostOptimization'
import DeployRDS from './pages/DeployRDS'
import GcpSandbox from './pages/sandbox/GcpSandbox'
import GcpUsers from './pages/sandbox/GcpUsers'
import OciSandbox from './pages/sandbox/OciSandbox'
import Signup from './pages/Signup'
import GuidedLabDetail from './pages/GuidedLabDetail'
import SelfServiceDashboard from './pages/SelfServiceDashboard'
import CourseCatalog from './pages/CourseCatalog'
import CourseDetail from './pages/CourseDetail'
import B2BCourseAnalyses from './pages/b2b/B2BCourseAnalyses'
import B2BCourseDetail from './pages/b2b/B2BCourseDetail'
import MySandboxes from './pages/MySandboxes'
import RosaCluster from './pages/RosaCluster'
import AroCluster from './pages/AroCluster'
import { BrandingProvider, useBranding } from './contexts/BrandingContext'

function AppInner() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem("uid"));
  const [userDetails, setUserDetails] = useState({ organization: "", email: "", userType: "" });
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [selectedUser, setSelectedUser] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();
  const { fetchBranding, resetBranding } = useBranding();

  // Auto-logout after 15 minutes of inactivity
  const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  const idleTimer = useRef(null);
  const [showIdleWarning, setShowIdleWarning] = useState(false);

  const resetIdleTimer = useCallback(() => {
    setShowIdleWarning(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (!isLoggedIn) return;

    // Show warning at 13 minutes, logout at 15
    idleTimer.current = setTimeout(() => {
      setShowIdleWarning(true);
      setTimeout(() => {
        if (idleTimer.current) {
          localStorage.clear();
          setIsLoggedIn(false);
          setUserDetails(null);
          navigate("/login");
        }
      }, 2 * 60 * 1000); // 2 more minutes before actual logout
    }, IDLE_TIMEOUT - 2 * 60 * 1000); // warn at 13 min
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    const handler = () => resetIdleTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetIdleTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [isLoggedIn, resetIdleTimer]);

  useEffect(() => {
    if (isLoggedIn) {
      const details = getUserDetails();
      setUserDetails(details);
      fetchBranding(details.organization);
    } else {
      resetBranding();
      // Don't redirect if already on login or signup
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/signup') {
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
    // Selfservice users go to their dashboard, not home
    navigate(details.userType === 'selfservice' ? '/my-labs' : '/');
  };

  const sidebarWidth = sidebarCollapsed ? 72 : 260;
  const { pathname } = useLocation();
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const showChrome = isLoggedIn && !isAuthPage;

  return (
    <div className="min-h-screen bg-surface-50">
      {showChrome && (
        <Sidebar
          userDetails={userDetails}
          onLogout={handleLogout}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />
      )}

      <div
        className="min-h-screen transition-all duration-200"
        style={{ marginLeft: showChrome ? sidebarWidth : 0 }}
      >
        {showChrome && <Navbar userDetails={userDetails} />}

        <main className={showChrome ? "px-6 py-5" : ""}>
          <Routes>
            <Route path="/login" element={<Login onLogin={handleLogin} apiRoutes={apiRoutes} />} />
            <Route path="/signup" element={<Signup onLogin={handleLogin} />} />

            <Route path="/" element={<PrivateRoute isLoggedIn={isLoggedIn}><Home userDetails={userDetails} /></PrivateRoute>} />
            <Route path="/dashboard" element={<PrivateRoute isLoggedIn={isLoggedIn}><Dashboard apiOpenRoutes={apiOpenRoutes} userDetails={userDetails} /></PrivateRoute>} />

            <Route path="/vm/*" element={<PrivateRoute isLoggedIn={isLoggedIn}><Selector userDetails={userDetails} apiRoutes={apiRoutes} setSelectedTraining={setSelectedTraining} setSelectedUser={setSelectedUser} /></PrivateRoute>}>
              <Route path="vmdetails" element={<VmDetails userDetails={userDetails} selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />
              <Route path='billing' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<BillingDetails selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='logs' element={<ViewLogs selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />
              <Route path='ports' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<Ports selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='scheduler' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<Scheduler selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='restriction' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AccessRestriction selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
              <Route path='quota' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<Quota selectedTraining={selectedTraining} superadminApiRoutes={superadminApiRoutes} />} />} />
              <Route path='deletelogs' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<DeleteLogs selectedTraining={selectedTraining} superadminApiRoutes={superadminApiRoutes} />} />} />
              <Route path='deletetraining' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<DeleteTraining selectedTraining={selectedTraining} apiRoutes={apiRoutes} />} />} />
            </Route>

            <Route path='/sandbox/azure' element={<RoleBasedRoute allowedRoles={['sandboxuser']} element={<Azure userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path='/sandbox/azure/users' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<AzureUsers userDetails={userDetails} apiRoutes={apiRoutes} superadminApiRoutes={superadminApiRoutes} />} />} />
            <Route path='/sandbox/aws/users' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<AwsSandbox superadminApiRoutes={superadminApiRoutes} />} />} />
            <Route path='/sandbox/gcp' element={<RoleBasedRoute allowedRoles={['sandboxuser']} element={<GcpSandbox userDetails={userDetails} />} />} />
            <Route path='/sandbox/gcp/users' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<GcpUsers />} />} />
            <Route path='/sandbox/oci-sandbox' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<OciSandbox />} />} />
            <Route path='/rosa' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<RosaCluster />} />} />
            <Route path='/aro' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<AroCluster />} />} />

            <Route path='/createvm' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<CreateVM userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path='/containers' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<DeployContainer userDetails={userDetails} />} />} />
            <Route path='/rds' element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<DeployRDS userDetails={userDetails} />} />} />
            <Route path='/overview' element={<RoleBasedRoute allowedRoles={['superadmin']} element={<Controller superadminApiRoutes={superadminApiRoutes} />} />} />

            <Route path="/costs" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<CostAnalytics />} />} />
            <Route path="/analytics" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<Analytics />} />} />
            <Route path="/optimize" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<CostOptimization />} />} />
            <Route path="/ledger" element={<RoleBasedRoute allowedRoles={["superadmin"]} element={<Ledger userDetails={userDetails} apiRoutes={apiRoutes} />} />} />
            <Route path="/ledger/account" element={<RoleBasedRoute allowedRoles={["superadmin", "admin"]} element={<Account userDetails={userDetails} apiRoutes={apiRoutes} />} />} />

            {/* Self-service B2C */}
            <Route path="/my-labs" element={<PrivateRoute isLoggedIn={isLoggedIn}><SelfServiceDashboard /></PrivateRoute>} />
            <Route path="/lab/:slug" element={<PrivateRoute isLoggedIn={isLoggedIn}><GuidedLabDetail /></PrivateRoute>} />

            {/* Student sandbox view — non-admin users see their admin-deployed sandboxes */}
            <Route path="/my-sandboxes" element={<PrivateRoute isLoggedIn={isLoggedIn}><RoleBasedRoute allowedRoles={['user', 'sandboxuser']} element={<MySandboxes />} /></PrivateRoute>} />

            {/* Course catalog — available to all authenticated users */}
            <Route path="/courses" element={<PrivateRoute isLoggedIn={isLoggedIn}><CourseCatalog /></PrivateRoute>} />
            <Route path="/courses/:slug" element={<PrivateRoute isLoggedIn={isLoggedIn}><CourseDetail /></PrivateRoute>} />

            {/* B2B course analyses (admin/superadmin) — upload PDF → feasibility, cost, template */}
            <Route path="/b2b/courses" element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<B2BCourseAnalyses />} />} />
            <Route path="/b2b/courses/:id" element={<RoleBasedRoute allowedRoles={['admin', 'superadmin']} element={<B2BCourseDetail />} />} />

            <Route path="/support" element={<PrivateRoute isLoggedIn={isLoggedIn}><SupportPage /></PrivateRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
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
