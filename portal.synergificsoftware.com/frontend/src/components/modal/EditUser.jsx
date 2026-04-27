import React, { useState } from 'react';
import { FaTimes, FaKey } from 'react-icons/fa';

// Edit-user modal for the Admin Center. Lets a superadmin/admin change:
//   - email (rename — careful, unique-index enforced by backend)
//   - organization (move to another org)
//   - userType (role)
//   - password reset → always to Welcome1234!
// No direct password input (admins shouldn't type arbitrary passwords for
// their users). Reset-to-default is the supported pattern.
export function EditUserModal({ open, user, organizations = [], onClose, onSave }) {
  const [email, setEmail] = useState(user?.email || '');
  const [organization, setOrganization] = useState(user?.organization || '');
  const [userType, setUserType] = useState(user?.userType || 'user');
  const [resetPassword, setResetPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (open && user) {
      setEmail(user.email || '');
      setOrganization(user.organization || '');
      setUserType(user.userType || 'user');
      setResetPassword(false);
    }
  }, [open, user]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave({
        email: user.email,                  // the TARGET email (for lookup)
        newEmail: email !== user.email ? email : undefined,
        newOrganization: organization !== user.organization ? organization : undefined,
        userType: userType !== user.userType ? userType : undefined,
        resetPassword,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
         onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Edit user</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><FaTimes /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim().toLowerCase())}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
            <select
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {organizations.length === 0 && <option value={organization}>{organization || '—'}</option>}
              {organizations.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <select
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="user">User (trainee)</option>
              <option value="admin">Admin (org-scoped manager)</option>
              <option value="superadmin">Superadmin (platform-wide)</option>
              <option value="sandboxuser">Sandbox user</option>
              <option value="selfservice">Self-service</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Changing role takes effect on the user's next login.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={resetPassword}
              onChange={(e) => setResetPassword(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-900 flex items-center gap-2">
                <FaKey className="text-xs" /> Reset password to <code className="text-xs bg-amber-100 px-1.5 py-0.5 rounded">Welcome1234!</code>
              </div>
              <div className="text-xs text-amber-700 mt-0.5">
                User will need to use this password on next login. Any current session remains valid.
              </div>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditUserModal;
