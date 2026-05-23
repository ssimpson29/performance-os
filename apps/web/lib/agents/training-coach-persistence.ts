import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrainingCoachOutput } from './training-coach';

type DailySummaryRow = {
  id: string;
  summary: Record<string, unknown> | null;
  training_recommendation: string | null;
};

/**
 * Merge the Training Coach run into `daily_summaries.summary` for the
 * athlete + today, preserving any other keys (e.g. Longevity Guru's
 * `longevityContext` once that workstream lands). Inserts a
 * `health_events` row when this turn detected a new injury signal.
 */
export async function persistTrainingCoachRun(
  supabase: SupabaseClient,
  args: {
    userId: string;
    today: string;
    output: TrainingCoachOutput;
  },
): Promise<{ summaryId: string; healthEventInserted: boolean }> {
  const { userId, today, output } = args;

  // Load existing daily summary for today (if any).
  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary, training_recommendation')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);

  if (loadError) {
    throw new Error(`Failed to load daily_summaries: ${loadError.message}`);
  }

  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];
  const existingSummary = existing?.summary ?? {};

  // Strip todaysCall on every chat turn so the next /coach load
  // recomposes with the new conversation context (injury report,
  // recovery report, "I'm handling more than the plan" report, etc.).
  // Stale composed calls would otherwise outlast the context that
  // produced them.
  const { todaysCall: _staleTodaysCall, ...summaryWithoutTodaysCall } = existingSummary as Record<
    string,
    unknown
  >;

  const mergedSummary: Record<string, unknown> = {
    ...summaryWithoutTodaysCall,
    coachConversation: output.conversation,
    coachRationale: output.rationale,
    coachRecommendations: output.recommendations,
    coachCautions: output.cautions,
    // Preserve null when no window is set (avoid resurrecting stale state).
    coachFollowUp: output.followUp,
  };

  let summaryId: string;
  if (existing) {
    const { error: updateError } = await supabase
      .from('daily_summaries')
      .update({
        summary: mergedSummary,
        training_recommendation: output.message,
      })
      .eq('id', existing.id);
    if (updateError) {
      throw new Error(`Failed to update daily_summaries: ${updateError.message}`);
    }
    summaryId = existing.id;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('daily_summaries')
      .insert({
        user_id: userId,
        day: today,
        summary: mergedSummary,
        training_recommendation: output.message,
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      throw new Error(`Failed to insert daily_summaries: ${insertError?.message ?? 'no row returned'}`);
    }
    summaryId = (inserted as { id: string }).id;
  }

  // Insert a health_events row when this turn flagged a new injury.
  // CLAUDE.md convention: event_type='injury', metadata.source='coach_message'.
  let healthEventInserted = false;
  if (output.injurySignal.detected) {
    const { error: heError } = await supabase.from('health_events').insert({
      user_id: userId,
      event_type: 'injury',
      title: output.injurySignal.bodyPart
        ? `${output.injurySignal.bodyPart} reported in coach message`
        : 'Injury / strain reported in coach message',
      started_at: new Date(`${today}T00:00:00.000Z`).toISOString(),
      metadata: {
        source: 'coach_message',
        bodyPart: output.injurySignal.bodyPart,
        rationale: output.injurySignal.rationale,
      },
    });
    if (heError) {
      throw new Error(`Failed to insert health_events: ${heError.message}`);
    }
    healthEventInserted = true;
  }

  return { summaryId, healthEventInserted };
}

/**
 * Load the existing coach conversation history + follow-up window state
 * for the athlete + today, so the next call to `runTrainingCoach` has
 * the prior context. Returns empty conversation + null followUp when
 * no row exists.
 */
export async function loadTrainingCoachState(
  supabase: SupabaseClient,
  args: { userId: string; today: string },
): Promise<{
  conversation: import('./training-coach').CoachConversationMessage[];
  followUp: import('./training-coach').CoachFollowUp | null;
}> {
  const { userId, today } = args;
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);

  if (error) {
    throw new Error(`Failed to load coach state: ${error.message}`);
  }

  const summary = ((data as { summary: Record<string, unknown> | null }[] | null)?.[0]?.summary ?? {}) as Record<
    string,
    unknown
  >;
  return {
    conversation:
      (summary.coachConversation as import('./training-coach').CoachConversationMessage[] | undefined) ?? [],
    followUp: (summary.coachFollowUp as import('./training-coach').CoachFollowUp | null | undefined) ?? null,
  };
}
