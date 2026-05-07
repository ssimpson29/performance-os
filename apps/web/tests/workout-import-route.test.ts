import { describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.fn();
const importActualWorkouts = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/training-plan/workout-ingestion', () => ({
  importActualWorkouts,
}));

describe('POST /api/imports/workouts', () => {
  it('returns 400 when userId or workouts are missing', async () => {
    const { POST } = await import('../app/api/imports/workouts/route');

    const response = await POST(
      new Request('http://localhost/api/imports/workouts', {
        method: 'POST',
        body: JSON.stringify({ workouts: [] }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing userId',
    });
  });

  it('delegates structured workout ingestion and returns its summary', async () => {
    const { POST } = await import('../app/api/imports/workouts/route');
    const supabase = { marker: 'supabase' };
    createServerSupabaseClient.mockReturnValue(supabase);
    importActualWorkouts.mockResolvedValue({
      importedWorkouts: 2,
      matching: {
        summary: {
          completed: 1,
          partial: 0,
          substituted: 0,
          missed: 1,
          matched: 1,
          unmatchedActual: 1,
        },
      },
    });

    const response = await POST(
      new Request('http://localhost/api/imports/workouts', {
        method: 'POST',
        body: JSON.stringify({
          userId: 'user-1',
          workouts: [{ externalId: 'w1' }],
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(importActualWorkouts).toHaveBeenCalledWith(supabase, {
      userId: 'user-1',
      workouts: [{ externalId: 'w1' }],
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedWorkouts: 2,
      matching: {
        summary: {
          completed: 1,
          missed: 1,
        },
      },
    });
  });
});
