import type { SupabaseClient } from '@supabase/supabase-js';

import { loadActiveTrainingPlan } from '@/app/plan/coach-data';
import type {
  CoachConversationMessage,
  CoachFollowUp,
} from '@/lib/agents/training-coach';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

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
      latestMessage: string | null;
      recommendations: string[];
      cautions: string[];
      rationale: string | null;
      conversation: CoachConversationMessage[];
      followUp: CoachFollowUp | null;
    };

type DailySummaryRow = {
  summary: Record<string, unknown> | null;
  training_recommendation: string | null;
};

type TrainingPlanRow = {
  metadata: Record<string, unknown> | null;
};

async function loadDailySummary(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<DailySummaryRow | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary, training_recommendation')
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
 * Does NOT invoke the LLM; only reads existing daily_summaries.summary.
 * The CoachChat client component drives /api/coach/message on user input.
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
      latestMessage: summary?.training_recommendation ?? null,
      recommendations: (summaryBlob.coachRecommendations as string[] | undefined) ?? [],
      cautions: (summaryBlob.coachCautions as string[] | undefined) ?? [],
      rationale: (summaryBlob.coachRationale as string | undefined) ?? null,
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

