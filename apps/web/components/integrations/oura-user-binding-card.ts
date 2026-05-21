import * as React from 'react';

export type OuraBindingUser = {
  id: string;
  email: string;
};

/**
 * Post-auth Oura connection card. Renders only when an athlete is signed
 * in (currentUser is non-null). The sign-in step lives in SignInCard,
 * rendered at the top of /settings/integrations when currentUser is null.
 */
export function OuraUserBindingCard({ currentUser }: { currentUser: OuraBindingUser }) {
  return React.createElement(
    'div',
    { className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-5' },
    React.createElement('p', { className: 'eyebrow' }, 'Oura connection'),
    React.createElement(
      'h3',
      { className: 'mt-2 text-xl font-semibold text-white' },
      'Connect your Oura account.',
    ),
    React.createElement(
      'p',
      { className: 'mt-2 text-sm leading-6 text-muted' },
      'OAuth-binds your Oura account to the athlete profile so recovery, sleep, and readiness sync into Supabase.',
    ),
    React.createElement(
      'div',
      { className: 'mt-4 rounded-2xl border border-white/5 bg-black/20 p-4' },
      React.createElement('p', { className: 'text-xs uppercase tracking-[0.18em] text-brand2' }, 'Signed in as'),
      React.createElement('p', { className: 'mt-2 text-sm font-medium text-white' }, currentUser.email),
      React.createElement('p', { className: 'mt-2 text-sm text-muted' }, `User ID: ${currentUser.id}`),
      React.createElement(
        'a',
        {
          href: `/api/imports/oura/connect?userId=${encodeURIComponent(currentUser.id)}`,
          className: 'mt-4 inline-flex rounded-full bg-brand2 px-4 py-2 text-sm font-medium text-black',
        },
        'Connect Oura',
      ),
    ),
  );
}
