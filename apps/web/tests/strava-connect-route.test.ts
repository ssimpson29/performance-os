import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAuthenticatedUserId = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

describe('GET /api/imports/strava/connect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { GET } = await import('../app/api/imports/strava/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/strava/connect'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(response.headers.get('location')).toBeNull();
  });

  it('embeds the authenticated athlete id in OAuth state when signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { GET } = await import('../app/api/imports/strava/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/strava/connect'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('https://www.strava.com/oauth/authorize');
    expect(location).toContain('state=strava-import%3Aathlete-session');
  });

  it('ignores any caller-supplied userId in the query string', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { GET } = await import('../app/api/imports/strava/connect/route');
    const response = await GET(
      new Request('http://localhost/api/imports/strava/connect?userId=attacker-athlete'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('state=strava-import%3Areal-athlete');
    expect(location).not.toContain('attacker-athlete');
  });

  it('happy path requests the read,activity:read_all scope and the configured redirect URI', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { GET } = await import('../app/api/imports/strava/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/strava/connect'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('client_id=strava-client-id');
    expect(location).toContain('scope=read%2Cactivity%3Aread_all');
    expect(location).toContain(encodeURIComponent('http://localhost:3000/api/imports/strava/callback'));
  });
});
