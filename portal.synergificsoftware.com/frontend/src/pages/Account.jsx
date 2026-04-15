import React, { useEffect, useState } from 'react';
import {
  FaRupeeSign,
  FaReceipt,
  FaArrowAltCircleRight,
  FaCheckCircle,
  FaSync,
  FaExclamationTriangle,
  FaTrash,
  FaEdit,
  FaTimes,
  FaSave,
  FaDownload
} from 'react-icons/fa';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import apiCaller from '../services/apiCaller';

const Account = ({ userDetails, apiRoutes }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [amount, setAmount] = useState(0);
  const [paymentButton, setPaymentButton] = useState(false);
  const [searchParams] = useSearchParams();
  const organization = searchParams.get('organization');
  const [accountDetails, setAccountDetails] = useState({
    name: 'ABC Corp',
    gst: '27AAAAA1234A1Z5',
    balance: 0,
    limit: 0,
  });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [payableInvoices, setPayableInvoices] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [lastPaymentId, setLastPaymentId] = useState(null);
  const [paymentAllocations, setPaymentAllocations] = useState({});

  // Delete functionality states
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [editFormData, setEditFormData] = useState({});

  // Toast helper
  const showToast = (message, type = 'info', options = {}) => {
    const fn = toast[type] || toast.info;
    fn(message, { position: 'top-right', autoClose: 3000, ...options });
  };

  // Format date to IST (DATE ONLY)
  const formatToISTDate = (dateString) => {
    try {
      const date = new Date(dateString);
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(date.getTime() + istOffset);
      const day = String(istTime.getUTCDate()).padStart(2, '0');
      const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
      const year = istTime.getUTCFullYear();
      return `${day}/${month}/${year}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  // Load Razorpay script
  useEffect(() => {
    const loadRazorpay = () => {
      return new Promise((resolve) => {
        if (window.Razorpay) {
          setRazorpayLoaded(true);
          resolve(true);
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = () => {
          setRazorpayLoaded(true);
          resolve(true);
        };
        script.onerror = () => {
          console.error('Failed to load Razorpay script');
          showToast('Failed to load payment gateway.', 'error');
          resolve(false);
        };
        document.head.appendChild(script);
      });
    };
    loadRazorpay();
  }, []);

  // ===== Download helpers =====
  const buildInvoiceDownloadUrl = (invoiceId, { includeOrg = true } = {}) => {
    // Supports '/.../pdf/:id', '/.../pdf/{id}', or '/.../pdf'
    const base = apiRoutes?.downloadInvoiceApi || '/admin/ledger/invoice/pdf';
    let url = base.includes(':id')
      ? base.replace(':id', encodeURIComponent(invoiceId))
      : base.includes('{id}')
        ? base.replace('{id}', encodeURIComponent(invoiceId))
        : `${base.endsWith('/') ? base.slice(0, -1) : base}/${encodeURIComponent(invoiceId)}`;

    // only attach org when explicitly wanted (we'll retry without it on 404)
    if (includeOrg && userDetails?.userType === 'superadmin' && organization) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}organization=${encodeURIComponent(organization)}`;
    }
    return url;
  };

  const handleDownloadInvoice = async (txn) => {
    const tryDownload = async (url) => {
      const res = await apiCaller.get(url, {
        responseType: 'blob',
        headers: { Accept: 'application/pdf, application/octet-stream, */*' },
      });
      const hdrType = (res.headers?.['content-type'] || '').toLowerCase();
      const blobType = (res.data?.type || '').toLowerCase();
      const isPdf = hdrType.includes('application/pdf') || blobType.includes('pdf');

      if (!isPdf) {
        // backend likely sent JSON/text error as blob
        const text = await new Response(res.data).text();
        throw { isNonPdf: true, text, status: res.status };
      }

      const disposition = res.headers?.['content-disposition'] || '';
      const match = /filename\*?=(?:UTF-8''|")?([^\";\n]+)/i.exec(disposition);
      const rawName = (match?.[1] || '').trim();
      const suggestedName = rawName
        ? decodeURIComponent(rawName.replace(/\"/g, ''))
        : `Invoice_${txn.id}.pdf`;

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    };

    try {
      if (!txn || !(txn.invoice > 0)) {
        showToast('This row is not an invoice.', 'warning');
        return;
      }

      // 1) try with organization (for superadmin viewing a specific org)
      const urlWithOrg = buildInvoiceDownloadUrl(txn.id, { includeOrg: true });
      await tryDownload(urlWithOrg);
      showToast('Invoice PDF downloaded.', 'success');
    } catch (err) {
      // If backend says "Invoice transaction not found", retry WITHOUT org
      let backendMsg = '';
      let status = err?.response?.status || err?.status;

      try {
        if (err?.isNonPdf && err.text) {
          backendMsg = err.text;
        } else if (err?.response?.data) {
          const text = await new Response(err.response.data).text();
          backendMsg = text;
        }
      } catch {}

      const msgLower = (backendMsg || '').toLowerCase();
      const looksLikeNotFound =
        status === 404 && (msgLower.includes('invoice transaction not found') || msgLower.includes('organization not found'));

      if (looksLikeNotFound && userDetails?.userType === 'superadmin') {
        try {
          // 2) retry without org → backend will search by transaction id across orgs
          const urlNoOrg = buildInvoiceDownloadUrl(txn.id, { includeOrg: false });
          await tryDownload(urlNoOrg);
          showToast('Invoice PDF downloaded.', 'success');
          return;
        } catch (err2) {
          // fall through to final error toast
          status = err2?.response?.status || err2?.status || status;
          try {
            if (err2?.response?.data) {
              const text2 = await new Response(err2.response.data).text();
              backendMsg = text2 || backendMsg;
            }
          } catch {}
        }
      }

      // final error notice
      if (backendMsg) {
        try {
          const parsed = JSON.parse(backendMsg);
          showToast(parsed?.message || `Failed to download invoice (HTTP ${status || 'error'})`, 'error');
        } catch {
          showToast(backendMsg || `Failed to download invoice (HTTP ${status || 'error'})`, 'error');
        }
      } else {
        showToast(`Failed to download invoice PDF. ${status ? '(HTTP ' + status + ')' : ''}`, 'error');
      }
      console.error('❌ Failed to download invoice PDF:', err);
    }
  };


  // ============================

  // Calculate invoice/payments
  const calculateInvoicePayments = (transactionsData) => {
    console.log('🔄 Calculating invoice payments...', transactionsData);
    const invoices = transactionsData
      .filter((txn) => txn && txn.invoice > 0)
      .map((txn) => ({
        id: txn.id,
        date: txn.date,
        particular: txn.particular || 'Unknown Invoice',
        originalAmount: txn.invoice,
        paidAmount: 0,
        amount: txn.invoice,
        isPaid: false,
        selected: false,
      }));

    const paymentAllocationsMap = {};

    transactionsData
      .filter((txn) => txn.payment > 0)
      .forEach((payment) => {
        const paymentId = payment.id;
        const paymentAmount = payment.payment;
        paymentAllocationsMap[paymentId] = {
          paymentId,
          amount: paymentAmount,
          date: payment.date,
          allocatedInvoices: []
        };

        if (payment.paidInvoices && Array.isArray(payment.paidInvoices)) {
          payment.paidInvoices.forEach(paidInvoice => {
            const invoice = invoices.find(inv => inv.id === paidInvoice.invoiceId);
            if (invoice) {
              const amountToAllocate = paidInvoice.amount || 0;
              invoice.paidAmount += amountToAllocate;
              invoice.amount = invoice.originalAmount - invoice.paidAmount;
              invoice.isPaid = invoice.amount <= 0.01;
              paymentAllocationsMap[paymentId].allocatedInvoices.push({
                invoiceId: paidInvoice.invoiceId,
                amount: amountToAllocate,
                explicit: true
              });
              console.log(`✅ Explicit allocation: ₹${amountToAllocate} from payment ${paymentId} to invoice ${paidInvoice.invoiceId}`);
            }
          });
        } else {
          console.log(`🔄 Fallback allocation for payment ${paymentId}`);
          let remainingPayment = paymentAmount;
          const paymentDate = new Date(payment.date);
          const unpaidInvoices = invoices
            .filter(inv => !inv.isPaid && new Date(inv.date) <= paymentDate)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
          for (const invoice of unpaidInvoices) {
            if (remainingPayment <= 0) break;
            const invoiceDue = invoice.originalAmount - invoice.paidAmount;
            const amountToPay = Math.min(remainingPayment, invoiceDue);
            if (amountToPay > 0) {
              invoice.paidAmount += amountToPay;
              invoice.amount = invoice.originalAmount - invoice.paidAmount;
              invoice.isPaid = invoice.amount <= 0.01;
              remainingPayment -= amountToPay;
              paymentAllocationsMap[paymentId].allocatedInvoices.push({
                invoiceId: invoice.id,
                amount: amountToPay,
                explicit: false
              });
            }
          }
        }
      });

    invoices.forEach(invoice => {
      const transaction = transactionsData.find(txn => txn.id === invoice.id);
      if (transaction && transaction.payment > 0) {
        const manualPayment = transaction.payment;
        if (manualPayment > 0) {
          invoice.paidAmount += manualPayment;
          invoice.amount = invoice.originalAmount - invoice.paidAmount;
          invoice.isPaid = invoice.amount <= 0.01;
          console.log(`✅ Manual payment detected for ${invoice.id}: ₹${manualPayment}`);
        }
      }
    });

    setPaymentAllocations(paymentAllocationsMap);
    const payableInvoicesList = invoices.filter((inv) => !inv.isPaid && inv.amount > 0);
    console.log('🎯 Final payable invoices:', payableInvoicesList);
    console.log('📋 All invoices status:', invoices.map(inv => ({
      id: inv.id, original: inv.originalAmount, paid: inv.paidAmount, remaining: inv.amount, isPaid: inv.isPaid
    })));
    return payableInvoicesList;
  };

  // Enhanced data fetching with retry mechanism
  const getAccountDetails = async (maxRetries = 3, delay = 1000) => {
    let retries = 0;

    const fetchData = async () => {
      try {
        setLoading(true);
        let url = apiRoutes.accountApi;
        if (userDetails?.userType === 'superadmin' && organization) {
          url += `?organization=${encodeURIComponent(organization)}`;
        }

        console.log('🔄 Fetching account data from:', url);
        const response = await apiCaller.get(url);
        console.log('🔍 FULL API Response:', response);

        if (response.data.legal || response.data.account || response.data) {
          const accountData = response.data.legal || response.data.account || response.data;
          setAccountDetails(accountData);

          const transactionsData = response.data.transactions || [];
          console.log('📊 Transactions:', transactionsData);

          setTransactions(transactionsData);
          const payableInvoicesList = calculateInvoicePayments(transactionsData);

          console.log('💰 Payable invoices:', payableInvoicesList);
          setPayableInvoices(payableInvoicesList);
          setSelectedInvoices([]);
          setAmount(0);

          const shouldEnablePayment = userDetails?.userType !== 'superadmin' || organization !== null;
          setPaymentButton(shouldEnablePayment && payableInvoicesList.length > 0);

          setLastUpdate(new Date());

          if (lastPaymentId) {
            const paymentFound = transactionsData.some(
              (txn) =>
                txn.particular?.includes(lastPaymentId) ||
                (txn.payment && txn.payment > 0 && txn.date && new Date(txn.date) > new Date(Date.now() - 300000))
            );

            if (paymentFound) {
              console.log('✅ Payment transaction verified.');
              setLastPaymentId(null);
              showToast('Payment detected and applied to transactions.', 'success');
            }
          }

          return true;
        }
        return false;
      } catch (error) {
        console.error('❌ Failed to get account details:', error);
        showToast('Failed to fetch account details.', 'error');
        throw error;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };

    while (retries < maxRetries) {
      try {
        console.log(`🔁 Attempt ${retries + 1}/${maxRetries}`);
        const success = await fetchData();
        if (success) return;
      } catch (error) {
        retries++;
        if (retries < maxRetries) {
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }

    showToast('Failed to load account details after multiple attempts. Please refresh the page.', 'warning');
  };

  useEffect(() => {
    getAccountDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization, userDetails?.userType]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await getAccountDetails();
  };

  const handleInvoiceSelect = (invoiceId) => {
    const updatedInvoices = payableInvoices.map((invoice) =>
      invoice.id === invoiceId ? { ...invoice, selected: !invoice.selected } : invoice
    );
    setPayableInvoices(updatedInvoices);
    const selected = updatedInvoices.filter((inv) => inv.selected);
    const totalAmount = selected.reduce((sum, inv) => sum + inv.amount, 0);
    setSelectedInvoices(selected);
    setAmount(totalAmount);
  };

  const handleSelectAll = () => {
    const allSelected = payableInvoices.every((inv) => inv.selected);
    const updatedInvoices = payableInvoices.map((invoice) => ({
      ...invoice,
      selected: !allSelected,
    }));
    setPayableInvoices(updatedInvoices);
    const selected = updatedInvoices.filter((inv) => inv.selected);
    const totalAmount = selected.reduce((sum, inv) => sum + inv.amount, 0);
    setSelectedInvoices(selected);
    setAmount(totalAmount);
  };

  // DELETE FUNCTIONALITY
  const handleDeleteClick = (transaction) => {
    setTransactionToDelete(transaction);
    setDeleteModalVisible(true);
  };

  const confirmDelete = async () => {
    if (!transactionToDelete) return;
    try {
      setDeleteLoading(true);
      const response = await apiCaller.delete(
        `${apiRoutes.transactionApi}/${transactionToDelete.id}`,
        {
          data: {
            organization: organization || userDetails?.organization,
            transactionId: transactionToDelete.id
          }
        }
      );
      if (response.status === 200 || response.status === 204) {
        showToast('Transaction deleted successfully!', 'success');
        setTransactions(prev => prev.filter(txn => txn.id !== transactionToDelete.id));
        await getAccountDetails();
      }
    } catch (error) {
      console.error('❌ Failed to delete transaction:', error);
      showToast('Failed to delete transaction. Please try again.', 'error');
    } finally {
      setDeleteLoading(false);
      setDeleteModalVisible(false);
      setTransactionToDelete(null);
    }
  };

  const cancelDelete = () => {
    setDeleteModalVisible(false);
    setTransactionToDelete(null);
  };

  // EDIT FUNCTIONALITY
  const handleEditClick = (transaction) => {
    setEditingTransaction(transaction.id);
    setEditFormData({
      particular: transaction.particular || '',
      invoice: transaction.invoice || 0,
      payment: transaction.payment || 0,
      date: transaction.date ? new Date(transaction.date).toISOString().split('T')[0] : ''
    });
  };

  const handleEditChange = (field, value) => {
    setEditFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const saveEdit = async () => {
    if (!editingTransaction) return;
    try {
      setDeleteLoading(true);
      const response = await apiCaller.put(
        `${apiRoutes.transactionApi}/${editingTransaction}`,
        {
          ...editFormData,
          organization: organization || userDetails?.organization
        }
      );
      if (response.status === 200) {
        showToast('Transaction updated successfully!', 'success');
        setTransactions(prev => prev.map(txn =>
          txn.id === editingTransaction
            ? { ...txn, ...editFormData }
            : txn
        ));
        await getAccountDetails();
        cancelEdit();
      }
    } catch (error) {
      console.error('❌ Failed to update transaction:', error);
      showToast('Failed to update transaction. Please try again.', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const cancelEdit = () => {
    setEditingTransaction(null);
    setEditFormData({});
  };

  // Payment verification with retry
  const refreshWithRetry = async (paymentId, maxRetries = 5, initialDelay = 1000) => {
    let retries = 0;
    let delay = initialDelay;
    while (retries < maxRetries) {
      try {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await getAccountDetails();
        const paymentFound = transactions.some(
          (txn) =>
            txn.particular?.includes(paymentId) ||
            (txn.payment && txn.payment > 0 && txn.date && new Date(txn.date) > new Date(Date.now() - 300000))
        );
        if (paymentFound) {
          console.log('✅ Payment found in transaction list.');
          return true;
        }
        retries++;
        delay *= 1.5;
      } catch (err) {
        retries++;
        delay *= 1.5;
      }
    }
    console.log('⚠️ Payment verification timed out.');
    return false;
  };

  const handlePayment = async () => {
    if (!razorpayLoaded) {
      showToast('Payment system is still loading. Please wait a moment and try again.', 'info');
      return;
    }
    if (!window.Razorpay) {
      showToast('Payment gateway not available. Please refresh the page.', 'error');
      return;
    }
    if (selectedInvoices.length === 0) {
      showToast('Please select at least one invoice to pay.', 'warning');
      return;
    }
    if (amount <= 0) {
      showToast('Selected invoice amount must be greater than zero.', 'warning');
      return;
    }

    try {
      setPaymentProcessing(true);
      console.log('💳 Initiating payment for:', selectedInvoices);

      const requestPayload = {
        amount: amount,
        organization: (organization || userDetails?.organization || '').toLowerCase(),
        invoice_ids: selectedInvoices.map((inv) => inv.id),
        invoice_details: selectedInvoices.map(inv => ({
          id: inv.id,
          amount: inv.amount,
          particular: inv.particular
        }))
      };

      const orderData = await apiCaller.post(apiRoutes.orderApi, requestPayload);
      const orderId = orderData.order_id || orderData.data?.order_id || orderData.data?.id;
      if (!orderId) throw new Error('Order ID not received from server');

      const options = {
        key: 'rzp_live_CQ15Xlgh123EHo',
        amount: orderData.amount * 100,
        currency: 'INR',
        order_id: orderId,
        name: accountDetails.name || 'Synergific Software',
        description: `Payment for ${selectedInvoices.length} invoice(s): ${selectedInvoices.map(inv => inv.particular).join(', ')}`,
        image: 'https://synergificsoftware.com/assets/images/logo.png',
        handler: async (response) => {
          console.log('✅ Payment successful response:', response);
          const paymentDetails = {
            payment_id: response.razorpay_payment_id,
            order_id: response.razorpay_order_id,
            signature: response.razorpay_signature,
            amount: amount,
            organization: (organization || userDetails?.organization || '').toLowerCase(),
            invoice_ids: selectedInvoices.map((inv) => inv.id),
            invoice_details: selectedInvoices.map(inv => ({
              id: inv.id,
              amount: inv.amount,
              particular: inv.particular
            }))
          };
          setLastPaymentId(response.razorpay_payment_id);
          try {
            await verifyPayment(paymentDetails);
          } catch (error) {
            console.error('Payment verification error:', error);
            showToast('Payment processed but verification failed.', 'warning');
          } finally {
            setPaymentProcessing(false);
          }
        },
        prefill: {
          name: userDetails?.name || '',
          email: userDetails?.email || '',
        },
        theme: { color: '#2563EB' },
        modal: {
          ondismiss: function () {
            console.log('Payment modal closed');
            setPaymentProcessing(false);
          },
        },
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', function (response) {
        console.error('❌ Payment failed:', response.error);
        showToast(`Payment failed: ${response.error.description}`, 'error');
        setPaymentProcessing(false);
      });
      razorpay.open();
    } catch (error) {
      console.error('❌ Payment initiation error:', error);
      showToast(`Payment initiation failed: ${error.message || 'Please try again'}`, 'error');
      setPaymentProcessing(false);
    }
  };

  const verifyPayment = async (paymentDetails) => {
    try {
      const verifyResponse = await apiCaller.post(apiRoutes.paymentVerifyApi, paymentDetails);
      console.log('✅ Payment verification API response:', verifyResponse);
      showToast(`Payment successful — ${selectedInvoices.length} invoice${selectedInvoices.length > 1 ? 's' : ''} paid`, 'success');

      setModalVisible(false);
      setSelectedInvoices([]);
      setAmount(0);

      await getAccountDetails();
      const verificationSuccess = await refreshWithRetry(paymentDetails.payment_id);
      if (!verificationSuccess) {
        showToast('Payment processed. If transactions not updated, please refresh.', 'info');
      }
    } catch (err) {
      console.error('❌ Failed to verify payment:', err);
      showToast('Payment succeeded but verification delayed. Refreshing data...', 'warning');

      setModalVisible(false);
      setSelectedInvoices([]);
      setAmount(0);

      await getAccountDetails();
      await refreshWithRetry(paymentDetails.payment_id);
    }
  };

  const getTransactionKey = (transaction, index) =>
    `${organization}-${transaction.id}-${index}-${lastUpdate?.getTime() || ''}`;

  // Status badges
  const getTransactionStatus = (transaction) => {
    if (!transaction) return { status: 'unknown', label: 'Unknown', style: '', badge: '' };

    const invoice = transaction.invoice || 0;
    const payment = transaction.payment || 0;

    if (payment > 0 && invoice === 0) {
      return { status: 'payment', label: 'Payment', style: 'bg-blue-50', badge: 'bg-blue-100 text-blue-800' };
    }

    if (invoice > 0) {
      if (payment > 0) {
        if (payment >= invoice - 0.01) {
          return { status: 'paid', label: 'Paid', style: 'bg-green-50', badge: 'bg-green-100 text-green-800' };
        } else if (payment > 0) {
          return {
            status: 'partial',
            label: `Paid ₹${payment.toFixed(2)}`,
            style: 'bg-yellow-50',
            badge: 'bg-yellow-100 text-yellow-800'
          };
        }
      }

      let totalPaidFromOtherPayments = 0;
      Object.values(paymentAllocations).forEach(paymentAlloc => {
        paymentAlloc.allocatedInvoices.forEach(alloc => {
          if (alloc.invoiceId === transaction.id) {
            totalPaidFromOtherPayments += alloc.amount;
          }
        });
      });

      const totalPaid = payment + totalPaidFromOtherPayments;

      if (totalPaid >= invoice - 0.01) {
        return { status: 'paid', label: 'Paid', style: 'bg-green-50', badge: 'bg-green-100 text-green-800' };
      } else if (totalPaid > 0) {
        return {
          status: 'partial',
          label: `Paid ₹${totalPaid.toFixed(2)}`,
          style: 'bg-yellow-50',
          badge: 'bg-yellow-100 text-yellow-800'
        };
      } else {
        return { status: 'unpaid', label: 'Unpaid', style: '', badge: 'bg-orange-100 text-orange-800' };
      }
    }

    return { status: 'other', label: '-', style: '', badge: 'bg-gray-100 text-gray-800' };
  };

  const canModifyTransactions = userDetails?.userType === 'superadmin';

  if (loading && !refreshing) {
    return <div className="max-w-5xl mx-auto p-4 text-center">Loading account details...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <ToastContainer />

      {/* Account Info */}
      <div className="bg-gray-50 rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-blue-600">{accountDetails.name}</h2>
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing || paymentProcessing}
              className={`flex items-center gap-2 px-3 py-2 text-white rounded-lg ${refreshing || paymentProcessing ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              <FaSync className={refreshing || paymentProcessing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              disabled={!paymentButton || paymentProcessing}
              onClick={() => setModalVisible(true)}
              className={`flex items-center gap-2 px-4 py-2 text-white rounded-lg ${paymentButton && !paymentProcessing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}
            >
              <FaArrowAltCircleRight />
              {paymentProcessing ? 'Processing...' : payableInvoices.length > 0 ? 'Pay Invoices' : 'No Invoices'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="text-center">
            <h4 className="text-2xl font-bold text-green-600 flex justify-center items-center gap-1">
              <FaRupeeSign /> {accountDetails.balance?.toFixed(2) || '0.00'}
            </h4>
            <p className="text-gray-500">Overall Balance</p>
          </div>
          <div className="text-center">
            <h4 className="text-2xl font-bold text-yellow-600 flex justify-center items-center gap-1">
              <FaRupeeSign /> {accountDetails.limit?.toFixed(2) || '0.00'}
            </h4>
            <p className="text-gray-500">Credit Limit</p>
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          Last updated: {lastUpdate?.toLocaleTimeString()}
          {paymentProcessing && <span className="text-yellow-600 ml-2">Processing...</span>}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="bg-blue-600 text-white px-6 py-3 flex justify-between items-center">
          <div>
            <h4 className="text-lg font-semibold">Transactions</h4>
            {organization && <p className="text-sm text-blue-100">Organization: {organization}</p>}
            <p className="text-xs text-blue-200">Showing {transactions.length} transactions {lastUpdate && `• Updated: ${lastUpdate.toLocaleTimeString()}`}</p>
          </div>
          <button onClick={handleRefresh} disabled={refreshing || paymentProcessing} className={`flex items-center gap-2 px-3 py-1 text-sm rounded ${refreshing || paymentProcessing ? 'bg-blue-400' : 'bg-blue-700 hover:bg-blue-800'}`}>
            <FaSync className={refreshing || paymentProcessing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2">Sl</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Particular</th>
                <th className="px-4 py-2 text-green-600">Invoice</th>
                <th className="px-4 py-2 text-red-600">Payment</th>
                <th className="px-4 py-2">Balance</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Download</th>
                {canModifyTransactions && <th className="px-4 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn, i) => {
                const balance = (txn.invoice || 0) - (txn.payment || 0);
                const statusInfo = getTransactionStatus(txn);
                const isEditing = editingTransaction === txn.id;

                return (
                  <tr key={getTransactionKey(txn, i)} className={`border-b ${statusInfo.style}`}>
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editFormData.date}
                          onChange={(e) => handleEditChange('date', e.target.value)}
                          className="border rounded px-2 py-1 text-sm w-32"
                        />
                      ) : (
                        txn.date ? formatToISTDate(txn.date) : 'N/A'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editFormData.particular}
                          onChange={(e) => handleEditChange('particular', e.target.value)}
                          className="border rounded px-2 py-1 text-sm w-full"
                        />
                      ) : (
                        txn.particular || 'N/A'
                      )}
                    </td>
                    <td className="px-4 py-2 text-green-600 font-semibold">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editFormData.invoice}
                          onChange={(e) => handleEditChange('invoice', parseFloat(e.target.value) || 0)}
                          className="border rounded px-2 py-1 text-sm w-24"
                        />
                      ) : (
                        txn.invoice ? txn.invoice.toFixed(2) : '0.00'
                      )}
                    </td>
                    <td className="px-4 py-2 text-red-600 font-semibold">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editFormData.payment}
                          onChange={(e) => handleEditChange('payment', parseFloat(e.target.value) || 0)}
                          className="border rounded px-2 py-1 text-sm w-24"
                        />
                      ) : (
                        txn.payment ? txn.payment.toFixed(2) : '0.00'
                      )}
                    </td>
                    <td className="px-4 py-2 font-semibold">
                      <span className={balance > 0 ? 'text-orange-600' : 'text-green-600'}>
                        {balance.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${statusInfo.badge}`}>
                        {statusInfo.status === 'paid' && <FaCheckCircle />} {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 flex items-center gap-1">
                      <FaReceipt className="text-gray-400" /> {txn.id}
                    </td>

                    {/* Download button (enabled only for invoices) */}
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleDownloadInvoice(txn)}
                        disabled={!(txn.invoice > 0)}
                        className={`flex items-center gap-2 px-3 py-1 rounded ${
                          txn.invoice > 0 ? 'bg-gray-200 hover:bg-gray-300 text-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        }`}
                        title={txn.invoice > 0 ? 'Download Invoice PDF' : 'Not an invoice'}
                      >
                        <FaDownload /> PDF
                      </button>
                    </td>

                    {/* Action Buttons */}
                    {canModifyTransactions && (
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={saveEdit}
                                disabled={deleteLoading}
                                className="text-green-600 hover:text-green-800 p-1 rounded"
                                title="Save"
                              >
                                <FaSave className={deleteLoading ? 'animate-spin' : ''} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="text-gray-600 hover:text-gray-800 p-1 rounded"
                                title="Cancel"
                              >
                                <FaTimes />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEditClick(txn)}
                                className="text-blue-600 hover:text-blue-800 p-1 rounded"
                                title="Edit"
                              >
                                <FaEdit />
                              </button>
                              <button
                                onClick={() => handleDeleteClick(txn)}
                                className="text-red-600 hover:text-red-800 p-1 rounded"
                                title="Delete"
                              >
                                <FaTrash />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={canModifyTransactions ? '10' : '9'} className="px-4 py-4 text-center text-gray-500">
                    No transactions found for {organization || 'this account'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      <AnimatePresence>
        {modalVisible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.98 }} animate={{ scale: 1 }} exit={{ scale: 0.98 }} className="bg-white w-full max-w-2xl rounded-xl shadow p-6 space-y-4 max-h-[90vh] flex flex-col">
              <div className="flex justify-between items-center">
                <h5 className="text-lg font-bold">Pay Invoices {organization && `to ${organization}`}</h5>
                <button onClick={() => { setModalVisible(false); setSelectedInvoices([]); setAmount(0); }} className="text-gray-500 hover:text-gray-800 text-xl">&times;</button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="flex justify-between items-center mb-3">
                  <h6 className="font-semibold">Select Invoices to Pay</h6>
                  {payableInvoices.length > 0 && (
                    <button onClick={handleSelectAll} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                      {payableInvoices.every((inv) => inv.selected) ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                {payableInvoices.length > 0 ? (
                  <div className="space-y-2">
                    {payableInvoices.map((inv) => (
                      <div key={inv.id} onClick={() => handleInvoiceSelect(inv.id)} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition ${inv.selected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                        <div>
                          <p className="font-medium">{inv.particular}</p>
                          <p className="text-sm text-gray-500">{formatToISTDate(inv.date)} • ID: {inv.id}</p>
                          {inv.paidAmount > 0 && <p className="text-xs text-yellow-600">Partially paid: ₹{inv.paidAmount.toFixed(2)} • Remaining ₹{inv.amount.toFixed(2)}</p>}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-green-600"><FaRupeeSign className="inline mr-1" />{inv.amount.toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    <FaCheckCircle className="text-green-400 text-3xl mx-auto mb-2" />
                    <p>No payable invoices available.</p>
                    <p className="text-sm">All invoices have been paid.</p>
                  </div>
                )}
              </div>

              {selectedInvoices.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold">Total Amount ({selectedInvoices.length} invoice{selectedInvoices.length > 1 ? 's' : ''})</span>
                      <p className="text-sm text-green-600 mt-1">Paying for: {selectedInvoices.map(inv => inv.particular).join(', ')}</p>
                    </div>
                    <span className="text-xl font-bold text-green-700"><FaRupeeSign className="inline mr-1" />{amount.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button onClick={handlePayment} disabled={!razorpayLoaded || selectedInvoices.length === 0 || paymentProcessing} className={`w-full py-3 rounded-lg text-white font-semibold ${razorpayLoaded && selectedInvoices.length > 0 && !paymentProcessing ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 cursor-not-allowed'}`}>
                {paymentProcessing ? (<div className="flex items-center justify-center gap-2"><FaSync className="animate-spin" /> Processing Payment...</div>) : (razorpayLoaded ? `Pay ₹${amount.toFixed(2)} for ${selectedInvoices.length} Invoice${selectedInvoices.length > 1 ? 's' : ''}` : 'Loading Payment...')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteModalVisible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.98 }} animate={{ scale: 1 }} exit={{ scale: 0.98 }} className="bg-white w-full max-w-md rounded-xl shadow p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-red-100 rounded-full">
                  <FaExclamationTriangle className="text-red-600 text-xl" />
                </div>
                <h5 className="text-lg font-bold">Delete Transaction</h5>
              </div>

              <p className="text-gray-600 mb-6">
                Are you sure you want to delete this transaction? This action cannot be undone.
              </p>

              {transactionToDelete && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                  <p className="font-semibold">{transactionToDelete.particular}</p>
                  <p className="text-sm text-gray-600">
                    Date: {transactionToDelete.date ? formatToISTDate(transactionToDelete.date) : 'N/A'} • 
                    ID: {transactionToDelete.id}
                  </p>
                  <p className="text-sm">
                    {transactionToDelete.invoice > 0 && (
                      <span className="text-green-600">Invoice: ₹{transactionToDelete.invoice.toFixed(2)}</span>
                    )}
                    {transactionToDelete.payment > 0 && (
                      <span className="text-red-600">Payment: ₹{transactionToDelete.payment.toFixed(2)}</span>
                    )}
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={cancelDelete}
                  disabled={deleteLoading}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteLoading}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {deleteLoading ? <FaSync className="animate-spin" /> : <FaTrash />}
                  {deleteLoading ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Account;
