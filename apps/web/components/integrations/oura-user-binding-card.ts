import * as React from 'react';

export type OuraBindingUser = {
  id: string;
  email: string;
};

export function OuraUserBindingCard({ currentUser }: { currentUser: OuraBindingUser | null }) {
  return React.createElement(
    'div',
    { className: 'rounded-2xl border border-white/5 bg-white/[0.03] p-5' },
    React.createElement('p', { className: 'eyebrow' }, 'Oura user binding'),
    React.createElement(
      'h3',
      { className: 'mt-2 text-xl font-semibold text-white' },
      'Sign in with email',
    ),
    React.createElement(
      'p',
      { className: 'mt-2 text-sm leading-6 text-muted' },
      'Send a Supabase magic link to create or sign in the athlete profile. Connect Oura after you sign in.',
    ),
    React.createElement(
      'form',
      { action: '/api/auth/magic-link', method: 'post', className: 'mt-4 space-y-3' },
      React.createElement('input', {
        type: 'email',
        name: 'email',
        placeholder: 'athlete@example.com',
        className: 'w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none',
      }),
      React.createElement(
        'button',
        {
          type: 'submit',
          className: 'rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white',
        },
        'Send magic link',
      ),
    ),
    currentUser
      ? React.createElement(
          'div',
          { className: 'mt-4 rounded-2xl border border-white/5 bg-black/20 p-4' },
          React.createElement('p', { className: 'text-xs uppercase tracking-[0.18em] text-brand2' }, 'Latest Supabase user record'),
          React.createElement('p', { className: 'mt-2 text-sm font-medium text-white' }, currentUser.email),
          React.createElement('p', { className: 'mt-2 text-sm text-muted' }, `User ID: ${currentUser.id}`),
          React.createElement(
            'a',
            {
              href: `/api/imports/oura/connect?userId=${encodeURIComponent(currentUser.id)}`,
              className: 'mt-4 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white',
            },
            'Connect Oura',
          ),
        )
      : React.createElement('p', { className: 'mt-3 text-xs text-muted' }, 'Connect Oura after you sign in.'),
  );
}
