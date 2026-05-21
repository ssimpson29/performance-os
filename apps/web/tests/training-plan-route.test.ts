import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();
const parseTrainingPlanWorkbook = vi.fn();
const expandTrainingPlanCalendar = vi.fn();
const adaptWeeklyStructure = vi.fn();
const persistImportedTrainingPlan = vi.fn();

vi.mock('@/lib/server-auth', () => ({
  getAuthenticatedUserId,
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient,
}));

vi.mock('@/lib/training-plan/parser', () => ({
  parseTrainingPlanWorkbook,
}));

vi.mock('@/lib/training-plan/expansion', () => ({
  expandTrainingPlanCalendar,
}));

vi.mock('@/lib/training-plan/adaptive-coach', () => ({
  adaptWeeklyStructure,
}));

vi.mock('@/lib/training-plan/persistence', () => ({
  persistImportedTrainingPlan,
}));

const SAMPLE_PARSED = {
  planName: 'Swiss Alps 100',
  sourceFileName: 'plan.xlsx',
  sheetNames: ['Weekly Schedule'],
  weeklyStructure: [
    { day: 'Monday', runSession: 'Easy', details: '', strengthMobility: '', exactWork: '' },
  ],
  phaseBlocks: [],
  supportTemplates: [],
};

const SAMPLE_EXPANDED = { planStartDate: '2026-02-02', totalWeeks: 24, sessions: [] };
const SAMPLE_ADAPTIVE = { fatigueState: 'manageable', overloadScore: 0, recommendations: [] };
const SAMPLE_PERSISTED = { planId: 'plan-1', importedSessions: 0, totalWeeks: 24 };

function buildFormData(overrides: { userId?: string; omitFile?: boolean } = {}) {
  const formData = new FormData();
  if (!overrides.omitFile) {
    formData.set('file', new File(['workbook-bytes'], 'plan.xlsx', { type: 'application/octet-stream' }));
  }
  if (overrides.userId !== undefined) {
    formData.set('userId', overrides.userId);
  }
  formData.set('startDate', '2026-02-02');
  formData.set('completedWorkouts', '[]');
  return formData;
}

describe('POST /api/imports/training-plan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    parseTrainingPlanWorkbook.mockReturnValue(SAMPLE_PARSED);
    expandTrainingPlanCalendar.mockReturnValue(SAMPLE_EXPANDED);
    adaptWeeklyStructure.mockReturnValue(SAMPLE_ADAPTIVE);
    persistImportedTrainingPlan.mockResolvedValue(SAMPLE_PERSISTED);
    createServerSupabaseClient.mockReturnValue({ marker: 'supabase' });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const { POST } = await import('../app/api/imports/training-plan/route');
    const response = await POST(
      new Request('http://localhost/api/imports/training-plan', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(persistImportedTrainingPlan).not.toHaveBeenCalled();
  });

  it('uses the authenticated athlete id when persisting', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-from-session');

    const { POST } = await import('../app/api/imports/training-plan/route');
    const response = await POST(
      new Request('http://localhost/api/imports/training-plan', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(200);
    expect(persistImportedTrainingPlan).toHaveBeenCalledWith(
      expect.anything(),
      SAMPLE_PARSED,
      expect.objectContaining({ userId: 'athlete-from-session' }),
    );
  });

  it('ignores any caller-supplied userId in the form data', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');

    const { POST } = await import('../app/api/imports/training-plan/route');
    const response = await POST(
      new Request('http://localhost/api/imports/training-plan', {
        method: 'POST',
        body: buildFormData({ userId: 'attacker-athlete' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(persistImportedTrainingPlan).toHaveBeenCalledWith(
      expect.anything(),
      SAMPLE_PARSED,
      expect.objectContaining({ userId: 'real-athlete' }),
    );
    // The persisted userId must be the authenticated one, never the attacker.
    const call = persistImportedTrainingPlan.mock.calls[0];
    expect((call[2] as { userId: string }).userId).not.toBe('attacker-athlete');
  });

  it('happy path returns parsedSummary, adaptivePreview, and persisted', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/training-plan/route');
    const response = await POST(
      new Request('http://localhost/api/imports/training-plan', {
        method: 'POST',
        body: buildFormData(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      parsedSummary: {
        planName: 'Swiss Alps 100',
        weeklyStructureCount: 1,
        phaseBlockCount: 0,
        supportTemplateCount: 0,
        expandedWeekCount: 24,
        expandedSessionCount: 0,
      },
      adaptivePreview: SAMPLE_ADAPTIVE,
      persisted: SAMPLE_PERSISTED,
    });
  });

  it('still returns 400 when the workbook file is missing', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');

    const { POST } = await import('../app/api/imports/training-plan/route');
    const response = await POST(
      new Request('http://localhost/api/imports/training-plan', {
        method: 'POST',
        body: buildFormData({ omitFile: true }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Missing workbook file' });
  });
});
