import type { SupabaseClient } from '@supabase/supabase-js';

import { loadActiveTrainingPlan } from '@/app/plan/coach-data';
import type {
  CoachConversationMessage,
  CoachFollowUp,
} from '@/lib/agents/training-coach';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { WeeklyStructureSession } from '@/lib/training-plan/types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Convert an ISO date (YYYY-MM-DD) to the day-of-week name used to match
 * `weeklyStructure[].day`. Uses UTC to stay consistent with how the rest
 * of the app derives "today" from `new Date().toISOString().slice(0, 10)`.
 */
function dayFromIsoDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return DAY_NAMES[d.getUTCDay()];
}

export type CoachPageState =
  | { kind: 'unauthenticated' }
  | { kind: 'no-plan'; userId: string; email?: string | null }
  | {
      kind: 'ready';
      userId: string;
      email?: string | null;
      planName: string | null;
      goal: string | null;
      raceDate: string | null;
      /** Today's day-of-week (e.g. "Tuesday"), derived from the `today` ISO date. */
      today: string;
      day: string;
      /**
       * The planned session for today, looked up by day-of-week from
       * `training_plans.metadata.weeklyStructure`. Null when the plan has
       * no entry for today's day-of-week (e.g. an off day with no row, or
       * a malformed import). This is the source of truth for the
       * "Today's call" headline — it must NOT come from the LLM
       * conversation, since the chat may be unrelated to today.
       */
      plannedSession: WeeklyStructureSession | null;
      conversation: CoachConversationMessage[];
      followUp: CoachFollowUp | null;
    };

type DailySummaryRow = {
  summary: Record<string, unknown> | null;
};

async function loadDailySummary(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<DailySummaryRow | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (error || !data) return null;
  return (data as DailySummaryRow[])[0] ?? null;
}

async function loadPlanName(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('training_plans')
    .select('name')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data) return null;
  const row = (data as { name: string | null }[])[0];
  return row?.name ?? null;
}

/**
 * Load the server-side state for /coach. Returns a tagged union that the
 * page renderer maps to one of three surfaces:
 *   - 'unauthenticated' → sign-in CTA
 *   - 'no-plan' → upload-a-plan CTA
 *   - 'ready' → CoachChat component with initial state
 *
 * Does NOT invoke the LLM. The "Today's call" headline is sourced from
 * the planned WeeklyStructureSession for today's day-of-week, NOT from
 * `daily_summaries.training_recommendation` — that column tracks the
 * most recent coach reply, which can drift to topics unrelated to today.
 *
 * Conversation + follow-up state are still loaded from `daily_summaries.summary`
 * so the chat history and active follow-up window survive a page reload.
 */
export async function loadCoachPageState(args?: { today?: string }): Promise<CoachPageState> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { kind: 'unauthenticated' };
    }

    const supabase = createServerSupabaseClient();
    const plan = await loadActiveTrainingPlan(supabase, user.id);
    if (!plan) {
      return { kind: 'no-plan', userId: user.id, email: user.email };
    }

    const today = args?.today ?? new Date().toISOString().slice(0, 10);
    const day = dayFromIsoDate(today);
    const plannedSession = plan.weeklyStructure.find((s) => s.day === day) ?? null;

    const summary = await loadDailySummary(supabase, user.id, today);
    const summaryBlob = (summary?.summary ?? {}) as Record<string, unknown>;
    const planName = await loadPlanName(supabase, user.id);

    return {
      kind: 'ready',
      userId: user.id,
      email: user.email,
      planName,
      goal: plan.goal ?? null,
      raceDate: plan.raceDate ?? null,
      today,
      day,
      plannedSession,
      conversation: (summaryBlob.coachConversation as CoachConversationMessage[] | undefined) ?? [],
      followUp: (summaryBlob.coachFollowUp as CoachFollowUp | null | undefined) ?? null,
    };
  } catch (err) {
    // Bad Supabase env / DB error / etc — surface as 'unauthenticated' so
    // the page shows the sign-in CTA instead of crashing the render.
    console.error('loadCoachPageState failed:', err instanceof Error ? err.message : err);
    return { kind: 'unauthenticated' };
  }
}

// Type guard helpers for cleaner page rendering.
export function isReady(state: CoachPageState): state is Extract<CoachPageState, { kind: 'ready' }> {
  return state.kind === 'ready';
}
