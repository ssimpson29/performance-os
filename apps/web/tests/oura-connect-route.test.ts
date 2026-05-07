import { describe, expect, it, vi, beforeEach } from 'vitest';

const createServerSupabaseClient = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

describe('GET /api/imports/oura/connect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('redirects to Oura OAuth when required env exists', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OURA_CLIENT_ID = 'oura-client-id';
    process.env.OURA_CLIENT_SECRET = '***';

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/connect'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('https://cloud.ouraring.com/oauth/authorize');
    expect(location).toContain('client_id=oura-client-id');
    expect(location).toContain(encodeURIComponent('http://localhost:3000/api/imports/oura/callback'));
  });

  it('encodes a user binding in state when userId is provided', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.OURA_CLIENT_ID = 'oura-client-id';
    process.env.OURA_CLIENT_SECRET = '***';

    const { GET } = await import('../app/api/imports/oura/connect/route');
    const response = await GET(new Request('http://localhost/api/imports/oura/connect?userId=user-123'));

    const location = response.headers.get('location') ?? '';
    expect(location).toContain('state=oura-import%3Auser-123');
  });
});
