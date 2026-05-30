import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProposeRacePlanResult } from './plan-generator';

/**
 * Durable storage for a coach-proposed training plan, on
 * `daily_summaries.summary.planProposal`.
 *
 * Why this exists: `proposeRacePlan` drafts a plan for athlete review and
 * `commitTrainingPlan` persists it after approval. Approval almost always
 * arrives in the NEXT chat message — a new `/api/coach/message` request — but
 * the in-memory `proposalStore` is created fresh per request, so the draft is
 * lost between turns and commit fails with "no proposal found." Persisting the
 * draft keyed by athlete makes "propose now, approve later" durable, and it
 * survives a page reload.
 *
 * One active proposal per athlete: a fresh `proposeRacePlan` overwrites the
 * prior draft (so the stored proposal is always the most-recently-presented
 * one), and it's cleared on successful commit.
 *
 * Mirrors the merge-preserving pattern in todays-call-cache.ts so other
 * summary keys (coachConversation, todaysCall, longevityContext, ...) are
 * never clobbered.
 */

export type StoredPlanProposal = {
  proposalId: string;
  proposal: ProposeRacePlanResult;
  proposedAt: string; // ISO timestamp
};

type DailySummaryRow = {
  id: string;
  day: string;
  summary: Record<string, unknown> | null;
};

// How many recent daily_summaries rows to scan when loading. Approval is
// nearly always same-day, but scanning a few rows tolerates a turn that
// crosses midnight without an extra index/query.
const LOOKBACK_ROWS = 7;

/**
 * Persist a proposal into `daily_summaries.summary.planProposal` for the
 * athlete + day, merging with any existing summary. Best-effort: logs and
 * returns on DB error rather than throwing into the tool loop.
 */
export async function savePlanProposal(
  supabase: SupabaseClient,
  args: {
    userId: string;
    today: string;
    proposalId: string;
    proposal: ProposeRacePlanResult;
    now?: Date;
  },
): Promise<void> {
  const { userId, today, proposalId, proposal } = args;
  const stored: StoredPlanProposal = {
    proposalId,
    proposal,
    proposedAt: (args.now ?? new Date()).toISOString(),
  };

  const { data, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (loadError) {
    console.error('[plan-proposal] save load failed:', loadError.message);
    return;
  }

  const existing = (data as Array<{ id: string; summary: Record<string, unknown> | null }> | null)?.[0];
  const mergedSummary: Record<string, unknown> = {
    ...(existing?.summary ?? {}),
    planProposal: stored,
  };

  if (existing) {
    const { error } = await supabase
      .from('daily_summaries')
      .update({ summary: mergedSummary })
      .eq('id', existing.id);
    if (error) console.error('[plan-proposal] save update failed:', error.message);
  } else {
    const { error } = await supabase
      .from('daily_summaries')
      .insert({ user_id: userId, day: today, summary: mergedSummary });
    if (error) console.error('[plan-proposal] save insert failed:', error.message);
  }
}

/**
 * Load the athlete's active proposal. Scans the most recent daily_summaries
 * rows and returns the newest one carrying a `planProposal` (with the `day`
 * it lives on, so the caller can clear that exact row). Null on miss / error.
 */
export async function loadPlanProposal(
  supabase: SupabaseClient,
  args: { userId: string },
): Promise<(StoredPlanProposal & { day: string }) | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('id, day, summary')
    .eq('user_id', args.userId)
    .order('day', { ascending: false })
    .limit(LOOKBACK_ROWS);
  if (error) {
    console.error('[plan-proposal] load failed:', error.message);
    return null;
  }

  for (const row of (data as DailySummaryRow[] | null) ?? []) {
    const raw = row.summary?.planProposal;
    if (raw && typeof raw === 'object') {
      const stored = raw as Partial<StoredPlanProposal>;
      if (stored.proposalId && stored.proposal) {
        return {
          proposalId: stored.proposalId,
          proposal: stored.proposal as ProposeRacePlanResult,
          proposedAt: stored.proposedAt ?? '',
          day: row.day,
        };
      }
    }
  }
  return null;
}

/**
 * Drop the stored proposal (after a successful commit). Idempotent: missing
 * row / key is a no-op. When `day` is omitted it locates the row holding the
 * proposal first.
 */
export async function clearPlanProposal(
  supabase: SupabaseClient,
  args: { userId: string; day?: string },
): Promise<void> {
  let targetDay = args.day;
  if (!targetDay) {
    const found = await loadPlanProposal(supabase, { userId: args.userId });
    if (!found) return;
    targetDay = found.day;
  }

  const { data, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', args.userId)
    .eq('day', targetDay)
    .limit(1);
  if (loadError) {
    console.error('[plan-proposal] clear load failed:', loadError.message);
    return;
  }

  const existing = (data as Array<{ id: string; summary: Record<string, unknown> | null }> | null)?.[0];
  if (!existing || !existing.summary || !('planProposal' in existing.summary)) {
    return; // nothing to clear
  }

  const { planProposal: _drop, ...rest } = existing.summary as Record<string, unknown>;
  const { error } = await supabase.from('daily_summaries').update({ summary: rest }).eq('id', existing.id);
  if (error) console.error('[plan-proposal] clear update failed:', error.message);
}
