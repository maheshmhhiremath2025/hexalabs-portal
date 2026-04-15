// Controller.jsx - Final fixed version
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import apiCaller from '../services/apiCaller';
import { AssignVmCardModal } from '../components/modal/AssignTemplate';
import { CreateVmCardModal } from '../components/modal/CreateTemplate';
import { CreateUserModal } from '../components/modal/CreateUser';
import { CreateOrganizationModal } from '../components/modal/CreateOrganization';
import Table from '../components/Table';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import debounce from 'lodash.debounce';

// ------------------ Enhanced hooks & components ------------------
const useLocalStorage = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : initialValue; } catch { return initialValue; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue];
};

const Card = ({ children, className }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
    className={clsx(
      "rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200",
      className
    )}
  >
    {children}
  </motion.div>
);

const KPICard = ({ label, value, sub, icon }) => (
  <Card className="p-6 hover:shadow-sm transition-all duration-300">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600 uppercase tracking-wide">
          {icon && <span className="text-slate-400">{icon}</span>}
          {label}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <div className="text-xl font-semibold text-gray-900">{value}</div>
        </div>
        {sub && <div className="mt-2 text-sm text-slate-500">{sub}</div>}
      </div>
      <div className="opacity-10 transform scale-150">
        {icon}
      </div>
    </div>
  </Card>
);

const LoadingRows = ({ rows = 4 }) => (
  <div className="p-6 space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-4">
        <div className="h-4 w-4 rounded bg-slate-200 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 rounded bg-slate-200 animate-pulse" style={{ animationDelay: `${i * 0.1}s` }} />
          <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 0.1 + 0.1}s` }} />
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ title = 'No data available', hint, icon, action }) => (
  <div className="p-8 text-center">
    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-4">
      {icon || '📊'}
    </div>
    <div className="text-sm font-medium text-slate-900">{title}</div>
    {hint && <div className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">{hint}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="p-6">
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
            <span className="text-red-500 text-sm">!</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-red-800">{message || 'Something went wrong'}</div>
        </div>
        {onRetry && (
          <button 
            onClick={onRetry}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  </div>
);

const SectionHeader = ({ title, count, collapsible, collapsed, onToggle, icon }) => (
  <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
    <div className="flex items-center gap-3">
      {icon && <div className="text-slate-400">{icon}</div>}
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      {typeof count === 'number' && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-600">
          {count}
        </span>
      )}
    </div>
    <div className="ml-auto flex items-center gap-3">
      {collapsible && (
        <button
          onClick={onToggle}
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors duration-200"
        >
          <span>{collapsed ? 'Expand' : 'Collapse'}</span>
          <motion.svg
            animate={{ rotate: collapsed ? 0 : 180 }}
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </button>
      )}
    </div>
  </div>
);

// ------------------ main component ------------------
const Controller = ({ superadminApiRoutes }) => {
  // Modal state
  const [createUserModalVisible, setCreateUserModalVisible] = useState(false);
  const [createOrganizationModalVisible, setCreateOrganizationModalVisible] = useState(false);
  const [createVmCardModalVisible, setCreateVmCardModalVisible] = useState(false);
  const [AssignVmCardModalVisible, setAssignVmCardModalVisible] = useState(false);

  // Data stores - ALL data (unfiltered)
  const [allOrganizations, setAllOrganizations] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allTemplates, setAllTemplates] = useState([]);
  const [allAssigned, setAllAssigned] = useState([]);

  // Filtered data (for display)
  const [organization, setOrganization] = useState([]);
  const [userList, setUserList] = useState([]);
  const [templatesList, setTemplatesList] = useState([]);
  const [assignedList, setAssignedList] = useState([]);

  // Single search state
  const [searchQuery, setSearchQuery] = useState('');

  // Loading & error states
  const [loading, setLoading] = useState({ org: true, users: true, tpl: true, asg: true });
  const [errors, setErrors] = useState({ org: '', users: '', tpl: '', asg: '' });

  // Collapsible states
  const [collapse, setCollapse] = useLocalStorage('ctrl_collapse', {
    org: false,
    users: false,
    tpl: false,
    asg: false,
  });

  // Icons for different sections
  const sectionIcons = {
    org: '🏢',
    users: '👥',
    tpl: '💻',
    asg: '🔗',
  };

  // ------------------ API fetchers ------------------
  useEffect(() => {
    getOrganization();
    getusers();
    gettemplates();
    getassigned();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setErr = (key, msg) => setErrors((e) => ({ ...e, [key]: msg || '' }));
  const setLoad = (key, v) => setLoading((l) => ({ ...l, [key]: v }));

  const getassigned = () => {
    setLoad('asg', true); setErr('asg');
    apiCaller.get(`${superadminApiRoutes.assignTemplatesApi}`)
      .then((response) => {
        const data = response.data || [];
        setAllAssigned(data);
        setAssignedList(data);
      })
      .catch((error) => {
        console.error('Error Fetching Assigned:', error);
        setErr('asg', 'Failed to load assignments.');
      })
      .finally(() => setLoad('asg', false));
  };

  const handleDeleteAssign = (assigned) => {
    const isConfirmed = window.confirm(`Are you sure you want to remove ${assigned.template} from ${assigned.organization}?`);
    if (!isConfirmed) return;
    const data = { organization: assigned.organization, template: assigned.template };
    apiCaller.delete(`${superadminApiRoutes.assignTemplatesApi}`, { data })
      .then((response) => { alert(response.data.message); getassigned(); })
      .catch((labError) => { console.error('Error Deleting Assignment:', labError); });
  };

  const handleAssignTemplate = (assignTemplateData) => {
    apiCaller.post(`${superadminApiRoutes.assignTemplatesApi}`, assignTemplateData)
      .then((response) => { getassigned(); alert(response.data.message); })
      .catch((labError) => { console.error('Error Assigning Template:', labError); })
      .finally(() => setAssignVmCardModalVisible(false));
  };

  const getusers = () => {
    setLoad('users', true); setErr('users');
    apiCaller.get(`${superadminApiRoutes.usersApi}`)
      .then((response) => {
        const data = response.data || [];
        setAllUsers(data);
        setUserList(data);
      })
      .catch((error) => { console.error('Error Fetching users:', error); setErr('users', 'Failed to load users.'); })
      .finally(() => setLoad('users', false));
  };

  const handleDeleteUser = (user) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete user ${user.email}?`);
    if (!isConfirmed) return;
    const data = { email: user.email, organization: user.organization };
    apiCaller.delete(`${superadminApiRoutes.usersApi}`, { data })
      .then((response) => { alert(response.data.message); getusers(); })
      .catch((labError) => { console.error('Error Deleting User:', labError); });
  };

  const getOrganization = async () => {
    setLoad('org', true); setErr('org');
    try {
      const response = await apiCaller.get(`${superadminApiRoutes.organizationApi}`);
      const orgs = response?.data?.organization || [];
      setAllOrganizations(orgs);
      setOrganization(orgs);
    } catch (error) {
      console.error('Error fetching organizations:', error);
      setErr('org', 'Failed to load organizations.');
    } finally { setLoad('org', false); }
  };

  const handleDeleteOrganization = (orgName) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete organization ${orgName}?`);
    if (!isConfirmed) return;
    const data = { organization: orgName };
    apiCaller.delete(`${superadminApiRoutes.organizationApi}`, { data })
      .then((response) => { alert(response.data.message); getOrganization(); })
      .catch((labError) => { console.error('Error Deleting Organization:', labError); });
  };

  const handleCreateOrganization = (payload) => {
    apiCaller.post(`${superadminApiRoutes.organizationApi}`, payload)
      .then((response) => { alert(response.data.message); getOrganization(); })
      .catch((labError) => { console.error('Error Creating Organization:', labError); })
      .finally(() => setCreateOrganizationModalVisible(false));
  };

  const handleCreateUser = (userData) => {
    apiCaller.post(`${superadminApiRoutes.usersApi}`, userData)
      .then((response) => { alert(response.data.message); getusers(); })
      .catch((labError) => { console.error('Error Creating User:', labError); })
      .finally(() => setCreateUserModalVisible(false));
  };

  const gettemplates = () => {
    setLoad('tpl', true); setErr('tpl');
    apiCaller.get(`${superadminApiRoutes.templatesApi}`)
      .then((response) => {
        const data = response.data || [];
        setAllTemplates(data);
        setTemplatesList(data);
      })
      .catch((error) => { console.error('Error Fetching templates:', error); setErr('tpl', 'Failed to load templates.'); })
      .finally(() => setLoad('tpl', false));
  };

  const handleDeleteTemplate = (template) => {
    const isConfirmed = window.confirm(`Are you sure you want to delete template ${template.name}?`);
    if (!isConfirmed) return;
    const data = { template: template.name };
    apiCaller.delete(`${superadminApiRoutes.templatesApi}`, { data })
      .then((response) => { alert(response.data.message); gettemplates(); })
      .catch((labError) => { console.error('Error Deleting Template:', labError); });
  };

  const handleCreateVmCard = (templateData) => {
    apiCaller.post(`${superadminApiRoutes.templatesApi}`, templateData)
      .then((response) => { alert(response.data.message); gettemplates(); })
      .catch((labError) => { console.error('Error Creating VM Card:', labError); })
      .finally(() => setCreateVmCardModalVisible(false));
  };

  // ------------------ SINGLE SEARCH FUNCTION ------------------
  const performSearch = useCallback((query) => {
    const lowerQuery = query.toLowerCase().trim();

    console.log('Searching for:', query); // Debug log

    // If empty query, show all data
    if (!lowerQuery) {
      setOrganization(allOrganizations);
      setUserList(allUsers);
      setTemplatesList(allTemplates);
      setAssignedList(allAssigned);
      return;
    }

    // Filter organizations (simple string array)
    const filteredOrgs = allOrganizations.filter(org => 
      String(org).toLowerCase().includes(lowerQuery)
    );
    setOrganization(filteredOrgs);

    // Filter users (object array)
    const filteredUsers = allUsers.filter(user => {
      if (!user) return false;
      return (
        (user.email || '').toLowerCase().includes(lowerQuery) ||
        (user.organization || '').toLowerCase().includes(lowerQuery) ||
        (user.userType || '').toLowerCase().includes(lowerQuery)
      );
    });
    setUserList(filteredUsers);

    // Filter templates (object array with nested properties)
    const filteredTemplates = allTemplates.filter(template => {
      if (!template) return false;
      return (
        (template.name || '').toLowerCase().includes(lowerQuery) ||
        (template.creation?.os || '').toLowerCase().includes(lowerQuery) ||
        (template.creation?.vmSize || '').toLowerCase().includes(lowerQuery) ||
        (template.creation?.licence || '').toLowerCase().includes(lowerQuery)
      );
    });
    setTemplatesList(filteredTemplates);

    // Filter assigned (object array)
    const filteredAssigned = allAssigned.filter(assigned => {
      if (!assigned) return false;
      return (
        (assigned.organization || '').toLowerCase().includes(lowerQuery) ||
        (assigned.template || '').toLowerCase().includes(lowerQuery)
      );
    });
    setAssignedList(filteredAssigned);
  }, [allOrganizations, allUsers, allTemplates, allAssigned]);

  // Debounced search
  const debouncedSearch = useMemo(() => 
    debounce((query) => performSearch(query), 300),
    [performSearch]
  );

  // Handle search input change
  const handleSearch = (query) => {
    setSearchQuery(query);
    debouncedSearch(query);
  };

  // Reset all filters
  const onResetAll = () => {
    setSearchQuery('');
    setOrganization(allOrganizations);
    setUserList(allUsers);
    setTemplatesList(allTemplates);
    setAssignedList(allAssigned);
  };

  // Enhanced KPI values with icons
  const kpis = useMemo(() => ([
    { 
      label: 'Organizations', 
      value: allOrganizations.length, 
      icon: '🏢',
      sub: 'Active organizations'
    },
    { 
      label: 'Users', 
      value: allUsers.length, 
      icon: '👥',
      sub: 'Registered users'
    },
    { 
      label: 'Templates', 
      value: allTemplates.length, 
      icon: '💻',
      sub: 'VM templates'
    },
    { 
      label: 'Assignments', 
      value: allAssigned.length, 
      icon: '🔗',
      sub: 'Active assignments'
    },
  ]), [allOrganizations.length, allUsers.length, allTemplates.length, allAssigned.length]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Single Search Toolbar */}
      <div className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <div className="w-2 h-8 rounded-full bg-blue-500" />
              <div>
                <h1 className="text-xl font-bold text-slate-900">Control Center</h1>
                <p className="text-sm text-slate-500">Manage your platform resources</p>
              </div>
            </div>
            
            <div className="lg:ml-auto flex flex-1 items-center gap-3 max-w-4xl">
              <div className="relative flex-1 min-w-0">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search across all sections: organizations, users, templates..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => handleSearch('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-3"
                  >
                    <svg className="h-4 w-4 text-slate-400 hover:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={onResetAll}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                >
                  Reset All
                </button>
                
                <div className="h-6 w-px bg-slate-200" />
                
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setCreateOrganizationModalVisible(true)}
                    className="rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    New Organization
                  </button>
                  <button 
                    onClick={() => setCreateUserModalVisible(true)}
                    className="rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    New User
                  </button>
                  <button 
                    onClick={() => setCreateVmCardModalVisible(true)}
                    className="rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    New Template
                  </button>
                  <button 
                    onClick={() => setAssignVmCardModalVisible(true)}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
                  >
                    Assign Template
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="mx-6 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KPICard 
            key={k.label} 
            label={k.label} 
            value={k.value} 
            sub={k.sub}
            icon={k.icon}
          />
        ))}
      </div>

      {/* Sections - NO SEARCH INPUTS INSIDE */}
      <div className="mx-6 my-6 space-y-6">
        {/* Organizations Section */}
        <Card>
          <SectionHeader
            title="Organizations"
            count={organization.length}
            icon={sectionIcons.org}
            collapsible
            collapsed={collapse.org}
            onToggle={() => setCollapse((c) => ({ ...c, org: !c.org }))}
          />
          <AnimatePresence initial={false}>
            {!collapse.org && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }} 
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                {loading.org && <LoadingRows rows={5} />}
                {!loading.org && errors.org && <ErrorState message={errors.org} onRetry={getOrganization} />}
                {!loading.org && !errors.org && organization.length === 0 && (
                  <EmptyState 
                    title={searchQuery ? "No organizations found" : "No organizations"}
                    hint={searchQuery ? "Try adjusting your search terms" : "Create your first organization to get started."}
                    icon="🏢"
                    action={
                      <button 
                        onClick={() => setCreateOrganizationModalVisible(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                      >
                        Create Organization
                      </button>
                    }
                  />
                )}
                {!loading.org && !errors.org && organization.length > 0 && (
                  <div className="p-4">
                    <Table
                      data={organization}
                      modalVisible={setCreateOrganizationModalVisible}
                      deleteData={handleDeleteOrganization}
                      title={"Organization"}
                      header={["ID", "Organization", "Operation"]}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Users Section */}
        <Card>
          <SectionHeader
            title="Users"
            count={userList.length}
            icon={sectionIcons.users}
            collapsible
            collapsed={collapse.users}
            onToggle={() => setCollapse((c) => ({ ...c, users: !c.users }))}
          />
          <AnimatePresence initial={false}>
            {!collapse.users && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }} 
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                {loading.users && <LoadingRows rows={6} />}
                {!loading.users && errors.users && <ErrorState message={errors.users} onRetry={getusers} />}
                {!loading.users && !errors.users && userList.length === 0 && (
                  <EmptyState 
                    title={searchQuery ? "No users found" : "No users"}
                    hint={searchQuery ? "Try adjusting your search terms" : "Create users to grant access to your platform."}
                    icon="👥"
                    action={
                      <button 
                        onClick={() => setCreateUserModalVisible(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                      >
                        Create User
                      </button>
                    }
                  />
                )}
                {!loading.users && !errors.users && userList.length > 0 && (
                  <div className="p-4">
                    <Table
                      data={userList}
                      modalVisible={setCreateUserModalVisible}
                      deleteData={handleDeleteUser}
                      title={"User"}
                      header={["ID", "Email", "Organization", "User Type", "Operation"]}
                      columns={["email", "organization", "userType"]}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Templates Section */}
        <Card>
          <SectionHeader
            title="Templates"
            count={templatesList.length}
            icon={sectionIcons.tpl}
            collapsible
            collapsed={collapse.tpl}
            onToggle={() => setCollapse((c) => ({ ...c, tpl: !c.tpl }))}
          />
          <AnimatePresence initial={false}>
            {!collapse.tpl && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }} 
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                {loading.tpl && <LoadingRows rows={5} />}
                {!loading.tpl && errors.tpl && <ErrorState message={errors.tpl} onRetry={gettemplates} />}
                {!loading.tpl && !errors.tpl && templatesList.length === 0 && (
                  <EmptyState 
                    title={searchQuery ? "No templates found" : "No templates"}
                    hint={searchQuery ? "Try adjusting your search terms" : "Create VM templates to standardize configurations."}
                    icon="💻"
                    action={
                      <button 
                        onClick={() => setCreateVmCardModalVisible(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                      >
                        Create Template
                      </button>
                    }
                  />
                )}
                {!loading.tpl && !errors.tpl && templatesList.length > 0 && (
                  <div className="p-4">
                    <Table
                      data={templatesList}
                      modalVisible={setCreateVmCardModalVisible}
                      deleteData={handleDeleteTemplate}
                      title={"Template"}
                      header={["ID", "Template Name", "OS", "VM Size", "Licence", "Operation"]}
                      columns={["name", "creation.os", "creation.vmSize", "creation.licence"]}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Assigned Templates Section */}
        <Card>
          <SectionHeader
            title="Assigned Templates"
            count={assignedList.length}
            icon={sectionIcons.asg}
            collapsible
            collapsed={collapse.asg}
            onToggle={() => setCollapse((c) => ({ ...c, asg: !c.asg }))}
          />
          <AnimatePresence initial={false}>
            {!collapse.asg && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }} 
                exit={{ height: 0, opacity: 0 }} 
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              >
                {loading.asg && <LoadingRows rows={5} />}
                {!loading.asg && errors.asg && <ErrorState message={errors.asg} onRetry={getassigned} />}
                {!loading.asg && !errors.asg && assignedList.length === 0 && (
                  <EmptyState 
                    title={searchQuery ? "No assignments found" : "No assignments"}
                    hint={searchQuery ? "Try adjusting your search terms" : "Assign templates to organizations to enable labs."}
                    icon="🔗"
                    action={
                      <button 
                        onClick={() => setAssignVmCardModalVisible(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200"
                      >
                        Assign Template
                      </button>
                    }
                  />
                )}
                {!loading.asg && !errors.asg && assignedList.length > 0 && (
                  <div className="p-4">
                    <Table
                      data={assignedList}
                      modalVisible={setAssignVmCardModalVisible}
                      deleteData={handleDeleteAssign}
                      title={"Assigned"}
                      header={["ID", "Organization", "Templates", "Operation"]}
                      columns={["organization", "template"]}
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      {/* Modals */}
      {createOrganizationModalVisible && (
        <CreateOrganizationModal
          onClose={() => setCreateOrganizationModalVisible(false)}
          onCreateOrganization={handleCreateOrganization}
        />
      )}

      {createUserModalVisible && (
        <CreateUserModal
          onClose={() => setCreateUserModalVisible(false)}
          onCreateUser={handleCreateUser}
          organization={organization}
        />
      )}

      {createVmCardModalVisible && (
        <CreateVmCardModal
          onClose={() => setCreateVmCardModalVisible(false)}
          onCreateVmCard={handleCreateVmCard}
        />
      )}

      {AssignVmCardModalVisible && (
        <AssignVmCardModal
          superadminApiRoutes={superadminApiRoutes}
          onClose={() => setAssignVmCardModalVisible(false)}
          onAssignTemplate={handleAssignTemplate}
          organization={organization}
          templates={templatesList}
        />
      )}
    </div>
  );
};

export default Controller;