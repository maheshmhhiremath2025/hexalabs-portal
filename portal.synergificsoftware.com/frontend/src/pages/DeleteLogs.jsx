import React, { useState } from 'react';
import apiCaller from '../services/apiCaller';

const DeleteLogs = ({ selectedTraining, superadminApiRoutes }) => {
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        if (!selectedTraining) {
            alert('Please select a training to delete.');
            return;
        }

        const confirmDelete = window.confirm(
            `Are you sure you want to delete the training "${selectedTraining}"? This action will delete:\n\n` +
            `1. User access\n` +
            `2. All VMs in the training (from both portals)\n` +
            `3. VM Logs\n` +
            `4. Billing details (consumption)`
        );

        if (!confirmDelete) return;

        setIsLoading(true);

        try {
            const response = await apiCaller.delete(superadminApiRoutes.logsApi, {
                data: { trainingName: selectedTraining }
            });
            alert(response.data.message || 'Logs deleted successfully.');
        } catch (error) {
            alert(error?.response?.data?.message || 'An error occurred while deleting logs.');
        } finally {
            setIsLoading(false);
        }
    };

    const isDisabled = !selectedTraining || isLoading;

    return (
        <div className="bg-white rounded-xl shadow-md p-6 mx-2 space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-red-600 mb-2">⚠️ Warning</h2>
                <p className="text-gray-800 mb-2">
                    Deleting logs of a training will permanently delete the following:
                </p>
                <ul className="list-disc pl-6 text-sm text-red-700 space-y-1">
                    <li>User access</li>
                    <li>All VMs in the training (from both portals)</li>
                    <li>Logs of VMs</li>
                    <li>Billing details (consumption)</li>
                </ul>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={handleSubmit}
                    disabled={isDisabled}
                    className={`px-6 py-2 rounded-md font-medium shadow transition ${isDisabled
                        ? 'bg-red-300 text-white cursor-not-allowed'
                        : 'bg-red-600 hover:bg-red-700 text-white'
                        }`}
                >
                    {isLoading ? 'Deleting...' : 'Delete'}
                </button>
            </div>
        </div>
    );
};

export default DeleteLogs;
