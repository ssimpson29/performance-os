import { describe, expect, it } from 'vitest';

import {
  clearPlanProposal,
  loadPlanProposal,
  savePlanProposal,
} from '../lib/agents/plan-proposal-store';
import type { ProposeRacePlanResult } from '../lib/agents/plan-generator';

// A draft proposal is an opaque blob to this module; a minimal stub is enough.
const proposal = (race: string) =>
  ({ summary: `${race} plan`, raceContext: { race }, plan: {} } as unknown as ProposeRacePlanResult);

type Row = { id: string; user_id: string; day: string; summary: Record<string, unknown> | null };

/**
 * Minimal in-memory fake of the supabase query builder for the daily_summaries
 * table, supporting exactly the chains this module uses:
 *   .select(..).eq(..).eq(..).limit(n)
 *   .select(..).eq(..).order('day',{ascending:false}).limit(n)
 *   .update({..}).eq('id', id)
 *   .insert({..})
 */
function makeDb(initial: Array<Partial<Row>> = []) {
  const rows: Row[] = initial.map((r, i) => ({
    id: r.id ?? `row-${i + 1}`,
    user_id: r.user_id ?? 'user-1',
    day: r.day ?? '2026-05-29',
    summary: r.summary ?? null,
  }));
  let seq = rows.length;

  function from() {
    const state: {
      op: 'select' | 'update' | 'insert';
      payload: Record<string, unknown> | null;
      filters: Record<string, unknown>;
      orderAsc: boolean | null;
      limit: number | null;
    } = { op: 'select', payload: null, filters: {}, orderAsc: null, limit: null };

    const match = (row: Row) =>
      Object.entries(state.filters).every(([k, v]) => (row as Record<string, unknown>)[k] === v);

    function run() {
      if (state.op === 'select') {
        let result = rows.filter(match);
        if (state.orderAsc === false) result = [...result].sort((a, b) => (a.day < b.day ? 1 : -1));
        if (state.limit != null) result = result.slice(0, state.limit);
        return { data: result.map((r) => ({ ...r })), error: null };
      }
      if (state.op === 'update') {
        for (const row of rows.filter(match)) Object.assign(row, state.payload);
        return { error: null };
      }
      seq += 1;
      rows.push({ id: `row-${seq}`, user_id: '', day: '', summary: null, ...(state.payload as object) } as Row);
      return { error: null };
    }

    const builder: Record<string, unknown> = {
      select() {
        state.op = 'select';
        return builder;
      },
      update(p: Record<string, unknown>) {
        state.op = 'update';
        state.payload = p;
        return builder;
      },
      insert(p: Record<string, unknown>) {
        state.op = 'insert';
        state.payload = p;
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters[col] = val;
        return builder;
      },
      order(_col: string, opts: { ascending?: boolean }) {
        state.orderAsc = opts?.ascending ?? true;
        return builder;
      },
      limit(n: number) {
        state.limit = n;
        return builder;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  return { from, _rows: rows } as never;
}

describe('plan-proposal-store', () => {
  it('inserts a new daily_summaries row when none exists', async () => {
    const db = makeDb([]);
    await savePlanProposal(db, { userId: 'user-1', today: '2026-05-29', proposalId: 'p1', proposal: proposal('SA100') });

    const stored = await loadPlanProposal(db, { userId: 'user-1' });
    expect(stored?.proposalId).toBe('p1');
    expect(stored?.day).toBe('2026-05-29');
    expect((stored?.proposal as unknown as { summary: string }).summary).toBe('SA100 plan');
  });

  it('merges into an existing summary without clobbering other keys', async () => {
    const db = makeDb([
      {
        user_id: 'user-1',
        day: '2026-05-29',
        summary: { coachConversation: [{ role: 'athlete', text: 'hi' }], todaysCall: { headline: 'Long run' } },
      },
    ]);
    await savePlanProposal(db, { userId: 'user-1', today: '2026-05-29', proposalId: 'p1', proposal: proposal('SA100') });

    const row = (db as unknown as { _rows: Row[] })._rows[0];
    expect(row.summary).toHaveProperty('coachConversation');
    expect(row.summary).toHaveProperty('todaysCall');
    expect((row.summary as { planProposal: { proposalId: string } }).planProposal.proposalId).toBe('p1');
  });

  it('overwrites the prior draft on a fresh proposal (one active per athlete)', async () => {
    const db = makeDb([]);
    await savePlanProposal(db, { userId: 'user-1', today: '2026-05-29', proposalId: 'p1', proposal: proposal('SA100') });
    await savePlanProposal(db, { userId: 'user-1', today: '2026-05-29', proposalId: 'p2', proposal: proposal('UTMB') });

    const stored = await loadPlanProposal(db, { userId: 'user-1' });
    expect(stored?.proposalId).toBe('p2');
    expect((stored?.proposal as unknown as { summary: string }).summary).toBe('UTMB plan');
  });

  it('finds a proposal stored on an earlier day (approval crosses midnight)', async () => {
    const db = makeDb([
      { user_id: 'user-1', day: '2026-05-28', summary: { planProposal: { proposalId: 'p-old', proposal: proposal('SA100'), proposedAt: '2026-05-28T23:50:00Z' } } },
      { user_id: 'user-1', day: '2026-05-29', summary: { todaysCall: { headline: 'Rest' } } },
    ]);
    const stored = await loadPlanProposal(db, { userId: 'user-1' });
    expect(stored?.proposalId).toBe('p-old');
    expect(stored?.day).toBe('2026-05-28');
  });

  it('returns null when there is no proposal', async () => {
    const db = makeDb([{ user_id: 'user-1', day: '2026-05-29', summary: { todaysCall: {} } }]);
    expect(await loadPlanProposal(db, { userId: 'user-1' })).toBeNull();
  });

  it('clears the proposal but preserves the rest of the summary', async () => {
    const db = makeDb([
      {
        user_id: 'user-1',
        day: '2026-05-29',
        summary: { coachConversation: [{ role: 'athlete', text: 'hi' }], planProposal: { proposalId: 'p1', proposal: proposal('SA100'), proposedAt: '' } },
      },
    ]);
    await clearPlanProposal(db, { userId: 'user-1', day: '2026-05-29' });

    const row = (db as unknown as { _rows: Row[] })._rows[0];
    expect(row.summary).toHaveProperty('coachConversation');
    expect(row.summary).not.toHaveProperty('planProposal');
    expect(await loadPlanProposal(db, { userId: 'user-1' })).toBeNull();
  });

  it('locates and clears the proposal row when day is omitted', async () => {
    const db = makeDb([
      { user_id: 'user-1', day: '2026-05-28', summary: { planProposal: { proposalId: 'p1', proposal: proposal('SA100'), proposedAt: '' } } },
    ]);
    await clearPlanProposal(db, { userId: 'user-1' });
    expect(await loadPlanProposal(db, { userId: 'user-1' })).toBeNull();
  });
});
