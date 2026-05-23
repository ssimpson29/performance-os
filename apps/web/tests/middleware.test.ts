import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Middleware onboarding-gate tests. The middleware mounts a real
 * supabase SSR client; we mock the createServerClient factory so each
 * test can return any (user, onboarding_completed_at) combo without
 * standing up auth infrastructure.
 *
 * We don't directly exercise the env-missing branch — that's covered
 * by the existing session-refresh path and isn't relevant to the
 * onboarding gate logic.
 */

type FakeUser = { id: string } | null;

const createServerClient = vi.fn();

vi.mock('@supabase/ssr', () => ({ createServerClient }));

function mockSupabase(args: {
  user: FakeUser;
  onboardingCompletedAt: string | null | undefined;
}) {
  // Loaded into createServerClient.mockReturnValue per test.
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: args.user } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            then: (resolve: (r: { data: unknown; error: null }) => void) =>
              resolve({
                data:
                  args.onboardingCompletedAt === undefined
                    ? []
                    : [{ onboarding_completed_at: args.onboardingCompletedAt }],
                error: null,
              }),
          })),
        })),
      })),
    })),
  };
}

/**
 * NextRequest gives the middleware everything it needs (cookies,
 * nextUrl.pathname, etc.) — plain Request lacks `nextUrl` and the
 * middleware would throw.
 */
function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

describe('middleware — onboarding gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'key';
  });

  it('redirects signed-in user with null onboarding_completed_at to /onboarding (from /coach)', async () => {
    createServerClient.mockReturnValue(
      mockSupabase({ user: { id: 'user-1' }, onboardingCompletedAt: null }),
    );
    const { middleware } = await import('../middleware');
    const response = await middleware(makeRequest('/coach'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toMatch(/\/onboarding$/);
  });

  it('passes through signed-in user with onboarding_completed_at set', async () => {
    createServerClient.mockReturnValue(
      mockSupabase({ user: { id: 'user-1' }, onboardingCompletedAt: '2026-05-20T10:00:00Z' }),
    );
    const { middleware } = await import('../middleware');
    const response = await middleware(makeRequest('/coach'));
    expect(response.status).toBe(200);
  });

  it('passes through signed-out users (the page handles its own sign-in CTA)', async () => {
    createServerClient.mockReturnValue(
      mockSupabase({ user: null, onboardingCompletedAt: null }),
    );
    const { middleware } = await import('../middleware');
    const response = await middleware(makeRequest('/coach'));
    expect(response.status).toBe(200);
  });

  it.each([
    '/',                          // marketing landing — fine to view signed-in
    '/onboarding',                // destination, would loop
    '/onboarding/anything',
    '/account',                   // athlete must be able to view + edit profile + sign out
    '/account/something',
    '/settings',                  // settings root — must be reachable mid-onboarding
    '/settings/integrations',     // Step 5 of onboarding links here in a new tab
    '/settings/anything-else',
    '/api/onboarding/complete',   // the completion endpoint itself
    '/api/coach/message',
    '/api/imports/strava/connect',// OAuth kick-off — must work mid-onboarding
    '/auth/callback',
    '/docs',
    '/docs/anything',
  ])('does NOT redirect signed-in incomplete athlete on excluded path %s', async (path) => {
    createServerClient.mockReturnValue(
      mockSupabase({ user: { id: 'user-1' }, onboardingCompletedAt: null }),
    );
    const { middleware } = await import('../middleware');
    const response = await middleware(makeRequest(path));
    expect(response.status).toBe(200);
  });
});
