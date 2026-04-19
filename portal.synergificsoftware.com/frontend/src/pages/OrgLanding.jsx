import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import { useBranding } from '../contexts/BrandingContext';
import {
  FaArrowRight, FaShieldAlt, FaRocket, FaCloud, FaCode, FaDocker, FaWindows,
  FaCheckCircle, FaHeadset, FaEnvelope, FaPhone,
} from 'react-icons/fa';

const FEATURES = [
  { icon: FaDocker, title: 'Browser-native workspaces', text: 'Pre-loaded Linux desktops, dev environments, and lab kits — open in any browser, no install.' },
  { icon: FaWindows, title: 'Windows & cloud sandboxes', text: 'Real Windows 11 desktops, plus AWS / Azure / GCP / OCI sandboxes with safety guardrails baked in.' },
  { icon: FaShieldAlt, title: 'Cost & policy guardrails', text: 'Hard quotas, IAM restrictions, idle auto-shutdown, and budget caps prevent surprise bills.' },
  { icon: FaCloud, title: 'Multi-cloud certified labs', text: 'Pre-built course templates aligned to AWS, Azure, GCP, Red Hat, and Kubernetes certifications.' },
];

const HOW_IT_WORKS = [
  { n: 1, title: 'Pick a course or template', text: 'Browse the catalog or load a template that matches your training need.' },
  { n: 2, title: 'Bulk-deploy students', text: 'Drop a CSV of emails and we provision per-student environments in minutes.' },
  { n: 3, title: 'Track & wind down', text: 'Live progress, idle auto-shutdown, expiry deletion — no leftover resources.' },
];

export default function OrgLanding() {
  const { orgSlug } = useParams();
  const { branding, fetchPublicBranding, resetBranding } = useBranding();
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!orgSlug) return;
    let mounted = true;
    apiCaller.get(`/open/branding/${encodeURIComponent(orgSlug)}`)
      .then(() => mounted && fetchPublicBranding(orgSlug))
      .catch(() => mounted && setNotFound(true))
      .finally(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
      // Don't reset — branding stays for any subsequent navigation
      void resetBranding;
    };
  }, [orgSlug, fetchPublicBranding, resetBranding]);

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50 px-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-3">😕</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Organization not found</h1>
          <p className="text-gray-600 mb-6">We couldn't find a workspace called <span className="font-mono px-2 py-0.5 rounded bg-gray-100">{orgSlug}</span>.</p>
          <Link to="/login" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
            Go to login <FaArrowRight />
          </Link>
        </div>
      </div>
    );
  }

  const primary = branding.primaryColor || '#2563eb';
  const accent = branding.accentColor || '#1e40af';
  const companyName = branding.companyName || orgSlug;

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <header
        className="relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <nav className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={companyName}
                  className="h-9 sm:h-10 object-contain bg-white/95 rounded-lg p-1.5"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="h-9 w-9 rounded-lg bg-white/20 text-white flex items-center justify-center font-bold">
                  {companyName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-white font-semibold text-base sm:text-lg">{companyName}</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link to="/login" className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-white/90 hover:text-white transition-colors">
                Sign in
              </Link>
              <Link to="/signup"
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold rounded-lg bg-white shadow hover:shadow-md transition-shadow"
                style={{ color: primary }}>
                Get Started
              </Link>
            </div>
          </nav>

          <div className="max-w-3xl text-white">
            <span className="inline-block px-3 py-1 rounded-full bg-white/15 text-[11px] font-semibold tracking-wider uppercase mb-4">
              Cloud training labs
            </span>
            <h1 className="text-3xl sm:text-5xl font-bold leading-tight mb-4">
              Train your teams on real cloud infra — without the bill shock.
            </h1>
            <p className="text-base sm:text-lg text-white/90 mb-8 max-w-2xl">
              {companyName === branding.companyName
                ? `${companyName} uses GetLabs to deliver hands-on AWS, Azure, GCP, Linux, and DevOps labs to learners — with quotas, idle auto-shutdown, and policy guardrails baked in.`
                : 'Hands-on AWS, Azure, GCP, Linux, and DevOps labs — with quotas, idle auto-shutdown, and policy guardrails baked in.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/signup"
                className="inline-flex items-center gap-2 px-5 py-3 bg-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-shadow"
                style={{ color: primary }}>
                Start free trial <FaArrowRight />
              </Link>
              <Link to="/courses"
                className="inline-flex items-center gap-2 px-5 py-3 bg-white/10 text-white border border-white/30 rounded-lg font-semibold hover:bg-white/20 transition-colors">
                Browse courses
              </Link>
            </div>

            {(branding.supportEmail || branding.supportPhone) && (
              <div className="mt-8 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-white/80">
                {branding.supportEmail && (
                  <a href={`mailto:${branding.supportEmail}`} className="inline-flex items-center gap-1.5 hover:text-white">
                    <FaEnvelope className="text-white/60" /> {branding.supportEmail}
                  </a>
                )}
                {branding.supportPhone && (
                  <a href={`tel:${branding.supportPhone}`} className="inline-flex items-center gap-1.5 hover:text-white">
                    <FaPhone className="text-white/60" /> {branding.supportPhone}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Soft gradient blob for depth */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-80 h-80 rounded-full opacity-30"
          style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }} />
      </header>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Everything trainers and learners need</h2>
          <p className="text-gray-600">Pre-built environments, real cloud sandboxes, full cost control.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                style={{ background: `${primary}15`, color: primary }}>
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{title}</h3>
              <p className="text-[13px] text-gray-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 border-y border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">How it works</h2>
            <p className="text-gray-600">From signup to deployed labs in under five minutes.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HOW_IT_WORKS.map(s => (
              <div key={s.n} className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-3 text-white"
                  style={{ background: primary }}>
                  {s.n}
                </div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1.5">{s.title}</h3>
                <p className="text-[13px] text-gray-600 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: FaCheckCircle, title: 'No surprise bills', text: 'Per-student quotas, daily caps, and auto-cleanup.' },
            { icon: FaRocket, title: 'Spin up in seconds', text: 'Pre-pulled images and Spot fallback keep deploys fast.' },
            { icon: FaCode, title: 'Bring your image', text: 'Custom Docker images and captured templates supported.' },
          ].map(item => (
            <div key={item.title} className="flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-lg">
              <item.icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: primary }} />
              <div>
                <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                <div className="text-xs text-gray-600 mt-0.5">{item.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-4 sm:px-6 pb-16">
        <div className="max-w-4xl mx-auto rounded-2xl p-8 sm:p-12 text-center text-white"
          style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to launch your first lab?</h2>
          <p className="text-white/90 mb-6 max-w-xl mx-auto">
            Free trial — no card, no install. Be running real workloads in five minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/signup"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-shadow"
              style={{ color: primary }}>
              Start free trial <FaArrowRight />
            </Link>
            <Link to="/login"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 border border-white/30 rounded-lg font-semibold hover:bg-white/20 transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            {branding.logoUrl && (
              <img src={branding.logoUrl} alt="" className="h-5 object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
            <span>© {new Date().getFullYear()} {companyName}. Powered by GetLabs.</span>
          </div>
          <div className="flex items-center gap-3">
            {branding.supportEmail && (
              <a href={`mailto:${branding.supportEmail}`} className="inline-flex items-center gap-1 hover:text-gray-700">
                <FaHeadset /> Support
              </a>
            )}
            <Link to="/login" className="hover:text-gray-700">Sign in</Link>
          </div>
        </div>
      </footer>

      {!loaded && <div className="sr-only">Loading…</div>}
    </div>
  );
}
