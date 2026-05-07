import { describe, expect, it, vi, beforeEach } from 'vitest';

const createServerSupabaseClient = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

describe('GET /api/imports/oura/callback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OURA_CLIENT_ID = 'oura-client-id';
    process.env.OURA_CLIENT_SECRET = 'oura-secret';
  });

  it('exchanges the OAuth code and persists the integration when a userId is provided in state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'daily email',
        token_type: 'Bearer',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    upsert.mockResolvedValue({ error: null });
    createServerSupabaseClient.mockReturnValue({ from });

    const { GET } = await import('../app/api/imports/oura/callback/route');
    const response = await GET(
      new Request('http://localhost/api/imports/oura/callback?code=test-code&state=oura-import:user-123'),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.ouraring.com/oauth/token');
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('user_integrations');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        provider: 'oura',
        status: 'active',
        access_token_encrypted: 'access-token',
        refresh_token_encrypted: 'refresh-token',
      }),
      { onConflict: 'user_id,provider' },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'oura',
      codeReceived: true,
      integrationPersisted: true,
      userId: 'user-123',
    });
  });

  it('returns success without persistence when no user binding is available yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/imports/oura/callback/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/callback?code=test-code&state=oura-import'));

    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      integrationPersisted: false,
      nextStep: 'Bind Oura OAuth to an app user before persisting integration tokens.',
    });
  });
});
