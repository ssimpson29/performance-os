import { beforeEach, describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.fn();
const syncOuraRecovery = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/oura/recovery-sync', () => ({
  syncOuraRecovery,
}));

describe('POST /api/sync/oura', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns 400 when userId is missing', async () => {
    const { POST } = await import('../app/api/sync/oura/route');

    const response = await POST(
      new Request('http://localhost/api/sync/oura', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(createServerSupabaseClient).not.toHaveBeenCalled();
    expect(syncOuraRecovery).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing userId' });
  });

  it('delegates Oura recovery sync to the server helper and returns its summary', async () => {
    const { POST } = await import('../app/api/sync/oura/route');
    const supabase = { marker: 'supabase' };
    createServerSupabaseClient.mockReturnValue(supabase);
    syncOuraRecovery.mockResolvedValue({
      ok: true,
      provider: 'oura',
      userId: 'user-123',
      startDate: '2026-05-01',
      endDate: '2026-05-06',
      syncedDays: 3,
      recordsFetched: {
        readiness: 3,
        sleep: 3,
        activity: 3,
      },
      tokenRefreshed: false,
    });

    const response = await POST(
      new Request('http://localhost/api/sync/oura', {
        method: 'POST',
        body: JSON.stringify({
          userId: 'user-123',
          startDate: '2026-05-01',
          endDate: '2026-05-06',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(syncOuraRecovery).toHaveBeenCalledWith(supabase, {
      userId: 'user-123',
      startDate: '2026-05-01',
      endDate: '2026-05-06',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'oura',
      syncedDays: 3,
    });
  });
});
