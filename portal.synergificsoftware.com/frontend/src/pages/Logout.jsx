import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Logout route. Wipes auth state (localStorage + sessionStorage), tells
 * React the user is no longer logged in, then navigates to /login.
 *
 * Why this exists: the apiCaller 401 interceptor redirects to /logout.
 * Without this route, the SPA fell through to the catch-all 404 and
 * rendered the authenticated shell with a stale (null) user — every
 * subsequent click re-hit 401 → /logout → 404, an infinite loop on JWT
 * expiry.
 */
export default function Logout({ setIsLoggedIn, setUserDetails }) {
  const navigate = useNavigate();
  useEffect(() => {
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    if (typeof setIsLoggedIn === 'function') setIsLoggedIn(false);
    if (typeof setUserDetails === 'function') {
      setUserDetails({ organization: '', email: '', userType: '' });
    }
    navigate('/login', { replace: true });
  }, [navigate, setIsLoggedIn, setUserDetails]);
  return null;
}
