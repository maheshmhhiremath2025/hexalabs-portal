import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { FaAws, FaCloud, FaGoogle, FaBook, FaLayerGroup, FaShieldAlt, FaClock, FaRupeeSign, FaGraduationCap, FaSearch } from 'react-icons/fa';

const CLOUD_META = {
  aws:   { label: 'AWS',   Icon: FaAws,    color: 'text-amber-600', pill: 'bg-amber-50 text-amber-700 border-amber-200' },
  azure: { label: 'Azure', Icon: FaCloud,  color: 'text-blue-600',  pill: 'bg-blue-50 text-blue-700 border-blue-200' },
  gcp:   { label: 'GCP',   Icon: FaGoogle, color: 'text-red-600',   pill: 'bg-red-50 text-red-700 border-red-200' },
};

const LEVEL_META = {
  foundational: { label: 'Foundational', pill: 'bg-green-50 text-green-700 border-green-200' },
  associate:    { label: 'Associate',    pill: 'bg-blue-50 text-blue-700 border-blue-200' },
  professional: { label: 'Professional', pill: 'bg-purple-50 text-purple-700 border-purple-200' },
  specialty:    { label: 'Specialty',    pill: 'bg-pink-50 text-pink-700 border-pink-200' },
};

export default function CourseCatalog() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cloudFilter, setCloudFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [search, setSearch] = useState('');

  const fetchTemplates = () => {
    setLoading(true);
    apiCaller.get('/sandbox-templates')
      .then(r => setTemplates(r.data || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load courses'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleDeleteTemplate = async (slug) => {
    try {
      await apiCaller.delete(`/sandbox-templates/${slug}`);
      setTemplates(prev => prev.filter(t => t.slug !== slug));
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to delete template');
    }
  };

  // Check if user is admin (only admins see delete buttons)
  const userType = localStorage.getItem('AH1apq12slurt5');
  const isAdmin = userType === 'z829Sgry6AkYJ' || userType === 'hpQ3s5dK247';

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (cloudFilter !== 'all' && t.cloud !== cloudFilter) return false;
      if (levelFilter !== 'all' && t.certificationLevel !== levelFilter) return false;
      if (search && !(`${t.name} ${t.certificationCode} ${t.description}`).toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [templates, cloudFilter, levelFilter, search]);

  const stats = useMemo(() => ({
    total: templates.length,
    aws: templates.filter(t => t.cloud === 'aws').length,
    azure: templates.filter(t => t.cloud === 'azure').length,
    gcp: templates.filter(t => t.cloud === 'gcp').length,
  }), [templates]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
          <FaGraduationCap className="w-3 h-3" /> <span>Training</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Course Catalog</h1>
        <p className="text-sm text-gray-600 mt-1">Certification-aligned sandbox templates. Deploy a pre-configured cloud environment with the exact services, IAM policies, and budget needed for each course.</p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total courses" value={stats.total} icon={FaBook} color="text-gray-700" />
        <StatCard label="AWS" value={stats.aws} icon={FaAws} color="text-amber-600" />
        <StatCard label="Azure" value={stats.azure} icon={FaCloud} color="text-blue-600" />
        <StatCard label="GCP" value={stats.gcp} icon={FaGoogle} color="text-red-600" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-3" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div className="relative flex-1 min-w-[200px]">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3 h-3" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, code, or keyword…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </div>
        <FilterGroup label="Cloud" value={cloudFilter} onChange={setCloudFilter} options={[
          { value: 'all', label: 'All' },
          { value: 'aws', label: 'AWS' },
          { value: 'azure', label: 'Azure' },
          { value: 'gcp', label: 'GCP' },
        ]} />
        <FilterGroup label="Level" value={levelFilter} onChange={setLevelFilter} options={[
          { value: 'all', label: 'All' },
          { value: 'foundational', label: 'Foundational' },
          { value: 'associate', label: 'Associate' },
          { value: 'professional', label: 'Professional' },
          { value: 'specialty', label: 'Specialty' },
        ]} />
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Loading catalog…</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl py-16 text-center" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <FaBook className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No courses match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(t => <CourseCard key={t.slug} template={t} onDelete={isAdmin ? handleDeleteTemplate : null} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
        </div>
        <Icon className={`w-6 h-6 ${color} opacity-80`} />
      </div>
    </div>
  );
}

function FilterGroup({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}:</span>
      <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-0.5">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              value === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >{opt.label}</button>
        ))}
      </div>
    </div>
  );
}

function CourseCard({ template, onDelete }) {
  const cloud = CLOUD_META[template.cloud] || CLOUD_META.aws;
  const level = LEVEL_META[template.certificationLevel] || { label: template.certificationLevel, pill: 'bg-gray-50 text-gray-700 border-gray-200' };
  const CloudIcon = cloud.Icon;

  return (
    <div className="relative group">
      {onDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.confirm(`Delete "${template.name}" from the catalog?\n\nThis removes the template. Active deployments from it will continue until TTL expiry.`)) {
              onDelete(template.slug);
            }
          }}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
          title="Delete template"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
      )}
    <Link
      to={`/courses/${template.slug}`}
      className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
    >
      {/* Top row: icon + code */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${cloud.pill} border`}>
            <CloudIcon className={`w-5 h-5 ${cloud.color}`} />
          </div>
          {template.certificationCode && (
            <span className="text-[11px] font-mono font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
              {template.certificationCode}
            </span>
          )}
        </div>
        {template.certificationLevel && (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${level.pill}`}>{level.label}</span>
        )}
      </div>

      {/* Name + description */}
      <h3 className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors leading-snug line-clamp-2">
        {template.name}
      </h3>
      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{template.description || '—'}</p>

      {/* Categories */}
      {template.categories?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {template.categories.slice(0, 4).map(c => (
            <span key={c} className="text-[10px] font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">{c}</span>
          ))}
          {template.categories.length > 4 && (
            <span className="text-[10px] font-medium text-gray-400">+{template.categories.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer row */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><FaLayerGroup className="w-2.5 h-2.5" /> {template.labCount || 0} labs</span>
        <span className="flex items-center gap-1"><FaShieldAlt className="w-2.5 h-2.5" /> {template.serviceCount || 0} services</span>
        {template.sandboxConfig?.ttlHours && (
          <span className="flex items-center gap-1"><FaClock className="w-2.5 h-2.5" /> {template.sandboxConfig.ttlHours}h</span>
        )}
        {template.sandboxConfig?.budgetInr && (
          <span className="flex items-center gap-1"><FaRupeeSign className="w-2.5 h-2.5" /> {template.sandboxConfig.budgetInr}</span>
        )}
      </div>
    </Link>
    </div>
  );
}
