import { describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.fn();
const importActualWorkouts = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/training-plan/workout-ingestion', () => ({
  importActualWorkouts,
}));

describe('POST /api/imports/apple-health/push', () => {
  it('rejects requests with an invalid signature', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret';

    const { POST } = await import('../app/api/imports/apple-health/push/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health/push?userId=user-1&signature=bad-signature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workouts: [] }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid Apple Health push signature' });
    expect(createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it('imports recurring Apple Health workout payloads through the existing ingestion pipeline', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-secret';

    const { buildAppleHealthPushUrl } = await import('../lib/apple-health/automation');
    const { POST } = await import('../app/api/imports/apple-health/push/route');

    const supabase = { marker: 'supabase' };
    createServerSupabaseClient.mockReturnValue(supabase);
    importActualWorkouts.mockResolvedValue({
      importedWorkouts: 1,
      matching: { summary: { completed: 1, partial: 0, substituted: 0, missed: 0, matched: 1, unmatchedActual: 0 } },
    });

    const response = await POST(
      new Request(buildAppleHealthPushUrl('user-123'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workouts: [
            {
              workoutType: 'Outdoor Run',
              startedAt: '2026-05-05T14:00:00.000Z',
              endedAt: '2026-05-05T15:05:00.000Z',
              distanceMeters: 12000,
              energyKcal: 850,
            },
          ],
        }),
      }),
    );

    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(importActualWorkouts).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        userId: 'user-123',
        workouts: [
          expect.objectContaining({
            source: 'apple_health',
            workoutType: 'Running',
            startedAt: '2026-05-05T14:00:00.000Z',
            endedAt: '2026-05-05T15:05:00.000Z',
            distanceMeters: 12000,
            energyKcal: 850,
          }),
        ],
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedWorkouts: 1,
      matching: { summary: { completed: 1 } },
      acceptedWorkouts: 1,
      mode: 'shortcut_push',
    });
  });
});
