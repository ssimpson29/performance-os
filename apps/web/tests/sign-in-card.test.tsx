import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SignInCard } from '../components/integrations/sign-in-card';

describe('SignInCard', () => {
  it('renders the magic-link sign-in form', () => {
    const html = renderToStaticMarkup(React.createElement(SignInCard));

    expect(html).toContain('Sign in with email');
    expect(html).toContain('Send magic link');
    expect(html).toContain('action="/api/auth/magic-link"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
  });
});
