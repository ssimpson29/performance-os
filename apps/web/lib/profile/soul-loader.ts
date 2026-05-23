import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Durable per-athlete memory document. Two kinds per athlete: one
 * scoped to Training Coach context (preferences, training values,
 * recurring patterns), one to Longevity Guru context (doctor /
 * influencer preferences, chronic conditions framing, dietary
 * philosophies). Both are read by each LLM's system prompt every
 * turn so the agents reframe every response through them.
 *
 * Schema: supabase/migrations/010_athlete_souls.sql.
 */
export type SoulKind = 'training' | 'longevity';
export type SoulAuthor = 'athlete' | 'training_coach' | 'longevity_guru';

export type AthleteSoul = {
  userId: string;
  kind: SoulKind;
  /** Markdown body. Empty string when no row exists yet. */
  content: string;
  updatedBy: SoulAuthor;
  /** ISO timestamp of the latest write, or null when no row exists. */
  updatedAt: string | null;
};

type SoulRow = {
  user_id: string;
  kind: SoulKind;
  content: string | null;
  updated_by: SoulAuthor;
  updated_at: string | null;
};

/**
 * Load the athlete's soul for the given kind. Returns an empty-content
 * shell (with default authorship + null updatedAt) when no row exists
 * yet — souls are optional and an athlete on day 1 has neither.
 * Throws on supabase errors so transient DB outages aren't masked as
 * "soul is empty."
 */
export async function loadSoul(
  supabase: SupabaseClient,
  userId: string,
  kind: SoulKind,
): Promise<AthleteSoul> {
  const { data, error } = await supabase
    .from('athlete_souls')
    .select('user_id, kind, content, updated_by, updated_at')
    .eq('user_id', userId)
    .eq('kind', kind)
    .limit(1);

  if (error) {
    throw new Error(`Failed to load athlete soul (${kind}): ${error.message}`);
  }

  const row = (data as SoulRow[] | null)?.[0];
  if (!row) {
    return {
      userId,
      kind,
      content: '',
      updatedBy: 'athlete',
      updatedAt: null,
    };
  }

  return {
    userId: row.user_id,
    kind: row.kind,
    content: row.content ?? '',
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
