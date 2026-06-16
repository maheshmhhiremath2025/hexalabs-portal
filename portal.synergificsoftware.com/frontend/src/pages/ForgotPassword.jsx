import { useState } from 'react';
import { Link } from 'react-router-dom';
import apiCaller from '../services/apiCaller';

// Public "Forgot password" page. Two flows on the backend gated by
// user.accountSource — the UI doesn't need to know which one fired,
// since the response is the same generic message either way (anti-enumeration).
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setSubmitting(true);
    try {
      await apiCaller.post('/user/forgot-password', { email: email.trim().toLowerCase() });
      setSubmitted(true);
    } catch (err) {
      // Backend always returns 200 for this endpoint, so a network error is
      // the only way here. Surface a friendly retry message.
      setError('We could not reach the portal. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-950 via-blue-900 to-blue-950 px-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur rounded-xl shadow-2xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Reset your password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter the email associated with your account. If a matching account exists, we'll send instructions to reset your password.
        </p>

        {submitted ? (
          <>
            <div className="bg-green-50 border border-green-200 rounded-md p-4 mb-4">
              <p className="text-sm text-green-900 font-medium">Check your email.</p>
              <p className="text-xs text-green-800 mt-1">
                If an account exists for <strong>{email}</strong>, instructions have been sent.
              </p>
              <p className="text-xs text-gray-700 mt-3">
                Note: if your account was created by your training administrator (typical for cohort enrolments), they will be notified to reset on your behalf — you don't need to wait for an email.
              </p>
            </div>
            <Link to="/login" className="block text-center text-sm text-blue-700 font-medium hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-xs text-red-900">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Sending…' : 'Send reset instructions'}
            </button>

            <div className="text-center pt-2">
              <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
