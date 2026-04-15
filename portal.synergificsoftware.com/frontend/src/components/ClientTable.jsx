import React from 'react';
import { FaRupeeSign } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

const ClientTable = ({ clients = [] }) => {
    const navigate = useNavigate();

    const handleRowClick = (organization) => {
        if (organization) {
            navigate(`/ledger/account?organization=${encodeURIComponent(organization)}`);
        }
    };

    return (
        <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="bg-primary text-white px-4 py-1">
                <h4 className="text-lg font-semibold">Client Ledger</h4>
            </div>

            <div className="overflow-x-auto">
                <table className="table-auto w-full text-sm text-left text-gray-700">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 pb-3 font-medium">#</th>
                            <th className="px-4 pb-3 font-medium">Client Name</th>
                            <th className="px-4 pb-3 font-medium">Invoice Value</th>
                            <th className="px-4 pb-3 font-medium">Payment Received</th>
                            <th className="px-4 pb-3 font-medium">Balance</th>
                        </tr>
                    </thead>

                    <tbody>
                        {clients.length > 0 ? (
                            clients.map((client, index) => (
                                <tr
                                    key={index}
                                    className="hover:bg-gray-50 cursor-pointer transition border-b border-gray-100"
                                    onClick={() => handleRowClick(client.organization)}
                                >
                                    <td className="px-4 py-3 whitespace-nowrap">{index + 1}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">{client.name}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className='flex flex-row items-center font-semibold text-blue-600'><FaRupeeSign /> {client.invoice.toFixed(2)} </div>

                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className='flex flex-row items-center font-semibold text-green-600'><FaRupeeSign /> {client.payment.toFixed(2)} </div>
                                    </td>
                                    <td className='px-4 py-3 whitespace-nowrap'>

                                        <div className={`flex flex-row items-center font-semibold ${client.balance > 0 ? 'text-red-600' : 'text-yellow-600'}`}><FaRupeeSign /> {client.balance.toFixed(2)} </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan="5" className="text-center py-6 text-gray-500">
                                    No client data available.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ClientTable;
