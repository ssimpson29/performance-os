import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireCronSecret = vi.fn();
const createServerSupabaseClient = vi.fn();
const syncOuraRecovery = vi.fn();

vi.mock('@/lib/env', () => ({
  requireCronSecret,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/oura/recovery-sync', () => ({
  syncOuraRecovery,
  // Re-create the error class so `instanceof` checks in the route work.
  OuraRecoverySyncError: class OuraRecoverySyncError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'OuraRecoverySyncError';
      this.status = status;
    }
  },
}));

const SECRET = 'test-cron-secret';

// Minimal thenable stub for `from('user_integrations').select(...).eq(...).eq(...)`.
function makeSupabase(integrationsResult: { data?: unknown; error?: unknown }) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) => resolve(integrationsResult);
  return { from: vi.fn(() => query) };
}

function makeRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/sync-oura', { method: 'GET', headers });
}

const result = (userId: string, syncedDays: number, tokenRefreshed = false) => ({
  ok: true,
  provider: 'oura',
  userId,
  startDate: '2026-05-05',
  endDate: '2026-05-30',
  syncedDays,
  recordsFetched: { readiness: syncedDays, sleep: syncedDays, activity: syncedDays },
  tokenRefreshed,
});

describe('GET /api/cron/sync-oura', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    requireCronSecret.mockReturnValue(SECRET);
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    requireCronSecret.mockImplementation(() => {
      throw new Error('Missing CRON_SECRET.');
    });
    createServerSupabaseClient.mockReturnValue(makeSupabase({ data: [], error: null }));

    const { GET } = await import('../app/api/cron/sync-oura/route');
    const response = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(syncOuraRecovery).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token is missing or wrong', async () => {
    createServerSupabaseClient.mockReturnValue(makeSupabase({ data: [], error: null }));

    const { GET } = await import('../app/api/cron/sync-oura/route');

    const noHeader = await GET(makeRequest());
    expect(noHeader.status).toBe(401);

    const wrong = await GET(makeRequest({ authorization: 'Bearer nope' }));
    expect(wrong.status).toBe(401);

    expect(syncOuraRecovery).not.toHaveBeenCalled();
  });

  it('syncs every active Oura integration and returns a summary', async () => {
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({ data: [{ user_id: 'athlete-1' }, { user_id: 'athlete-2' }], error: null }),
    );
    syncOuraRecovery
      .mockResolvedValueOnce(result('athlete-1', 3))
      .mockResolvedValueOnce(result('athlete-2', 5, true));

    const { GET } = await import('../app/api/cron/sync-oura/route');
    const response = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'oura',
      integrations: 2,
      syncedCount: 2,
      failedCount: 0,
    });
    expect(syncOuraRecovery).toHaveBeenCalledTimes(2);
    expect(syncOuraRecovery).toHaveBeenNthCalledWith(1, expect.anything(), { userId: 'athlete-1' });
    expect(syncOuraRecovery).toHaveBeenNthCalledWith(2, expect.anything(), { userId: 'athlete-2' });
  });

  it('continues past a per-athlete failure and reports it', async () => {
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({ data: [{ user_id: 'athlete-1' }, { user_id: 'athlete-2' }], error: null }),
    );
    syncOuraRecovery
      .mockRejectedValueOnce(new Error('Oura integration requires re-authentication.'))
      .mockResolvedValueOnce(result('athlete-2', 4));

    const { GET } = await import('../app/api/cron/sync-oura/route');
    const response = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.syncedCount).toBe(1);
    expect(body.failedCount).toBe(1);
    expect(body.failed[0]).toMatchObject({ userId: 'athlete-1' });
    expect(body.synced[0]).toMatchObject({ userId: 'athlete-2', syncedDays: 4 });
  });

  it('returns 500 when listing integrations fails', async () => {
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({ data: null, error: { message: 'relation does not exist' } }),
    );

    const { GET } = await import('../app/api/cron/sync-oura/route');
    const response = await GET(makeRequest({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    expect(syncOuraRecovery).not.toHaveBeenCalled();
  });
});
