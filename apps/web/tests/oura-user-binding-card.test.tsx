import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { OuraUserBindingCard } from '../components/integrations/oura-user-binding-card';

describe('OuraUserBindingCard', () => {
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
    expect(html).toContain('Signed in as');
    expect(html).toContain('user-123');
    expect(html).toContain('/api/imports/oura/connect?userId=user-123');
    expect(html).toContain('Connect Oura');
    // The sign-in form lives in SignInCard now; this component must not render it.
    expect(html).not.toContain('Send magic link');
    expect(html).not.toContain('/api/auth/magic-link');
  });
});
