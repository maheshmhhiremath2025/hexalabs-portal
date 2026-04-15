import React, { useState } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';

export const CreateVmCardModal = ({ onClose, onCreateVmCard }) => {
    const [form, setForm] = useState({
        name: '',
        rate: '',
        resourceGroup: '',
        vmSize: '',
        imageId: '',
        location: '',
        os: '',
        vnet: '',
        licence: 'none',
        planPublisher: '',
        product: '',
        version: '',
        isOfficial: false,
        cpu: '',
        memory: '',
        storage: '',
        disk: ''
    });

    const vmSizeOptions = [
        'Standard_DS1_v2',
        'Standard_D2s_v3',
        'Standard_D4s_v3',
        'Standard_D8s_v3',
        'Standard_D16s_v3',
        'Standard_DS3_v2',
        'Standard_D2s_v3',
        'Standard_D4s_v4',
        'Standard_D8s_v4',
        'Standard_D16ds_v4'
    ];

    const licenceOptions = ['Windows_Server', 'none'];
    const osOptions = ['Windows', 'Linux'];

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = () => {
        const payload = {
            ...form,
            ...(form.isOfficial ? {
                planPublisher: form.planPublisher,
                product: form.product,
                version: form.version
            } : {})
        };
        onCreateVmCard(payload);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 border border-gray-200 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-semibold">Create VM Card</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FaTimes className="text-lg" />
                    </button>
                </div>

                <div className="space-y-4">
                    {[
                        { label: 'Name', name: 'name' },
                        { label: 'Resource Group', name: 'resourceGroup' },
                        { label: 'Rate', name: 'rate' },
                        { label: 'Image ID', name: 'imageId' },
                        { label: 'Virtual Net', name: 'vnet' },
                        { label: 'Location', name: 'location' },
                        { label: 'CPU', name: 'cpu' },
                        { label: 'Memory', name: 'memory' },
                        { label: 'Storage', name: 'storage' },
                        { label: 'Disk', name: 'disk' }
                    ].map(({ label, name }) => (
                        <div key={name}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                            <input
                                type="text"
                                name={name}
                                value={form[name]}
                                onChange={handleChange}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            />
                        </div>
                    ))}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">VM Size</label>
                        <select
                            name="vmSize"
                            value={form.vmSize}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                            <option value="">Select VM Size</option>
                            {vmSizeOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">OS</label>
                        <select
                            name="os"
                            value={form.os}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                            <option value="">Select OS</option>
                            {osOptions.map((os) => (
                                <option key={os} value={os}>{os}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Licence</label>
                        <select
                            name="licence"
                            value={form.licence}
                            onChange={handleChange}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                            <option value="">Select Licence</option>
                            {licenceOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            name="isOfficial"
                            checked={form.isOfficial}
                            onChange={handleChange}
                            className="w-4 h-4 text-gray-800 border-gray-300 rounded focus:ring-gray-500"
                            id="isOfficialCheck"
                        />
                        <label htmlFor="isOfficialCheck" className="text-sm font-medium text-gray-700">
                            Is Official
                        </label>
                    </div>

                    {form.isOfficial && (
                        <>
                            {[
                                { label: 'Plan Publisher', name: 'planPublisher' },
                                { label: 'Product', name: 'product' },
                                { label: 'Version', name: 'version' }
                            ].map(({ label, name }) => (
                                <div key={name}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                                    <input
                                        type="text"
                                        name={name}
                                        value={form[name]}
                                        onChange={handleChange}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                                    />
                                </div>
                            ))}
                        </>
                    )}

                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            className="px-3 py-1.5 rounded-lg text-sm text-white bg-gray-800 hover:bg-gray-700 flex items-center gap-1"
                        >
                            <FaPlus className="text-xs" />
                            Create
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
