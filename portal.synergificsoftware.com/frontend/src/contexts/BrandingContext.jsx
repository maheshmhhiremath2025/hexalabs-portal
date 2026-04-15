import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiCaller from '../services/apiCaller';

const DEFAULTS = {
  logoUrl: '/logo/synergificsoftware-logo.png',
  primaryColor: '#2563eb',
  accentColor: '#1e40af',
  companyName: 'Synergific',
  faviconUrl: '',
  loginBanner: '',
  supportEmail: '',
  supportPhone: '',
};

const BrandingContext = createContext({ branding: DEFAULTS, loading: false });

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS);
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

  // Reset to defaults (e.g. on logout)
  const resetBranding = useCallback(() => {
    setBranding(DEFAULTS);
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
