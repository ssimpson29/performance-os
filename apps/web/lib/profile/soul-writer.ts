import type { SupabaseClient } from '@supabase/supabase-js';

import { loadSoul, type AthleteSoul, type SoulAuthor, type SoulKind } from './soul-loader';

/**
 * Update an athlete soul. Three logical steps run sequentially:
 *   1. Read the current content (for the snapshot).
 *   2. Insert the OLD content into athlete_soul_revisions so the
 *      pre-write state is always recoverable.
 *   3. Upsert athlete_souls with the new content + author + now().
 *
 * No JS-side transaction (supabase-js doesn't expose multi-statement
 * tx in the browser path). A failure between steps 2 and 3 leaves an
 * "orphan revision" — harmless audit residue, no data loss.
 *
 * Idempotency: writing the same content as the current row is a
 * no-op — no revision is appended and updated_at is not bumped. Keeps
 * the audit table clean when an LLM rewrite produces identical text.
 */
export async function updateSoul(
  supabase: SupabaseClient,
  args: {
    userId: string;
    kind: SoulKind;
    content: string;
    updatedBy: SoulAuthor;
  },
): Promise<AthleteSoul> {
  const { userId, kind, content, updatedBy } = args;
  const trimmed = content ?? '';

  const current = await loadSoul(supabase, userId, kind);

  // Identical-content writes are no-ops. The current row stays as-is
  // (including the prior updated_at / updated_by), no revision is
  // appended. Avoids audit churn for repeated LLM rewrites.
  if (current.content === trimmed) {
    return current;
  }

  // Snapshot the OLD content into the audit table BEFORE the upsert,
  // so even if the upsert fails the prior state is recoverable. Skip
  // when no row existed yet (current.updatedAt === null) — there's
  // nothing meaningful to snapshot for an athlete's first write.
  if (current.updatedAt !== null) {
    const { error: snapshotError } = await supabase.from('athlete_soul_revisions').insert({
      user_id: userId,
      kind,
      content: current.content,
      updated_by: current.updatedBy,
    });
    if (snapshotError) {
      throw new Error(`Failed to snapshot prior soul: ${snapshotError.message}`);
    }
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from('athlete_souls')
    .upsert(
      {
        user_id: userId,
        kind,
        content: trimmed,
        updated_by: updatedBy,
        updated_at: now,
      },
      { onConflict: 'user_id,kind' },
    );

  if (upsertError) {
    throw new Error(`Failed to update athlete soul: ${upsertError.message}`);
  }

  return {
    userId,
    kind,
    content: trimmed,
    updatedBy,
    updatedAt: now,
  };
}
