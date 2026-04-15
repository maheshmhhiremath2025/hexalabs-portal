import React, { useEffect, useState } from 'react';
import apiCaller from '../services/apiCaller';
import { FaShieldAlt, FaClock, FaExclamationTriangle } from 'react-icons/fa';

const AccessRestriction = ({ selectedTraining, apiRoutes }) => {
  const [loginStart, setLoginStart] = useState(null);
  const [loginStop, setLoginStop] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (selectedTraining) {
      setLoading(true);
      setError(null);
      apiCaller
        .get(`${apiRoutes.myUserApi}?trainingName=${selectedTraining}`)
        .then((response) => {
          if (response.data) {
            setLoginStart(response.data.loginStart);
            setLoginStop(response.data.loginStop);
          } else {
            setLoginStart(null);
            setLoginStop(null);
          }
        })
        .catch(() => setError('Failed to fetch training schedule'))
        .finally(() => setLoading(false));
    }
  }, [selectedTraining, apiRoutes]);

  if (!selectedTraining) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-gray-50 to-amber-50 border border-gray-200 flex items-center justify-center mb-4">
          <FaShieldAlt className="w-6 h-6 text-gray-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700">Select a training</p>
        <p className="text-xs text-gray-400 mt-1">Choose a training from the dropdown to view access restrictions.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto mt-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 flex items-center gap-3">
        <FaExclamationTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
        <div className="text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Access Control</h2>
        <p className="text-sm text-gray-500 mt-0.5">Login window restrictions for <span className="font-medium text-gray-700">{selectedTraining}</span></p>
      </div>

      {loginStart && loginStop ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Login window active</span>
            </div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FaClock className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Login opens</span>
                </div>
                <div className="text-xl font-semibold text-gray-900 tabular-nums">{loginStart}</div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <FaClock className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-[11px] font-semibold text-red-600 uppercase tracking-wider">Login closes</span>
                </div>
                <div className="text-xl font-semibold text-gray-900 tabular-nums">{loginStop}</div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">Students can only access their labs between the login window. Outside this window, the portal blocks new sessions.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-10 text-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-3">
            <FaShieldAlt className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-sm font-medium text-gray-700">No restrictions</div>
          <div className="text-xs text-gray-400 mt-1">This training has no login window restrictions — students can access anytime.</div>
        </div>
      )}
    </div>
  );
};

export default AccessRestriction;
