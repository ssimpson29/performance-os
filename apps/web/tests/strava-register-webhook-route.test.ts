import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

describe('/api/strava/register-webhook', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'verify-token-123';
  });

  it('GET returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { GET } = await import('../app/api/strava/register-webhook/route');
    const response = await GET(new Request('http://localhost/api/strava/register-webhook'));
    expect(response.status).toBe(401);
  });

  it('POST returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/strava/register-webhook/route');
    const response = await POST(
      new Request('http://localhost/api/strava/register-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('GET lists subscriptions when signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 42, callback_url: 'https://example.test/api/webhooks/strava' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('../app/api/strava/register-webhook/route');
    const response = await GET(new Request('http://localhost/api/strava/register-webhook'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      subscriptions: [{ id: 42 }],
    });
    expect(fetchMock.mock.calls[0][0]).toContain('https://www.strava.com/api/v3/push_subscriptions');
    expect(fetchMock.mock.calls[0][0]).toContain('client_id=strava-client-id');
  });

  it('POST deletes any existing subscriptions then creates a new one', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const fetchMock = vi
      .fn()
      // 1) list existing
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 7 }, { id: 8 }],
      })
      // 2) delete first
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      // 3) delete second
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      // 4) create
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 99, callback_url: 'http://localhost:3000/api/webhooks/strava' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/api/strava/register-webhook/route');
    const response = await POST(
      new Request('http://localhost/api/strava/register-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      subscription: { id: 99 },
      callbackUrl: 'http://localhost:3000/api/webhooks/strava',
      replacedCount: 2,
    });
    // The create call should have sent the verify_token from env.
    const createCallBody = fetchMock.mock.calls[3][1]?.body as string;
    expect(createCallBody).toContain('verify_token=verify-token-123');
    expect(createCallBody).toContain('callback_url=http');
  });

  it('POST surfaces a 502 when Strava rejects the registration', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const fetchMock = vi
      .fn()
      // list returns empty
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      // create fails
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"errors":[{"resource":"PushSubscription","field":"callback url","code":"GET response from your callback URL did not return the correct hub.challenge"}]}',
      });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/api/strava/register-webhook/route');
    const response = await POST(
      new Request('http://localhost/api/strava/register-webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Strava create subscription failed/);
  });
});
