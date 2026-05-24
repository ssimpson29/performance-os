import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const loadAthleteContext = vi.fn();
const runTrainingCoach = vi.fn();
const persistTrainingCoachRun = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/agents/athlete-context', () => ({ loadAthleteContext }));
vi.mock('@/lib/agents/training-coach', () => ({ runTrainingCoach }));
vi.mock('@/lib/agents/training-coach-persistence', () => ({ persistTrainingCoachRun }));

const SAMPLE_CONTEXT = {
  userId: 'real-athlete',
  today: '2026-05-22',
  // Profile shell: every athletic field null, mirroring an athlete who
  // signed in but hasn't completed onboarding. Mock just needs the shape
  // — the route forwards context to runTrainingCoach (also mocked).
  profile: {
    userId: 'real-athlete',
    displayName: null,
    timezone: null,
    dateOfBirth: null,
    sex: null,
    heightCm: null,
    weightKg: null,
    primaryGoal: null,
    experienceLevel: null,
    weeklyTrainingHoursBaseline: null,
    healthNotes: null,
    onboardingCompletedAt: null,
  },
  currentPlan: null,
  recentWorkouts: [],
  recoveryHistory: [],
  injuryHistory: [],
  biomarkers: null,
  longevityContext: null,
  conversation: [],
  followUp: null,
  longevityConversation: [],
  trainingSoul: {
    userId: 'real-athlete',
    kind: 'training',
    content: '',
    updatedBy: 'athlete',
    updatedAt: null,
  },
  longevitySoul: {
    userId: 'real-athlete',
    kind: 'longevity',
    content: '',
    updatedBy: 'athlete',
    updatedAt: null,
  },
};

const SAMPLE_OUTPUT = {
  message: 'Easy run today.',
  recommendations: [],
  cautions: [],
  rationale: 'Coach in plan-building mode.',
  conversation: [{ role: 'coach', text: 'Easy run today.' }],
  followUp: null,
  injurySignal: { detected: false, rationale: 'no injury pattern matched' },
  recoverySignal: { detected: false, rationale: 'no positive-recovery phrase detected' },
  llmInvoked: true,
  toolTrace: [],
  planCommitted: false,
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
    vi.resetModules();
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
    loadAthleteContext.mockResolvedValue(SAMPLE_CONTEXT);
    runTrainingCoach.mockResolvedValue(SAMPLE_OUTPUT);
    persistTrainingCoachRun.mockResolvedValue({ summaryId: 'summary-1', healthEventInserted: false });
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'hi' }));
    expect(response.status).toBe(401);
    expect(runTrainingCoach).not.toHaveBeenCalled();
  });

  it('uses authenticated athlete id and threads it through the loader', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'how should I run today?' }));
    expect(response.status).toBe(200);
    expect(loadAthleteContext).toHaveBeenCalledWith(
      expect.anything(),
      'real-athlete',
      expect.objectContaining({ today: expect.any(String) }),
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'hi', userId: 'attacker' }));
    expect(response.status).toBe(200);
    expect(loadAthleteContext).toHaveBeenCalledWith(
      expect.anything(),
      'real-athlete',
      expect.anything(),
    );
  });

  it('happy path returns the coach output including toolTrace and planCommitted', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: 'feeling solid' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Easy run today.',
      llmInvoked: true,
      toolTrace: [],
      planCommitted: false,
    });
    expect(persistTrainingCoachRun).toHaveBeenCalledTimes(1);
  });

  it('does NOT throw on no-plan athlete — the new loader returns currentPlan: null gracefully', async () => {
    getAuthenticatedUserId.mockResolvedValue('new-athlete');
    const { POST } = await import('../app/api/coach/message/route');
    const response = await POST(makeRequest({ message: "I just signed up for a 100k" }));
    expect(response.status).toBe(200);
  });

  it('rate-limits when called more than 10 times in 60s', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/coach/message/route');
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(makeRequest({ message: `msg ${i}` }));
      expect(response.status).toBe(200);
    }
    const limited = await POST(makeRequest({ message: 'one too many' }));
    expect(limited.status).toBe(429);
  });
});
