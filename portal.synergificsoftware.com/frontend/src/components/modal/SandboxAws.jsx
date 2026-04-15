import { useState } from "react";
import { FaTimes, FaPlus, FaFileCsv, FaUserPlus, FaCheck } from "react-icons/fa";

export const BulkUserCreateModal = ({
    onClose,
    handleFileUpload,
    error,
    duration,
    setDuration,
    progress,
    setProgress,
    users,
    onConfirmCreateUsers,
    onReset,
}) => {
    const [loading, setLoading] = useState(false);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [showCompletion, setShowCompletion] = useState(false);

    const handleCreateUsers = async () => {
        setShowConfirmation(false);
        setLoading(true);
        setProgress(0);

        // Simulate progress (if needed)
        let prog = 0;
        const interval = setInterval(() => {
            prog += 20;
            if (prog >= 100) {
                clearInterval(interval);
                setProgress(100);
                setLoading(false);
                setShowCompletion(true);
                onConfirmCreateUsers(); // trigger actual user creation callback
            } else {
                setProgress(prog);
            }
        }, 300);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50 overflow-y-auto p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-base font-semibold">Bulk User Create</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FaTimes className="text-lg" />
                    </button>
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium">Upload CSV</h3>
                        <button
                            onClick={onReset}
                            className="p-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200"
                        >
                            <FaTimes />
                        </button>
                    </div>

                    <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                    />

                    {error && <div className="text-sm text-red-600">{error}</div>}

                    {users.length > 0 && (
                        <>
                            <div className="overflow-auto max-h-48 border border-gray-300 rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="px-3 py-2">Username</th>
                                            <th className="px-3 py-2">Personal Email</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map((user, idx) => (
                                            <tr key={idx} className="border-b">
                                                <td className="px-3 py-2">{user.username}</td>
                                                <td className="px-3 py-2">{user.personalEmail}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div>
                                <label className="block text-sm font-medium mb-1">Duration (in days)</label>
                                <input
                                    type="number"
                                    value={duration}
                                    onChange={(e) => setDuration(e.target.value)}
                                    placeholder="Enter duration"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500"
                                />
                            </div>

                            {loading && (
                                <div className="w-full bg-gray-100 rounded-full h-2.5 mt-3 overflow-hidden">
                                    <div
                                        className="bg-gray-800 h-2.5 rounded-full transition-all duration-300"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            )}

                            <button
                                className="w-full p-2 rounded-lg text-white bg-gray-800 hover:bg-gray-700 flex justify-center"
                                onClick={() => setShowConfirmation(true)}
                                disabled={loading}
                            >
                                {loading ? "Creating Users..." : <FaPlus />}
                            </button>
                        </>
                    )}
                </div>

                {/* Confirmation Modal */}
                {showConfirmation && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-xs p-5 border border-gray-200">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-base font-semibold">Confirm</h2>
                                <button onClick={() => setShowConfirmation(false)} className="text-gray-500 hover:text-gray-800">
                                    <FaTimes className="text-lg" />
                                </button>
                            </div>
                            <p className="text-sm mb-4">{users.length} users will be created. Proceed?</p>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowConfirmation(false)}
                                    className="p-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200"
                                >
                                    <FaTimes />
                                </button>
                                <button
                                    onClick={handleCreateUsers}
                                    className="p-2 rounded-lg text-white bg-gray-800 hover:bg-gray-700"
                                >
                                    <FaCheck />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Completion Modal */}
                {showCompletion && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center z-50">
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-xs p-5 border border-gray-200">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-base font-semibold">Task Completed</h2>
                                <button onClick={() => setShowCompletion(false)} className="text-gray-500 hover:text-gray-800">
                                    <FaTimes className="text-lg" />
                                </button>
                            </div>
                            <p className="text-sm mb-4">All users created successfully.</p>
                            <div className="flex justify-end">
                                <button
                                    onClick={() => setShowCompletion(false)}
                                    className="p-2 rounded-lg text-white bg-gray-800 hover:bg-gray-700"
                                >
                                    <FaCheck />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BulkUserCreateModal;