import { beforeEach, describe, expect, it, vi } from 'vitest';

// DELETE /api/coach/conversation — "Start fresh" endpoint. Wipes today's
// coach state from daily_summaries.summary + nulls training_recommendation
// without touching longevity state or souls. Mirrors the auth-scoping +
// merge-without-clobber pattern used elsewhere.

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));

type LoadResult = { data: unknown; error: { message: string } | null };
type UpdateResult = { error: { message: string } | null };

/**
 * Mock Supabase client that captures the update payload separately
 * from the load result. Lets tests assert exactly what summary blob
 * was written and that the row id filter was honored.
 */
function makeSupabase(args: {
  load: LoadResult;
  update?: UpdateResult;
  onUpdate?: (payload: Record<string, unknown>, rowId: string) => void;
}) {
  const updateResult = args.update ?? { error: null };
  return {
    from: vi.fn((_table: string) => {
      // Capture the load chain (select + eq + eq + limit → thenable).
      // Update chain is `update(payload).eq('id', rowId)` and returns
      // a thenable too.
      const chain: Record<string, unknown> = {};
      let updatePayload: Record<string, unknown> | null = null;

      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((_col: string, _val: string) => {
        // Capture row id for update assertions.
        if (updatePayload && _col === 'id') {
          args.onUpdate?.(updatePayload, _val);
        }
        return chain;
      });
      chain.limit = vi.fn(() => chain);
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return chain;
      });
      // Thenable: resolves to load result if no update was started, else update result.
      chain.then = (resolve: (r: LoadResult | UpdateResult) => void) => {
        if (updatePayload) {
          resolve(updateResult);
        } else {
          resolve(args.load);
        }
      };
      return chain;
    }),
  } as unknown as ReturnType<typeof createServerSupabaseClient>;
}

function makeRequest() {
  return new Request('http://localhost/api/coach/conversation', { method: 'DELETE' });
}

describe('DELETE /api/coach/conversation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('returns 401 when not signed in', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    createServerSupabaseClient.mockReturnValue(makeSupabase({ load: { data: [], error: null } }));
    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(401);
  });

  it('returns 200 with cleared=false when no daily summary exists for today', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    let updateCalled = false;
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        load: { data: [], error: null },
        onUpdate: () => {
          updateCalled = true;
        },
      }),
    );
    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cleared: false });
    expect(updateCalled).toBe(false);
  });

  it('strips all coach keys but preserves longevity state + other summary keys', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const existingSummary = {
      coachConversation: [{ role: 'athlete', text: 'hi' }],
      coachFollowUp: { easyThroughDate: '2026-05-26', status: 'active' },
      coachRationale: 'evidence string',
      coachRecommendations: ['rec'],
      coachCautions: ['caution'],
      todaysCall: { headline: 'Long Run', llmInvoked: true },
      // Should survive:
      longevityContext: { recoveryPriority: 'elevated' },
      longevityConversation: [{ role: 'athlete', text: 'how are my labs' }],
      longevityPriorities: ['vitamin d'],
      arbitraryFutureKey: 'leave-me-alone',
    };
    let capturedPayload: Record<string, unknown> | null = null;
    let capturedRowId: string | null = null;
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        load: {
          data: [{ id: 'row-42', summary: existingSummary }],
          error: null,
        },
        onUpdate: (payload, rowId) => {
          capturedPayload = payload;
          capturedRowId = rowId;
        },
      }),
    );

    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cleared: true, touchedAnyKey: true });

    expect(capturedRowId).toBe('row-42');
    expect(capturedPayload).not.toBeNull();
    // Alias to const after the guard — TS doesn't narrow `let` vars that
    // are mutated inside a closure (onUpdate), so capturedPayload.foo
    // would error as 'never' without this step.
    const payload = capturedPayload as Record<string, unknown> | null;
    if (!payload) return;
    expect(payload.training_recommendation).toBeNull();
    const writtenSummary = payload.summary as Record<string, unknown>;
    // Coach keys gone.
    for (const key of [
      'coachConversation',
      'coachFollowUp',
      'coachRationale',
      'coachRecommendations',
      'coachCautions',
      'todaysCall',
    ]) {
      expect(writtenSummary[key]).toBeUndefined();
    }
    // Longevity + arbitrary keys survive.
    expect(writtenSummary.longevityContext).toEqual({ recoveryPriority: 'elevated' });
    expect(writtenSummary.longevityConversation).toEqual([
      { role: 'athlete', text: 'how are my labs' },
    ]);
    expect(writtenSummary.longevityPriorities).toEqual(['vitamin d']);
    expect(writtenSummary.arbitraryFutureKey).toBe('leave-me-alone');
  });

  it('row exists but no coach keys present → still clears training_recommendation', async () => {
    // Edge case: athlete reset already today; summary has only longevity
    // state. The update still runs because training_recommendation could
    // hold a stale top-line answer that the page reads on next load.
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    let capturedPayload: Record<string, unknown> | null = null;
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        load: {
          data: [
            {
              id: 'row-99',
              summary: { longevityContext: { recoveryPriority: 'low' } },
            },
          ],
          error: null,
        },
        onUpdate: (payload) => {
          capturedPayload = payload;
        },
      }),
    );

    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ cleared: true, touchedAnyKey: false });
    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as Record<string, unknown> | null;
    if (!payload) return;
    expect(payload.training_recommendation).toBeNull();
    expect((payload.summary as Record<string, unknown>).longevityContext).toEqual({
      recoveryPriority: 'low',
    });
  });

  it('returns 500 when the load query errors', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        load: { data: null, error: { message: 'supabase down' } },
      }),
    );
    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('supabase down'),
    });
  });

  it('returns 500 when the update query errors', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    createServerSupabaseClient.mockReturnValue(
      makeSupabase({
        load: {
          data: [{ id: 'row-1', summary: { coachConversation: [] } }],
          error: null,
        },
        update: { error: { message: 'write failed' } },
      }),
    );
    const { DELETE } = await import('../app/api/coach/conversation/route');
    const response = await DELETE();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('write failed'),
    });
  });
});
