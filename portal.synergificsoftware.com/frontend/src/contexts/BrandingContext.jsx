import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiCaller from '../services/apiCaller';

const DEFAULTS = {
  logoUrl: '/logo/logo.png',
  primaryColor: '#2563eb',
  accentColor: '#1e40af',
  companyName: 'Hexalabs',
  faviconUrl: '',
  loginBanner: '',
  supportEmail: '',
  supportPhone: '',
};

const BrandingContext = createContext({ branding: DEFAULTS, loading: false });

// Resolve initial branding synchronously, BEFORE first React render.
// On whitelabel hosts the backend pre-injects window.__BRANDING__ via
// generate-whitelabel-index.js — reading it at useState init eliminates the
// brief default-branded flash that customers reported as 'the page is not
// branded'.
function resolveInitialBranding() {
  if (typeof window !== 'undefined' && window.__BRANDING__) {
    const merged = { ...DEFAULTS, ...stripEmpty(window.__BRANDING__) };
    if (merged.companyName && typeof document !== 'undefined') {
      document.title = merged.companyName;
    }
    return merged;
  }
  return DEFAULTS;
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(resolveInitialBranding);
  const [loading, setLoading] = useState(false);

  // Apply CSS custom properties whenever branding changes
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-accent', branding.accentColor);
  }, [branding.primaryColor, branding.accentColor]);

  // Update favicon if custom faviconUrl is set
  useEffect(() => {
    if (branding.faviconUrl) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.faviconUrl;
    }
  }, [branding.faviconUrl]);

  // Fetch branding for a given organization name (authenticated endpoint)
  const fetchBranding = useCallback(async (orgName) => {
    if (!orgName) return;
    setLoading(true);
    try {
      const res = await apiCaller.get(`/admin/branding/${encodeURIComponent(orgName)}`);
      if (res.data?.branding) {
        setBranding((prev) => ({ ...prev, ...stripEmpty(res.data.branding) }));
      }
    } catch {
      // Keep defaults on failure
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch branding from public endpoint (no auth, for login page)
  const fetchPublicBranding = useCallback(async (orgName) => {
    if (!orgName) return;
    setLoading(true);
    try {
      const res = await apiCaller.get(`/open/branding/${encodeURIComponent(orgName)}`);
      if (res.data?.branding) {
        setBranding((prev) => ({ ...prev, ...stripEmpty(res.data.branding) }));
      }
    } catch {
      // Keep defaults on failure
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch branding by current host on mount (whitelabel domains).
  // Server-side injection (window.__BRANDING__) is applied synchronously
  // at useState init via resolveInitialBranding — this effect is now only
  // the API fallback for the canonical host (or any host where the global
  // wasn't injected). No-op if branding is already populated from the global.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__BRANDING__) {
      return;
    }
    const host = window.location.hostname;
    apiCaller.get('/branding/by-host?host=' + encodeURIComponent(host))
      .then((res) => {
        if (res.data && (res.data.customDomain || res.data.organization)) {
          setBranding((prev) => ({ ...prev, ...stripEmpty(res.data) }));
          if (res.data.companyName) document.title = res.data.companyName;
        }
      })
      .catch(() => {});
  }, []);

  // Reset to defaults (e.g. on logout).
  // On whitelabel hosts, re-resolve from window.__BRANDING__ first so the
  // logout-redirect login page keeps the tenant logo/colors. Falls back to
  // the API only if no injected global is present.
  const resetBranding = useCallback(() => {
    if (typeof window !== 'undefined' && window.__BRANDING__) {
      setBranding({ ...DEFAULTS, ...stripEmpty(window.__BRANDING__) });
      if (window.__BRANDING__.companyName) document.title = window.__BRANDING__.companyName;
      return;
    }
    setBranding(DEFAULTS);
    const host = window.location.hostname;
    apiCaller.get('/branding/by-host?host=' + encodeURIComponent(host))
      .then((res) => {
        if (res.data && (res.data.customDomain || res.data.organization)) {
          setBranding((prev) => ({ ...prev, ...stripEmpty(res.data) }));
          if (res.data.companyName) document.title = res.data.companyName;
        }
      })
      .catch(() => {});
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, loading, fetchBranding, fetchPublicBranding, resetBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}

// Strip empty/null/undefined values so defaults are preserved
function stripEmpty(obj) {
  const cleaned = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
  }
  return cleaned;
}

export default BrandingContext;
