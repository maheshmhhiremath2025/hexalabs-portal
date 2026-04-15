import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiCaller from '../services/apiCaller';
import moment from 'moment';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Server,
  Search,
  RefreshCw,
  Clock,
  Activity,
  AlertCircle,
  Download,
  ChevronDown,
  Monitor,
  Cpu,
  HardDrive,
} from 'lucide-react';

/**
 * ViewLogs.jsx (Simplified UI with Serial VM Display)
 */
const COLORS = {
  green: '#10b981',
  emerald: '#059669',
  yellow: '#f59e0b',
  amber: '#d97706',
  red: '#ef4444',
  indigo: '#6366f1',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  slate: '#94a3b8',
  gray: '#6b7280',
  bgCard: 'bg-white',
  border: 'border border-gray-200',
};

// ----- Helper subcomponents -----

const IconWrapper = ({ children, className = "" }) => (
  <div className={`p-2 rounded-xl bg-gray-50 inline-flex items-center justify-center shadow-sm ${className}`}>
    {children}
  </div>
);

const KPI = ({ title, value, subtitle, icon }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</div>
        <div className="text-lg font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
        {subtitle && (
          <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>
        )}
      </div>
    </div>
  </div>
);

const SkeletonBlock = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />
);

const ErrorAlert = ({ message, onRetry }) => (
  <motion.div 
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 flex items-start gap-3 shadow-sm"
  >
    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
    <div className="flex-1">
      <div className="font-semibold text-red-900">Unable to load data</div>
      <div className="text-sm mt-1">{message}</div>
      {onRetry && (
        <button 
          onClick={onRetry} 
          className="mt-3 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-sm font-medium transition-colors duration-200"
        >
          Try Again
        </button>
      )}
    </div>
  </motion.div>
);

const DurationBadge = ({ minutes }) => {
  const getStyles = (mins) => {
    if (mins <= 5) return 'bg-green-100 text-green-800 border-green-200';
    if (mins <= 30) return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  return (
    <span className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${getStyles(minutes)}`}>
      {minutes} min
    </span>
  );
};

const StatusIndicator = ({ status, size = "md" }) => {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4"
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'online': return 'bg-green-500 ring-green-400';
      case 'offline': return 'bg-red-500 ring-red-400';
      case 'running': return 'bg-blue-500 ring-blue-400';
      case 'stopped': return 'bg-gray-500 ring-gray-400';
      default: return 'bg-gray-400 ring-gray-300';
    }
  };

  return (
    <div className={`${sizeClasses[size]} rounded-full ring-2 ${getStatusColor(status)}`} />
  );
};

// ----- Main component -----

const ViewLogs = ({ selectedTraining, apiRoutes }) => {
  // State
  const [vmDetails, setVmDetails] = useState([]);
  const [vmFilter, setVmFilter] = useState('');
  const [selectedVM, setSelectedVM] = useState('');
  const [logs, setLogs] = useState([]);
  const [loadingVMs, setLoadingVMs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loadingDownload, setLoadingDownload] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);

  const abortRef = useRef(null);
  const dropdownRef = useRef(null);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch VM names
  const getVMNames = useCallback(
    async (trainingName) => {
      if (!trainingName || !apiRoutes?.vmNamesApi) return;
      try {
        setLoadingVMs(true);
        setError('');
        const params = new URLSearchParams({ trainingName });
        const response = await apiCaller.get(`${apiRoutes.vmNamesApi}?${params.toString()}`);
        
        let list = [];
        if (Array.isArray(response?.data)) list = response.data;
        else if (Array.isArray(response?.data?.vmList)) list = response.data.vmList;
        
        const statusMap = response?.data?.status ?? response?.data?.vmStatus ?? {};
        
        // Sort VM names in serial order (natural sort for numbers)
        const sortedList = list.sort((a, b) => {
          const nameA = typeof a === 'string' ? a : a.name ?? a.vm ?? '';
          const nameB = typeof b === 'string' ? b : b.name ?? b.vm ?? '';
          
          // Extract numbers from VM names for natural sorting
          const numA = nameA.match(/\d+/)?.[0] || '0';
          const numB = nameB.match(/\d+/)?.[0] || '0';
          
          return parseInt(numA) - parseInt(numB);
        });

        const normalized = sortedList.map((item) =>
          typeof item === 'string'
            ? { 
                name: item, 
                status: statusMap?.[item] ?? 'unknown',
              }
            : { 
                name: item.name ?? item.vm ?? 'unknown', 
                status: item.status ?? 'unknown',
              }
        );
        setVmDetails(normalized);
      } catch (err) {
        console.error('Failed to fetch VM names:', err);
        setError('Failed to load VM list. Please check your connection and try again.');
      } finally {
        setLoadingVMs(false);
      }
    },
    [apiRoutes]
  );

  useEffect(() => {
    if (selectedTraining) getVMNames(selectedTraining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTraining]);

  // Fetch logs for a single VM
  const fetchLogsForVM = useCallback(
    async (vmName) => {
      if (!vmName || !apiRoutes?.getLogsApi) return [];
      try {
        setLoadingLogs(true);
        setError('');
        if (abortRef.current) abortRef.current.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        
        const params = { vmName };
        const response = await apiCaller.get(`${apiRoutes.getLogsApi}`, {
          params,
          signal: ctrl.signal,
        });
        
        const data = Array.isArray(response?.data) ? response.data : response?.data?.logs ?? [];
        const normalized = (data || []).map((r) => ({
          start: r.start || r.started || r.s || null,
          stop: r.stop || r.stopped || r.e || null,
          duration: Number(r.duration ?? r.diffMinutes ?? 0),
        }));
        
        setLogs(normalized);
        setLastUpdated(new Date());
        return normalized;
      } catch (err) {
        if (err?.name === 'CanceledError' || err?.message === 'canceled') return [];
        console.error('Failed to fetch logs for VM', vmName, err);
        setError('Failed to fetch logs. The server might be temporarily unavailable.');
        return [];
      } finally {
        setLoadingLogs(false);
      }
    },
    [apiRoutes]
  );

  // Fetch logs for all VMs
  const fetchAllLogs = useCallback(
    async () => {
      if (!vmDetails.length || !apiRoutes?.getLogsApi) return [];
      const allLogs = [];
      for (const vm of vmDetails) {
        try {
          const params = { vmName: vm.name };
          const response = await apiCaller.get(`${apiRoutes.getLogsApi}`, { params });
          const data = Array.isArray(response?.data) ? response.data : response?.data?.logs ?? [];
          const normalized = data.map((r) => ({
            vmName: vm.name,
            start: r.start || r.started || r.s || null,
            stop: r.stop || r.stopped || r.e || null,
            duration: Number(r.duration ?? r.diffMinutes ?? 0),
          }));
          allLogs.push(...normalized);
        } catch (err) {
          console.error(`Failed to fetch logs for VM ${vm.name}:`, err);
        }
      }
      return allLogs;
    },
    [vmDetails, apiRoutes]
  );

  // Download logs for selected VM as CSV
  const downloadLogsAsCSV = useCallback(() => {
    if (!logs || logs.length === 0) return;
    setLoadingDownload(true);
    try {
      const headers = ['Start Time', 'End Time', 'Duration (min)', 'Relative'];
      const csvRows = [
        headers.join(','),
        ...logs.map(log => [
          `"${log.start ? moment(log.start).format('HH:mm:ss, DD MMM YYYY') : '-'}"`,
          `"${log.stop ? moment(log.stop).format('HH:mm:ss, DD MMM YYYY') : '-'}"`,
          `"${Math.round(Number(log.duration || 0))}"`,
          `"${log.start ? moment(log.start).fromNow() : '-'}"`,
        ].join(',')),
      ];
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `logs_${selectedVM || 'vm'}_${moment().format('YYYYMMDD_HHmmss')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download selected VM logs:', err);
      setError('Failed to download selected VM logs.');
    } finally {
      setLoadingDownload(false);
      setIsDownloadOpen(false);
    }
  }, [logs, selectedVM]);

  // Download all logs as CSV
  const downloadAllLogsAsCSV = useCallback(
    async () => {
      if (!vmDetails.length) return;
      setLoadingDownload(true);
      try {
        const allLogs = await fetchAllLogs();
        if (allLogs.length === 0) {
          setError('No logs available to download.');
          return;
        }

        const headers = ['VM Name', 'Start Time', 'End Time', 'Duration (min)', 'Relative'];
        const csvRows = [
          headers.join(','),
          ...allLogs.map(log => [
            `"${log.vmName}"`,
            `"${log.start ? moment(log.start).format('HH:mm:ss, DD MMM YYYY') : '-'}"`,
            `"${log.stop ? moment(log.stop).format('HH:mm:ss, DD MMM YYYY') : '-'}"`,
            `"${Math.round(Number(log.duration || 0))}"`,
            `"${log.start ? moment(log.start).fromNow() : '-'}"`,
          ].join(',')),
        ];
        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `logs_${selectedTraining || 'training'}_${moment().format('YYYYMMDD_HHmmss')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Failed to download all logs:', err);
        setError('Failed to download logs. Please try again.');
      } finally {
        setLoadingDownload(false);
        setIsDownloadOpen(false);
      }
    },
    [fetchAllLogs, selectedTraining, vmDetails.length]
  );

  // when selectedVM changes (via dropdown), fetch logs
  useEffect(() => {
    if (selectedVM) fetchLogsForVM(selectedVM);
    else setLogs([]);
  }, [selectedVM, fetchLogsForVM]);

  // Derived & memoized analytics
  const summary = useMemo(() => {
    if (!logs || logs.length === 0) {
      return { totalSessions: 0, avgDuration: 0, lastDuration: 0, totalDuration: 0 };
    }
    const totalSessions = logs.length;
    const durations = logs.map((l) => Number(l.duration || 0));
    const totalDuration = durations.reduce((s, v) => s + (isFinite(v) ? v : 0), 0);
    const avgDuration = totalDuration / Math.max(1, durations.length);
    const lastDuration = durations[0] ?? durations[durations.length - 1] ?? 0;
    
    return {
      totalSessions,
      avgDuration: Math.round(avgDuration),
      lastDuration: Math.round(lastDuration),
      totalDuration: Math.round(totalDuration),
    };
  }, [logs]);

  // Filtered VM list for searchable dropdown - already sorted by serial
  const filteredVMs = useMemo(() => {
    const q = vmFilter.trim().toLowerCase();
    return vmDetails.filter((v) => 
      v.name.toLowerCase().includes(q) || 
      v.status.toLowerCase().includes(q)
    );
  }, [vmFilter, vmDetails]);

  // UI helpers
  const formatDate = (iso) => (iso ? moment(iso).format('HH:mm:ss, DD MMM YYYY') : '-');

  const handleRefresh = () => {
    setError('');
    if (!selectedVM && selectedTraining) getVMNames(selectedTraining);
    if (selectedVM) fetchLogsForVM(selectedVM);
  };

  const firstFiltered = filteredVMs[0];

  // Get selected VM details
  const selectedVMDetails = useMemo(() => 
    vmDetails.find(vm => vm.name === selectedVM),
    [vmDetails, selectedVM]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Activity Log</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedTraining
                ? <>Session history for <span className="font-medium text-gray-700">{selectedTraining}</span>{lastUpdated && <span className="text-gray-400"> · {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}</>
                : 'Select a training to view session logs'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDownloadOpen(!isDownloadOpen)}
                disabled={!selectedTraining || vmDetails.length === 0 || loadingDownload || loadingVMs}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-sm text-sm font-medium transition-all duration-200 ${
                  !selectedTraining || vmDetails.length === 0 || loadingDownload || loadingVMs
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-white text-gray-700 border-gray-300  hover:border-gray-400'
                }`}
                aria-label="Toggle download options"
                aria-expanded={isDownloadOpen}
              >
                <motion.span
                  animate={loadingDownload ? { rotate: 360 } : { rotate: 0 }}
                  transition={{ repeat: loadingDownload ? Infinity : 0, duration: 1, ease: 'linear' }}
                >
                  <Download className="w-4 h-4" />
                </motion.span>
                Export Data
                <ChevronDown className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {isDownloadOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 mt-2 w-72 rounded-lg bg-white shadow-lg border border-gray-200 z-10 overflow-hidden"
                  >
                    <div className="p-2">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Export Options
                      </div>
                      <button
                        onClick={downloadAllLogsAsCSV}
                        disabled={!selectedTraining || vmDetails.length === 0 || loadingDownload}
                        className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors duration-200 flex items-center gap-3 ${
                          !selectedTraining || vmDetails.length === 0 || loadingDownload
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                      >
                        <Monitor className="w-4 h-4" />
                        <div>
                          <div className="font-medium">All VMs Data</div>
                          <div className="text-xs text-gray-500">Complete training logs</div>
                        </div>
                      </button>
                      <button
                        onClick={downloadLogsAsCSV}
                        disabled={!selectedVM || logs.length === 0 || loadingDownload}
                        className={`w-full text-left px-3 py-3 rounded-lg text-sm transition-colors duration-200 flex items-center gap-3 ${
                          !selectedVM || logs.length === 0 || loadingDownload
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                        }`}
                      >
                        <Server className="w-4 h-4" />
                        <div>
                          <div className="font-medium">Current VM Data</div>
                          <div className="text-xs text-gray-500">Selected VM logs only</div>
                        </div>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
            <button
              onClick={handleRefresh}
              disabled={loadingLogs || loadingVMs}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              aria-label="Refresh"
            >
              <motion.span
                animate={loadingLogs || loadingVMs ? { rotate: 360 } : { rotate: 0 }}
                transition={{ repeat: loadingLogs || loadingVMs ? Infinity : 0, duration: 1, ease: 'linear' }}
              >
                <RefreshCw className="w-4 h-4" />
              </motion.span>
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-6">
          <ErrorAlert message={error} onRetry={handleRefresh} />
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Left Sidebar - VM Selector & Analytics */}
        <div className="xl:col-span-1 space-y-6">
          {/* VM Selector Card */}
          <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm ">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <IconWrapper>
                  <Search className="w-4 h-4 text-gray-700" />
                </IconWrapper>
                <div>
                  <div className="text-sm font-semibold text-gray-900">Virtual Machines</div>
                  <div className="text-xs text-gray-500">Select instance to inspect</div>
                </div>
              </div>
              <div className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                {vmDetails.length} instances
              </div>
            </div>

            {/* Search Input */}
            <div className="mb-4">
              <input
                placeholder="Search by name or status..."
                value={vmFilter}
                onChange={(e) => setVmFilter(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                aria-label="Search VMs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && firstFiltered) {
                    setSelectedVM(firstFiltered.name);
                  }
                }}
              />
            </div>

            {/* VM List */}
            <div className="max-h-96 overflow-auto rounded-lg border border-gray-200">
              {loadingVMs ? (
                <div className="space-y-3 p-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3">
                      <SkeletonBlock className="w-10 h-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <SkeletonBlock className="h-4 w-3/4" />
                        <SkeletonBlock className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredVMs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <div className="text-sm">No VMs found</div>
                  <div className="text-xs mt-1">Try adjusting your search</div>
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {filteredVMs.map((vm) => (
                    <li key={vm.name}>
                      <button
                        onClick={() => setSelectedVM(vm.name)}
                        className={`w-full text-left p-4 transition-all duration-200 group ${
                          selectedVM === vm.name 
                            ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                            : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <StatusIndicator status={vm.status} />
                            <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-700">
                              {vm.name}
                            </div>
                          </div>
                          <div className={`text-xs font-medium px-2 py-1 rounded-full ${
                            vm.status === 'online' ? 'bg-green-100 text-green-800' :
                            vm.status === 'offline' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {vm.status}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Cpu className="w-3 h-3" />
                          Virtual Machine
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Session Summary Cards */}
          <div className="space-y-4">
            <KPI
              title="Total Sessions"
              value={summary.totalSessions}
              subtitle="All recorded sessions"
              icon={<IconWrapper><Activity className="w-5 h-5 text-blue-600" /></IconWrapper>}
            />
            <KPI
              title="Average Duration"
              value={`${summary.avgDuration}m`}
              subtitle="Per session"
              icon={<IconWrapper><Clock className="w-5 h-5 text-amber-600" /></IconWrapper>}
            />
            <KPI
              title="Last Session"
              value={`${summary.lastDuration}m`}
              subtitle="Most recent duration"
              icon={<IconWrapper><HardDrive className="w-5 h-5 text-emerald-600" /></IconWrapper>}
            />
          </div>
        </div>

        {/* Main Content Area - Logs Table */}
        <div className="xl:col-span-3">
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            {/* Table Header */}
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Session Logs
                    {selectedVMDetails && (
                      <span className="text-gray-600 ml-2">
                        - {selectedVMDetails.name}
                      </span>
                    )}
                  </h3>
                  <div className="text-sm text-gray-500 mt-1">
                    Detailed session timeline and duration metrics
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-sm text-gray-500">
                    Showing <span className="font-semibold text-gray-900">{logs.length}</span> sessions
                  </div>
                  {selectedVMDetails && (
                    <div className="flex items-center gap-2">
                      <StatusIndicator status={selectedVMDetails.status} size="lg" />
                      <span className="text-sm font-medium text-gray-700 capitalize">
                        {selectedVMDetails.status}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Table Content */}
            <div className="p-6">
              {loadingLogs ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center gap-4 p-4">
                      <SkeletonBlock className="h-12 flex-1" />
                      <SkeletonBlock className="h-12 flex-1" />
                      <SkeletonBlock className="h-12 w-24" />
                      <SkeletonBlock className="h-12 w-20" />
                    </div>
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Server className="w-8 h-8 text-gray-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">No Session Data</h4>
                  <p className="text-gray-500 max-w-sm mx-auto">
                    {selectedVM 
                      ? 'No activity logs found for the selected virtual machine.' 
                      : 'Select a virtual machine to view its session logs.'
                    }
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Start Time
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          End Time
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Relative Time
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      <AnimatePresence>
                        {logs.map((log, idx) => (
                          <motion.tr
                            key={`${log.start || idx}-${idx}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2, delay: idx * 0.02 }}
                            className="hover:bg-gray-50 transition-colors duration-150"
                          >
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                              {formatDate(log.start)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                              {formatDate(log.stop)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <DurationBadge minutes={Math.round(Number(log.duration || 0))} />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                              {log.start ? (
                                <div className="flex items-center gap-2">
                                  <Clock className="w-3 h-3" />
                                  {moment(log.start).fromNow()}
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Footer Note */}
          <div className="mt-4 text-center">
            <div className="text-xs text-gray-500 inline-flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-full">
              <Activity className="w-3 h-3" />
              Real-time monitoring • Auto-refresh every 30 seconds
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewLogs;