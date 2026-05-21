import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const importActualWorkouts = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/training-plan/workout-ingestion', () => ({
  importActualWorkouts,
}));

const SAMPLE_RESULT = {
  importedWorkouts: 2,
  matching: {
    summary: { completed: 1, partial: 0, substituted: 0, missed: 1, matched: 1, unmatchedActual: 1 },
  },
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/imports/workouts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/imports/workouts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    importActualWorkouts.mockResolvedValue(SAMPLE_RESULT);
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/imports/workouts/route');
    const response = await POST(makeRequest({ workouts: [{ externalId: 'w1' }] }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(importActualWorkouts).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when ingesting', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-from-session');

    const { POST } = await import('../app/api/imports/workouts/route');
    const response = await POST(makeRequest({ workouts: [{ externalId: 'w1' }] }));

    expect(response.status).toBe(200);
    expect(importActualWorkouts).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'athlete-from-session', workouts: [{ externalId: 'w1' }] },
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/imports/workouts/route');
    const response = await POST(
      makeRequest({ userId: 'attacker-athlete', workouts: [{ externalId: 'w1' }] }),
    );

    expect(response.status).toBe(200);
    const call = importActualWorkouts.mock.calls[0];
    expect((call[1] as { userId: string }).userId).toBe('real-athlete');
    expect((call[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path returns the ingestion summary', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/workouts/route');
    const response = await POST(makeRequest({ workouts: [{ externalId: 'w1' }] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedWorkouts: 2,
      matching: { summary: { completed: 1, missed: 1 } },
    });
  });

  it('still returns 400 when the workouts array is missing or empty', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/workouts/route');
    const response = await POST(makeRequest({ workouts: [] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing workouts payload' });
  });
});
