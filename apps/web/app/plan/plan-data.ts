import { loadCachedTodaysCall } from '@/lib/agents/todays-call-cache';
import type { TodaysCall } from '@/lib/agents/todays-call';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import type {
  AdaptiveCoachResult,
  PhaseBlock,
  SupportTemplate,
  WeeklyStructureSession,
} from '@/lib/training-plan/types';

import { loadAdaptiveCoachContext, loadActiveTrainingPlan } from './coach-data';

/**
 * Discriminated union returned by `loadPlanView`. The `/plan` page renders
 * one of three branches:
 *
 * - `unauthenticated` — no auth session OR loader threw (logged + caught
 *   in `loadPlanView`). Page shows the sign-in CTA.
 * - `no-plan` — signed in but no `training_plans` row exists. Page shows
 *   the import CTA.
 * - `ready` — full plan state including the cached Today's Call (when
 *   present). The "This week — today" row in the page reads
 *   `todaysCall` first and falls back to the plan template on cache
 *   miss, so /plan and /coach never disagree about today's session.
 */
export type PlanView =
  | { kind: 'unauthenticated' }
  | { kind: 'no-plan' }
  | {
      kind: 'ready';
      planName: string;
      goal: string | null;
      raceDate: string | null;
      planStartDate: string | null;
      weeklyStructure: WeeklyStructureSession[];
      phaseBlocks: PhaseBlock[];
      supportTemplates: SupportTemplate[];
      adaptive: AdaptiveCoachResult;
      /**
       * Cached LLM-composed Today's Call for today, if /coach has been
       * loaded since the last invalidation. Null = cache miss (athlete
       * hasn't visited /coach today yet, or a chat turn just invalidated
       * it). Page falls back to plan template when null.
       */
      todaysCall: TodaysCall | null;
    };

type TrainingPlanRow = {
  name: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Page-level loader for `/plan`. Catches loader exceptions and surfaces
 * them as `unauthenticated` so a transient DB error doesn't crash the
 * page; the user can re-sign-in to recover. Extracted from `page.tsx`
 * (was inline) so it can be unit-tested without importing the TSX page
 * component (Vitest 4 + Next.js TSX import friction — see CLAUDE.md
 * pitfall #2).
 */
export async function loadPlanView(): Promise<PlanView> {
  try {
    return await loadPlanViewUnsafe();
  } catch (err) {
    console.error('loadPlanView failed:', err instanceof Error ? err.message : err);
    return { kind: 'unauthenticated' };
  }
}

async function loadPlanViewUnsafe(): Promise<PlanView> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: 'unauthenticated' };

  const supabase = createServerSupabaseClient();
  const plan = await loadActiveTrainingPlan(supabase, user.id);
  if (!plan) return { kind: 'no-plan' };

  // Pull plan name + supportTemplates directly (the data loader doesn't carry them).
  const { data: rows } = await supabase
    .from('training_plans')
    .select('name, metadata')
    .eq('id', plan.planId)
    .limit(1);
  const planRow = ((rows as TrainingPlanRow[] | null) ?? [])[0];
  const supportTemplates =
    (planRow?.metadata?.supportTemplates as SupportTemplate[] | undefined) ?? [];
  const planName = planRow?.name ?? 'Imported plan';

  // Run the race-aware engine against today's athlete state.
  const today = new Date().toISOString().slice(0, 10);
  const coachInput = await loadAdaptiveCoachContext(supabase, user.id, { today });
  const adaptive = adaptWeeklyStructure(coachInput);

  // Side-effect-only read of the cached Today's Call. Lets /plan's
  // "This week — today" row show whatever /coach composed for today
  // instead of just the static weekly-structure template, so the two
  // surfaces agree. No composition happens here — /coach owns that path
  // (we'd otherwise double the LLM cost on every /plan load). Cache miss
  // is normal: athlete hasn't visited /coach today yet, or a chat turn
  // just invalidated it. Today row falls back to the plan template in
  // that case (same as before).
  const todaysCall = await loadCachedTodaysCall(supabase, {
    userId: user.id,
    today,
  });

  return {
    kind: 'ready',
    planName,
    goal: plan.goal,
    raceDate: plan.raceDate,
    planStartDate: plan.planStartDate,
    weeklyStructure: plan.weeklyStructure,
    phaseBlocks: plan.phaseBlocks,
    supportTemplates,
    adaptive,
    todaysCall,
  };
}
