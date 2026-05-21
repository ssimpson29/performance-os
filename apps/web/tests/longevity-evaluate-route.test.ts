import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const runLongevityGuru = vi.fn();
const persistLongevityRun = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/agents/longevity-guru', () => ({ runLongevityGuru }));
vi.mock('@/lib/longevity/persistence', () => ({ persistLongevityRun }));

type QueryResult = { data: unknown; error: { message: string } | null };

function makeSupabase(perTable: Record<string, QueryResult>) {
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order']) {
        chain[m] = (..._args: unknown[]) => chain;
      }
      chain.then = (resolve: (r: QueryResult) => void) => resolve(perTable[table] ?? { data: [], error: null });
      return chain;
    }),
  };
}

const SAMPLE_OUTPUT = {
  priorities: [
    {
      leverKey: 'cardiometabolic' as const,
      severity: 2.5,
      contributingMarkers: ['Apolipoprotein B'],
      recommendation: 'Tighten cardiometabolic levers.',
      rationale: 'High ApoB.',
    },
  ],
  watching: [],
  markerEvaluations: [],
  narrative: 'Top lever: cardiometabolic.',
  cautions: [],
  longevityContext: { recoveryPriority: 'elevated' as const, notes: 'cardio', evaluatedAt: '2026-05-21T00:00:00.000Z' },
  conflictsWithTraining: [],
  llmInvoked: false,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/longevity/evaluate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/longevity/evaluate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        biomarker_results: {
          data: [{ biomarker_key: 'apob', value_numeric: 100, unit: 'mg/dL', measured_at: '2026-05-01' }],
          error: null,
        },
        users: { data: [{ date_of_birth: '1988-03-12', sex: 'male' }], error: null },
      }),
    );
    runLongevityGuru.mockResolvedValue(SAMPLE_OUTPUT);
    persistLongevityRun.mockResolvedValue({ summaryId: 'sum-1' });
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/longevity/evaluate/route');
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(runLongevityGuru).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when running the Guru + persisting', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/longevity/evaluate/route');
    await POST(makeRequest({}));
    expect(persistLongevityRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'athlete-1' }),
    );
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { POST } = await import('../app/api/longevity/evaluate/route');
    await POST(makeRequest({ userId: 'attacker-athlete', athleteQuestion: 'how am I doing?' }));
    const call = persistLongevityRun.mock.calls[0];
    expect((call[1] as { userId: string }).userId).toBe('real-athlete');
    expect((call[1] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('returns 400 when no biomarker_results exist for the athlete', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({ biomarker_results: { data: [], error: null } }),
    );
    const { POST } = await import('../app/api/longevity/evaluate/route');
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Import a panel first/) });
  });

  it('happy path returns the Guru output payload', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/longevity/evaluate/route');
    const response = await POST(makeRequest({ athleteQuestion: 'should I be worried about ApoB?' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      priorities: [expect.objectContaining({ leverKey: 'cardiometabolic' })],
      longevityContext: { recoveryPriority: 'elevated' },
      persisted: { summaryId: 'sum-1' },
    });
  });
});


describe('POST /api/longevity/evaluate — rate limit', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { resetRateLimitStore } = await import('../lib/rate-limit');
    resetRateLimitStore();
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        biomarker_results: { data: [{ biomarker_key: 'apob', value_numeric: 100, unit: 'mg/dL', measured_at: '2026-05-01' }], error: null },
        users: { data: [{ date_of_birth: '1988-03-12', sex: 'male' }], error: null },
      }),
    );
    runLongevityGuru.mockResolvedValue(SAMPLE_OUTPUT);
    persistLongevityRun.mockResolvedValue({ summaryId: 'sum-1' });
  });

  it('returns 429 after 5 calls/min from the same authenticated user', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/longevity/evaluate/route');
    const req = () => makeRequest({});

    for (let i = 0; i < 5; i++) {
      const r = await POST(req());
      expect(r.status).toBe(200);
    }
    const sixth = await POST(req());
    expect(sixth.status).toBe(429);
  });
});
