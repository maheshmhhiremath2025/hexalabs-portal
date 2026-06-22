import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiCaller from '../services/apiCaller';

// Public reset-password page. URL: /reset-password/:token
// On mount: validates the token via GET /user/reset-password/check/:token.
// On submit: POSTs new password; redirects to /login on success.
export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState('checking');     // checking | valid | invalid | submitting | done
  const [accountEmail, setAccountEmail] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiCaller.get(`/user/reset-password/check/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (res.status === 200 && res.data?.valid) {
          setAccountEmail(res.data.email || '');
          setState('valid');
        } else {
          setState('invalid');
        }
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (pw1.length < 8) return setError('Password must be at least 8 characters.');
    if (pw1 !== pw2) return setError("Passwords don't match.");
    setState('submitting');
    try {
      await apiCaller.post('/user/reset-password', { token, newPassword: pw1 });
      setState('done');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not reset password. Please try again or request a new link.');
      setState('valid');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950 px-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur rounded-xl shadow-2xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set a new password</h1>

        {state === 'checking' && (
          <p className="text-sm text-gray-600">Validating your reset link…</p>
        )}

        {state === 'invalid' && (
          <>
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <p className="text-sm text-red-900 font-medium">This link has expired or is invalid.</p>
              <p className="text-xs text-red-800 mt-1">
                Reset links are valid for 30 minutes. Please request a new one.
              </p>
            </div>
            <Link to="/forgot-password" className="block text-center bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-indigo-700 transition-colors">
              Request a new reset link
            </Link>
            <Link to="/login" className="block text-center text-sm text-gray-600 hover:text-gray-900 mt-3">
              Back to sign in
            </Link>
          </>
        )}

        {state === 'done' && (
          <div className="bg-green-50 border border-green-200 rounded-md p-4">
            <p className="text-sm text-green-900 font-medium">Password updated.</p>
            <p className="text-xs text-green-800 mt-1">Redirecting you to sign in…</p>
          </div>
        )}

        {(state === 'valid' || state === 'submitting') && (
          <>
            {accountEmail && (
              <p className="text-sm text-gray-600 mb-4">Setting a new password for <strong>{accountEmail}</strong>.</p>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor="pw1" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">New password</label>
                <input
                  id="pw1" type="password" autoComplete="new-password" required minLength={8}
                  value={pw1} onChange={(e) => setPw1(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
              </div>
              <div>
                <label htmlFor="pw2" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Confirm new password</label>
                <input
                  id="pw2" type="password" autoComplete="new-password" required minLength={8}
                  value={pw2} onChange={(e) => setPw2(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <p className="text-xs text-red-900">{error}</p>
                </div>
              )}
              <button
                type="submit" disabled={state === 'submitting'}
                className="w-full bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {state === 'submitting' ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
