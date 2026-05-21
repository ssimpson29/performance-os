import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
const createServerClient = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable';
    createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession },
    });
  });

  it('redirects to /settings/integrations?auth_error=missing_code when no code is provided', async () => {
    const { GET } = await import('../app/auth/callback/route');
    const response = await GET(new Request('http://localhost/auth/callback') as never);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toMatch(
      /\/settings\/integrations\?auth_error=missing_code$/,
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('exchanges the code and redirects to ?next= on success', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import('../app/auth/callback/route');
    const response = await GET(
      new Request('http://localhost/auth/callback?code=abc123&next=/longevity') as never,
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toMatch(/\/longevity$/);
  });

  it('defaults to /coach when ?next= is omitted', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import('../app/auth/callback/route');
    const response = await GET(new Request('http://localhost/auth/callback?code=abc123') as never);

    expect(response.headers.get('location')).toMatch(/\/coach$/);
  });

  it('redirects with auth_error when the exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid grant' } });

    const { GET } = await import('../app/auth/callback/route');
    const response = await GET(new Request('http://localhost/auth/callback?code=abc123') as never);

    expect(response.headers.get('location')).toMatch(
      /\/settings\/integrations\?auth_error=invalid%20grant$/,
    );
  });

  it('refuses absolute or protocol-relative next URLs (open-redirect guard)', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });

    const { GET } = await import('../app/auth/callback/route');
    const response = await GET(
      new Request('http://localhost/auth/callback?code=abc&next=//evil.example/x') as never,
    );

    // Falls back to /coach instead of redirecting off-host.
    expect(response.headers.get('location')).toMatch(/\/coach$/);
  });
});
