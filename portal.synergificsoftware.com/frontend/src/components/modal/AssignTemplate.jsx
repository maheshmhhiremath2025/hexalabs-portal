import { useState } from "react";
import { FaTimes, FaPlus } from "react-icons/fa";

export const AssignVmCardModal = ({ onClose, onAssignTemplate, organization, templates }) => {
    const [selectedOrganization, setSelectedOrganization] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState('');

    const handleAssignTemplate = () => {
        if (!selectedOrganization || !selectedTemplate) return;
        onAssignTemplate({ organization: selectedOrganization, template: selectedTemplate });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-semibold">Assign VM Card</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FaTimes className="text-lg" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            User Tag
                        </label>
                        <select
                            value={selectedOrganization}
                            onChange={(e) => setSelectedOrganization(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white"
                        >
                            <option value="">Select Organization</option>
                            {organization.map((org, index) => (
                                <option key={index} value={org}>{org}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            VM Card Name
                        </label>
                        <select
                            value={selectedTemplate}
                            onChange={(e) => setSelectedTemplate(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500 bg-white"
                        >
                            <option value="">Select VM Card Name</option>
                            {templates.map((template, index) => (
                                <option key={index} value={template.name}>{template.name}</option>
                            ))}
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
                            onClick={handleAssignTemplate}
                            className="px-3 py-1.5 rounded-lg text-sm text-white bg-gray-800 hover:bg-gray-700 flex items-center gap-1"
                        >
                            <FaPlus className="text-xs" />
                            Assign
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
