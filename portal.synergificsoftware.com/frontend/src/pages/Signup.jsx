import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import {
  FaCloud, FaCheck, FaDocker, FaWindows, FaAws, FaGoogle, FaShieldAlt,
  FaRocket, FaUsers, FaGlobe, FaLock, FaCertificate, FaChevronRight,
  FaDatabase, FaCubes, FaHeadset, FaStar,
} from 'react-icons/fa';

const formatINR = (n) => n === 0 ? 'Free' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

function ExpandableFeatures({ features }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      {open && features.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
          <FaCheck className="text-green-500 w-2.5 h-2.5 flex-shrink-0" />
          <span>{f}</span>
        </div>
      ))}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="text-[11px] font-medium text-blue-600 hover:text-blue-800 mt-1"
      >
        {open ? 'Show less' : `+ ${features.length} more feature${features.length !== 1 ? 's' : ''}`}
      </button>
    </>
  );
}

const TRUST_STATS = [
  { value: '5', label: 'Cloud Providers', icon: FaGlobe },
  { value: '33+', label: 'Lab Images', icon: FaDocker },
  { value: '500+', label: 'Active Users', icon: FaUsers },
  { value: '99.9%', label: 'Uptime SLA', icon: FaRocket },
];

const CLOUD_LOGOS = [
  { name: 'AWS', icon: FaAws, color: 'text-[#FF9900]' },
  { name: 'Azure', icon: FaCloud, color: 'text-[#0078D4]' },
  { name: 'GCP', icon: FaGoogle, color: 'text-[#4285F4]' },
  { name: 'OCI', icon: FaDatabase, color: 'text-[#F80000]' },
  { name: 'OpenShift', icon: FaCubes, color: 'text-[#EE0000]' },
];

const CAPABILITIES = [
  { icon: FaRocket, title: 'Instant Lab Provisioning', desc: 'Deploy cloud sandboxes and workspaces in under 10 seconds' },
  { icon: FaShieldAlt, title: 'Enterprise Security', desc: 'IAM-scoped access, region-locked, service-restricted sandboxes' },
  { icon: FaCertificate, title: 'ISO Certified', desc: 'ISO 9001:2015 & ISO 10004:2018 certified operations' },
  { icon: FaLock, title: 'Auto Cost Control', desc: 'TTL cleanup, daily caps, idle shutdown, budget alerts' },
  { icon: FaHeadset, title: 'AI Lab Assistant', desc: 'Built-in AI chatbot helps students troubleshoot in real-time' },
  { icon: FaGlobe, title: 'White-Label Ready', desc: 'Deploy under your brand with custom logo, colors, and domain' },
];

export default function Signup({ onLogin }) {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [step, setStep] = useState('plans');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiCaller.get('/selfservice/plans').then(r => {
      const sorted = (r.data || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setPlans(sorted);
      const pro = sorted.find(p => p.badge) || sorted[1];
      if (pro) setSelectedPlan(pro);
    }).catch(() => {});
  }, []);

  const handleSignup = async () => {
    if (!form.email || !form.password) return setError('Email and password required');
    if (form.password.length < 6) return setError('Password must be at least 6 characters');
    setLoading(true); setError(null);

    try {
      const res = await apiCaller.post('/selfservice/signup', {
        email: form.email, password: form.password, name: form.name, planId: selectedPlan._id,
      });

      if (res.data.isFree) {
        localStorage.setItem('uid', res.data.uid);
        localStorage.setItem('email', res.data.email);
        localStorage.setItem('organization', res.data.organization);
        localStorage.setItem('AH1apq12slurt5', 'sS3lf5v1cE2b');
        onLogin();
        return;
      }

      const options = {
        key: res.data.razorpayKeyId,
        amount: res.data.amount * 100,
        currency: res.data.currency,
        name: 'Synergific Cloud Portal',
        description: `${selectedPlan.name} Plan`,
        order_id: res.data.orderId,
        handler: async (response) => {
          try {
            const verify = await apiCaller.post('/selfservice/verify-payment', {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              subscriptionId: res.data.subscriptionId,
            });
            localStorage.setItem('uid', verify.data.uid);
            localStorage.setItem('email', verify.data.email);
            localStorage.setItem('organization', verify.data.organization);
            localStorage.setItem('AH1apq12slurt5', 'sS3lf5v1cE2b');
            onLogin();
          } catch { setError('Payment verification failed. Contact support.'); }
        },
        prefill: { email: form.email, name: form.name },
        theme: { color: '#1e40af' },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) { setError(err.response?.data?.message || 'Signup failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src="/logo/logo.png" alt="Synergific" className="h-9 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-500">
            <FaCertificate className="text-green-600 w-3 h-3" />
            <span>ISO 9001:2015 & ISO 10004:2018 Certified</span>
          </div>
          <Link to="/login" className="text-sm text-blue-600 font-medium hover:underline">Sign in</Link>
        </div>
      </nav>

      {step === 'plans' && (
        <>
          {/* Hero Section */}
          <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
            <div className="max-w-6xl mx-auto px-6 py-16 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 rounded-full text-xs text-blue-200 mb-6">
                <FaShieldAlt className="w-3 h-3" />
                ISO 9001:2015 & ISO 10004:2018 Certified
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                Enterprise Cloud Training Labs
              </h1>
              <p className="text-lg text-blue-200 max-w-2xl mx-auto mb-8">
                Deploy cloud sandboxes, workspaces, and OpenShift clusters across 5 cloud providers. Used by training companies, enterprises, and universities worldwide.
              </p>

              {/* Cloud Logos */}
              <div className="flex items-center justify-center gap-6 mb-10">
                {CLOUD_LOGOS.map(c => (
                  <div key={c.name} className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors">
                    <c.icon className="text-xl" />
                    <span className="text-xs font-medium hidden sm:inline">{c.name}</span>
                  </div>
                ))}
              </div>

              {/* Trust Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
                {TRUST_STATS.map(s => (
                  <div key={s.label} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                    <s.icon className="text-blue-400 text-lg mx-auto mb-1" />
                    <div className="text-2xl font-bold">{s.value}</div>
                    <div className="text-xs text-blue-300">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Plans Section */}
          <div className="max-w-6xl mx-auto px-6 py-14">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-gray-900">Choose Your Plan</h2>
              <p className="text-gray-500 mt-2">Start free, upgrade anytime. No credit card required for free plan.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
              {plans.map(plan => (
                <button key={plan._id} onClick={() => setSelectedPlan(plan)}
                  className={`relative text-left p-5 rounded-xl border-2 transition-all ${
                    selectedPlan?._id === plan._id
                      ? 'border-blue-600 bg-blue-50/30 shadow-xl ring-1 ring-blue-600/20'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                  }`}>
                  {plan.badge && (
                    <span className="absolute -top-2.5 left-4 px-2.5 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">{plan.badge}</span>
                  )}
                  <div className="text-sm font-semibold text-gray-800">{plan.name}</div>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-gray-900">{formatINR(plan.priceMonthly)}</span>
                    {plan.priceMonthly > 0 && <span className="text-gray-400 text-sm">/mo</span>}
                  </div>

                  {plan.highlights?.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {plan.highlights.map((h, i) => (
                        <div key={i} className="text-xs text-blue-600 font-medium">{h}</div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {plan.containerHours > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <FaDocker className="text-blue-500 w-3 h-3 flex-shrink-0" />
                        <span>{plan.containerHours} workspace hours</span>
                      </div>
                    )}

                    {(plan.sandboxCredits?.azure > 0 || plan.sandboxCredits?.aws > 0 || plan.sandboxCredits?.gcp > 0 || plan.sandboxCredits?.oci > 0) && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <FaCloud className="text-cyan-500 w-3 h-3 flex-shrink-0" />
                        <span>
                          {[
                            plan.sandboxCredits?.aws > 0 && `${plan.sandboxCredits.aws} AWS`,
                            plan.sandboxCredits?.azure > 0 && `${plan.sandboxCredits.azure} Azure`,
                            plan.sandboxCredits?.gcp > 0 && `${plan.sandboxCredits.gcp} GCP`,
                            plan.sandboxCredits?.oci > 0 && `${plan.sandboxCredits.oci} OCI`,
                          ].filter(Boolean).join(' + ')} sandboxes
                        </span>
                      </div>
                    )}

                    {plan.sandboxTtlHours > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <FaCheck className="text-green-500 w-2.5 h-2.5 flex-shrink-0" />
                        <span>{plan.sandboxTtlHours}hr sandbox sessions</span>
                      </div>
                    )}

                    {plan.vmHours > 0 && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <FaWindows className="text-blue-400 w-3 h-3 flex-shrink-0" />
                        <span>{plan.vmHours}hr dedicated VMs</span>
                      </div>
                    )}

                    {plan.features?.slice(0, 4).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <FaCheck className="text-green-500 w-2.5 h-2.5 flex-shrink-0" />
                        <span>{f}</span>
                      </div>
                    ))}
                    {plan.features?.length > 4 && (
                      <ExpandableFeatures features={plan.features.slice(4)} />
                    )}
                  </div>

                  {/* Select indicator */}
                  <div className={`mt-4 py-2 text-center rounded-lg text-xs font-semibold transition-colors ${
                    selectedPlan?._id === plan._id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {selectedPlan?._id === plan._id ? 'Selected' : 'Select Plan'}
                  </div>
                </button>
              ))}
            </div>

            <div className="text-center">
              <button onClick={() => setStep('form')} disabled={!selectedPlan}
                className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm shadow-lg shadow-blue-600/20">
                {selectedPlan?.priceMonthly === 0 ? 'Start Free Trial' : `Continue with ${selectedPlan?.name}`}
                <FaChevronRight className="w-3 h-3" />
              </button>
              <p className="text-xs text-gray-400 mt-3">No credit card required for free plan</p>
            </div>
          </div>

          {/* Capabilities Section */}
          <div className="bg-gray-50 border-t border-gray-100">
            <div className="max-w-6xl mx-auto px-6 py-14">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-bold text-gray-900">Why Synergific Cloud Portal?</h2>
                <p className="text-gray-500 mt-2">Everything you need to deliver world-class cloud training</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {CAPABILITIES.map(c => (
                  <div key={c.title} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                    <c.icon className="text-blue-600 text-lg mb-3" />
                    <h3 className="font-semibold text-gray-900 text-sm mb-1">{c.title}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Testimonial / Trust Section */}
          <div className="max-w-6xl mx-auto px-6 py-14">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  quote: 'We used to spend 2 days setting up AWS labs for each batch. Now our trainers deploy 30 sandboxes in under a minute. The cost savings alone paid for the platform in the first month.',
                  name: 'Rajesh K.',
                  role: 'Technical Training Manager',
                  company: 'IT Services Company, Bangalore',
                },
                {
                  quote: 'Our CCNA and Azure students get hands-on labs instantly. The auto-cleanup means we never get surprise cloud bills anymore. ISO certification gave our clients the confidence to onboard.',
                  name: 'Priya M.',
                  role: 'Director of Learning & Development',
                  company: 'EdTech Training Provider, Hyderabad',
                },
                {
                  quote: 'We switched from Whizlabs to Synergific for our corporate training. 5 cloud providers, white-label branding, and 60% lower costs. Our clients think it is our own platform.',
                  name: 'Amit S.',
                  role: 'CEO',
                  company: 'Cloud Training Academy, Pune',
                },
              ].map((t, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                  <div className="flex items-center gap-0.5 mb-3">
                    {[1,2,3,4,5].map(s => <FaStar key={s} className="text-yellow-400 text-sm" />)}
                  </div>
                  <blockquote className="text-sm text-gray-700 leading-relaxed mb-4">"{t.quote}"</blockquote>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.role}</div>
                    <div className="text-xs text-gray-400">{t.company}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 px-6 py-6">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img src="/logo/logo.png" alt="Synergific" className="h-7 object-contain opacity-60" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="text-xs text-gray-400">Synergific Software Solutions Pvt. Ltd.</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1"><FaCertificate className="text-green-600" /> ISO 9001:2015</span>
                <span className="flex items-center gap-1"><FaCertificate className="text-green-600" /> ISO 10004:2018</span>
                <span className="flex items-center gap-1"><FaLock className="text-gray-400" /> 256-bit SSL</span>
              </div>
            </div>
          </div>
        </>
      )}

      {step === 'form' && (
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="max-w-sm w-full">
            <button onClick={() => setStep('plans')} className="text-sm text-blue-600 mb-6 hover:underline flex items-center gap-1">
              &larr; Change plan
            </button>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold text-gray-800">{selectedPlan?.name}</span>
                  {selectedPlan?.badge && <span className="ml-2 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{selectedPlan.badge}</span>}
                </div>
                <span className="text-sm font-bold text-gray-900">{formatINR(selectedPlan?.priceMonthly)}{selectedPlan?.priceMonthly > 0 ? '/mo' : ''}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {selectedPlan?.containerHours}hr workspaces + {(selectedPlan?.sandboxCredits?.aws || 0) + (selectedPlan?.sandboxCredits?.azure || 0) + (selectedPlan?.sandboxCredits?.gcp || 0) + (selectedPlan?.sandboxCredits?.oci || 0)} sandbox sessions
              </div>
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-1">Create your account</h2>
            <p className="text-gray-500 text-sm mb-6">Get started in under a minute</p>

            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Full Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Email</label>
                <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@company.com"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">Password</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>

              <button onClick={handleSignup} disabled={loading}
                className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm shadow-lg shadow-blue-600/20">
                {loading ? 'Processing...' : selectedPlan?.priceMonthly === 0 ? 'Start Free Trial' : `Pay ${formatINR(selectedPlan?.priceMonthly)} & Start`}
              </button>
            </div>

            <div className="flex items-center justify-center gap-4 mt-6 text-xs text-gray-400">
              <span className="flex items-center gap-1"><FaLock className="w-2.5 h-2.5" /> Secure</span>
              <span className="flex items-center gap-1"><FaCertificate className="w-2.5 h-2.5 text-green-600" /> ISO Certified</span>
              {selectedPlan?.priceMonthly > 0 && <span>Powered by Razorpay</span>}
            </div>

            <p className="text-[11px] text-gray-400 text-center mt-4">
              By signing up you agree to our terms of service.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
