import * as React from 'react';

/**
 * Standalone Supabase magic-link sign-in card. Posts to /api/auth/magic-link.
 * Rendered at the top of /settings/integrations when no athlete is signed in.
 * After sign-in this card is hidden and OuraUserBindingCard takes over for
 * the Connect-Oura step.
 */
export function SignInCard() {
  return React.createElement(
    'div',
    { className: 'panel space-y-4 p-6 shadow-glow' },
    React.createElement('p', { className: 'eyebrow' }, 'Sign in'),
    React.createElement(
      'h2',
      { className: 'mt-1 text-2xl font-semibold text-white' },
      'Sign in with email to get started.',
    ),
    React.createElement(
      'p',
      { className: 'text-sm leading-6 text-muted' },
      'Performance OS uses Supabase magic-link sign-in. Enter your email below and you’ll get a one-click link to authenticate. Once you’re signed in, you can import a training plan, talk to your coach, upload lab work, and connect Oura.',
    ),
    React.createElement(
      'form',
      { action: '/api/auth/magic-link', method: 'post', className: 'mt-2 flex flex-col gap-3 sm:flex-row sm:items-center' },
      React.createElement('input', {
        type: 'email',
        name: 'email',
        required: true,
        placeholder: 'you@example.com',
        className: 'w-full flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none focus:border-brand2/60 sm:w-auto',
      }),
      React.createElement(
        'button',
        {
          type: 'submit',
          className: 'rounded-full bg-brand2 px-5 py-3 text-sm font-medium text-black',
        },
        'Send magic link',
      ),
    ),
    React.createElement(
      'p',
      { className: 'text-xs text-muted' },
      'Check your inbox after submitting. The link redirects you back here.',
    ),
  );
}
