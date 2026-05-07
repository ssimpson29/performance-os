import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OuraUserBindingCard } from '../components/integrations/oura-user-binding-card';

describe('OuraUserBindingCard', () => {
  it('renders a sign-in prompt when no app user is bound yet', () => {
    const html = renderToStaticMarkup(React.createElement(OuraUserBindingCard, { currentUser: null }));

    expect(html).toContain('Sign in with email');
    expect(html).toContain('Send magic link');
    expect(html).toContain('Connect Oura after you sign in');
  });

  it('renders the signed-in user id and an Oura connect link bound to that user', () => {
    const html = renderToStaticMarkup(
      React.createElement(OuraUserBindingCard, {
        currentUser: {
          id: 'user-123',
          email: 'athlete@example.com',
        },
      }),
    );

    expect(html).toContain('athlete@example.com');
    expect(html).toContain('Latest Supabase user record');
    expect(html).toContain('user-123');
    expect(html).toContain('/api/imports/oura/connect?userId=user-123');
    expect(html).toContain('Connect Oura');
    expect(html).toContain('Send magic link');
  });
});
