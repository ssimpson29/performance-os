import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const syncOuraRecovery = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/oura/recovery-sync', () => ({
  syncOuraRecovery,
}));

const SAMPLE_RESULT = {
  ok: true,
  provider: 'oura',
  userId: 'real-athlete',
  startDate: '2026-05-01',
  endDate: '2026-05-06',
  syncedDays: 3,
  recordsFetched: { readiness: 3, sleep: 3, activity: 3 },
  tokenRefreshed: false,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/sync/oura', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/sync/oura', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    syncOuraRecovery.mockResolvedValue(SAMPLE_RESULT);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/sync/oura/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(syncOuraRecovery).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when syncing', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { POST } = await import('../app/api/sync/oura/route');
    const response = await POST(makeRequest({ startDate: '2026-05-01', endDate: '2026-05-06' }));

    expect(response.status).toBe(200);
    expect(syncOuraRecovery).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'athlete-session', startDate: '2026-05-01', endDate: '2026-05-06' },
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/sync/oura/route');
    const response = await POST(makeRequest({ userId: 'attacker-athlete' }));

    expect(response.status).toBe(200);
    const call = syncOuraRecovery.mock.calls[0];
    expect((call[1] as { userId: string }).userId).toBe('real-athlete');
    expect((call[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path returns the recovery sync summary', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/sync/oura/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'oura',
      syncedDays: 3,
    });
  });
});
