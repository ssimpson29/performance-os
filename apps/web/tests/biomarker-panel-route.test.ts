import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserId = vi.fn();
const createServerSupabaseClient = vi.fn();

vi.mock('@/lib/server-auth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient }));

type CapturedCall = { table: string; method: string; payload?: unknown };

function buildSupabase(opts: {
  insertedPanelId?: string;
  panelInsertError?: { message: string };
  resultsInsertError?: { message: string };
}) {
  const calls: CapturedCall[] = [];

  const makeChain = (table: string, method: string, payload?: unknown) => {
    calls.push({ table, method, payload });
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'order']) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.single = async () => {
      if (table === 'lab_panels' && method === 'insert') {
        if (opts.panelInsertError) return { data: null, error: opts.panelInsertError };
        return { data: { id: opts.insertedPanelId ?? 'panel-1' }, error: null };
      }
      return { data: null, error: null };
    };
    chain.then = (resolve: (r: { data: unknown; error: unknown }) => void) => {
      if (table === 'biomarker_results' && method === 'insert') {
        resolve({ data: null, error: opts.resultsInsertError ?? null });
        return;
      }
      resolve({ data: null, error: null });
    };
    return chain;
  };

  const supabase = {
    from: (table: string) => ({
      select: (...args: unknown[]) => makeChain(table, 'select', args),
      insert: (payload: unknown) => makeChain(table, 'insert', payload),
    }),
  };
  return { supabase, calls };
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/imports/biomarker-panel', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/imports/biomarker-panel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const { supabase } = buildSupabase({ insertedPanelId: 'panel-1' });
    createServerSupabaseClient.mockReturnValue(supabase);
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(
      makeRequest({
        panelDate: '2026-05-01',
        markers: [{ markerKey: 'apob', value: 80, unit: 'mg/dL' }],
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('uses authenticated athlete id when persisting (verified via panel insert)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-session');
    const { supabase, calls } = buildSupabase({ insertedPanelId: 'panel-1' });
    createServerSupabaseClient.mockReturnValue(supabase);
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(
      makeRequest({
        panelDate: '2026-05-01',
        markers: [{ markerKey: 'apob', value: 80, unit: 'mg/dL' }],
      }),
    );
    expect(response.status).toBe(200);
    const panelInsert = calls.find((c) => c.table === 'lab_panels' && c.method === 'insert');
    expect(panelInsert).toBeDefined();
    const payload = panelInsert!.payload as { user_id: string };
    expect(payload.user_id).toBe('athlete-session');
  });

  it('ignores any caller-supplied userId in the body', async () => {
    getAuthenticatedUserId.mockResolvedValue('real-athlete');
    const { supabase, calls } = buildSupabase({ insertedPanelId: 'panel-1' });
    createServerSupabaseClient.mockReturnValue(supabase);
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    await POST(
      makeRequest({
        userId: 'attacker-athlete',
        panelDate: '2026-05-01',
        markers: [{ markerKey: 'apob', value: 80, unit: 'mg/dL' }],
      }),
    );
    const panelInsert = calls.find((c) => c.table === 'lab_panels' && c.method === 'insert');
    const payload = panelInsert!.payload as { user_id: string };
    expect(payload.user_id).toBe('real-athlete');
  });

  it('happy path inserts panel + marker rows, returns summary with evaluation flags', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { supabase, calls } = buildSupabase({ insertedPanelId: 'panel-xyz' });
    createServerSupabaseClient.mockReturnValue(supabase);
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(
      makeRequest({
        panelDate: '2026-05-01',
        provider: 'Quest',
        panelName: 'Annual longevity',
        markers: [
          { markerKey: 'apob', value: 80, unit: 'mg/dL' },
          { markerKey: 'hs_crp', value: 0.5, unit: 'mg/L' },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      panelId: 'panel-xyz',
      importedMarkerCount: 2,
      summary: [
        expect.objectContaining({ markerKey: 'apob', flag: 'in_range' }),
        expect.objectContaining({ markerKey: 'hs_crp', flag: 'in_range' }),
      ],
    });

    // biomarker_results insert should carry the snapshotted reference + optimal.
    const resultsInsert = calls.find((c) => c.table === 'biomarker_results' && c.method === 'insert');
    expect(resultsInsert).toBeDefined();
    const rows = resultsInsert!.payload as Array<Record<string, unknown>>;
    expect(rows[0].biomarker_key).toBe('apob');
    expect(rows[0].reference_high).toBe(130);
    expect(rows[0].optimal_high).toBe(80);
    expect(rows[0].status).toBe('in_range');
    expect(rows[0].metadata).toBeUndefined(); // marker-row metadata is per-result, not the lab panel

    // The lab_panels insert should also carry source + importedAt metadata.
    const panelInsert = calls.find((c) => c.table === 'lab_panels' && c.method === 'insert');
    const panelPayload = panelInsert!.payload as { metadata: Record<string, unknown> };
    expect(panelPayload.metadata).toMatchObject({ source: 'json_upload', markerCount: 2 });
    expect(typeof panelPayload.metadata.importedAt).toBe('string');
  });

  it('returns 400 when panelDate is missing or malformed', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(makeRequest({ markers: [{ markerKey: 'apob', value: 80, unit: 'mg/dL' }] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/panelDate/) });
  });

  it('returns 400 when markers array is missing or empty', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(makeRequest({ panelDate: '2026-05-01', markers: [] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/markers array/) });
  });

  it('returns 400 on unknown marker key (fail-fast — no panel inserted)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { supabase, calls } = buildSupabase({});
    createServerSupabaseClient.mockReturnValue(supabase);
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(
      makeRequest({
        panelDate: '2026-05-01',
        markers: [{ markerKey: 'completely_made_up', value: 1, unit: 'mg/dL' }],
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Unknown marker key/) });
    // No DB write should have happened.
    expect(calls.find((c) => c.method === 'insert')).toBeUndefined();
  });

  it('returns 400 on unit mismatch (fail-fast)', async () => {
    getAuthenticatedUserId.mockResolvedValue('athlete-1');
    const { POST } = await import('../app/api/imports/biomarker-panel/route');
    const response = await POST(
      makeRequest({
        panelDate: '2026-05-01',
        markers: [{ markerKey: 'apob', value: 1, unit: 'mmol/L' }], // wrong unit
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Unit mismatch/) });
  });
});
