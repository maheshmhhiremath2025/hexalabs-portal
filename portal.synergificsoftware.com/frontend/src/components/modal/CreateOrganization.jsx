import { useState } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';

export const CreateOrganizationModal = ({ onClose, onCreateOrganization }) => {
    const [organization, setOrganization] = useState('');

    const handleCreateOrganization = () => {
        if (!organization.trim()) return;
        
        const payload = { 
            organization: organization.trim()
        };
        
        console.log('Creating organization with:', payload);
        onCreateOrganization(payload);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-semibold">Create Organization</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FaTimes className="text-lg" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Organization Name *
                        </label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            value={organization}
                            onChange={(e) => setOrganization(e.target.value)}
                            placeholder="e.g. Synsoft Technologies"
                            required
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 rounded-lg text-sm text-gray-700 bg-gray-100 hover:bg-gray-200"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleCreateOrganization}
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