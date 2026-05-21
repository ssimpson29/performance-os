import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAuthenticatedUserId = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

describe('GET /api/imports/oura/connect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OURA_CLIENT_ID = 'oura-client-id';
    process.env.OURA_CLIENT_SECRET = '***';
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/connect'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(response.headers.get('location')).toBeNull();
  });

  it('embeds the authenticated athlete id in OAuth state when signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/connect'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('https://cloud.ouraring.com/oauth/authorize');
    expect(location).toContain('state=oura-import%3Aathlete-session');
  });

  it('ignores any caller-supplied userId in the query string', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(
      new Request('http://localhost/api/imports/oura/connect?userId=attacker-athlete'),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('state=oura-import%3Areal-athlete');
    expect(location).not.toContain('attacker-athlete');
  });

  it('happy path includes the redirect URI built from NEXT_PUBLIC_APP_URL', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/connect'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('client_id=oura-client-id');
    expect(location).toContain(encodeURIComponent('http://localhost:3000/api/imports/oura/callback'));
  });
});
