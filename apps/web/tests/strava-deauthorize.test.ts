import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deauthorizeStravaForUser } from '../lib/strava/deauthorize';

// supabase stub for from('user_integrations').select(...).eq().eq().limit().maybeSingle().
function makeSupabase(row: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: row, error: null });
  // ensureFreshStravaToken may call .update().eq() if it refreshes — far-future
  // expiry below avoids that path.
  builder.update = () => builder;
  return { from: () => builder } as never;
}

const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();

describe('deauthorizeStravaForUser', () => {
  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'cid';
    process.env.STRAVA_CLIENT_SECRET = 'secret';
  });
  afterEach(() => vi.restoreAllMocks());

  it('POSTs to Strava deauthorize with the access token and returns revoked:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const supabase = makeSupabase({
      id: 'i1',
      access_token_encrypted: 'tok-123',
      refresh_token_encrypted: 'ref',
      token_expires_at: FUTURE,
    });

    const res = await deauthorizeStravaForUser(supabase, 'u1', fetchMock as unknown as typeof fetch);

    expect(res).toEqual({ revoked: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.strava.com/oauth/deauthorize');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer tok-123' } });
  });

  it('returns revoked:false (no fetch) when there is no integration token', async () => {
    const fetchMock = vi.fn();
    const res = await deauthorizeStravaForUser(makeSupabase(null), 'u1', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ revoked: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is best-effort: returns revoked:false when Strava responds non-ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const supabase = makeSupabase({ id: 'i1', access_token_encrypted: 'tok', refresh_token_encrypted: 'r', token_expires_at: FUTURE });
    const res = await deauthorizeStravaForUser(supabase, 'u1', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ revoked: false });
  });

  it('returns revoked:false when Strava env is unset', async () => {
    delete process.env.STRAVA_CLIENT_ID;
    const fetchMock = vi.fn();
    const res = await deauthorizeStravaForUser(makeSupabase(null), 'u1', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ revoked: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
