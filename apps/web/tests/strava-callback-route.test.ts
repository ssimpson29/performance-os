import { describe, expect, it, vi, beforeEach } from 'vitest';

const createServerSupabaseClient = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

describe('GET /api/imports/strava/callback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
  });

  it('exchanges the OAuth code and persists the integration when state carries a userId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: 1_750_000_000,
        athlete: { id: 99 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    upsert.mockResolvedValue({ error: null });
    createServerSupabaseClient.mockReturnValue({ from });

    const { GET } = await import('../app/api/imports/strava/callback/route');
    const response = await GET(
      new Request('http://localhost/api/imports/strava/callback?code=test-code&state=strava-import:user-123'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.strava.com/oauth/token');
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('user_integrations');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        provider: 'strava',
        status: 'active',
        access_token_encrypted: 'access-token',
        refresh_token_encrypted: 'refresh-token',
        external_user_id: '99',
      }),
      { onConflict: 'user_id,provider' },
    );
    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/settings/integrations?strava=connected');
  });

  it('returns 400 when Strava reports an error in the callback query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/imports/strava/callback/route');
    const response = await GET(
      new Request('http://localhost/api/imports/strava/callback?error=access_denied'),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'access_denied' });
  });

  it('returns success without persistence when no user binding is available yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: 1_750_000_000,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/imports/strava/callback/route');
    const response = await GET(
      new Request('http://localhost/api/imports/strava/callback?code=test-code&state=strava-import'),
    );

    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'strava',
      codeReceived: true,
      integrationPersisted: false,
    });
  });
});
