import { describe, expect, it, vi } from 'vitest';

import { loadSoul } from '../lib/profile/soul-loader';

type ChainResult = { data: unknown; error: { message: string } | null };

function supabaseReturning(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'limit', 'order']) {
    chain[m] = vi.fn(() => chain);
  }
  Object.assign(chain, {
    then: (resolve: (r: ChainResult) => void) => resolve(result),
  });
  return { from: vi.fn(() => chain) } as never;
}

describe('loadSoul', () => {
  it('returns an empty-content shell when no row exists', async () => {
    const supabase = supabaseReturning({ data: [], error: null });
    const soul = await loadSoul(supabase, 'user-1', 'training');
    expect(soul).toEqual({
      userId: 'user-1',
      kind: 'training',
      content: '',
      updatedBy: 'athlete',
      updatedAt: null,
    });
  });

  it('maps a populated row to AthleteSoul', async () => {
    const supabase = supabaseReturning({
      data: [
        {
          user_id: 'user-1',
          kind: 'longevity',
          content: 'I value Attia and Saladino on health topics.',
          updated_by: 'athlete',
          updated_at: '2026-05-22T10:00:00Z',
        },
      ],
      error: null,
    });
    const soul = await loadSoul(supabase, 'user-1', 'longevity');
    expect(soul.kind).toBe('longevity');
    expect(soul.content).toBe('I value Attia and Saladino on health topics.');
    expect(soul.updatedBy).toBe('athlete');
    expect(soul.updatedAt).toBe('2026-05-22T10:00:00Z');
  });

  it('treats null content defensively as empty string', async () => {
    const supabase = supabaseReturning({
      data: [
        {
          user_id: 'user-1',
          kind: 'training',
          content: null,
          updated_by: 'training_coach',
          updated_at: '2026-05-22T10:00:00Z',
        },
      ],
      error: null,
    });
    const soul = await loadSoul(supabase, 'user-1', 'training');
    expect(soul.content).toBe('');
  });

  it('throws on supabase error (so DB outages are not masked as empty soul)', async () => {
    const supabase = supabaseReturning({ data: null, error: { message: 'rls denied' } });
    await expect(loadSoul(supabase, 'user-1', 'training')).rejects.toThrow(/rls denied/);
  });
});
