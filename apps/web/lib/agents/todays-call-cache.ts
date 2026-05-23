import type { SupabaseClient } from '@supabase/supabase-js';

import type { TodaysCall } from './todays-call';

/**
 * Cache wrappers around daily_summaries.summary.todaysCall.
 *
 * Each /coach page load triggers an LLM compose call (~$0.02-0.05).
 * Caching by (athlete, day) means subsequent loads on the same day
 * return the prior composition. Cache invalidates on:
 *   - Day rollover (key is (user_id, day), so 2026-05-24 is a fresh row)
 *   - persistTrainingCoachRun clearing it (a chat turn just landed,
 *     the conversation context has shifted, recompose with the new info)
 *
 * This module is intentionally side-effect-only (no LLM call) so it
 * can be safely awaited from server components.
 */

type DailySummaryRow = {
  id: string;
  summary: Record<string, unknown> | null;
};

/**
 * Load the cached TodaysCall for the athlete + day. Returns null on
 * cache miss, parse failure, or DB error — caller composes fresh in
 * any of those cases.
 */
export async function loadCachedTodaysCall(
  supabase: SupabaseClient,
  args: { userId: string; today: string },
): Promise<TodaysCall | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', args.userId)
    .eq('day', args.today)
    .limit(1);
  if (error) {
    console.error('[todays-call] cache load failed:', error.message);
    return null;
  }
  const row = (data as Array<{ summary: Record<string, unknown> | null }> | null)?.[0];
  const raw = row?.summary?.todaysCall;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // Minimal shape validation. Be lenient on field presence so an older
  // cached payload with fewer fields still renders.
  if (typeof obj.headline !== 'string' || typeof obj.runSession !== 'string') return null;
  return raw as TodaysCall;
}

/**
 * Persist a fresh TodaysCall into daily_summaries.summary.todaysCall
 * for the athlete + day. Merges with existing summary so other keys
 * (coachConversation, longevityContext, etc.) are preserved.
 */
export async function saveCachedTodaysCall(
  supabase: SupabaseClient,
  args: { userId: string; today: string; call: TodaysCall },
): Promise<void> {
  const { userId, today, call } = args;
  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (loadError) {
    console.error('[todays-call] cache save load failed:', loadError.message);
    return;
  }
  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];
  const mergedSummary: Record<string, unknown> = {
    ...(existing?.summary ?? {}),
    todaysCall: call,
  };

  if (existing) {
    const { error } = await supabase
      .from('daily_summaries')
      .update({ summary: mergedSummary })
      .eq('id', existing.id);
    if (error) {
      console.error('[todays-call] cache save update failed:', error.message);
    }
  } else {
    const { error } = await supabase
      .from('daily_summaries')
      .insert({ user_id: userId, day: today, summary: mergedSummary });
    if (error) {
      console.error('[todays-call] cache save insert failed:', error.message);
    }
  }
}

/**
 * Clear the cached TodaysCall for the athlete + day. Called by the
 * chat-turn persister so the next /coach load recomposes with the
 * new conversation context. Idempotent: missing row is a no-op.
 */
export async function invalidateCachedTodaysCall(
  supabase: SupabaseClient,
  args: { userId: string; today: string },
): Promise<void> {
  const { userId, today } = args;
  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (loadError) {
    console.error('[todays-call] cache invalidate load failed:', loadError.message);
    return;
  }
  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];
  if (!existing || !existing.summary || !('todaysCall' in existing.summary)) {
    return; // nothing to clear
  }
  // Drop the key, keep the rest of the summary intact.
  const { todaysCall: _drop, ...rest } = existing.summary as Record<string, unknown>;
  const { error } = await supabase
    .from('daily_summaries')
    .update({ summary: rest })
    .eq('id', existing.id);
  if (error) {
    console.error('[todays-call] cache invalidate update failed:', error.message);
  }
}
