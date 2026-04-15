import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { FaCheck, FaClock, FaCloud, FaArrowLeft, FaRocket, FaLock } from 'react-icons/fa';

export default function GuidedLabDetail() {
  const { slug } = useParams();
  const [lab, setLab] = useState(null);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [sandboxReady, setSandboxReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCaller.get(`/selfservice/guided-labs/${slug}`)
      .then(r => setLab(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Load progress from localStorage
    const saved = localStorage.getItem(`lab-progress-${slug}`);
    if (saved) setCompletedSteps(new Set(JSON.parse(saved)));
  }, [slug]);

  const toggleStep = (order) => {
    const next = new Set(completedSteps);
    if (next.has(order)) next.delete(order);
    else next.add(order);
    setCompletedSteps(next);
    localStorage.setItem(`lab-progress-${slug}`, JSON.stringify([...next]));
  };

  const startSandbox = async () => {
    try {
      if (lab.cloud === 'container') {
        await apiCaller.post('/selfservice/deploy', { imageKey: lab.containerImage || 'ubuntu-xfce' });
      } else {
        await apiCaller.post('/selfservice/sandbox', { cloud: lab.cloud, name: `lab-${slug.slice(0, 8)}` });
      }
      setSandboxReady(true);
    } catch {}
  };

  if (loading) return <div className="max-w-3xl mx-auto py-20 text-center"><div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto" /></div>;
  if (!lab) return <div className="max-w-3xl mx-auto py-20 text-center text-gray-500">Lab not found</div>;

  const progress = lab.steps?.length > 0 ? Math.round((completedSteps.size / lab.steps.length) * 100) : 0;
  const allDone = completedSteps.size === lab.steps?.length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <Link to="/my-labs" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"><FaArrowLeft className="w-2.5 h-2.5" /> Back to My Labs</Link>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="flex items-start gap-4">
          <span className="text-4xl">{lab.icon || '📚'}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-gray-900">{lab.title}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                lab.difficulty === 'beginner' ? 'bg-green-50 text-green-700' : lab.difficulty === 'intermediate' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
              }`}>{lab.difficulty}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                lab.cloud === 'azure' ? 'bg-blue-50 text-blue-600' : lab.cloud === 'aws' ? 'bg-amber-50 text-amber-600' : lab.cloud === 'gcp' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'
              }`}>{lab.cloud}</span>
            </div>
            <p className="text-sm text-gray-600 mt-1">{lab.description}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><FaClock className="w-3 h-3" /> {lab.duration} min</span>
              <span>{lab.category}</span>
              <span>{lab.steps?.length} steps</span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">Progress</span>
            <span className="text-xs font-semibold text-gray-700">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Start sandbox button */}
        {!sandboxReady && (
          <button onClick={startSandbox}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">
            <FaRocket className="w-3 h-3" />
            {lab.cloud === 'container' ? 'Deploy Lab Environment' : `Start ${lab.cloud.toUpperCase()} Sandbox`}
          </button>
        )}
        {sandboxReady && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            {lab.cloud === 'container' ? 'Workspace deployed! Open it from the Workspaces tab.' : 'Sandbox provisioning started. Check the Cloud Sandboxes tab for access details.'}
          </div>
        )}

        {/* Restrictions */}
        {lab.requiresSandbox && lab.sandboxConfig && (
          <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-400">
            <span>TTL: {lab.sandboxConfig.ttlHours}h</span>
            <span>Budget: ₹{lab.sandboxConfig.budgetInr}</span>
            <span>B-series VMs only</span>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="px-5 py-3.5 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">Steps ({completedSteps.size}/{lab.steps?.length})</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {lab.steps?.sort((a, b) => a.order - b.order).map(step => {
            const done = completedSteps.has(step.order);
            return (
              <div key={step.order} className={`px-5 py-4 ${done ? 'bg-green-50/30' : ''}`}>
                <div className="flex items-start gap-3">
                  <button onClick={() => toggleStep(step.order)}
                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-blue-400'
                    }`}>
                    {done && <FaCheck className="w-2.5 h-2.5" />}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono">#{step.order}</span>
                      <span className={`text-sm font-medium ${done ? 'text-green-700 line-through' : 'text-gray-800'}`}>{step.title}</span>
                    </div>
                    <p className={`text-xs mt-1 leading-relaxed ${done ? 'text-green-600' : 'text-gray-600'}`}>{step.description}</p>
                    {step.hint && (
                      <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
                        💡 {step.hint}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Completion */}
      {allDone && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="text-lg font-bold text-green-800">Lab Complete!</h3>
          <p className="text-sm text-green-700 mt-1">Great job! You've completed all {lab.steps?.length} steps.</p>
          <Link to="/my-labs" className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">
            Back to My Labs
          </Link>
        </div>
      )}
    </div>
  );
}
