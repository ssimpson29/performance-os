import type { SupabaseClient } from '@supabase/supabase-js';

import type { LongevityContext, LongevityGuruOutput } from '@/lib/agents/longevity-guru';

type DailySummaryRow = {
  id: string;
  summary: Record<string, unknown> | null;
  longevity_priority: string | null;
};

/**
 * Merge a Longevity Guru run into `daily_summaries.summary.longevityContext`
 * for the athlete + today. Preserves all other keys in the summary blob
 * (Training Coach state, etc.) so the two agents can coexist.
 *
 * Also updates the top-level `longevity_priority` text column with a
 * one-line summary of the highest-severity lever, for cheap queries that
 * don't need to crack open the jsonb.
 */
export async function persistLongevityRun(
  supabase: SupabaseClient,
  args: { userId: string; today: string; output: LongevityGuruOutput },
): Promise<{ summaryId: string }> {
  const { userId, today, output } = args;

  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary, longevity_priority')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);

  if (loadError) {
    throw new Error(`Failed to load daily_summaries: ${loadError.message}`);
  }

  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];
  const existingSummary = existing?.summary ?? {};

  const mergedSummary: Record<string, unknown> = {
    ...existingSummary,
    longevityContext: output.longevityContext,
    longevityPriorities: output.priorities,
    longevityWatching: output.watching,
    longevityNarrative: output.narrative,
    longevityCautions: output.cautions,
  };

  const longevityPriorityText =
    output.priorities[0]
      ? `${output.priorities[0].leverKey}: ${output.priorities[0].recommendation}`
      : null;

  let summaryId: string;
  if (existing) {
    const { error: updateError } = await supabase
      .from('daily_summaries')
      .update({
        summary: mergedSummary,
        longevity_priority: longevityPriorityText,
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
        longevity_priority: longevityPriorityText,
      })
      .select('id')
      .single();
    if (insertError || !inserted) {
      throw new Error(`Failed to insert daily_summaries: ${insertError?.message ?? 'no row returned'}`);
    }
    summaryId = (inserted as { id: string }).id;
  }

  return { summaryId };
}

/**
 * Read just the cross-write longevityContext signal for a given athlete + day.
 * Used by the Training Coach (future iteration) to factor longevity priority
 * into its daily adaptation. Returns null when no context has been written.
 */
export async function loadLongevityContext(
  supabase: SupabaseClient,
  args: { userId: string; today: string },
): Promise<LongevityContext | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', args.userId)
    .eq('day', args.today)
    .limit(1);
  if (error) {
    throw new Error(`Failed to load longevityContext: ${error.message}`);
  }
  const summary = ((data as { summary: Record<string, unknown> | null }[] | null)?.[0]?.summary ?? {}) as Record<string, unknown>;
  return (summary.longevityContext as LongevityContext | undefined) ?? null;
}
