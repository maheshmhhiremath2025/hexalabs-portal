import React from 'react';
import clsx from 'clsx';

// Small color-coded pill for labels like user type, status, etc.
// Keep colors ADA-contrast friendly (blue/green/amber/red/slate).
const TONES = {
  blue:   'bg-blue-50 text-blue-700 ring-blue-200',
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber:  'bg-amber-50 text-amber-700 ring-amber-200',
  red:    'bg-rose-50 text-rose-700 ring-rose-200',
  slate:  'bg-slate-100 text-slate-700 ring-slate-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ tone = 'slate', children, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        TONES[tone] || TONES.slate,
        className
      )}
    >
      {children}
    </span>
  );
}

// Map a userType string to a badge tone + label.
export function UserTypeBadge({ userType }) {
  const map = {
    superadmin:   { tone: 'purple', label: 'Superadmin' },
    admin:        { tone: 'blue',   label: 'Admin' },
    user:         { tone: 'slate',  label: 'User' },
    sandboxuser:  { tone: 'amber',  label: 'Sandbox' },
    selfservice:  { tone: 'green',  label: 'Self-service' },
  };
  const { tone, label } = map[userType] || { tone: 'slate', label: userType || '—' };
  return <Badge tone={tone}>{label}</Badge>;
}

export default Badge;
