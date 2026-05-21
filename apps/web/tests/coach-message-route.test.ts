import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadAdaptiveCoachContext = vi.fn();
const adaptWeeklyStructure = vi.fn();
const loadTrainingCoachState = vi.fn();
const runTrainingCoach = vi.fn();
const persistTrainingCoachRun = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/app/plan/coach-data', () => ({ loadAdaptiveCoachContext }));
vi.mock('@/lib/training-plan/adaptive-coach', () => ({ adaptWeeklyStructure }));
vi.mock('@/lib/agents/training-coach-persistence', () => ({
  loadTrainingCoachState,
  persistTrainingCoachRun,
}));
vi.mock('@/lib/agents/training-coach', () => ({ runTrainingCoach }));

const SAMPLE_COACH_INPUT = {
  weeklyStructure: [],
  completedWorkouts: [],
  currentDay: 'Monday',
};

const SAMPLE_ADAPTIVE = {
  fatigueState: 'manageable',
  overloadScore: 200,
  recommendations: [],
};

const SAMPLE_OUTPUT = {
  message: 'Easy run today.',
  recommendations: ['Monday: Aerobic Run — base'],
  cautions: [],
  rationale: 'Fatigue: manageable.',
  conversation: [{ role: 'coach', text: 'Easy run today.' }],
  followUp: null,
  injurySignal: { detected: false, rationale: 'no injury' },
  recoverySignal: { detected: false, rationale: 'no positive phrase' },
  llmInvoked: false,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/coach/message', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/coach/message', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    loadAdaptiveCoachContext.mockResolvedValue(SAMPLE_COACH_INPUT);
    adaptWeeklyStructure.mockReturnValue(SAMPLE_ADAPTIVE);
    loadTrainingCoachState.mockResolvedValue({ conversation: [], followUp: null });
    runTrainingCoach.mockResolvedValue(SAMPLE_OUTPUT);
    persistTrainingCoachRun.mockResolvedValue({ summaryId: 'sum-1', healthEventInserted: false });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'how should I run today?' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runTrainingCoach).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when loading context and running the coach', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');

    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'how should I run today?' }));

    expect(response.status).toBe(200);
    expect(loadAdaptiveCoachContext).toHaveBeenCalledWith(
      expect.anything(),
      'athlete-session',
      expect.objectContaining({ today: expect.any(String) }),
    );
    expect(loadTrainingCoachState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'athlete-session' }));
    expect(persistTrainingCoachRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'athlete-session' }),
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(
      makeRequest({ userId: 'attacker-athlete', message: 'how should I run today?' }),
    );

    expect(response.status).toBe(200);
    const persistCall = persistTrainingCoachRun.mock.calls[0];
    expect((persistCall[1] as { userId: string }).userId).toBe('real-athlete');
    expect((persistCall[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path returns the coach output payload', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'how should I run today?' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Easy run today.',
      recommendations: ['Monday: Aerobic Run — base'],
      rationale: 'Fatigue: manageable.',
      followUp: null,
      injurySignal: { detected: false },
      llmInvoked: false,
      persisted: { summaryId: 'sum-1' },
    });
  });

  it('returns 400 when loadAdaptiveCoachContext throws (e.g. no active plan)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    loadAdaptiveCoachContext.mockRejectedValue(new Error('No active training plan found for athlete; cannot assemble coach context.'));

    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'how should I run today?' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/No active training plan/) });
  });
});


describe('POST /api/coach/message — rate limit', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { resetRateLimitStore } = await import('../lib/rate-limit');
    resetRateLimitStore();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    loadAdaptiveCoachContext.mockResolvedValue(SAMPLE_COACH_INPUT);
    adaptWeeklyStructure.mockReturnValue(SAMPLE_ADAPTIVE);
    loadTrainingCoachState.mockResolvedValue({ conversation: [], followUp: null });
    runTrainingCoach.mockResolvedValue(SAMPLE_OUTPUT);
    persistTrainingCoachRun.mockResolvedValue({ summaryId: 'sum-1', healthEventInserted: false });
  });

  it('returns 429 after 10 calls/min from the same authenticated user', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/coach/message/route');
    const req = () => makeRequest({ message: 'how should I run today?' });

    for (let i = 0; i < 10; i++) {
      const r = await POST(req());
      expect(r.status).toBe(200);
    }
    const eleventh = await POST(req());
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).toBeTruthy();
  });
});
