import { describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.fn();
const importActualWorkouts = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/training-plan/workout-ingestion', () => ({
  importActualWorkouts,
}));

describe('POST /api/imports/apple-health', () => {
  it('returns 400 when the file or userId is missing', async () => {
    const { POST } = await import('../app/api/imports/apple-health/route');

    const formData = new FormData();
    formData.set('file', new File(['<HealthData />'], 'export.xml', { type: 'text/xml' }));

    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: formData,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing userId' });
  });

  it('parses the Apple Health export and delegates workout ingestion', async () => {
    const { POST } = await import('../app/api/imports/apple-health/route');
    const supabase = { marker: 'supabase' };
    createServerSupabaseClient.mockReturnValue(supabase);
    importActualWorkouts.mockResolvedValue({
      importedWorkouts: 1,
      matching: { summary: { completed: 1, partial: 0, substituted: 0, missed: 0, matched: 1, unmatchedActual: 0 } },
    });

    const formData = new FormData();
    formData.set('userId', 'user-1');
    formData.set(
      'file',
      new File(
        [
          `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="60" durationUnit="min" startDate="2026-02-07 14:00:00 -0700" endDate="2026-02-07 15:00:00 -0700" totalDistance="12000" totalDistanceUnit="m" totalEnergyBurned="800" totalEnergyBurnedUnit="kcal" sourceName="Scott’s Apple Watch" />
</HealthData>`,
        ],
        'export.xml',
        { type: 'text/xml' },
      ),
    );

    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: formData,
      }),
    );

    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1);
    expect(importActualWorkouts).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        userId: 'user-1',
        workouts: [
          expect.objectContaining({
            source: 'apple_health',
            workoutType: 'Running',
            durationSeconds: 3600,
            distanceMeters: 12000,
          }),
        ],
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedWorkouts: 1,
      matching: { summary: { completed: 1 } },
      parsedWorkouts: 1,
    });
  });
});
