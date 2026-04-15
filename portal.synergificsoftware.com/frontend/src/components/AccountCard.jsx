import React from 'react';
import { FaRupeeSign, FaPlusCircle, FaMoneyCheckAlt } from 'react-icons/fa';

const AccountCard = ({ accountDetails, onModalOpen }) => {
    return (
        <div className="bg-gray-50 p-6 mb-6 shadow rounded-lg">
            <h2 className="text-2xl font-bold text-primary">{accountDetails.name}</h2>

            <div className="flex justify-between items-center mt-6">
                <div className="text-center">
                    <h4 className="text-xl font-bold text-primary flex items-center justify-center gap-1">
                        <FaRupeeSign /> {accountDetails.invoiceValue.toFixed(2)}
                    </h4>
                    <p className="text-gray-500 text-sm mt-1">Invoice Value</p>
                </div>
                <div className="text-center">
                    <h4 className="text-xl font-bold text-green-600 flex items-center justify-center gap-1">
                        <FaRupeeSign /> {accountDetails.paymentReceived.toFixed(2)}
                    </h4>
                    <p className="text-gray-500 text-sm mt-1">Payment Received</p>
                </div>
                <div className="text-center">
                    <h4 className="text-xl font-bold text-red-600 flex items-center justify-center gap-1">
                        <FaRupeeSign /> {accountDetails.balance.toFixed(2)}
                    </h4>
                    <p className="text-gray-500 text-sm mt-1">Balance</p>
                </div>
            </div>

            <div className="flex justify-center gap-4 mt-6">
                <button
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-500 transition"
                    onClick={() => onModalOpen('invoice')}
                >
                    <FaPlusCircle /> Add Invoice
                </button>
                <button
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
                    onClick={() => onModalOpen('payment')}
                >
                    <FaMoneyCheckAlt /> Record Payment
                </button>
            </div>
        </div>
    );
};

export default AccountCard;
