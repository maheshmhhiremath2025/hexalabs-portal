// DemoRequestModal — opens from the "Book demo" CTA on the login page.
// Collects name/email/company/date/timing, posts to /open/demo-request,
// then shows success or error. Matches the login page's dark glassmorphism.

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import apiCaller from '../services/apiCaller';
import { FaTimes, FaArrowRight, FaCheckCircle, FaExclamationCircle, FaCalendar, FaClock, FaBuilding, FaEnvelope, FaUser } from 'react-icons/fa';

const TIMING_SLOTS = [
  'Morning (9am–12pm IST)',
  'Afternoon (12pm–3pm IST)',
  'Late afternoon (3pm–6pm IST)',
  'Evening (6pm–8pm IST)',
  'Flexible — any time',
];

export default function DemoRequestModal({ open, onClose }) {
  const [form, setForm] = useState({ name: '', email: '', company: '', demoDate: '', preferredTiming: '' });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'error', message }
  const nameRef = useRef(null);

  // Autofocus first field + reset state when modal opens
  useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', company: '', demoDate: '', preferredTiming: '' });
      setResult(null);
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open]);

  // ESC closes modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Default demoDate = 2 business days out (gives ops time to respond)
  const minDate = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 10);

  const update = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.company.trim()) {
      setResult({ type: 'error', message: 'Please fill name, email, and company.' });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await apiCaller.post('/open/demo-request', {
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        demoDate: form.demoDate,
        preferredTiming: form.preferredTiming,
      });
      setResult({ type: 'success', message: res.data?.message || 'Request received. Check your email.' });
    } catch (err) {
      setResult({ type: 'error', message: err.response?.data?.message || 'Something went wrong. Please try again or email itops@synergificsoftware.com' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          onClick={onClose}
          style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-[#020617] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-white/5 bg-gradient-to-br from-blue-600/10 to-emerald-500/5">
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute top-5 right-5 text-slate-500 hover:text-white transition-colors"
              >
                <FaTimes className="w-4 h-4" />
              </button>
              <div className="text-[10px] font-black text-blue-400/80 uppercase tracking-[0.3em]"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Book a demo
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight mt-1">
                Let's walk through it <span className="italic">together.</span>
              </h2>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Tell us a bit about you and we'll send back a calendar invite within 24 business hours.
              </p>
            </div>

            {/* Body */}
            {result?.type === 'success' ? (
              <div className="px-6 py-10 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 mb-4">
                  <FaCheckCircle className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-black text-white mb-2">Thanks — we've got it.</h3>
                <p className="text-sm text-slate-400 mb-6 max-w-sm mx-auto">{result.message}</p>
                <button
                  onClick={onClose}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black font-bold text-sm rounded-full hover:scale-[1.02] transition-transform"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <Field icon={FaUser}     label="Full name"  placeholder="Jane Sharma"
                  inputRef={nameRef} value={form.name} onChange={update('name')} required />
                <Field icon={FaEnvelope} label="Work email" placeholder="jane@yourcompany.com"
                  type="email" value={form.email} onChange={update('email')} required />
                <Field icon={FaBuilding} label="Company"    placeholder="SpringPeople"
                  value={form.company} onChange={update('company')} required />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field icon={FaCalendar} label="Preferred date" type="date" min={minDate}
                    value={form.demoDate} onChange={update('demoDate')} />
                  <div className="space-y-2 group">
                    <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest pl-1 group-focus-within:text-blue-400 transition-colors">
                      Preferred timing
                    </label>
                    <div className="relative">
                      <FaClock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors w-3.5 h-3.5 z-10" />
                      <select
                        value={form.preferredTiming}
                        onChange={update('preferredTiming')}
                        className="w-full h-11 bg-white/[0.03] border border-white/10 rounded-xl pl-11 pr-4 text-white focus:outline-none focus:border-blue-500/50 transition-all text-sm font-medium appearance-none cursor-pointer"
                      >
                        <option value="" className="bg-[#020617]">Flexible</option>
                        {TIMING_SLOTS.map(s => (
                          <option key={s} value={s} className="bg-[#020617]">{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {result?.type === 'error' && (
                  <div className="flex items-center gap-2.5 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
                    <FaExclamationCircle className="w-4 h-4 flex-shrink-0" />
                    {result.message}
                  </div>
                )}

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  disabled={submitting}
                  className="w-full h-12 overflow-hidden rounded-xl bg-white text-black font-black text-sm tracking-tight disabled:opacity-60 transition-all flex items-center justify-center gap-2.5 mt-2"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 border-[2.5px] border-black/20 border-t-black rounded-full animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <span>Send request</span>
                      <FaArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </motion.button>

                <p className="text-[11px] text-slate-500 text-center pt-1">
                  By submitting, you agree we can email you about this demo. We won't share your details.
                </p>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Small labeled input with leading icon — matches Login.jsx field style.
function Field({ icon: Icon, label, inputRef, ...inputProps }) {
  return (
    <div className="space-y-2 group">
      <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest pl-1 group-focus-within:text-blue-400 transition-colors">
        {label}
      </label>
      <div className="relative">
        {Icon && <Icon className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-blue-400 transition-colors w-3.5 h-3.5" />}
        <input
          ref={inputRef}
          {...inputProps}
          className={`w-full h-11 bg-white/[0.03] border border-white/10 rounded-xl ${Icon ? 'pl-11' : 'pl-4'} pr-4 text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-600 text-sm font-medium`}
        />
      </div>
    </div>
  );
}
