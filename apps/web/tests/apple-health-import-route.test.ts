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

const RUNNING_EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="60" durationUnit="min" startDate="2026-02-07 14:00:00 -0700" endDate="2026-02-07 15:00:00 -0700" totalDistance="12000" totalDistanceUnit="m" totalEnergyBurned="800" totalEnergyBurnedUnit="kcal" sourceName="Scott's Apple Watch" />
</HealthData>`;

function buildFormData(opts: { userId?: string; omitFile?: boolean } = {}) {
  const formData = new FormData();
  if (!opts.omitFile) {
    formData.set('file', new File([RUNNING_EXPORT], 'export.xml', { type: 'text/xml' }));
  }
  if (opts.userId !== undefined) {
    formData.set('userId', opts.userId);
  }
  return formData;
}

describe('POST /api/imports/apple-health', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    importActualWorkouts.mockResolvedValue({
      importedWorkouts: 1,
      matching: {
        summary: { completed: 1, partial: 0, substituted: 0, missed: 0, matched: 1, unmatchedActual: 0 },
      },
    });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/imports/apple-health/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(importActualWorkouts).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when ingesting', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { POST } = await import('../app/api/imports/apple-health/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(200);
    expect(importActualWorkouts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'athlete-session' }),
    );
  });

  it('ignores any caller-supplied userId in the form data', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/imports/apple-health/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: buildFormData({ userId: 'attacker-athlete' }),
      }),
    );

    expect(response.status).toBe(200);
    const call = importActualWorkouts.mock.calls[0];
    expect((call[1] as { userId: string }).userId).toBe('real-athlete');
    expect((call[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path parses the export and returns the ingestion summary plus parsedWorkouts count', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/apple-health/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      importedWorkouts: 1,
      matching: { summary: { completed: 1 } },
      parsedWorkouts: 1,
    });
    expect(importActualWorkouts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'athlete-1',
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
  });

  it('still returns 400 when the file is missing', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/apple-health/route');
    const response = await POST(
      new Request('http://localhost/api/imports/apple-health', {
        method: 'POST',
        body: buildFormData({ omitFile: true }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing file' });
  });
});
