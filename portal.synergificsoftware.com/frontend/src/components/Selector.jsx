import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { FaBuilding, FaFlask, FaChevronDown } from 'react-icons/fa';

const Selector = ({ setSelectedTraining, setSelectedUser, userDetails, apiRoutes }) => {
    const [userTag, setUserTag] = useState([]);
    const [trainingName, setTrainingName] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [selectedLab, setSelectedLab] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                if (userDetails.userType === "superadmin") {
                    await getUserTags();
                } else if (userDetails.userType === "admin" || userDetails.userType === "user") {
                    await getTrainingNames();
                }
            } catch (error) {
                console.error('Error in useEffect:', error);
            }
        };
        fetchData();
    }, [userDetails]);

    const handleTrainingName = (selectedValue) => {
        setSelectedLab(selectedValue);
        setSelectedTraining(selectedValue);
    };

    const handleUserTag = async (selectedValue) => {
        setSelectedCustomer(selectedValue);
        setSelectedUser(selectedValue);
        setSelectedTraining('');
        setSelectedLab('');
        await getTrainingNames(selectedValue);
    };

    const getTrainingNames = async (selectedValue = userDetails.organization) => {
        const queryParameter = userDetails.userType === "superadmin"
            ? `organization=${selectedValue}`
            : `organization=${userDetails.organization}`;
        setTrainingName([]);
        try {
            const response = await apiCaller.get(`${apiRoutes.trainingNameApi}?${queryParameter}`);
            setTrainingName(response.data.trainingNames || []);
        } catch (error) {
            console.error('Error fetching training names:', error);
        }
    };

    const getUserTags = async () => {
        try {
            const response = await apiCaller.get(apiRoutes.userTagApi);
            setUserTag(response.data.organization || []);
        } catch (error) {
            console.error('Error fetching user tags:', error);
        }
    };

    return (
        <>
            <div className="flex items-start gap-3 mb-5">
                {userDetails.userType === "superadmin" && (
                    <div className="min-w-[220px]">
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                            <FaBuilding className="text-[10px]" />
                            Customer
                        </label>
                        <div className="relative">
                            <select
                                value={selectedCustomer}
                                onChange={(e) => handleUserTag(e.target.value)}
                                className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 pr-9 text-sm text-gray-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all cursor-pointer hover:border-gray-300"
                            >
                                <option value="">Select customer...</option>
                                {userTag.length > 0 ? (
                                    userTag.map((organization, index) => (
                                        <option key={index} value={organization}>{organization}</option>
                                    ))
                                ) : (
                                    <option value="" disabled>No customers found</option>
                                )}
                            </select>
                            <FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none" />
                        </div>
                    </div>
                )}

                <div className="min-w-[220px]">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                        <FaFlask className="text-[10px]" />
                        Lab Module
                    </label>
                    <div className="relative">
                        <select
                            value={selectedLab}
                            onChange={(e) => handleTrainingName(e.target.value)}
                            className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 pr-9 text-sm text-gray-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all cursor-pointer hover:border-gray-300"
                        >
                            <option value="">Select lab module...</option>
                            {trainingName.length > 0 ? (
                                trainingName.map((training, index) => (
                                    <option key={index} value={training}>{training}</option>
                                ))
                            ) : (
                                <option value="" disabled>No labs found</option>
                            )}
                        </select>
                        <FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] pointer-events-none" />
                    </div>
                </div>

                {/* Selection indicator */}
                {selectedLab && (
                    <div className="flex items-center gap-2 self-end pb-1">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-xs text-gray-500">
                            Viewing <span className="font-medium text-gray-700">{selectedLab}</span>
                            {selectedCustomer && <> for <span className="font-medium text-gray-700">{selectedCustomer}</span></>}
                        </span>
                    </div>
                )}
            </div>

            <Outlet />
        </>
    );
};

export default Selector;
