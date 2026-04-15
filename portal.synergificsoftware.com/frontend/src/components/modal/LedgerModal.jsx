import React, { useEffect, useState, useRef } from 'react';
import { Search, MapPin, CheckCircle2, ChevronDown, X, Users } from 'lucide-react';

// Customer Selector Component - UPDATED TO DROPDOWN ONLY
const CustomerSelector = ({ 
  customers, 
  selectedCustomer, 
  onSelectCustomer, 
  onClearSelection 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  const filteredCustomers = customers.filter(customer =>
    customer.organization.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.gstin?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.pan?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectCustomer = (customer) => {
    onSelectCustomer(customer);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClearSelection = () => {
    onClearSelection();
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="space-y-3" ref={dropdownRef}>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">
          Select Customer
        </label>
        {selectedCustomer && (
          <button
            type="button"
            onClick={handleClearSelection}
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            <X className="w-4 h-4 mr-1" />
            Clear
          </button>
        )}
      </div>
      
      {/* Dropdown Trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-300 rounded-xl hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200"
        >
          <div className="flex items-center space-x-3 min-w-0">
            {selectedCustomer ? (
              <>
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 text-sm font-semibold">
                    {selectedCustomer.organization.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-left min-w-0 flex-1">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {selectedCustomer.organization}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {selectedCustomer.gstin || 'No GSTIN'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <Users className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <span className="text-gray-500 text-sm">Select a customer...</span>
              </>
            )}
          </div>
          <ChevronDown 
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${
              isOpen ? 'transform rotate-180' : ''
            }`} 
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg max-h-80 overflow-hidden">
            {/* Search Input */}
            <div className="p-3 border-b border-gray-100 bg-gray-50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search customers by name, GST, or PAN..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  autoFocus
                />
              </div>
            </div>

            {/* Customer List */}
            <div className="max-h-60 overflow-y-auto">
              {filteredCustomers.length > 0 ? (
                filteredCustomers.map((customer) => (
                  <div
                    key={customer.id}
                    onClick={() => handleSelectCustomer(customer)}
                    className="flex items-center space-x-3 p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors duration-150 group"
                  >
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-xs font-semibold">
                        {customer.organization.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {customer.organization}
                      </p>
                      <div className="flex items-center space-x-2 mt-1 flex-wrap gap-1">
                        {customer.gstin && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">GST: {customer.gstin}</span>
                        )}
                        {customer.pan && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">PAN: {customer.pan}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {customer.address && `${customer.address}, `}
                        {customer.city} {customer.pincode && `- ${customer.pincode}`}
                      </p>
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))
              ) : (
                <div className="p-6 text-center">
                  <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">
                    {searchTerm ? 'No customers found' : 'No customers saved yet'}
                  </p>
                  <p className="text-gray-400 text-xs mt-1">
                    {searchTerm ? 'Try a different search term' : 'Customers will appear here after you create invoices'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected Customer Details */}
      {selectedCustomer && (
        <div className="p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-start space-x-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">{selectedCustomer.organization}</p>
              <div className="mt-2 space-y-2">
                {(selectedCustomer.address || selectedCustomer.city) && (
                  <div className="flex items-start text-xs text-gray-700">
                    <MapPin className="w-3 h-3 mr-2 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">
                      {selectedCustomer.address && `${selectedCustomer.address}, `}
                      {selectedCustomer.city} 
                      {selectedCustomer.pincode && ` - ${selectedCustomer.pincode}`}
                      {selectedCustomer.state && `, ${selectedCustomer.state}`}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {selectedCustomer.gstin && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">GST: {selectedCustomer.gstin}</span>
                  )}
                  {selectedCustomer.pan && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">PAN: {selectedCustomer.pan}</span>
                  )}
                </div>
                {(selectedCustomer.email || selectedCustomer.phone) && (
                  <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                    {selectedCustomer.email && (
                      <span>Email: {selectedCustomer.email}</span>
                    )}
                    {selectedCustomer.phone && (
                      <span>Phone: {selectedCustomer.phone}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// REST OF THE CODE REMAINS EXACTLY THE SAME AS YOUR ORIGINAL
const LedgerModal = ({ 
  type, 
  clients, 
  formData, 
  setFormData, 
  onClose, 
  onSubmit,
  // New props for customer management
  customerAddresses = [],
  selectedCustomer,
  onSelectCustomer,
  onClearSelection
}) => {
    const [errors, setErrors] = useState({});
    const [gstDetails, setGstDetails] = useState({
        baseAmount: 0,
        gstAmount: 0,
        totalAmount: 0,
        gstPercentage: 18
    });
    const [customGstInput, setCustomGstInput] = useState('');
    const [showCustomInput, setShowCustomInput] = useState(false);
    const [items, setItems] = useState([{ name: '', description: '', quantity: 1, price: 0 }]);
    const [customerDetails, setCustomerDetails] = useState({
        name: '',
        company: '',
        email: '',
        phone: '',
        gstin: '',
        pan: '',
        state: '',
        pincode: '',
        address: '',
        shippingAddress: ''
    });

    // Format date to IST (Indian Standard Time)
    const formatToIST = (dateString) => {
      try {
        const date = new Date(dateString);
        return date.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      } catch (error) {
        console.error('Error formatting date:', error);
        return 'Invalid Date';
      }
    };

    // Get current date-time in IST format for input
    const getCurrentISTDateTime = () => {
      const now = new Date();
      // Convert to IST (UTC+5:30)
      const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
      const istTime = new Date(now.getTime() + istOffset);
      
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = istTime.getUTCFullYear();
      const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(istTime.getUTCDate()).padStart(2, '0');
      const hours = String(istTime.getUTCHours()).padStart(2, '0');
      const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
      
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    // Initialize with current IST date
    useEffect(() => {
      if (!formData.date) {
        setFormData(prev => ({ 
          ...prev, 
          date: getCurrentISTDateTime() 
        }));
      }
    }, []);

    const validateForm = () => {
        const newErrors = {};
        if (!formData.organization) newErrors.organization = "Organization is required";
        if (!formData.id) newErrors.id = type === "invoice" ? "Invoice ID is required" : "Payment ID is required";
        if (!formData.amount || formData.amount <= 0) newErrors.amount = "Amount must be greater than zero";
        if (!formData.date) newErrors.date = "Date is required";
        
        // Validate items for invoices
        if (type === 'invoice') {
            items.forEach((item, index) => {
                if (!item.name.trim()) newErrors[`itemName_${index}`] = "Item name is required";
                if (!item.price || item.price <= 0) newErrors[`itemPrice_${index}`] = "Item price must be greater than zero";
            });
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Auto-fill form when customer is selected
    useEffect(() => {
        if (selectedCustomer && type === 'invoice') {
            console.log('🔄 Auto-filling form with customer:', selectedCustomer);
            
            // Set organization name
            setFormData(prev => ({ 
                ...prev, 
                organization: selectedCustomer.organization 
            }));

            // Auto-fill customer details with ALL saved information
            setCustomerDetails({
                name: selectedCustomer.name || '',
                company: selectedCustomer.organization,
                email: selectedCustomer.email || '',
                phone: selectedCustomer.phone || '',
                gstin: selectedCustomer.gstin || '',
                pan: selectedCustomer.pan || '',
                state: selectedCustomer.state || '',
                pincode: selectedCustomer.pincode || '',
                address: selectedCustomer.address || '',
                shippingAddress: selectedCustomer.shippingAddress || selectedCustomer.address || ''
            });
        }
    }, [selectedCustomer, type, setFormData]);

    // Calculate total amount from items and GST
    useEffect(() => {
        if (type === 'invoice') {
            const totalBaseAmount = items.reduce((sum, item) => {
                return sum + (parseFloat(item.price) * parseInt(item.quantity));
            }, 0);
            
            const gstAmount = (totalBaseAmount * gstDetails.gstPercentage) / 100;
            const totalAmount = totalBaseAmount + gstAmount;

            setGstDetails(prev => ({
                ...prev,
                baseAmount: totalBaseAmount,
                gstAmount,
                totalAmount
            }));

            // Update the main form amount
            setFormData(prev => ({ ...prev, amount: totalBaseAmount }));
        } else {
            // For payments, just use the direct amount
            const amount = parseFloat(formData.amount) || 0;
            setGstDetails({
                baseAmount: amount,
                gstAmount: 0,
                totalAmount: amount,
                gstPercentage: 0
            });
        }
    }, [items, formData.amount, gstDetails.gstPercentage, type]);

    useEffect(() => {
        setFormData((prevFormData) => ({ ...prevFormData, type }));
    }, [type, setFormData]);

    // Auto-fill customer details when organization is selected (legacy functionality)
    useEffect(() => {
        if (formData.organization && type === 'invoice' && !selectedCustomer) {
            const selectedClient = clients.find(client => client.organization === formData.organization);
            if (selectedClient) {
                setCustomerDetails({
                    name: selectedClient.contactPerson || '',
                    company: selectedClient.organization,
                    email: selectedClient.email || '',
                    phone: selectedClient.phone || '',
                    gstin: selectedClient.gstin || '',
                    pan: selectedClient.pan || '',
                    state: selectedClient.state || '',
                    pincode: selectedClient.pincode || '',
                    address: selectedClient.address || '',
                    shippingAddress: selectedClient.shippingAddress || selectedClient.address || ''
                });
            }
        }
    }, [formData.organization, type, clients, selectedCustomer]);

    const handleSubmit = () => {
        if (!validateForm()) return;
        
        // Prepare complete customer details with ALL information
        const completeCustomerDetails = {
            ...customerDetails,
            company: formData.organization, // Ensure company name matches organization
        };

        const payload = {
            ...formData,
            amount: type === 'invoice' ? gstDetails.totalAmount : formData.amount,
            gstDetails: type === 'invoice' ? {
                ...gstDetails,
                gstin: customerDetails.gstin // Include GSTIN in gstDetails for API
            } : undefined,
            items: type === 'invoice' ? items : undefined,
            customerDetails: type === 'invoice' ? completeCustomerDetails : undefined,
            description: type === 'invoice' ? `Invoice for ${items.length} item(s)` : 'Payment received'
        };
        
        console.log('📦 Submitting payload with customer details:', payload);
        onSubmit(payload);
    };

    const handleGstPercentageChange = (percentage) => {
        setGstDetails(prev => ({
            ...prev,
            gstPercentage: parseFloat(percentage)
        }));
        setShowCustomInput(false);
        setCustomGstInput('');
    };

    const handleCustomGstSubmit = () => {
        const customPercentage = parseFloat(customGstInput);
        if (!isNaN(customPercentage) && customPercentage >= 0 && customPercentage <= 100) {
            setGstDetails(prev => ({
                ...prev,
                gstPercentage: customPercentage
            }));
            setShowCustomInput(false);
            setCustomGstInput('');
        }
    };

    // Item management functions
    const addItem = () => {
        setItems([...items, { name: '', description: '', quantity: 1, price: 0 }]);
    };

    const removeItem = (index) => {
        if (items.length > 1) {
            setItems(items.filter((_, i) => i !== index));
        }
    };

    const updateItem = (index, field, value) => {
        const updatedItems = items.map((item, i) => 
            i === index ? { ...item, [field]: value } : item
        );
        setItems(updatedItems);
    };

    const updateCustomerDetail = (field, value) => {
        setCustomerDetails(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const predefinedPercentages = [0, 5, 12, 18, 28];

    // Function to convert number to words
    const convertToWords = (num) => {
        const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        
        if (num === 0) return 'Zero';
        if (num < 20) return ones[num];
        if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ones[num % 10] : '');
        if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 !== 0 ? ' ' + convertToWords(num % 100) : '');
        if (num < 100000) return convertToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 !== 0 ? ' ' + convertToWords(num % 1000) : '');
        if (num < 10000000) return convertToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 !== 0 ? ' ' + convertToWords(num % 100000) : '');
        return convertToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 !== 0 ? ' ' + convertToWords(num % 10000000) : '');
    };

    const amountInWords = convertToWords(Math.round(gstDetails.totalAmount)) + ' Only';

    return (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 rounded-t-xl flex-shrink-0">
                    <h2 className="text-lg font-semibold text-gray-800">
                        {type === 'invoice' ? 'Create New Invoice' : 'Record Payment'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors text-xl p-1 hover:bg-gray-200 rounded-full"
                        aria-label="Close"
                    >
                        &times;
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="overflow-y-auto overflow-x-hidden flex-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-400">
                    <div className="p-6 space-y-5">
                        <form className="space-y-5">
                            {/* Customer Selection - Only for Invoices */}
                            {type === 'invoice' && customerAddresses.length > 0 && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                                    <CustomerSelector
                                        customers={customerAddresses}
                                        selectedCustomer={selectedCustomer}
                                        onSelectCustomer={onSelectCustomer}
                                        onClearSelection={onClearSelection}
                                    />
                                </div>
                            )}

                            {/* Organization - Show only if no customer selected or for payments */}
                            {(!selectedCustomer || type === 'payment') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Organization
                                    </label>
                                    <select
                                        className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-all ${errors.organization
                                            ? 'border-red-500 focus:ring-red-400 bg-red-50'
                                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                                            }`}
                                        value={formData.organization}
                                        onChange={(e) => {
                                            setFormData({ ...formData, organization: e.target.value });
                                            // Clear customer selection when manually selecting organization
                                            if (onClearSelection) onClearSelection();
                                        }}
                                    >
                                        <option value="">Select Organization</option>
                                        {clients.map((client) => (
                                            <option key={client.organization} value={client.organization}>
                                                {client.organization}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.organization && (
                                        <p className="text-red-500 text-xs mt-2 flex items-center">
                                            <span className="w-1 h-1 bg-red-500 rounded-full mr-1"></span>
                                            {errors.organization}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* ID Field */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    {type === 'invoice' ? 'Invoice Number' : 'Payment ID'}
                                </label>
                                <input
                                    type="text"
                                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-all ${errors.id 
                                        ? 'border-red-500 focus:ring-red-400 bg-red-50'
                                        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                                        }`}
                                    value={formData.id}
                                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                                    placeholder={type === 'invoice' ? 'INV-001' : 'PAY-001'}
                                />
                                {errors.id && (
                                    <p className="text-red-500 text-xs mt-2 flex items-center">
                                        <span className="w-1 h-1 bg-red-500 rounded-full mr-1"></span>
                                        {errors.id}
                                    </p>
                                )}
                            </div>

                            {/* Customer Details Section - Only for Invoices */}
                            {type === 'invoice' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-lg font-semibold text-gray-900">Customer Details</h3>
                                        {selectedCustomer && (
                                            <span className="flex items-center text-sm text-green-600 bg-green-50 px-2 py-1 rounded-lg">
                                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                                Pre-filled from saved customer
                                            </span>
                                        )}
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Contact Person</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.name}
                                                onChange={(e) => updateCustomerDetail('name', e.target.value)}
                                                placeholder="Contact person name"
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.company}
                                                onChange={(e) => updateCustomerDetail('company', e.target.value)}
                                                placeholder="Company name"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                                            <input
                                                type="email"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.email}
                                                onChange={(e) => updateCustomerDetail('email', e.target.value)}
                                                placeholder="customer@company.com"
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.phone}
                                                onChange={(e) => updateCustomerDetail('phone', e.target.value)}
                                                placeholder="+91 9876543210"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">GSTIN</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase"
                                                value={customerDetails.gstin}
                                                onChange={(e) => updateCustomerDetail('gstin', e.target.value.toUpperCase())}
                                                placeholder="29ABCDE1234F1Z5"
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">PAN</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm uppercase"
                                                value={customerDetails.pan}
                                                onChange={(e) => updateCustomerDetail('pan', e.target.value.toUpperCase())}
                                                placeholder="ABCDE1234F"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.state}
                                                onChange={(e) => updateCustomerDetail('state', e.target.value)}
                                                placeholder="State"
                                            />
                                        </div>
                                        
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Pincode</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                value={customerDetails.pincode}
                                                onChange={(e) => updateCustomerDetail('pincode', e.target.value)}
                                                placeholder="560001"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Billing Address</label>
                                        <textarea
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm resize-none"
                                            rows="3"
                                            value={customerDetails.address}
                                            onChange={(e) => updateCustomerDetail('address', e.target.value)}
                                            placeholder="Full billing address"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Shipping Address</label>
                                        <textarea
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm resize-none"
                                            rows="3"
                                            value={customerDetails.shippingAddress}
                                            onChange={(e) => updateCustomerDetail('shhippingAddress', e.target.value)}
                                            placeholder="Full shipping address (same as billing if left empty)"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Items Section - Only for Invoices */}
                            {type === 'invoice' && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-sm font-medium text-gray-700">
                                            Items & Services
                                        </label>
                                        <button
                                            type="button"
                                            onClick={addItem}
                                            className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                                        >
                                            <span>+ Add Item</span>
                                        </button>
                                    </div>

                                    {items.map((item, index) => (
                                        <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-sm font-medium text-gray-700">Item {index + 1}</h4>
                                                {items.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItem(index)}
                                                        className="text-red-500 hover:text-red-700 text-sm"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {/* Item Name */}
                                                <div>
                                                    <label className="block text-xs text-gray-600 mb-1">Item Name *</label>
                                                    <input
                                                        type="text"
                                                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-1 text-sm ${
                                                            errors[`itemName_${index}`] 
                                                            ? 'border-red-500 focus:ring-red-400' 
                                                            : 'border-gray-300 focus:ring-blue-500'
                                                        }`}
                                                        value={item.name}
                                                        onChange={(e) => updateItem(index, 'name', e.target.value)}
                                                        placeholder="e.g., Docket Lab"
                                                    />
                                                    {errors[`itemName_${index}`] && (
                                                        <p className="text-red-500 text-xs mt-1">{errors[`itemName_${index}`]}</p>
                                                    )}
                                                </div>

                                                {/* Quantity */}
                                                <div>
                                                    <label className="block text-xs text-gray-600 mb-1">Quantity</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                                        value={item.quantity}
                                                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                                                    />
                                                </div>
                                            </div>

                                            {/* Description */}
                                            <div>
                                                <label className="block text-xs text-gray-600 mb-1">Description</label>
                                                <textarea
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm resize-none"
                                                    rows="2"
                                                    value={item.description}
                                                    onChange={(e) => updateItem(index, 'description', e.target.value)}
                                                    placeholder="Describe the item or service... (e.g., 27-10 V-411,25 Wis | GST: 18% | SAC: 998213)"
                                                />
                                            </div>

                                            {/* Price */}
                                            <div>
                                                <label className="block text-xs text-gray-600 mb-1">Price per unit *</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">₹</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-1 text-sm ${
                                                            errors[`itemPrice_${index}`] 
                                                            ? 'border-red-500 focus:ring-red-400' 
                                                            : 'border-gray-300 focus:ring-blue-500'
                                                        }`}
                                                        value={item.price}
                                                        onChange={(e) => updateItem(index, 'price', parseFloat(e.target.value) || 0)}
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                                {errors[`itemPrice_${index}`] && (
                                                    <p className="text-red-500 text-xs mt-1">{errors[`itemPrice_${index}`]}</p>
                                                )}
                                            </div>

                                            {/* Item Total */}
                                            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                                                <span className="text-xs text-gray-600">Item Total:</span>
                                                <span className="text-sm font-semibold text-green-600">
                                                    ₹{(item.price * item.quantity).toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Direct Amount Input - For Payments */}
                            {type === 'payment' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Amount
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500">₹</span>
                                        <input
                                            type="number"
                                            className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-all ${errors.amount 
                                                ? 'border-red-500 focus:ring-red-400 bg-red-50'
                                                : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                                                }`}
                                            value={formData.amount}
                                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                            placeholder="0.00"
                                            min="0"
                                            step="0.01"
                                        />
                                    </div>
                                    {errors.amount && (
                                        <p className="text-red-500 text-xs mt-2 flex items-center">
                                            <span className="w-1 h-1 bg-red-500 rounded-full mr-1"></span>
                                            {errors.amount}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* GST Section - Only for Invoices */}
                            {type === 'invoice' && (
                                <div className="space-y-3">
                                    <label className="block text-sm font-medium text-gray-700">
                                        GST Settings
                                    </label>
                                    
                                    {/* GST Percentage Selector */}
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                            {predefinedPercentages.map(percentage => (
                                                <button
                                                    key={percentage}
                                                    type="button"
                                                    className={`py-2 px-3 text-sm font-medium rounded-lg border transition-all ${
                                                        gstDetails.gstPercentage === percentage && !showCustomInput
                                                            ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                                                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                                    }`}
                                                    onClick={() => handleGstPercentageChange(percentage)}
                                                >
                                                    {percentage}%
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                className={`py-2 px-3 text-sm font-medium rounded-lg border transition-all ${
                                                    showCustomInput
                                                        ? 'bg-green-500 text-white border-green-500 shadow-sm'
                                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                                }`}
                                                onClick={() => setShowCustomInput(true)}
                                            >
                                                Custom
                                            </button>
                                        </div>

                                        {/* Custom GST Input */}
                                        {showCustomInput && (
                                            <div className="flex gap-2 items-center bg-gray-50 p-3 rounded-lg border border-gray-200">
                                                <input
                                                    type="number"
                                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                                    value={customGstInput}
                                                    onChange={(e) => setCustomGstInput(e.target.value)}
                                                    placeholder="Enter GST %"
                                                    min="0"
                                                    max="100"
                                                    step="0.1"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleCustomGstSubmit}
                                                    className="px-3 py-2 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors"
                                                >
                                                    Apply
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setShowCustomInput(false);
                                                        setCustomGstInput('');
                                                    }}
                                                    className="px-3 py-2 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        )}

                                        {/* Current GST Percentage Display */}
                                        <div className="text-center">
                                            <span className="text-sm text-gray-600">Current GST: </span>
                                            <span className="text-sm font-semibold text-blue-600">{gstDetails.gstPercentage}%</span>
                                        </div>
                                    </div>

                                    {/* GST Calculation Card */}
                                    {items.some(item => item.price > 0) && (
                                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 space-y-3">
                                            <h4 className="text-sm font-semibold text-blue-800 flex items-center">
                                                <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                                                Invoice Summary
                                            </h4>
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-gray-600">Subtotal ({items.length} items):</span>
                                                    <span className="font-medium text-gray-800">₹{gstDetails.baseAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="text-gray-600">GST ({gstDetails.gstPercentage}%):</span>
                                                    <span className="font-medium text-orange-600">₹{gstDetails.gstAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between items-center pt-2 border-t border-blue-200">
                                                    <span className="text-sm font-semibold text-gray-700">Total Amount:</span>
                                                    <span className="text-lg font-bold text-green-600">₹{gstDetails.totalAmount.toFixed(2)}</span>
                                                </div>
                                                <div className="pt-2 border-t border-blue-200">
                                                    <p className="text-sm text-gray-600">
                                                        <strong>Amount in Words:</strong> {amountInWords}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Date Field - UPDATED FOR IST */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Date & Time (IST)
                                </label>
                                <input
                                    type="datetime-local"
                                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 transition-all ${errors.date 
                                        ? 'border-red-500 focus:ring-red-400 bg-red-50'
                                        : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                                        }`}
                                    value={formData.date || getCurrentISTDateTime()}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                />
                                {errors.date && (
                                    <p className="text-red-500 text-xs mt-2 flex items-center">
                                        <span className="w-1 h-1 bg-red-500 rounded-full mr-1"></span>
                                        {errors.date}
                                    </p>
                                )}
                                {/* Show selected date in IST format */}
                                {formData.date && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        Selected: {formatToIST(formData.date)}
                                    </p>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {/* Fixed Submit Button */}
                <div className="p-6 border-t border-gray-200 bg-white flex-shrink-0">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        className="w-full bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-white font-semibold py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                    >
                        {type === 'invoice' ? (
                            <div className="flex items-center justify-center space-x-2">
                                <span>Create Invoice</span>
                                {gstDetails.totalAmount > 0 && (
                                    <span className="bg-green-500 px-2 py-1 rounded-lg text-xs">
                                        ₹{gstDetails.totalAmount.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        ) : (
                            'Record Payment'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LedgerModal;