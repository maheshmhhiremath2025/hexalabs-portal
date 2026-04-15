import React, { useEffect, useState, useMemo } from 'react';
import AccountCard from '../components/AccountCard';
import ClientTable from '../components/ClientTable';
import LedgerModal from '../components/modal/LedgerModal';
import apiCaller from '../services/apiCaller';
import { 
  TrendingUp, 
  TrendingDown, 
  Users, 
  DollarSign, 
  FileText, 
  CreditCard,
  RefreshCw,
  Plus,
  BarChart3,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Search,
  MapPin
} from 'lucide-react';

// Customer Selector Component
const CustomerSelector = ({ 
  customers, 
  selectedCustomer, 
  onSelectCustomer, 
  onClearSelection 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredCustomers = customers.filter(customer =>
    customer.organization.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.gstin?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          Select Customer
        </label>
        {selectedCustomer && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Clear Selection
          </button>
        )}
      </div>
      
      {!selectedCustomer ? (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search customers by name or GST..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
            {filteredCustomers.map((customer) => (
              <div
                key={customer.id}
                onClick={() => onSelectCustomer(customer)}
                className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{customer.organization}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {customer.address && `${customer.address}, `}
                      {customer.city} {customer.pincode && `- ${customer.pincode}`}
                    </p>
                    {customer.gstin && (
                      <p className="text-xs text-gray-500 mt-1">GST: {customer.gstin}</p>
                    )}
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
                </div>
              </div>
            ))}
            
            {filteredCustomers.length === 0 && searchTerm && (
              <div className="p-4 text-center text-gray-500">
                No customers found matching "{searchTerm}". Add a new one below.
              </div>
            )}
            
            {filteredCustomers.length === 0 && !searchTerm && (
              <div className="p-4 text-center text-gray-500">
                No customers saved yet. They will appear here after you create invoices.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="flex items-center">
                <CheckCircle2 className="w-5 h-5 text-green-500 mr-2" />
                <p className="font-semibold text-gray-900">{selectedCustomer.organization}</p>
              </div>
              <div className="mt-2 space-y-1">
                {(selectedCustomer.address || selectedCustomer.city) && (
                  <div className="flex items-start text-sm text-gray-700">
                    <MapPin className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                    <span>
                      {selectedCustomer.address && `${selectedCustomer.address}, `}
                      {selectedCustomer.city} 
                      {selectedCustomer.pincode && ` - ${selectedCustomer.pincode}`}
                      {selectedCustomer.state && `, ${selectedCustomer.state}`}
                    </span>
                  </div>
                )}
                {selectedCustomer.gstin && (
                  <p className="text-sm text-gray-600">GST: {selectedCustomer.gstin}</p>
                )}
                {selectedCustomer.email && (
                  <p className="text-sm text-gray-600">Email: {selectedCustomer.email}</p>
                )}
                {selectedCustomer.phone && (
                  <p className="text-sm text-gray-600">Phone: {selectedCustomer.phone}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Customer Manager Component
const CustomerManager = ({ customers, onClose, onDeleteCustomer }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Manage Customers</h3>
            <p className="text-sm text-gray-600 mt-1">
              {customers.length} saved customer{customers.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
          >
            ✕
          </button>
        </div>
        
        <div className="overflow-y-auto max-h-[60vh]">
          {customers.length > 0 ? (
            <div className="p-6 space-y-4">
              {customers.map((customer) => (
                <div key={customer.id} className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors duration-200">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                          <span className="font-semibold text-blue-600 text-sm">
                            {customer.organization.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{customer.organization}</h4>
                          <p className="text-sm text-gray-600 mt-1">
                            {customer.address && `${customer.address}, `}
                            {customer.city} 
                            {customer.pincode && ` - ${customer.pincode}`}
                            {customer.state && `, ${customer.state}`}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
                        {customer.gstin && (
                          <span className="bg-gray-100 px-2 py-1 rounded">GST: {customer.gstin}</span>
                        )}
                        {customer.email && (
                          <span className="bg-gray-100 px-2 py-1 rounded">Email: {customer.email}</span>
                        )}
                        {customer.phone && (
                          <span className="bg-gray-100 px-2 py-1 rounded">Phone: {customer.phone}</span>
                        )}
                      </div>
                      
                      <p className="text-xs text-gray-400 mt-2">
                        Added: {new Date(customer.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => onDeleteCustomer(customer.id)}
                      className="ml-4 px-3 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors duration-200"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No customers saved yet</p>
              <p className="text-gray-400 text-sm mt-2">
                Customers will appear here after you create invoices with their details
              </p>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Ledger = ({ apiRoutes }) => {
  const [accountDetails, setAccountDetails] = useState({
    name: 'Cloud Portal',
    invoiceValue: 0,
    paymentReceived: 0,
    balance: 0,
  });
  const [clients, setClients] = useState([]);
  const [modalConfig, setModalConfig] = useState({ visible: false, type: 'invoice' });
  const [formData, setFormData] = useState({
    organization: '',
    id: '',
    amount: 0,
    date: '',
    type: ''
  });
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalClients: 0,
    overdueClients: 0,
    avgInvoice: 0,
    collectionRate: 0,
    recentActivity: []
  });
  
  // Customer addresses state
  const [customerAddresses, setCustomerAddresses] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showCustomerManager, setShowCustomerManager] = useState(false);

  // Load saved customer addresses from localStorage
  useEffect(() => {
    loadCustomerAddresses();
  }, []);

  const loadCustomerAddresses = () => {
    try {
      const savedAddresses = localStorage.getItem('customerAddresses');
      if (savedAddresses) {
        setCustomerAddresses(JSON.parse(savedAddresses));
      }
    } catch (error) {
      console.error('Failed to load customer addresses:', error);
    }
  };

// In your Ledger.js, update the saveCustomerAddress function:

    const saveCustomerAddress = (customerData) => {
        if (!customerData.organization || !customerData.customerDetails) return;

        const newAddress = {
            id: Date.now().toString(),
            organization: customerData.organization.trim(),
            name: customerData.customerDetails?.name || '', // Add name
            address: customerData.customerDetails?.address || '',
            city: customerData.customerDetails?.city || '',
            state: customerData.customerDetails?.state || '',
            pincode: customerData.customerDetails?.pincode || '',
            gstin: customerData.customerDetails?.gstin || customerData.gstDetails?.gstin || '', // Get from customerDetails first
            pan: customerData.customerDetails?.pan || '', // Add PAN
            email: customerData.customerDetails?.email || '',
            phone: customerData.customerDetails?.phone || '',
            shippingAddress: customerData.customerDetails?.shippingAddress || '', // Add shipping address
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const updatedAddresses = [...customerAddresses];
        
        // Check if customer already exists
        const existingIndex = updatedAddresses.findIndex(
            addr => addr.organization.toLowerCase() === customerData.organization.toLowerCase()
        );

        if (existingIndex >= 0) {
            // Update existing customer - merge with existing data
            updatedAddresses[existingIndex] = {
                ...updatedAddresses[existingIndex],
                ...newAddress,
                id: updatedAddresses[existingIndex].id, // Keep original ID
                createdAt: updatedAddresses[existingIndex].createdAt, // Keep original creation date
                updatedAt: new Date().toISOString() // Update modification date
            };
        } else {
            // Add new customer
            updatedAddresses.push(newAddress);
        }

        setCustomerAddresses(updatedAddresses);
        localStorage.setItem('customerAddresses', JSON.stringify(updatedAddresses));
        
        console.log('💾 Saved customer address:', newAddress);
    };

  const deleteCustomerAddress = (customerId) => {
    const updatedAddresses = customerAddresses.filter(customer => customer.id !== customerId);
    setCustomerAddresses(updatedAddresses);
    localStorage.setItem('customerAddresses', JSON.stringify(updatedAddresses));
    
    // If the deleted customer was selected, clear the selection
    if (selectedCustomer && selectedCustomer.id === customerId) {
      setSelectedCustomer(null);
    }
  };

  const getAccountDetails = async () => {
    setLoading(true);
    try {
      console.log('📡 Fetching ledger data...');
      const response = await apiCaller.get(apiRoutes.ledgerApi);
      console.log('✅ Ledger API Response:', response.data);
      
      if (response.data) {
        const { totalInvoice, totalPayment, totalBalance, ledger } = response.data;
        
        setAccountDetails({
          name: 'Cloud Portal',
          invoiceValue: totalInvoice,
          paymentReceived: totalPayment,
          balance: totalBalance,
        });
        
        // Transform the data to match ClientTable expectations
        const formattedClients = (ledger || []).map(client => ({
          ...client,
          name: client.organization,
          invoice: client.legal?.invoice || client.invoice || 0,
          payment: client.legal?.payment || client.payment || 0,
          balance: client.legal?.balance || client.balance || 0,
          lastActivity: client.lastActivity || new Date().toISOString().split('T')[0]
        }));
        
        setClients(formattedClients);
        
        // Calculate additional stats
        const overdueCount = formattedClients.filter(client => client.balance > 0).length;
        const avgInvoice = formattedClients.length > 0 
          ? formattedClients.reduce((sum, client) => sum + (client.invoice || 0), 0) / formattedClients.length 
          : 0;
        const collectionRate = totalInvoice > 0 ? (totalPayment / totalInvoice) * 100 : 0;
        
        // Generate recent activity
        const recentActivity = formattedClients
          .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
          .slice(0, 4)
          .map(client => ({
            client: client.organization,
            type: client.balance > 0 ? 'invoice' : 'payment',
            amount: client.balance > 0 ? client.balance : client.payment,
            date: client.lastActivity,
            status: client.balance > 0 ? 'pending' : 'completed'
          }));
        
        setStats({
          totalClients: formattedClients.length,
          overdueClients: overdueCount,
          avgInvoice: avgInvoice,
          collectionRate: collectionRate,
          recentActivity: recentActivity
        });
        
        console.log('👥 Formatted Clients for Table:', formattedClients);
      }
    } catch (error) {
      console.error('❌ Failed to get account details', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAccountDetails();
  }, []);

  const handleModalOpen = (type) => {
    setModalConfig({ visible: true, type });
    // Clear selection when opening new modal
    setSelectedCustomer(null);
  };

  const handleModalClose = () => {
    setModalConfig({ visible: false, type: 'invoice' });
    setFormData({
      organization: '',
      id: '',
      amount: 0,
      date: '',
      type: ''
    });
    setSelectedCustomer(null);
  };

  const sortedClients = useMemo(() => {
    const sorted = [...clients].sort((a, b) => (b.balance || 0) - (a.balance || 0));
    console.log('📈 Sorted clients for display:', sorted);
    return sorted;
  }, [clients]);

  const onSubmit = async (formDataWithGst) => {
    try {
      console.log('🔄 Submitting transaction for:', formDataWithGst.organization);
      
      const payload = {
        organization: formDataWithGst.organization,
        id: formDataWithGst.id,
        amount: parseFloat(formDataWithGst.amount),
        date: formDataWithGst.date,
        type: formDataWithGst.type,
        gstDetails: formDataWithGst.gstDetails,
        items: formDataWithGst.items,
        customerDetails: formDataWithGst.customerDetails,
        particular: formDataWithGst.description
      };
      
      console.log('📦 Sending payload with GST:', payload);
      await apiCaller.post(apiRoutes.addTransaction, payload);
      
      // Save customer address for future use
      if (formDataWithGst.organization && formDataWithGst.customerDetails) {
        saveCustomerAddress(formDataWithGst);
      }
      
      await getAccountDetails();
      handleModalClose();
      
    } catch (error) {
      console.error('❌ Failed to submit form', error);
      alert(`Error: ${error.response?.data?.message || error.message}`);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short'
    });
  };

  // Top 5 clients by balance
  const topClientsByBalance = useMemo(() => {
    return [...clients]
      .filter(client => client.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);
  }, [clients]);

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invoices & Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">Receivables, payments, and client balances</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCustomerManager(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Users className="w-3.5 h-3.5" />
            Customers
            {customerAddresses.length > 0 && (
              <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{customerAddresses.length}</span>
            )}
          </button>
          <button
            onClick={() => handleModalOpen('invoice')}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" />
            New Invoice
          </button>
          <button
            onClick={() => handleModalOpen('payment')}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Record Payment
          </button>
          <button
            onClick={getAccountDetails}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Invoiced</div>
          <div className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{formatCurrency(accountDetails.invoiceValue)}</div>
          <div className="text-[11px] text-gray-400 mt-1">all time</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Received</div>
          <div className="text-xl font-semibold text-green-700 mt-1 tabular-nums">{formatCurrency(accountDetails.paymentReceived)}</div>
          <div className="text-[11px] text-gray-400 mt-1">{stats.collectionRate.toFixed(0)}% collected</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Outstanding</div>
          <div className={`text-xl font-semibold mt-1 tabular-nums ${accountDetails.balance > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{formatCurrency(accountDetails.balance)}</div>
          <div className="text-[11px] text-gray-400 mt-1">{stats.overdueClients} client{stats.overdueClients !== 1 ? 's' : ''} pending</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Clients</div>
          <div className="text-xl font-semibold text-gray-900 mt-1">{stats.totalClients}</div>
          <div className="text-[11px] text-gray-400 mt-1">avg {formatCurrency(stats.avgInvoice)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Collection rate</div>
          <div className={`text-xl font-semibold mt-1 ${stats.collectionRate >= 90 ? 'text-green-700' : stats.collectionRate >= 70 ? 'text-amber-700' : 'text-red-700'}`}>
            {stats.collectionRate.toFixed(1)}%
          </div>
          <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${stats.collectionRate >= 90 ? 'bg-green-500' : stats.collectionRate >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, stats.collectionRate)}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Recent activity</div>
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
          </div>
          <div className="divide-y divide-gray-50">
            {stats.recentActivity.length > 0 ? stats.recentActivity.map((activity, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center ${activity.type === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                    {activity.type === 'invoice' ? <FileText className="w-3.5 h-3.5" /> : <CreditCard className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{activity.client}</div>
                    <div className="text-[11px] text-gray-500 capitalize">{activity.type} · {formatDate(activity.date)}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(activity.amount)}</div>
              </div>
            )) : (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No recent activity</div>
            )}
          </div>
        </div>

        {/* Outstanding */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Outstanding balances</div>
            {topClientsByBalance.length > 0 && (
              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">{topClientsByBalance.length}</span>
            )}
          </div>
          {topClientsByBalance.length > 0 ? (
            <div className="divide-y divide-gray-50">
              {topClientsByBalance.map((client, i) => (
                <div key={client.id || i} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center text-[11px] font-bold text-gray-600">
                      {client.organization.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-sm font-medium text-gray-900 truncate max-w-[140px]">{client.organization}</div>
                  </div>
                  <div className="text-sm font-semibold text-amber-700 tabular-nums">{formatCurrency(client.balance)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-6 h-6 text-green-400 mx-auto mb-2" />
              <div className="text-sm text-gray-500">All clear — no outstanding balances</div>
            </div>
          )}
        </div>
      </div>

      {/* Client Ledger Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Client ledger</div>
            <div className="text-[11px] text-gray-500 mt-0.5">{sortedClients.length} client{sortedClients.length !== 1 ? 's' : ''} · {formatCurrency(accountDetails.balance)} total outstanding</div>
          </div>
        </div>
        <div className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
            </div>
          ) : (
            <ClientTable clients={sortedClients} />
          )}
        </div>
      </div>

      {/* Ledger Modal */}
      {modalConfig.visible && (
        <LedgerModal
          type={modalConfig.type}
          clients={clients}
          formData={formData}
          setFormData={setFormData}
          onClose={handleModalClose}
          onSubmit={onSubmit}
          // Pass customer management props
          customerAddresses={customerAddresses}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
          onClearSelection={() => setSelectedCustomer(null)}
        />
      )}

      {/* Customer Manager Modal */}
      {showCustomerManager && (
        <CustomerManager
          customers={customerAddresses}
          onClose={() => setShowCustomerManager(false)}
          onDeleteCustomer={deleteCustomerAddress}
        />
      )}
    </div>
  );
};

export default Ledger;