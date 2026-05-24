import { NextResponse } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * DELETE /api/coach/conversation
 *
 * "Start fresh" — clears the in-progress Training Coach conversation for
 * the athlete's *today* without touching durable memory. Resets the
 * 20-message window so a new chat doesn't inherit yesterday's tone or a
 * dropped thread that's no longer relevant.
 *
 * Auth-scoped per CLAUDE.md convention. Body is ignored — there is no
 * "delete somebody else's conversation" semantic.
 *
 * What gets cleared (today's `daily_summaries` row for this athlete):
 *   - `summary.coachConversation` — message history
 *   - `summary.coachFollowUp` — easy-through / check-in window
 *   - `summary.coachRationale` — flattened evidence string
 *   - `summary.coachRecommendations`
 *   - `summary.coachCautions`
 *   - `summary.todaysCall` — cached LLM-composed Today's Call (forces
 *     fresh compose on next /coach load against the cleared state)
 *   - `training_recommendation` — top-line current coach answer
 *
 * What survives (intentionally):
 *   - `summary.longevityContext`, `summary.longevityConversation`,
 *     `summary.longevityNarrative`, `summary.longevityPriorities`,
 *     `summary.longevityWatching`, `summary.longevityCautions` —
 *     Longevity Guru's state belongs to a different agent
 *   - `athlete_souls` table — durable memory written by either agent or
 *     the athlete; the whole point is to outlast the chat window
 *   - `health_events` — any injury rows inserted during prior turns are
 *     historical and stay on the record
 *
 * No-op cases (all return 200):
 *   - No daily_summaries row for today
 *   - Row exists but `summary` is null
 *   - Row exists but none of the cleared keys are present
 *
 * Failure modes:
 *   - 401 when not signed in
 *   - 500 when the load or update DB query errors
 */
export async function DELETE() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);

  if (loadError) {
    console.error('[coach/conversation DELETE] load failed:', loadError.message);
    return NextResponse.json(
      { error: `Failed to load daily_summaries: ${loadError.message}` },
      { status: 500 },
    );
  }

  type DailySummaryRow = { id: string; summary: Record<string, unknown> | null };
  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];

  // No row → nothing to clear. Idempotent success.
  if (!existing) {
    return NextResponse.json({ cleared: false, reason: 'no daily summary for today' });
  }

  const existingSummary = (existing.summary ?? {}) as Record<string, unknown>;
  const COACH_KEYS = [
    'coachConversation',
    'coachFollowUp',
    'coachRationale',
    'coachRecommendations',
    'coachCautions',
    'todaysCall',
  ];

  // Drop each coach key while preserving everything else (longevity state,
  // any future keys we don't know about). Object spread + delete pattern
  // keeps this safe under concurrent reads of other keys.
  const cleanedSummary: Record<string, unknown> = { ...existingSummary };
  let touchedAnyKey = false;
  for (const key of COACH_KEYS) {
    if (key in cleanedSummary) {
      delete cleanedSummary[key];
      touchedAnyKey = true;
    }
  }

  // Even when no summary keys were present, training_recommendation may
  // still hold the top-line answer — clear it too so /coach doesn't show
  // a ghost recommendation after "Start fresh".
  const { error: updateError } = await supabase
    .from('daily_summaries')
    .update({
      summary: cleanedSummary,
      training_recommendation: null,
    })
    .eq('id', existing.id);

  if (updateError) {
    console.error('[coach/conversation DELETE] update failed:', updateError.message);
    return NextResponse.json(
      { error: `Failed to clear conversation: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ cleared: true, touchedAnyKey });
}
