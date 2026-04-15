// Scheduler.js
import React, { useEffect, useState, useMemo, useRef } from 'react';
import apiCaller from '../services/apiCaller';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

// Real Wall Clock Component - Smaller Size
const AnalogClock = ({ selectedTime, onTimeChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [activeHand, setActiveHand] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editHours, setEditHours] = useState('');
  const [editMinutes, setEditMinutes] = useState('');
  const [editIsPM, setEditIsPM] = useState(false);
  const clockRef = useRef(null);
  const hoursInputRef = useRef(null);
  const minutesInputRef = useRef(null);

  const parseTime = (timeStr) => {
    if (!timeStr) return { hours: 12, minutes: 0, isPM: false };
    const [hoursStr, minutesStr] = timeStr.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    return { 
      hours: hours % 12 || 12, 
      minutes,
      isPM: hours >= 12
    };
  };

  const { hours, minutes, isPM } = parseTime(selectedTime);

  const formatTime = (newHours, newMinutes, newIsPM) => {
    let hours24 = newIsPM ? (newHours === 12 ? 12 : newHours + 12) : (newHours === 12 ? 0 : newHours);
    return `${String(hours24).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
  };

  const getClockPosition = (event) => {
    if (!clockRef.current) return { x: 0, y: 0 };
    const rect = clockRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      x: event.clientX - centerX,
      y: event.clientY - centerY
    };
  };

  const calculateAngle = (x, y) => {
    let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
    if (angle < 0) angle += 360;
    return angle;
  };

  const angleToTime = (angle, isHour) => {
    if (isHour) {
      let hourValue = Math.round(angle / 30);
      if (hourValue === 0) hourValue = 12;
      if (hourValue > 12) hourValue = 12;
      return hourValue;
    } else {
      let minuteValue = Math.round(angle / 6);
      if (minuteValue === 60) minuteValue = 0;
      return minuteValue;
    }
  };

  const handlePointerDown = (event, handType) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    setActiveHand(handType);
    handlePointerMove(event);
  };

  const handlePointerMove = (event) => {
    if (!isDragging || !activeHand) return;

    const { x, y } = getClockPosition(event);
    const angle = calculateAngle(x, y);
    
    if (activeHand === 'hour') {
      const newHour = angleToTime(angle, true);
      onTimeChange(formatTime(newHour, minutes, isPM));
    } else {
      const newMinute = angleToTime(angle, false);
      onTimeChange(formatTime(hours, newMinute, isPM));
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    setActiveHand(null);
  };

  const handleTimeDoubleClick = () => {
    setIsEditing(true);
    setEditHours(hours.toString());
    setEditMinutes(minutes === 0 ? '' : minutes.toString());
    setEditIsPM(isPM);
    setTimeout(() => {
      if (hoursInputRef.current) {
        hoursInputRef.current.focus();
        hoursInputRef.current.select();
      }
    }, 100);
  };

  const handleHoursChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    if (value === '' || (parseInt(value) >= 1 && parseInt(value) <= 12)) {
      setEditHours(value);
    }
  };

  const handleMinutesChange = (e) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    
    // Allow empty or any number from 0-59
    if (value === '') {
      setEditMinutes('');
    } else {
      const minutesNum = parseInt(value);
      if (minutesNum >= 0 && minutesNum <= 59) {
        setEditMinutes(value); // Keep raw input
      }
      // If invalid, don't update
    }
  };

  const handleAMPMToggle = () => {
    setEditIsPM(!editIsPM);
  };

  const handleTimeEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleTimeEditSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.target === hoursInputRef.current) {
        minutesInputRef.current?.focus();
        minutesInputRef.current?.select();
      } else if (e.target === minutesInputRef.current) {
        hoursInputRef.current?.focus();
        hoursInputRef.current?.select();
      }
    }
  };

  const handleTimeEditSave = () => {
    const hoursNum = parseInt(editHours);
    let minutesNum = parseInt(editMinutes);

    // Handle empty minutes (default to 0)
    if (editMinutes === '') {
      minutesNum = 0;
    }

    // Validate ranges
    if (isNaN(minutesNum)) minutesNum = 0;
    if (minutesNum < 0) minutesNum = 0;
    if (minutesNum > 59) minutesNum = 59;

    if (hoursNum >= 1 && hoursNum <= 12 && minutesNum >= 0 && minutesNum <= 59) {
      const newTime = formatTime(hoursNum, minutesNum, editIsPM);
      onTimeChange(newTime);
      setIsEditing(false);
    } else {
      alert('Please enter valid hours (1-12) and minutes (0-59)');
      hoursInputRef.current?.focus();
    }
  };

  const handleTimeEditBlur = (e) => {
    // Only save if the blur is not due to clicking another edit field
    if (!e.relatedTarget?.closest('.time-edit-container')) {
      setTimeout(() => {
        if (!document.activeElement?.closest('.time-edit-container')) {
          handleTimeEditSave();
        }
      }, 100);
    }
  };

  useEffect(() => {
    if (isDragging) {
      const handleMove = (e) => handlePointerMove(e);
      const handleUp = () => handlePointerUp();

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleMove, { passive: false });
      document.addEventListener('touchend', handleUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleUp);
      };
    }
  }, [isDragging, activeHand, hours, minutes, isPM]);

  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  const minuteAngle = minutes * 6;

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Smaller Professional Wall Clock Design */}
      <div className="relative">
        <div 
          className="relative w-56 h-56"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600 rounded-full shadow-sm border-6 border-slate-600">
            <div className="absolute inset-2 bg-gradient-to-br from-slate-700 via-slate-600 to-slate-500 rounded-full shadow-inner border-3 border-slate-500">
              <div
                ref={clockRef}
                className="absolute inset-2 bg-gradient-to-br from-gray-50 to-blue-50 rounded-full shadow-inner cursor-pointer select-none border border-gray-200"
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => e.preventDefault()}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    <div className="w-5 h-5 bg-gradient-to-br from-blue-600 to-blue-800 rounded-full border-2 border-slate-500 shadow-lg z-30" />
                    <div className="absolute inset-0 w-5 h-5 bg-yellow-400 rounded-full animate-ping opacity-20" />
                  </div>
                </div>

                {/* Hour Hand - Smaller */}
                <div
                  className={`absolute top-1/2 left-1/2 w-2.5 h-14 bg-gray-900 origin-top -ml-1.25 -mt-14 rounded-md cursor-grab z-20 shadow-sm ${
                    isDragging && activeHand === 'hour' ? 'scale-110 bg-gray-800' : ''
                  }`}
                  style={{
                    transform: `rotate(${hourAngle}deg)`,
                    transformOrigin: 'bottom center'
                  }}
                  onMouseDown={(e) => handlePointerDown(e, 'hour')}
                  onTouchStart={(e) => handlePointerDown(e, 'hour')}
                >
                  <div className="absolute -bottom-1 left-1/2 w-3 h-1.5 bg-gray-900 rounded-sm -ml-1.5" />
                </div>

                {/* Minute Hand - Smaller */}
                <div
                  className={`absolute top-1/2 left-1/2 w-1.5 h-20 bg-gray-800 origin-top -ml-0.75 -mt-20 rounded-md cursor-grab z-20 shadow-sm ${
                    isDragging && activeHand === 'minute' ? 'scale-110 bg-gray-700' : ''
                  }`}
                  style={{
                    transform: `rotate(${minuteAngle}deg)`,
                    transformOrigin: 'bottom center'
                  }}
                  onMouseDown={(e) => handlePointerDown(e, 'minute')}
                  onTouchStart={(e) => handlePointerDown(e, 'minute')}
                >
                  <div className="absolute -bottom-1 left-1/2 w-2.5 h-1.5 bg-gray-800 rounded-sm -ml-1.25" />
                </div>

                {/* Hour Numbers - Smaller */}
                {[
                  { hour: 'XII', angle: 0 },
                  { hour: 'I', angle: 30 },
                  { hour: 'II', angle: 60 },
                  { hour: 'III', angle: 90 },
                  { hour: 'IV', angle: 120 },
                  { hour: 'V', angle: 150 },
                  { hour: 'VI', angle: 180 },
                  { hour: 'VII', angle: 210 },
                  { hour: 'VIII', angle: 240 },
                  { hour: 'IX', angle: 270 },
                  { hour: 'X', angle: 300 },
                  { hour: 'XI', angle: 330 }
                ].map(({ hour, angle }, i) => {
                  const radius = 62;
                  const x = 50 + radius * Math.sin(angle * Math.PI / 180);
                  const y = 50 - radius * Math.cos(angle * Math.PI / 180);
                  const isMajor = i % 3 === 0;

                  return (
                    <div
                      key={hour}
                      className={`absolute pointer-events-none ${
                        isMajor ? 'text-base font-bold' : 'text-sm font-semibold'
                      } text-gray-900`}
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        transform: 'translate(-50%, -50%)',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.1)'
                      }}
                    >
                      {hour}
                    </div>
                  );
                })}

                {/* Minute Markers - Smaller */}
                {Array.from({ length: 60 }, (_, i) => {
                  if (i % 5 === 0) return null;
                  
                  const angle = i * 6;
                  const length = i % 15 === 0 ? 3 : 2;
                  const width = i % 15 === 0 ? 1.5 : 1;
                  const color = i % 15 === 0 ? '#92400e' : '#b45309';
                  
                  return (
                    <div
                      key={i}
                      className="absolute top-0 left-0 w-full h-full pointer-events-none"
                      style={{
                        transform: `rotate(${angle}deg)`
                      }}
                    >
                      <div
                        className="absolute top-2.5 left-1/2 -translate-x-1/2 rounded-full"
                        style={{
                          width: `${width}px`,
                          height: `${length}px`,
                          backgroundColor: color
                        }}
                      />
                    </div>
                  );
                })}

                {/* Quarter Markers - Smaller */}
                {[0, 90, 180, 270].map((angle) => (
                  <div
                    key={angle}
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    style={{
                      transform: `rotate(${angle}deg)`
                    }}
                  >
                    <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-0.5 h-5 bg-slate-700 rounded-full" />
                  </div>
                ))}

                {/* Brand Plate - Smaller */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 translate-y-5 pointer-events-none">
                  <div className="bg-gradient-to-b from-blue-100 to-blue-200 px-2 py-1 rounded-md shadow-inner border border-blue-400">
                    <div className="text-xs font-bold text-gray-900 tracking-tight">SCHEDULER</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Clock Hanger - Smaller */}
          <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
            <div className="w-6 h-3 bg-gradient-to-b from-slate-700 to-slate-800 rounded-t-full shadow-md" />
          </div>

          {/* Clock Shadow - Smaller */}
          <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 w-40 h-3 bg-black rounded-full blur-lg opacity-20" />
        </div>

        {/* Dragging Instructions */}
        {isDragging && (
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-xs font-semibold text-gray-900 bg-blue-50 px-2 py-1 rounded-full border border-gray-300 shadow-lg backdrop-blur-sm">
            Dragging {activeHand} hand
          </div>
        )}
      </div>

      {/* Time Display - Compact with Edit Option */}
      <div className="text-center">
        <div className="text-xs font-semibold text-gray-800 mb-2">SELECTED TIME</div>
        {isEditing ? (
          <div className="time-edit-container flex flex-col items-center gap-3 bg-blue-50 p-4 rounded-xl border-2 border-blue-500 shadow-lg">
            <div className="flex items-center gap-3">
              {/* Hours Input */}
              <div className="flex flex-col items-center">
                <label className="text-xs font-semibold text-gray-700 mb-1">HOURS</label>
                <input
                  ref={hoursInputRef}
                  type="text"
                  value={editHours}
                  onChange={handleHoursChange}
                  onKeyDown={handleTimeEditKeyDown}
                  onBlur={handleTimeEditBlur}
                  className="text-2xl font-mono font-bold text-gray-900 bg-white px-3 py-2 rounded-lg border-2 border-blue-500 shadow-inner text-center w-16"
                  placeholder="12"
                  maxLength={2}
                />
                <div className="text-xs text-blue-600 mt-1">1-12</div>
              </div>

              {/* Colon */}
              <div className="text-2xl font-bold text-gray-900 mt-6">:</div>

              {/* Minutes Input */}
              <div className="flex flex-col items-center">
                <label className="text-xs font-semibold text-gray-700 mb-1">MINUTES</label>
                <input
                  ref={minutesInputRef}
                  type="text"
                  value={editMinutes}
                  onChange={handleMinutesChange}
                  onKeyDown={handleTimeEditKeyDown}
                  onBlur={handleTimeEditBlur}
                  className="text-2xl font-mono font-bold text-gray-900 bg-white px-3 py-2 rounded-lg border-2 border-blue-500 shadow-inner text-center w-16"
                  placeholder="0"
                  maxLength={2}
                />
                <div className="text-xs text-blue-600 mt-1">0-59</div>
              </div>

              {/* AM/PM Toggle */}
              <div className="flex flex-col items-center">
                <label className="text-xs font-semibold text-gray-700 mb-1">AM/PM</label>
                <button
                  onClick={handleAMPMToggle}
                  className={`text-sm font-semibold px-3 py-1.5 rounded-md border transition-all ${
                    editIsPM 
                      ? 'bg-blue-600 text-white border-blue-700 shadow-lg' 
                      : 'bg-white text-gray-900 border-blue-500 hover:bg-blue-50'
                  }`}
                >
                  {editIsPM ? 'PM' : 'AM'}
                </button>
              </div>
            </div>

            {/* Quick Minute Presets */}
            <div className="flex flex-wrap gap-1 justify-center mt-2">
              {['0', '15', '30', '45'].map((minute) => (
                <button
                  key={minute}
                  onClick={() => setEditMinutes(minute)}
                  className={`px-2 py-1 text-xs rounded border ${
                    editMinutes === minute
                      ? 'bg-blue-500 text-white border-blue-600'
                      : 'bg-blue-50 text-gray-700 border-gray-300 hover:bg-blue-100'
                  }`}
                >
                  {minute}
                </button>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-2">
              <button
                onClick={handleTimeEditSave}
                className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-600 shadow-md flex items-center gap-2"
              >
                <span>✓</span> Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                }}
                className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-600 shadow-md flex items-center gap-2"
              >
                <span>✕</span> Cancel
              </button>
            </div>
          </div>
        ) : (
          <div 
            className="text-2xl font-mono font-bold text-gray-900 bg-blue-100 px-4 py-3 rounded-lg border border-gray-300 shadow-inner cursor-pointer hover:border-blue-500 group relative"
            onDoubleClick={handleTimeDoubleClick}
            title="Double-click to edit time"
          >
            {selectedTime || '12:00'}
            <span className="text-sm font-semibold text-gray-700 ml-2">
              {isPM ? 'PM' : 'AM'}
            </span>
            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs px-1 rounded opacity-0 group-hover:opacity-100">
              ✏️
            </div>
          </div>
        )}
        <div className="text-xs text-blue-600 mt-1">Double-click to edit hours & minutes</div>
      </div>

      {/* Quick Time Presets - Compact */}
      <div className="text-center">
        <div className="text-xs font-semibold text-gray-800 mb-2">QUICK SELECT</div>
        <div className="grid grid-cols-2 gap-1">
          {[
            { time: '09:00', label: '9AM', emoji: '☀️' },
            { time: '12:00', label: '12PM', emoji: '🕛' },
            { time: '18:00', label: '6PM', emoji: '🌇' },
            { time: '21:00', label: '9PM', emoji: '🌙' }
          ].map(({ time, label, emoji }) => (
            <button
              key={time}
              onClick={() => onTimeChange(time)}
              className={`p-1 rounded border flex items-center justify-center gap-1 ${
                selectedTime === time
                  ? 'bg-blue-500 text-white border-blue-400 shadow scale-100'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:shadow-sm'
              }`}
            >
              <span className="text-xs">{emoji}</span>
              <span className="text-xs font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const Scheduler = ({ selectedTraining, apiRoutes }) => {
  // ---------------- State ----------------
  const [activeTab, setActiveTab] = useState('create');
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [isStart, setIsStart] = useState(true);
  const [scheduleList, setScheduleList] = useState([]);
  const [existingSchedules, setExistingSchedules] = useState([]);
  const [restrictUserLogin, setRestrictUserLogin] = useState(false);
  const [userAccessOnTime, setUserAccessOnTime] = useState('');
  const [userAccessOffTime, setUserAccessOffTime] = useState('');
  const [scheduleScope, setScheduleScope] = useState('entire');
  const [vmList, setVmList] = useState([]);
  const [selectedVMs, setSelectedVMs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timeInputMode, setTimeInputMode] = useState('analog');

  // --------------- Effects ---------------
  useEffect(() => {
    if (selectedTraining) {
      getExistingSchedule(selectedTraining);
      getTrainingVMs(selectedTraining);
    }
  }, [selectedTraining]);

  useEffect(() => {
    if (selectedTraining && activeTab === 'view') {
      const interval = setInterval(() => {
        getExistingSchedule(selectedTraining);
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [selectedTraining, activeTab]);

  // --------------- Utils -----------------
  const parseLocalDate = (str) => {
    if (!str) return null;
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str)) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  const toISODate = (date) => {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const fmtDMY = (str) => {
    const d = parseLocalDate(str);
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const actionLabel = (isStart) => (isStart ? 'Power On' : 'Shut Down');

  const getEnhancedStatusDisplay = (schedule) => {
    const status = schedule.status || 'pending';
    const processed = schedule.processedVMs || 0;
    const failed = schedule.failedVMs || 0;
    const notFound = schedule.notFoundVMs || 0;

    switch (status) {
      case 'completed':
        return {
          text: 'Completed',
          color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
          icon: '✅',
        };
      case 'completed_with_errors':
        return {
          text: 'Completed with Issues',
          color: 'text-blue-600 bg-gray-50 border-gray-200',
          icon: '⚠️',
        };
      case 'failed':
        return {
          text: 'Failed',
          color: 'text-rose-600 bg-rose-50 border-rose-200',
          icon: '❌',
        };
      case 'pending':
      default:
        return {
          text: 'Pending',
          color: 'text-slate-600 bg-slate-50 border-slate-200',
          icon: '⏳',
        };
    }
  };

  const formatScopeDisplay = (schedule) => {
    if (schedule.scope === 'entire' || schedule.entireTraining === true) {
      return {
        text: 'All VMs',
        description: 'Entire training environment',
      };
    }
    const vms = schedule.targetVMs || [];
    if (vms.length === 0) {
      return {
        text: 'No VMs',
        description: 'No VMs selected',
      };
    }
    return {
      text: `${vms.length} VM${vms.length > 1 ? 's' : ''}`,
      description: vms.join(', '),
    };
  };

  const naturalSort = (a, b) => {
    const numA = parseInt((a.match(/(\d+)$/) || [0])[0], 10) || 0;
    const numB = parseInt((b.match(/(\d+)$/) || [0])[0], 10) || 0;
    const prefixA = a.replace(/(\d+)$/, '');
    const prefixB = b.replace(/(\d+)$/, '');
    const p = prefixA.localeCompare(prefixB, undefined, { numeric: false, sensitivity: 'base' });
    if (p !== 0) return p;
    return numA - numB;
  };

  // --------------- API -------------------
  const getExistingSchedule = async (training) => {
    try {
      const response = await apiCaller.get(`${apiRoutes.schedulesApi}?trainingName=${training}`);
      const schedules = response?.data?.schedules || [];
      setExistingSchedules(Array.isArray(schedules) ? schedules : []);
    } catch (error) {
      console.error('Error fetching schedule:', error);
    }
  };

  const getTrainingVMs = async (trainingName) => {
    try {
      const response = await apiCaller.get(`${apiRoutes.vmNamesApi}?trainingName=${trainingName}`);
      const vms = Array.isArray(response?.data) ? response.data : response?.data?.vmList || [];
      const vmNames = vms
        .map((vm) => (typeof vm === 'string' ? vm : vm.vmName || vm.name))
        .filter(Boolean);
      setVmList(vmNames);
    } catch (error) {
      console.error('Error fetching VMs:', error);
      setVmList([]);
    }
  };

  const toggleVMSelection = (vm) => {
    setSelectedVMs((prev) => (prev.includes(vm) ? prev.filter((v) => v !== vm) : [...prev, vm]));
  };

  const selectAllVMs = () => {
    setSelectedVMs(sortedVmList);
  };

  const deselectAllVMs = () => {
    setSelectedVMs([]);
  };

  const addSchedule = () => {
    if (selectedDates.length === 0 || !selectedTime) {
      alert('Please select at least one date and time.');
      return;
    }

    const isEntire = scheduleScope === 'entire';
    if (!isEntire && selectedVMs.length === 0) {
      alert('Please select at least one VM.');
      return;
    }

    const action = actionLabel(isStart);
    const newEntries = selectedDates.map((date) => ({
      date,
      action,
      time: selectedTime,
      status: 'Pending',
      entireTraining: isEntire,
      targetVMs: isEntire ? [] : [...selectedVMs],
    }));

    setScheduleList((prev) => [...prev, ...newEntries]);
    setSelectedTime('');
    setSelectedVMs([]);
    setScheduleScope('entire');
  };

  const removeEntry = (index) => {
    setScheduleList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (scheduleList.length === 0) {
      alert('No schedules to submit.');
      return;
    }

    setLoading(true);

    const restrictLogin = {
      restrictUserLogin,
      userAccessOnTime: restrictUserLogin ? userAccessOnTime : null,
      userAccessOffTime: restrictUserLogin ? userAccessOffTime : null,
    };

    const data = { schedules: scheduleList, restrictLogin };

    try {
      await apiCaller.post(`${apiRoutes.schedulesApi}`, {
        trainingName: selectedTraining,
        data,
      });

      alert('Schedules created successfully!');
      getExistingSchedule(selectedTraining);
      setScheduleList([]);
      setActiveTab('view');
    } catch (error) {
      console.error('Error creating schedule:', error);
      alert('Failed to create schedules.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSchedule = async (schedule) => {
    if (!window.confirm(`Are you sure you want to delete this schedule?`)) return;
    try {
      const response = await apiCaller.delete(`${apiRoutes.schedulesApi}`, {
        params: { scheduleId: schedule._id, trainingName: selectedTraining },
      });
      if (response.status === 200) {
        getExistingSchedule(selectedTraining);
        alert('Schedule deleted successfully!');
      } else {
        alert('Failed to delete schedule.');
      }
    } catch (error) {
      console.error('Error deleting schedule:', error?.message);
      alert('Error deleting schedule.');
    }
  };

  const clearAllSelections = () => {
    setSelectedDates([]);
    setSelectedTime('');
    setSelectedVMs([]);
    setScheduleScope('entire');
    setRestrictUserLogin(false);
    setUserAccessOnTime('');
    setUserAccessOffTime('');
  };

  const sortedVmList = useMemo(() => {
    return Array.isArray(vmList) ? [...vmList].sort(naturalSort) : [];
  }, [vmList]);

  const selectedDaysForCalendar = useMemo(() => {
    return selectedDates.map((d) => {
      const parts = d.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    });
  }, [selectedDates]);

  const onCalendarSelect = (dates) => {
    if (!dates) {
      setSelectedDates([]);
      return;
    }
    const arr = Array.isArray(dates) ? dates : [dates];
    const iso = arr
      .map((dt) => toISODate(dt))
      .filter(Boolean)
      .sort();
    setSelectedDates(iso);
  };

  // Tab Content Components
  const CreateScheduleTab = () => (
    <div className="space-y-6">
      <div className="rounded-xl bg-white shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900">Create new schedule</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Set up power schedules for your training instances</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Calendar and Clock Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Calendar Section */}
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-3">Select Dates</label>
              <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-inner">
                <DayPicker
                  mode="multiple"
                  selected={selectedDaysForCalendar}
                  onSelect={onCalendarSelect}
                  className="text-sm"
                />
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-sm text-gray-700">
                    {selectedDates.length} date{selectedDates.length !== 1 ? 's' : ''} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedDates([])}
                      className="text-sm text-blue-600 hover:text-gray-800 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Time Selection with Clock */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-gray-800">Set Time (IST)</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTimeInputMode('analog')}
                    className={`px-3 py-1 text-xs rounded-lg ${
                      timeInputMode === 'analog'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    🕐 Clock
                  </button>
                  <button
                    onClick={() => setTimeInputMode('digital')}
                    className={`px-3 py-1 text-xs rounded-lg ${
                      timeInputMode === 'digital'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                    }`}
                  >
                    ⏰ Digital
                  </button>
                </div>
              </div>

              {timeInputMode === 'analog' ? (
                <div 
                  className="border border-gray-200 rounded-xl p-4 bg-gradient-to-br from-gray-50 to-white flex justify-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <AnalogClock selectedTime={selectedTime} onTimeChange={setSelectedTime} />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="time"
                      value={selectedTime}
                      onChange={(e) => setSelectedTime(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 bg-white"
                    />
                    <div className="text-sm text-blue-600 whitespace-nowrap">24-hour</div>
                  </div>
                  {/* AM/PM Toggle for digital mode */}
                  {selectedTime && (
                    <div className="flex gap-2 bg-blue-100 p-2 rounded-lg border border-gray-300">
                      <button
                        onClick={() => {
                          const [hours, minutes] = selectedTime.split(':').map(Number);
                          const newIsPM = false;
                          const formatTime = (newHours, newMinutes, newIsPM) => {
                            let hours24 = newIsPM ? (newHours === 12 ? 12 : newHours + 12) : (newHours === 12 ? 0 : newHours);
                            return `${String(hours24).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
                          };
                          setSelectedTime(formatTime(hours % 12 || 12, minutes, newIsPM));
                        }}
                        className={`flex-1 py-2 text-sm font-semibold rounded-md ${
                          !(parseInt(selectedTime.split(':')[0]) >= 12)
                            ? 'bg-white text-gray-900 shadow border border-blue-400'
                            : 'text-gray-700 hover:text-gray-900 hover:bg-blue-200'
                        }`}
                      >
                        AM
                      </button>
                      <button
                        onClick={() => {
                          const [hours, minutes] = selectedTime.split(':').map(Number);
                          const newIsPM = true;
                          const formatTime = (newHours, newMinutes, newIsPM) => {
                            let hours24 = newIsPM ? (newHours === 12 ? 12 : newHours + 12) : (newHours === 12 ? 0 : newHours);
                            return `${String(hours24).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
                          };
                          setSelectedTime(formatTime(hours % 12 || 12, minutes, newIsPM));
                        }}
                        className={`flex-1 py-2 text-sm font-semibold rounded-md ${
                          parseInt(selectedTime.split(':')[0]) >= 12
                            ? 'bg-white text-gray-900 shadow border border-blue-400'
                            : 'text-gray-700 hover:text-gray-900 hover:bg-blue-200'
                        }`}
                      >
                        PM
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Scope Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-3">Scope</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setScheduleScope('entire');
                  setSelectedVMs([]);
                }}
                className={`p-4 rounded-xl border-2 text-left ${
                  scheduleScope === 'entire'
                    ? 'border-blue-500 bg-gray-50 shadow-lg'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="font-semibold text-gray-900">All VMs</div>
                <div className="text-sm text-blue-600 mt-1">Entire training</div>
              </button>
              <button
                onClick={() => setScheduleScope('specific')}
                className={`p-4 rounded-xl border-2 text-left ${
                  scheduleScope === 'specific'
                    ? 'border-blue-500 bg-gray-50 shadow-lg'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="font-semibold text-gray-900">Select VMs</div>
                <div className="text-sm text-blue-600 mt-1">Specific instances</div>
              </button>
            </div>
          </div>

          {/* VM Selection */}
          {scheduleScope === 'specific' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-gray-800">Virtual Machines</label>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllVMs}
                    className="text-sm text-blue-600 hover:text-gray-800 font-medium"
                  >
                    Select All
                  </button>
                  <button
                    onClick={deselectAllVMs}
                    className="text-sm text-blue-600 hover:text-gray-800 font-medium"
                  >
                    Deselect
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-xl p-4 max-h-48 overflow-y-auto bg-gray-50">
                <div className="grid grid-cols-2 gap-2">
                  {sortedVmList.length === 0 ? (
                    <div className="col-span-2 text-center text-gray-400 py-4">
                      No VMs available
                    </div>
                  ) : (
                    sortedVmList.map((vm) => (
                      <label
                        key={vm}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-blue-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedVMs.includes(vm)}
                          onChange={() => toggleVMSelection(vm)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{vm}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {selectedVMs.length > 0 && (
                <div className="mt-2 text-sm text-blue-600">
                  Selected {selectedVMs.length} VM{selectedVMs.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}

          {/* Action */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">Action</label>
            <div className="flex rounded-xl border border-gray-200 p-1 bg-gray-50">
              <button
                onClick={() => setIsStart(true)}
                className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg ${
                  isStart
                    ? 'bg-white text-gray-900 shadow-lg border border-gray-300'
                    : 'text-blue-600 hover:text-gray-900'
                }`}
              >
                Power On
              </button>
              <button
                onClick={() => setIsStart(false)}
                className={`flex-1 py-3 px-4 text-sm font-semibold rounded-lg ${
                  !isStart
                    ? 'bg-white text-gray-900 shadow-lg border border-gray-300'
                    : 'text-blue-600 hover:text-gray-900'
                }`}
              >
                Shut Down
              </button>
            </div>
          </div>

          {/* Access Restrictions */}
          <div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={restrictUserLogin}
                onChange={() => setRestrictUserLogin(!restrictUserLogin)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-semibold text-gray-800">Restrict User Access</span>
            </label>
            {restrictUserLogin && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-blue-600 mb-1">Access Start</label>
                  <input
                    type="time"
                    value={userAccessOnTime}
                    onChange={(e) => setUserAccessOnTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-blue-600 mb-1">Access End</label>
                  <input
                    type="time"
                    value={userAccessOffTime}
                    onChange={(e) => setUserAccessOffTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Add to Schedule Button */}
          <button
            onClick={addSchedule}
            disabled={!selectedTime || selectedDates.length === 0}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:shadow-sm disabled:bg-blue-200 disabled:cursor-not-allowed disabled:shadow-none"
          >
            Add to Schedule List
          </button>
        </div>

        {/* Pending Schedules */}
        {scheduleList.length > 0 && (
          <div className="border-t border-gray-200 p-6 bg-gray-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Pending Schedules ({scheduleList.length})
              </h3>
              <button
                onClick={() => setScheduleList([])}
                className="text-sm text-blue-600 hover:text-gray-800 font-medium"
              >
                Clear All
              </button>
            </div>
            <div className="space-y-3">
              {scheduleList.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200 shadow-sm"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {fmtDMY(item.date)} at {item.time}
                    </div>
                    <div className="text-xs text-blue-600">
                      {item.action} • {item.entireTraining ? 'All VMs' : `${item.targetVMs.length} VMs`}
                    </div>
                  </div>
                  <button
                    onClick={() => removeEntry(index)}
                    className="text-gray-400 hover:text-blue-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:shadow-sm disabled:bg-blue-200 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {loading ? 'Creating Schedules...' : 'Submit All Schedules'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const ViewSchedulesTab = () => (
    <div className="space-y-6">
      <div className="rounded-xl bg-white shadow-lg border border-gray-200">
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Active schedules</h2>
              <p className="text-gray-700 mt-1">
                Schedules are executed automatically every minute
              </p>
            </div>
            <div className="text-sm font-semibold text-gray-700 bg-white px-3 py-1 rounded-full border border-gray-300">
              {existingSchedules.length} schedule{existingSchedules.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <div className="p-6">
          {existingSchedules.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">No active schedules</h3>
              <p className="text-blue-600 mb-4">
                Create your first schedule to get started
              </p>
              <button
                onClick={() => setActiveTab('create')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create Schedule
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {existingSchedules.map((schedule, index) => {
                const statusInfo = getEnhancedStatusDisplay(schedule);
                const scopeInfo = formatScopeDisplay(schedule);
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-gray-300 bg-white shadow-sm"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-2 h-12 rounded-full ${
                        schedule.action.includes('on') ? 'bg-emerald-500' : 'bg-rose-500'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}>
                            {statusInfo.icon} {statusInfo.text}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                            schedule.action.includes('on')
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {schedule.action}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-gray-900">
                          {fmtDMY(schedule.date)} at {schedule.time}
                        </div>
                        <div className="text-sm text-blue-600 mt-1">
                          {scopeInfo.text} • {scopeInfo.description}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteSchedule(schedule)}
                      className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                      title="Delete schedule"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Information Panel */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 p-6">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">About Scheduling</h3>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>• Schedules are checked and executed every minute</li>
              <li>• All times are in IST (UTC+5:30) timezone</li>
              <li>• Power actions affect specified VMs at the scheduled time</li>
              <li>• Status updates automatically when schedules execute</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="mx-auto mb-8 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Operations</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {selectedTraining ? (
                <>Managing schedules for <span className="font-semibold text-gray-900">{selectedTraining}</span></>
              ) : (
                'No training selected'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="mx-auto max-w-7xl mb-8">
        <div className="flex space-x-1 bg-blue-50 p-2 rounded-xl border border-gray-200 shadow-inner">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2.5 px-4 text-sm font-medium rounded-lg ${
              activeTab === 'create'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-blue-600 hover:text-gray-900 hover:bg-blue-100'
            }`}
          >
            🕐 Create Schedule
          </button>
          <button
            onClick={() => setActiveTab('view')}
            className={`flex-1 py-2.5 px-4 text-sm font-medium rounded-lg ${
              activeTab === 'view'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-blue-600 hover:text-gray-900 hover:bg-blue-100'
            }`}
          >
            📋 View Schedules
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto max-w-7xl">
        {activeTab === 'create' ? <CreateScheduleTab /> : <ViewSchedulesTab />}
      </div>
    </div>
  );
};

export default Scheduler;