import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUserId } = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));
const { createServerSupabaseClient } = vi.hoisted(() => ({ createServerSupabaseClient: vi.fn() }));
const { disconnectIntegration } = vi.hoisted(() => ({ disconnectIntegration: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/integrations/disconnect', () => ({ disconnectIntegration }));

function req(body: unknown) {
  return new Request('http://localhost/api/integrations/disconnect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/integrations/disconnect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'sb' });
    disconnectIntegration.mockResolvedValue({
      provider: 'oura',
      deletedRecovery: 26,
      deletedWorkouts: 0,
      deletedSyncRuns: 3,
      integrationRemoved: true,
    });
  });

  it('401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/integrations/disconnect/route');
    const res = await POST(req({ provider: 'oura' }));
    expect(res.status).toBe(401);
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it('400 on an unknown provider', async () => {
    getAuthenticatedUserId.mockResolvedValue('u1');
    const { POST } = await import('../app/api/integrations/disconnect/route');
    const res = await POST(req({ provider: 'fitbit' }));
    expect(res.status).toBe(400);
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it('disconnects for the session athlete, ignoring any caller-supplied userId', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/integrations/disconnect/route');
    const res = await POST(req({ provider: 'oura', userId: 'attacker' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, provider: 'oura', deletedRecovery: 26 });
    expect(disconnectIntegration).toHaveBeenCalledWith(expect.anything(), {
      userId: 'real-athlete',
      provider: 'oura',
    });
  });

  it('500 with a message when the disconnect throws', async () => {
    getAuthenticatedUserId.mockResolvedValue('u1');
    disconnectIntegration.mockRejectedValue(new Error('Failed to delete from workouts: boom'));
    const { POST } = await import('../app/api/integrations/disconnect/route');
    const res = await POST(req({ provider: 'strava' }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/workouts/) });
  });
});
