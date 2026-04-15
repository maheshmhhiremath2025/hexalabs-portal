import React, { useState, useEffect } from 'react';
import apiCaller from '../services/apiCaller';

export default function Ports({ selectedTraining, apiRoutes }) {
    const [existingPorts, setExistingPorts] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [newPort, setNewPort] = useState('');
    const [portDirection, setPortDirection] = useState('inbound');
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAddPort = () => setShowModal(true);
    const handleCloseModal = () => {
        setShowModal(false);
        setNewPort('');
        setPortDirection('inbound');
    };

    const handleModalSubmit = () => {
        if (!newPort) return;
        console.log('✅ Modal submitting with direction:', portDirection);
        handleOpenPort(newPort, portDirection);
        setShowModal(false);
        setNewPort('');
        setPortDirection('inbound');
    };

    const handleDeletePort = async (deletePort, direction = 'inbound') => {
        const directionText = direction === 'both' ? 'Inbound & Outbound' : 
                            direction === 'outbound' ? 'Outbound' : 'Inbound';
        
        const confirmDelete = window.confirm(
            `Are you sure you want to delete ${directionText} Port: ${deletePort} from the Training: ${selectedTraining}?`
        );
        if (!confirmDelete) return;

        console.log('🗑️ Deleting port:', {
            trainingName: selectedTraining,
            port: deletePort,
            direction: direction,
            apiUrl: apiRoutes.portsApi
        });

        try {
            const res = await apiCaller.delete(`${apiRoutes.portsApi}`, {
                data: {
                    trainingName: selectedTraining,
                    port: deletePort,
                    direction: direction
                },
            });

            console.log('✅ Delete response:', res.status, res.data);
            
            if (res.status === 200) {
                // Remove the port from local state
                setExistingPorts(prevPorts => 
                    prevPorts.filter(port => port.portNumber !== deletePort)
                );
            } else {
                console.error('❌ Failed to delete port:', res.data.error);
                alert(`Delete failed: ${res.data.error}`);
            }
        } catch (err) {
            console.error('❌ Error deleting port:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status
            });
            alert(`Error deleting port: ${err.response?.data?.error || err.message}`);
        }
    };

    const handleOpenPort = async (port, direction = 'inbound') => {
        const data = {
            trainingName: selectedTraining,
            port,
            priority: existingPorts.length + 1001,
            direction: direction
        };

        console.log('🎯 DEBUG - API Payload being sent:', JSON.stringify(data, null, 2));
        console.log('🔧 Opening port request:', {
            data,
            apiUrl: apiRoutes.portsApi,
            selectedTraining,
            direction
        });

        setIsLoading(true);
        try {
            const res = await apiCaller.post(`${apiRoutes.portsApi}`, data);
            
            console.log('✅ Open port response:', {
                status: res.status,
                data: res.data
            });
            
            const directionText = direction === 'both' ? 'Inbound & Outbound' : 
                                direction === 'outbound' ? 'Outbound' : 'Inbound';
            
            // Add the new port to local state with direction
            const newPortObj = {
                portNumber: port,
                direction: direction
            };
            
            setExistingPorts(prevPorts => [...prevPorts, newPortObj]);
            
            alert(res.data.message || `${directionText} Port ${port} opened successfully`);
        } catch (err) {
            console.error('❌ Error opening port:', {
                message: err.message,
                response: err.response?.data,
                status: err.response?.status,
                config: err.config
            });
            
            alert(`Failed to open port: ${err.response?.data?.error || err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const getExistingPorts = () => {
        if (!selectedTraining) {
            console.log('⚠️ No training selected');
            return;
        }

        const query = `trainingName=${selectedTraining}`;
        const url = `${apiRoutes.portsApi}?${query}`;
        
        console.log('📡 Fetching ports:', url);

        setIsLoading(true);
        apiCaller
            .get(url)
            .then((res) => {
                console.log('✅ Ports fetched:', res.data);
                
                // For existing ports from backend, we don't know the direction
                // So we'll default them to 'inbound' and let new ports have their actual direction
                const portsWithDirection = (res.data.ports || []).map(port => ({
                    portNumber: port,
                    direction: 'inbound' // Default for existing ports
                }));
                
                setExistingPorts(portsWithDirection);
            })
            .catch((err) => {
                console.error('❌ Error fetching ports:', {
                    message: err.message,
                    response: err.response?.data,
                    status: err.response?.status
                });
                setExistingPorts([]);
            })
            .finally(() => setIsLoading(false));
    };

    // Helper function to get direction badge color and text
    const getDirectionBadge = (direction) => {
        const styles = {
            inbound: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Inbound' },
            outbound: { bg: 'bg-green-100', text: 'text-green-800', label: 'Outbound' },
            both: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Both' }
        };
        return styles[direction] || styles.inbound;
    };

    useEffect(() => {
        console.log('🔄 Ports component updated:', {
            selectedTraining,
            existingPortsCount: existingPorts.length
        });
        
        if (selectedTraining) {
            getExistingPorts();
        } else {
            setExistingPorts([]);
        }
    }, [selectedTraining]);

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Networking</h1>
                    <p className="text-sm text-gray-500 mt-0.5">Manage firewall port rules for your training VMs</p>
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                    onClick={handleAddPort}
                    disabled={!selectedTraining || isLoading}
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Open Port
                </button>
            </div>

            {/* Training Selection Alert */}
            {!selectedTraining && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-50 to-blue-50 border border-gray-200 flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700">Select a training</p>
                    <p className="text-xs text-gray-400 mt-1">Choose a training from the dropdown to manage its firewall rules.</p>
                </div>
            )}

            {/* Ports Table */}
            {selectedTraining && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-gray-900">Open ports</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{selectedTraining} · {existingPorts.length} rule{existingPorts.length !== 1 ? 's' : ''}</div>
                        </div>
                        <button onClick={getExistingPorts} disabled={isLoading}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors" title="Refresh">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        </button>
                    </div>

                        {isLoading ? (
                            <div className="flex justify-center items-center py-16">
                                <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                            </div>
                        ) : existingPorts.length > 0 ? (
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200 text-left">
                                        <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Port</th>
                                        <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Direction</th>
                                        <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {existingPorts.map((port, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50/50">
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base font-mono font-semibold text-gray-900">{port.portNumber}</span>
                                                    <span className="text-[11px] text-gray-400">TCP</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`${getDirectionBadge(port.direction).bg} ${getDirectionBadge(port.direction).text} px-2 py-0.5 rounded-md text-[11px] font-medium`}>
                                                    {getDirectionBadge(port.direction).label}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                                    <span className="text-xs text-green-700 font-medium">Active</span>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                <button
                                                    onClick={() => handleDeletePort(port.portNumber, port.direction)}
                                                    className="text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 px-2.5 py-1 rounded-md transition-colors"
                                                >
                                                    Close
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="text-center py-14">
                                <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-3">
                                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                </div>
                                <p className="text-sm font-medium text-gray-700">No open ports</p>
                                <p className="text-xs text-gray-400 mt-1">Click "Open Port" to add a firewall rule.</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Modal with Direction Selection */}
                {showModal && (
                    <div className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/50 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-gray-200">
                            <div className="p-6">
                                <div className="flex items-center justify-between mb-5">
                                    <h3 className="text-base font-semibold text-gray-900">Open port</h3>
                                    <button
                                        onClick={handleCloseModal}
                                        className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                                
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Port Number
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g., 8080, 3000, 80"
                                            value={newPort}
                                            onChange={(e) => setNewPort(e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-lg font-mono"
                                        />
                                        <p className="text-sm text-gray-500 mt-2">
                                            Enter a valid port number between 1 and 65535
                                        </p>
                                    </div>
                                    
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Port Direction
                                        </label>
                                        <div className="grid grid-cols-3 gap-3">
                                            {[
                                                { value: 'inbound', label: 'Inbound', desc: 'Traffic to VM' },
                                                { value: 'outbound', label: 'Outbound', desc: 'Traffic from VM' },
                                                { value: 'both', label: 'Both', desc: 'In & Out' }
                                            ].map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    onClick={() => setPortDirection(option.value)}
                                                    className={`p-3 border rounded-xl text-center transition-all duration-200 ${
                                                        portDirection === option.value
                                                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                                                            : 'border-gray-300 hover:border-gray-400'
                                                    }`}
                                                >
                                                    <div className="font-medium text-gray-900">{option.label}</div>
                                                    <div className="text-xs text-gray-500 mt-1">{option.desc}</div>
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-sm text-gray-500 mt-2">
                                            Selected: <span className="font-semibold text-blue-600">
                                                {portDirection === 'both' ? 'Inbound & Outbound' : 
                                                 portDirection === 'outbound' ? 'Outbound' : 'Inbound'}
                                            </span>
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="flex justify-end gap-2 mt-6 pt-5 border-t border-gray-200">
                                    <button onClick={handleCloseModal} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
                                    <button onClick={handleModalSubmit} disabled={!newPort || isLoading}
                                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                                        {isLoading ? 'Opening...' : 'Open Port'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
}