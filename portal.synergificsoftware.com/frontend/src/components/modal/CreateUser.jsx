import { useState } from 'react';
import { FaPlus, FaTimes } from 'react-icons/fa';

export const CreateUserModal = ({ onClose, onCreateUser, organization }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [userType, setUserType] = useState('admin');
    const [selectedOrganization, setSelectedOrganization] = useState('');

    const handleCreateUser = () => {
        if (!email.trim() || !password || !selectedOrganization) return;
        onCreateUser({ email: email.trim(), password, organization: selectedOrganization, userType });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-semibold">Create User</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FaTimes className="text-lg" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter email"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                        <input
                            type="password"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
                        <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            value={selectedOrganization}
                            onChange={(e) => setSelectedOrganization(e.target.value)}
                        >
                            <option value="">Select Organization</option>
                            {organization.map((org, idx) => (
                                <option key={idx} value={org}>{org}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">User Type</label>
                        <select
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                            value={userType}
                            onChange={(e) => setUserType(e.target.value)}
                        >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                            <option value="superadmin">Super Admin</option>
                        </select>
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
                            onClick={handleCreateUser}
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
