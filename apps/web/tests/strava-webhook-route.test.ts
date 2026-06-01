import { beforeEach, describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.fn();
const loadStravaIntegrationByOwnerId = vi.fn();
const handleStravaActivityEvent = vi.fn();
const disconnectIntegration = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/integrations/disconnect', () => ({ disconnectIntegration }));

vi.mock('@/lib/strava/activity-sync', async () => {
  const actual = await vi.importActual<typeof import('@/lib/strava/activity-sync')>(
    '@/lib/strava/activity-sync',
  );
  return {
    ...actual,
    loadStravaIntegrationByOwnerId,
    handleStravaActivityEvent,
  };
});

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/webhooks/strava', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/webhooks/strava (verification challenge)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'expected-token';
  });

  it('echoes hub.challenge when the verify_token matches', async () => {
    const { GET } = await import('../app/api/webhooks/strava/route');
    const url =
      'http://localhost/api/webhooks/strava?hub.mode=subscribe&hub.verify_token=expected-token&hub.challenge=abc123';
    const response = await GET(new Request(url));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ 'hub.challenge': 'abc123' });
  });

  it('rejects with 403 when the verify_token is wrong', async () => {
    const { GET } = await import('../app/api/webhooks/strava/route');
    const url =
      'http://localhost/api/webhooks/strava?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=abc123';
    const response = await GET(new Request(url));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'verify_token_mismatch' });
  });

  it('rejects with 400 when hub.mode is missing', async () => {
    const { GET } = await import('../app/api/webhooks/strava/route');
    const url = 'http://localhost/api/webhooks/strava?hub.verify_token=expected-token&hub.challenge=abc123';
    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
  });
});

describe('POST /api/webhooks/strava (event handler)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.STRAVA_CLIENT_ID = 'strava-client-id';
    process.env.STRAVA_CLIENT_SECRET = 'strava-secret';
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'expected-token';
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
  });

  it('on athlete deauthorization, deletes the Strava data for that owner', async () => {
    loadStravaIntegrationByOwnerId.mockResolvedValue({ userId: 'u1', integration: { id: 'i1' } });
    disconnectIntegration.mockResolvedValue({
      provider: 'strava',
      deletedWorkouts: 12,
      deletedRecovery: 0,
      deletedSyncRuns: 2,
      integrationRemoved: true,
    });
    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({ object_type: 'athlete', aspect_type: 'update', owner_id: 999, updates: { authorized: 'false' } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, deauthorized: true });
    expect(disconnectIntegration).toHaveBeenCalledWith(expect.anything(), { userId: 'u1', provider: 'strava' });
    expect(handleStravaActivityEvent).not.toHaveBeenCalled();
  });

  it('acks an athlete deauthorization for an unknown owner', async () => {
    loadStravaIntegrationByOwnerId.mockResolvedValue(null);
    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({ object_type: 'athlete', owner_id: 5, updates: { authorized: 'false' } }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: 'deauth_unknown_owner' });
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it('acks non-activity events without touching the integration', async () => {
    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({
        object_type: 'athlete',
        aspect_type: 'update',
        owner_id: 42,
        object_id: 99,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: 'non_activity_event' });
    expect(loadStravaIntegrationByOwnerId).not.toHaveBeenCalled();
  });

  it('acks delete events without dispatching to the handler', async () => {
    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({
        object_type: 'activity',
        aspect_type: 'delete',
        owner_id: 42,
        object_id: 99,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: 'delete_event' });
    expect(handleStravaActivityEvent).not.toHaveBeenCalled();
  });

  it('acks when owner_id maps to no integration row (fails closed)', async () => {
    loadStravaIntegrationByOwnerId.mockResolvedValue(null);

    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({
        object_type: 'activity',
        aspect_type: 'create',
        owner_id: 42,
        object_id: 99,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, ignored: 'unknown_owner' });
    expect(handleStravaActivityEvent).not.toHaveBeenCalled();
  });

  it('dispatches to the handler when owner is recognized and returns the result', async () => {
    loadStravaIntegrationByOwnerId.mockResolvedValue({
      userId: 'athlete-1',
      integration: { id: 'integration-1' },
    });
    handleStravaActivityEvent.mockResolvedValue('linked');

    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({
        object_type: 'activity',
        aspect_type: 'create',
        owner_id: 42,
        object_id: 1234,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: 'linked' });
    expect(handleStravaActivityEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'athlete-1',
        integration: { id: 'integration-1' },
        activityId: 1234,
        clientId: 'strava-client-id',
        clientSecret: 'strava-secret',
      }),
    );
  });

  it('returns the StravaSyncError status when the handler raises a sync error', async () => {
    loadStravaIntegrationByOwnerId.mockResolvedValue({
      userId: 'athlete-1',
      integration: { id: 'integration-1' },
    });
    const { StravaSyncError } = await import('@/lib/strava/activity-sync');
    handleStravaActivityEvent.mockRejectedValueOnce(new StravaSyncError('Boom', 502));

    const { POST } = await import('../app/api/webhooks/strava/route');
    const response = await POST(
      makePostRequest({
        object_type: 'activity',
        aspect_type: 'create',
        owner_id: 42,
        object_id: 1234,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: 'Boom' });
  });
});
