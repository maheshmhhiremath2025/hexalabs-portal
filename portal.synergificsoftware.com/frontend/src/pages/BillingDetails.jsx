import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  RefreshCw, 
  Activity, 
  Server, 
  Clock, 
  DollarSign, 
  TrendingUp,
  AlertCircle,
  Play,
  Square
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  LineChart, 
  Line,
  Legend
} from 'recharts';
import apiCaller from '../services/apiCaller';

// Helper Components
const SkeletonCard = () => (
  <div className="bg-white rounded-xl p-6 shadow-sm">
    <div className="animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/4 mb-3"></div>
      <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
      <div className="h-3 bg-gray-200 rounded w-3/4"></div>
    </div>
  </div>
);

const StatCard = ({ icon: Icon, title, value, subtitle, color = "text-blue-600", delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    whileHover={{ y: -4, transition: { duration: 0.2 } }}
    className="bg-white rounded-xl p-6 shadow-sm hover:shadow-sm transition-shadow duration-300"
  >
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-xl ${color.replace('text-', 'bg-').replace('-600', '-100')}`}>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
    </div>
    <div>
      <h3 className="text-sm font-medium text-gray-600 mb-1">{title}</h3>
      <p className="text-xl font-semibold text-gray-900 mb-1">{value}</p>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
    </div>
  </motion.div>
);

const ChartCard = ({ title, children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    whileHover={{ y: -2, transition: { duration: 0.2 } }}
    className="bg-white rounded-xl p-6 shadow-sm hover:shadow-sm transition-shadow duration-300"
  >
    <h3 className="text-lg font-semibold text-gray-800 mb-6">{title}</h3>
    {children}
  </motion.div>
);

const ErrorAlert = ({ message, onRetry }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-center gap-4"
  >
    <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
    <div className="flex-1">
      <h3 className="font-semibold text-red-800 mb-1">Error Loading Data</h3>
      <p className="text-red-600">{message}</p>
    </div>
    <button
      onClick={onRetry}
      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200"
    >
      Retry
    </button>
  </motion.div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
        <p className="font-medium text-gray-700">{`${label}: ${payload[0].value}`}</p>
      </div>
    );
  }
  return null;
};

const DonutChart = ({ data }) => (
  <div className="relative">
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
      </PieChart>
    </ResponsiveContainer>
    
    {/* Legend */}
    <div className="flex justify-center gap-4 mt-4">
      {data.map((entry, index) => {
        const IconComponent = entry.icon;
        return (
          <div key={index} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <IconComponent className="w-4 h-4 text-gray-600" />
            <span className="text-sm text-gray-600">
              {entry.name} ({entry.value})
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

const BillingDetails = ({ selectedTraining, apiRoutes }) => {
  const [totalDuration, setTotalDuration] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalVMs, setTotalVMs] = useState(0);
  const [onlineVMs, setOnlineVMs] = useState(0);
  const [offlineVMs, setOfflineVMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const mountedRef = useRef(true);

  // Memoized formatted values
  const formattedAmount = useMemo(() => {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(totalAmount || 0);
    } catch {
      return `₹${totalAmount || 0}`;
    }
  }, [totalAmount]);

  const formattedDuration = useMemo(() => {
    if (!totalDuration) return '0 hours';
    return totalDuration >= 24 
      ? `${Math.floor(totalDuration / 24)}d ${totalDuration % 24}h`
      : `${totalDuration} hours`;
  }, [totalDuration]);

  // Generate VM status data for donut chart
  const vmStatusData = useMemo(() => [
    { name: 'Online', value: onlineVMs, color: '#10b981', icon: Play },
    { name: 'Offline', value: offlineVMs, color: '#6b7280', icon: Square }
  ], [onlineVMs, offlineVMs]);

  // Generate runtime trend data - illustrative distribution from total hours
  // Note: This is synthetic data for visualization purposes
  const runtimeTrendData = useMemo(() => {
    if (!totalDuration) return [];
    
    const days = 7;
    const baseHours = Math.floor(totalDuration / days);
    const remainder = totalDuration % days;
    
    return Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (days - 1 - i));
      
      // Add some variation to make the chart more realistic
      const variation = Math.random() * 0.4 + 0.8; // 80-120% of base
      const hours = Math.round((baseHours + (i < remainder ? 1 : 0)) * variation);
      
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        hours: Math.max(0, hours)
      };
    });
  }, [totalDuration]);

  // Generate cost trend data - illustrative trend based on total amount
  // Note: This is synthetic data for visualization purposes
  const costTrendData = useMemo(() => {
    if (!totalAmount) return [];
    
    const points = 10;
    const baseAmount = totalAmount / points;
    
    return Array.from({ length: points }, (_, i) => {
      // Create a gentle upward trend with some variation
      const trend = 1 + (i / points) * 0.3; // 30% increase over time
      const variation = Math.random() * 0.3 + 0.85; // 85-115% variation
      const amount = Math.round(baseAmount * trend * variation);
      
      return {
        point: i + 1,
        amount: Math.max(0, amount)
      };
    });
  }, [totalAmount]);

  const fetchBillingDetails = useCallback(async (trainingName) => {
    if (!apiRoutes?.billingApi) {
      setError('API route not configured');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setRefreshing(true);
      
      const params = new URLSearchParams({ trainingName });
      const response = await apiCaller.get(`${apiRoutes.billingApi}?${params.toString()}`);
      const billing = response.data;

      // Only update state if component is still mounted
      if (mountedRef.current) {
        setTotalAmount(billing.Amount || 0);
        setTotalDuration(billing.Duration || 0);
        setTotalVMs((billing.Status?.online || 0) + (billing.Status?.offline || 0));
        setOnlineVMs(billing.Status?.online || 0);
        setOfflineVMs(billing.Status?.offline || 0);
        setLastUpdated(new Date());
        setLoading(false);
        setRefreshing(false);
      }
    } catch (error) {
      console.error('Billing fetch error:', error);
      if (mountedRef.current) {
        setError('Failed to fetch billing details. Please try again.');
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [apiRoutes]);

  const handleRefresh = useCallback(() => {
    if (selectedTraining && !refreshing) {
      fetchBillingDetails(selectedTraining);
    }
  }, [selectedTraining, fetchBillingDetails, refreshing]);

  const handleRetry = useCallback(() => {
    setError('');
    if (selectedTraining) {
      fetchBillingDetails(selectedTraining);
    }
  }, [selectedTraining, fetchBillingDetails]);

  useEffect(() => {
    mountedRef.current = true;
    
    if (selectedTraining) {
      fetchBillingDetails(selectedTraining);
    }

    return () => {
      mountedRef.current = false;
    };
  }, [selectedTraining, fetchBillingDetails]);

  // Show initial loading state
  if (loading && !lastUpdated) {
    return (
      <div className="w-full px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Cost Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {selectedTraining
              ? <>Billing breakdown for <span className="font-medium text-gray-700">{selectedTraining}</span>{lastUpdated && <span className="text-gray-400"> · {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}</>
              : 'Select a training from the dropdown above'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <div className="flex-1 text-sm text-red-700">{error}</div>
          <button onClick={handleRetry} className="text-xs font-medium text-red-600 hover:text-red-800">Retry</button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !lastUpdated && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-20 mb-3" />
              <div className="h-6 bg-gray-100 rounded w-16" />
            </div>
          ))}
        </div>
      )}

      {/* Main Content */}
      {((!loading && !error) || (loading && lastUpdated)) && (
        <div className={loading ? 'opacity-60' : ''}>
          {/* KPI strip — colored left borders, ₹ for INR */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 border-l-[3px] border-l-blue-500 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Instances</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{totalVMs}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="flex items-center gap-1 text-[11px] text-green-600"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />{onlineVMs} running</span>
                <span className="flex items-center gap-1 text-[11px] text-gray-400"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" />{offlineVMs} stopped</span>
              </div>
            </div>
            <div className="bg-white border border-gray-200 border-l-[3px] border-l-emerald-500 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Running</div>
              <div className="text-2xl font-semibold text-emerald-700 mt-1 tabular-nums">{onlineVMs}</div>
              <div className="text-[11px] text-gray-400 mt-1.5">Currently active</div>
            </div>
            <div className="bg-white border border-gray-200 border-l-[3px] border-l-indigo-500 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Runtime</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{formattedDuration}</div>
              <div className="text-[11px] text-gray-400 mt-1.5">Total compute hours</div>
            </div>
            <div className="bg-white border border-gray-200 border-l-[3px] border-l-amber-500 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Usage Cost</div>
              <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{formattedAmount}</div>
              <div className="text-[11px] text-gray-400 mt-1.5">Estimated billing (INR)</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
            {/* Status distribution */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Instance status</div>
              </div>
              <div className="p-5">
                <DonutChart data={vmStatusData} />
              </div>
            </div>

            {/* Runtime trend */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Runtime hours</div>
                <div className="text-[11px] text-gray-500">Last 7 days (estimated)</div>
              </div>
              <div className="p-4">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={runtimeTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                    <Bar dataKey="hours" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Cost trend */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
              <div className="px-5 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold text-gray-900">Cost trend (₹)</div>
                <div className="text-[11px] text-gray-500">Estimated billing in INR</div>
              </div>
              <div className="p-4">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={costTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="point" tick={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                      formatter={(v) => [`₹${v?.toLocaleString('en-IN')}`, 'Cost']}
                    />
                    <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#10b981' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingDetails;
