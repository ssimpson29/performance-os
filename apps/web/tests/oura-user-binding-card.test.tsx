import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The card imports a client-only button ('use client' + useRouter) that can't
// render under renderToStaticMarkup; stub it so this server-render test stays
// focused on the card's own markup.
vi.mock('../components/integrations/disconnect-integration-button', () => ({
  DisconnectIntegrationButton: () => null,
}));

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
