import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadActiveTrainingPlan,
  loadAdaptiveCoachContext,
  type ActiveTrainingPlanContext,
} from '@/app/plan/coach-data';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import type {
  AdaptedRecommendation,
  AdaptiveCoachResult,
  PhaseWeekTarget,
  SupportTemplate,
  WeeklyStructureSession,
} from '@/lib/training-plan/types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayFromIsoDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return DAY_NAMES[d.getUTCDay()];
}

/** Match the day's anchor session.strengthMobility text to a support template. */
function matchSupportTemplate(
  anchor: WeeklyStructureSession,
  templates: SupportTemplate[],
): SupportTemplate | null {
  const text = `${anchor.strengthMobility} ${anchor.exactWork} ${anchor.runSession}`.toLowerCase();
  // Specific lift-day matches.
  if (/\blift\s*a\b/.test(text) || /strength day a/i.test(text)) {
    return templates.find((t) => /day a|posterior chain/i.test(t.name)) ?? null;
  }
  if (/\blift\s*b\b/.test(text) || /strength day b/i.test(text) || /mobility/i.test(anchor.strengthMobility)) {
    return templates.find((t) => /mobility|day b/i.test(t.name)) ?? null;
  }
  if (/\blift\s*c\b/.test(text) || /strength day c/i.test(text) || /foot \+ core/i.test(text)) {
    return templates.find((t) => /day c|foot/i.test(t.name)) ?? null;
  }
  // Quality / intervals / tempo → speed warmup.
  if (/quality|interval|tempo|speed|track/i.test(anchor.runSession + ' ' + anchor.exactWork)) {
    return templates.find((t) => /speed warmup/i.test(t.name)) ?? null;
  }
  return null;
}

/** Daily routine template — always relevant regardless of which session today is. */
function findDailyRoutine(templates: SupportTemplate[]): SupportTemplate | null {
  return templates.find((t) => /daily routine/i.test(t.name)) ?? null;
}

type RecoveryRow = {
  day: string;
  readiness_score: number | null;
  sleep_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
};

async function loadTodayRecovery(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<RecoveryRow | null> {
  const { data, error } = await supabase
    .from('recovery_daily')
    .select('day, readiness_score, sleep_score, hrv_ms, resting_hr')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (error) return null;
  return ((data as RecoveryRow[] | null) ?? [])[0] ?? null;
}

export type TodayPageState =
  | { kind: 'unauthenticated' }
  | { kind: 'no-plan'; userId: string; email?: string | null }
  | {
      kind: 'ready';
      userId: string;
      today: string;
      day: string;
      planName: string | null;
      goal: string | null;
      raceDate: string | null;
      anchorSession: WeeklyStructureSession | null;
      adaptedRecommendation: AdaptedRecommendation | null;
      phaseWeekTarget: PhaseWeekTarget | null;
      phaseName: string | null;
      weeksToRace: number | null;
      isTaper: boolean;
      isRaceWeek: boolean;
      strengthTemplate: SupportTemplate | null;
      dailyRoutine: SupportTemplate | null;
      recovery: {
        readinessScore: number | null;
        sleepScore: number | null;
        hrvMs: number | null;
        restingHr: number | null;
      } | null;
      adaptive: AdaptiveCoachResult;
      coachMessage: string | null;
      activeFollowUp: {
        easyThroughDate: string;
        checkInDate: string;
        bodyPart?: string;
      } | null;
    };

type DailySummaryRow = {
  training_recommendation: string | null;
  summary: Record<string, unknown> | null;
};

async function loadCoachState(supabase: SupabaseClient, userId: string, today: string) {
  const { data } = await supabase
    .from('daily_summaries')
    .select('training_recommendation, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  return ((data as DailySummaryRow[] | null) ?? [])[0] ?? null;
}

export async function loadTodayPageState(args?: { today?: string }): Promise<TodayPageState> {
  const user = await getAuthenticatedUser();
  if (!user) return { kind: 'unauthenticated' };

  const supabase = createServerSupabaseClient();
  const today = args?.today ?? new Date().toISOString().slice(0, 10);
  const plan: ActiveTrainingPlanContext | null = await loadActiveTrainingPlan(supabase, user.id);
  if (!plan) return { kind: 'no-plan', userId: user.id, email: user.email };

  const day = dayFromIsoDate(today);
  const anchorSession = plan.weeklyStructure.find((s) => s.day === day) ?? null;

  // Run the race-aware engine to get phase position + today's recommendation + recovery trend.
  const coachInput = await loadAdaptiveCoachContext(supabase, user.id, { today });
  const adaptive = adaptWeeklyStructure(coachInput);

  const adaptedRecommendation =
    adaptive.recommendations.find((r) => r.day === day) ?? null;

  let phaseWeekTarget: PhaseWeekTarget | null = null;
  if (adaptive.phasePosition && adaptive.phasePosition.phaseIndex >= 0) {
    phaseWeekTarget =
      plan.phaseBlocks[adaptive.phasePosition.phaseIndex]?.weeks[adaptive.phasePosition.weekIndexInPhase] ??
      null;
  }

  const strengthTemplate = anchorSession ? matchSupportTemplate(anchorSession, plan.supportTemplates) : null;
  const dailyRoutine = findDailyRoutine(plan.supportTemplates);

  const recoveryRow = await loadTodayRecovery(supabase, user.id, today);
  const recovery = recoveryRow
    ? {
        readinessScore: recoveryRow.readiness_score,
        sleepScore: recoveryRow.sleep_score,
        hrvMs: recoveryRow.hrv_ms,
        restingHr: recoveryRow.resting_hr,
      }
    : null;

  const dailySummary = await loadCoachState(supabase, user.id, today);
  const coachMessage = dailySummary?.training_recommendation ?? null;
  const followUpRaw = (dailySummary?.summary?.['coachFollowUp'] ?? null) as
    | { easyThroughDate?: string; checkInDate?: string; status?: string; bodyPart?: string }
    | null;
  const activeFollowUp =
    followUpRaw?.status === 'active' && followUpRaw.easyThroughDate && followUpRaw.checkInDate
      ? {
          easyThroughDate: followUpRaw.easyThroughDate,
          checkInDate: followUpRaw.checkInDate,
          bodyPart: followUpRaw.bodyPart,
        }
      : null;

  return {
    kind: 'ready',
    userId: user.id,
    today,
    day,
    planName: null,
    goal: plan.goal,
    raceDate: plan.raceDate,
    anchorSession,
    adaptedRecommendation,
    phaseWeekTarget,
    phaseName: adaptive.phasePosition?.phaseName ?? null,
    weeksToRace: adaptive.phasePosition?.weeksToRace ?? null,
    isTaper: Boolean(adaptive.phasePosition?.isTaper),
    isRaceWeek: Boolean(adaptive.phasePosition?.isRaceWeek),
    strengthTemplate,
    dailyRoutine,
    recovery,
    adaptive,
    coachMessage,
    activeFollowUp,
  };
}
