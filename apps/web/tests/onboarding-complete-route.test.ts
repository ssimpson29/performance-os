import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const upsertAthleteProfile = vi.fn();
const markOnboardingComplete = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/profile/profile-writer', () => ({
  upsertAthleteProfile,
  markOnboardingComplete,
}));

type InjuryRow = Record<string, unknown>;

function makeSupabaseCapturingInjuries(insertResult: { error: null | { message: string } }) {
  const captured: InjuryRow[][] = [];
  return {
    captured,
    client: {
      from: vi.fn(() => ({
        insert: vi.fn((rows: InjuryRow[]) => {
          captured.push(rows);
          return {
            then: (resolve: (r: { error: null | { message: string } }) => void) =>
              resolve(insertResult),
          };
        }),
      })),
    } as never,
  };
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/onboarding/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/onboarding/complete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/onboarding/complete/route');
    const res = await POST(buildRequest({ profile: {}, injuries: [] }));
    expect(res.status).toBe(401);
    expect(upsertAthleteProfile).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
  });

  it('returns 400 when JSON is malformed', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const badRequest = new Request('http://localhost/api/onboarding/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const { POST } = await import('../app/api/onboarding/complete/route');
    const res = await POST(badRequest);
    expect(res.status).toBe(400);
  });

  it.each([
    [{ injuries: [] }, /profile must be an object/i],
    [{ profile: {} }, /injuries must be an array/i],
    [{ profile: {}, injuries: [{ startedAt: '2024-01-01' }] }, /bodyPart is required/i],
    [{ profile: {}, injuries: [{ bodyPart: 'foot', startedAt: 'not-a-date' }] }, /startedAt/],
  ])('returns 400 on invalid payload (%j)', async (payload, expectedError) => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { POST } = await import('../app/api/onboarding/complete/route');
    const res = await POST(buildRequest(payload));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(expectedError);
  });

  it('happy path: upserts profile, inserts injuries, stamps onboarding_completed_at', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { client, captured } = makeSupabaseCapturingInjuries({ error: null });
    createServerSupabaseClient.mockReturnValue(client);
    upsertAthleteProfile.mockResolvedValue({});
    markOnboardingComplete.mockResolvedValue(undefined);

    const { POST } = await import('../app/api/onboarding/complete/route');
    const res = await POST(
      buildRequest({
        profile: { heightCm: 180, primaryGoal: 'top 10 at Swiss Alps 100' },
        injuries: [
          { bodyPart: 'left hamstring', startedAt: '2024-06-01', endedAt: '2024-07-15', notes: '6wk off' },
          { bodyPart: 'right foot', startedAt: '2026-03-01' }, // still active
        ],
        raceSeed: { raceName: 'Swiss Alps 100', raceDate: '2026-08-07', distanceKm: 160 },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.raceSeed).toEqual({
      raceName: 'Swiss Alps 100',
      raceDate: '2026-08-07',
      distanceKm: 160,
    });
    expect(upsertAthleteProfile).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.objectContaining({ heightCm: 180, primaryGoal: 'top 10 at Swiss Alps 100' }),
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toHaveLength(2);
    expect(captured[0][0]).toMatchObject({
      user_id: 'user-1',
      event_type: 'injury',
      ended_at: expect.stringContaining('2024-07-15'),
      metadata: { source: 'onboarding', bodyPart: 'left hamstring' },
    });
    expect(captured[0][1]).toMatchObject({
      user_id: 'user-1',
      ended_at: null, // still-active injuries persist as null ended_at
    });
    expect(markOnboardingComplete).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('skips injury insert when array is empty (no spurious DB call)', async () => {
    getAuthenticatedUserId.mockResolvedValue('user-1');
    const { client, captured } = makeSupabaseCapturingInjuries({ error: null });
    createServerSupabaseClient.mockReturnValue(client);
    upsertAthleteProfile.mockResolvedValue({});
    markOnboardingComplete.mockResolvedValue(undefined);

    const { POST } = await import('../app/api/onboarding/complete/route');
    const res = await POST(buildRequest({ profile: { heightCm: 180 }, injuries: [] }));

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(0);
    expect(markOnboardingComplete).toHaveBeenCalled();
  });
});
