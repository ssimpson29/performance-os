import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const syncStravaActivities = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/strava/activity-sync', async () => {
  // Preserve the real StravaSyncError so the route's instanceof check works
  // and we still test the error branch of the handler.
  const actual = await vi.importActual<typeof import('@/lib/strava/activity-sync')>(
    '@/lib/strava/activity-sync',
  );
  return {
    ...actual,
    syncStravaActivities,
  };
});

const SAMPLE_RESULT = {
  ok: true,
  provider: 'strava',
  activitiesFetched: 4,
  workoutsInserted: 2,
  workoutsLinkedToApple: 1,
  workoutsAlreadyPresent: 1,
  tokenRefreshed: false,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/sync/strava', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/sync/strava', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    syncStravaActivities.mockResolvedValue(SAMPLE_RESULT);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/sync/strava/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(syncStravaActivities).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when syncing', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { POST } = await import('../app/api/sync/strava/route');
    const response = await POST(makeRequest({ afterDate: '2026-05-01' }));

    expect(response.status).toBe(200);
    expect(syncStravaActivities).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'athlete-session',
        clientId: 'strava-client-id',
        clientSecret: 'strava-secret',
        options: { afterDate: '2026-05-01' },
      }),
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/sync/strava/route');
    const response = await POST(makeRequest({ userId: 'attacker-athlete' }));

    expect(response.status).toBe(200);
    const call = syncStravaActivities.mock.calls[0];
    expect((call[1] as { userId: string }).userId).toBe('real-athlete');
    expect((call[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path returns the activity sync summary', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/sync/strava/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'strava',
      activitiesFetched: 4,
      workoutsInserted: 2,
      workoutsLinkedToApple: 1,
    });
  });

  it('forwards a StravaSyncError as an error response with the carried status', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { StravaSyncError } = await import('@/lib/strava/activity-sync');
    syncStravaActivities.mockRejectedValueOnce(new StravaSyncError('No Strava integration on record', 400));

    const { POST } = await import('../app/api/sync/strava/route');
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      provider: 'strava',
      error: 'No Strava integration on record',
    });
  });
});
