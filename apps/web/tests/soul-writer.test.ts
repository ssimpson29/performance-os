import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateSoul } from '../lib/profile/soul-writer';

// vi.mock is hoisted ABOVE all imports. A plain `const loadSoul = vi.fn()`
// at top level would still be in the TDZ when soul-writer.ts (imported
// above) tries to resolve its `./soul-loader` dependency and triggers
// the mock factory. vi.hoisted() lifts the var creation alongside the
// mock so the factory closes over an initialized vi.fn.
const { loadSoul } = vi.hoisted(() => ({ loadSoul: vi.fn() }));

vi.mock('../lib/profile/soul-loader', () => ({ loadSoul }));

type Captured = {
  revisionsInserted: Array<Record<string, unknown>>;
  upsertCalls: Array<{ payload: Record<string, unknown>; conflict: string | undefined }>;
};

function captureSupabase(captured: Captured) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'athlete_soul_revisions') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            captured.revisionsInserted.push(row);
            return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
          }),
        };
      }
      if (table === 'athlete_souls') {
        return {
          upsert: vi.fn((payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
            captured.upsertCalls.push({ payload, conflict: opts?.onConflict });
            return { then: (resolve: (r: { error: null }) => void) => resolve({ error: null }) };
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as never;
}

describe('updateSoul', () => {
  let captured: Captured;

  beforeEach(() => {
    vi.clearAllMocks();
    captured = { revisionsInserted: [], upsertCalls: [] };
  });

  it('inserts a revision snapshot + upserts new content on a non-empty change', async () => {
    loadSoul.mockResolvedValue({
      userId: 'user-1',
      kind: 'training',
      content: 'morning runs only.',
      updatedBy: 'athlete',
      updatedAt: '2026-05-20T10:00:00Z',
    });
    const supabase = captureSupabase(captured);

    const result = await updateSoul(supabase, {
      userId: 'user-1',
      kind: 'training',
      content: 'morning runs only. hate the treadmill.',
      updatedBy: 'training_coach',
    });

    expect(captured.revisionsInserted).toHaveLength(1);
    expect(captured.revisionsInserted[0]).toMatchObject({
      user_id: 'user-1',
      kind: 'training',
      content: 'morning runs only.',           // SNAPSHOTS PRIOR CONTENT
      updated_by: 'athlete',
    });
    expect(captured.upsertCalls).toHaveLength(1);
    expect(captured.upsertCalls[0].payload).toMatchObject({
      user_id: 'user-1',
      kind: 'training',
      content: 'morning runs only. hate the treadmill.',
      updated_by: 'training_coach',
    });
    expect(captured.upsertCalls[0].conflict).toBe('user_id,kind');
    expect(result.content).toBe('morning runs only. hate the treadmill.');
    expect(result.updatedBy).toBe('training_coach');
  });

  it('identical content is a no-op (no revision, no upsert)', async () => {
    loadSoul.mockResolvedValue({
      userId: 'user-1',
      kind: 'training',
      content: 'morning runs only.',
      updatedBy: 'athlete',
      updatedAt: '2026-05-20T10:00:00Z',
    });
    const supabase = captureSupabase(captured);

    const result = await updateSoul(supabase, {
      userId: 'user-1',
      kind: 'training',
      content: 'morning runs only.',
      updatedBy: 'training_coach',
    });

    expect(captured.revisionsInserted).toHaveLength(0);
    expect(captured.upsertCalls).toHaveLength(0);
    expect(result.content).toBe('morning runs only.');
    // No bump: updatedBy stays as the prior athlete value, not training_coach.
    expect(result.updatedBy).toBe('athlete');
  });

  it('first write (no prior row) skips the revision snapshot but still upserts', async () => {
    loadSoul.mockResolvedValue({
      userId: 'user-1',
      kind: 'longevity',
      content: '',
      updatedBy: 'athlete',
      updatedAt: null,
    });
    const supabase = captureSupabase(captured);

    await updateSoul(supabase, {
      userId: 'user-1',
      kind: 'longevity',
      content: 'attia + saladino frame health.',
      updatedBy: 'athlete',
    });

    expect(captured.revisionsInserted).toHaveLength(0); // no prior state to snapshot
    expect(captured.upsertCalls).toHaveLength(1);
    expect(captured.upsertCalls[0].payload).toMatchObject({
      kind: 'longevity',
      content: 'attia + saladino frame health.',
    });
  });
});
