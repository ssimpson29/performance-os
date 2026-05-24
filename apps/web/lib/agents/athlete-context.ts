import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadActiveTrainingPlan,
  loadCompletedWorkouts,
  loadLongevityContextForAthlete,
  loadRecoveryHistory,
  type ActiveTrainingPlanContext,
} from '@/app/plan/coach-data';
import { loadAthleteProfile, type AthleteProfile } from '@/lib/profile/profile-loader';
import { loadSoul, type AthleteSoul } from '@/lib/profile/soul-loader';
import type { CoachingPosture } from '@/lib/training-plan/posture';
import type {
  AdaptiveCoachInput,
  CompletedWorkout,
  RecoverySample,
} from '@/lib/training-plan/types';

/**
 * Rich athlete context for the Training Coach agent. Unlike the older
 * `loadAdaptiveCoachContext`, this loader does NOT throw when the athlete
 * has no plan — instead it returns `currentPlan: null` and lets the coach
 * have a plan-building conversation.
 *
 * The shape is intentionally broader than what the deterministic engine
 * needs, because the LLM agent can call tools that surface any of these
 * slices to the model when relevant.
 */

export type InjuryEvent = {
  id: string;
  eventType: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  severity: string | null;
  notes: string | null;
  bodyPart?: string;
  source?: string;
};

export type BiomarkerSummary = {
  /** Most recent panel for this athlete, or null if none. */
  panelDate: string | null;
  provider: string | null;
  panelName: string | null;
  results: Array<{
    biomarkerKey: string;
    displayName: string;
    domain: string;
    value: number | string | null;
    unit: string | null;
    referenceLow: number | null;
    referenceHigh: number | null;
    optimalLow: number | null;
    optimalHigh: number | null;
    status: string | null;
    measuredAt: string;
  }>;
};

export type LongevityContextSummary = {
  recoveryPriority: 'low' | 'normal' | 'elevated';
  notes?: string;
  evaluatedAt?: string;
};

export type CoachConversationMessageStored = {
  role: 'athlete' | 'coach';
  text: string;
  at?: string;
};

/**
 * Longevity Guru chat message — mirrors CoachConversationMessageStored
 * but with 'guru' as the AI-side role for clarity in mixed UIs.
 */
export type LongevityConversationMessageStored = {
  role: 'athlete' | 'guru';
  text: string;
  at?: string;
};

export type CoachFollowUpStored = {
  easyThroughDate: string;
  checkInDate: string;
  status: 'active' | 'closed';
  bodyPart?: string;
};

export type AthleteContext = {
  userId: string;
  today: string;
  /**
   * Athlete profile (height, weight, DOB, sex, goal, experience,
   * health notes, onboarding completion). Always present — when the
   * athlete hasn't completed onboarding, fields are null but the shell
   * is still returned so the coach's no-profile branch reads cleanly.
   */
  profile: AthleteProfile;
  /** Active training plan + metadata, or null when the athlete hasn't built one yet. */
  currentPlan: ActiveTrainingPlanContext | null;
  /** Recent completed workouts. Default lookback: 14 days. */
  recentWorkouts: CompletedWorkout[];
  /** Recovery samples (e.g. Oura readiness) over the same lookback. */
  recoveryHistory: RecoverySample[];
  /** Injury / strain events from health_events. Default lookback: 90 days. */
  injuryHistory: InjuryEvent[];
  /** Most recent biomarker panel, with the individual marker results. */
  biomarkers: BiomarkerSummary | null;
  /** Longevity Guru's recoveryPriority signal, if any. */
  longevityContext: LongevityContextSummary | null;
  /** Last 20 coach <-> athlete messages, oldest first. */
  conversation: CoachConversationMessageStored[];
  /** Active follow-up window from a prior injury report, if any. */
  followUp: CoachFollowUpStored | null;
  /**
   * Last 20 Longevity Guru <-> athlete messages, oldest first. Loaded
   * from `daily_summaries.summary.longevityConversation` (most recent
   * row, same pattern as `conversation` above). Both agents see both
   * conversations — useful when a longevity question intersects with
   * something the athlete recently told the coach (e.g. injury).
   */
  longevityConversation: LongevityConversationMessageStored[];
  /**
   * Durable "soul" memory documents. Read by both LLM agents' system
   * prompts every turn so durable facts about the athlete (preferences,
   * doctor / influencer trust, recurring patterns, hard constraints)
   * outlast any single conversation. Empty-content shells when no row
   * exists yet; never null.
   */
  trainingSoul: AthleteSoul;
  longevitySoul: AthleteSoul;
};

const DEFAULT_WORKOUT_LOOKBACK_DAYS = 14;
const DEFAULT_INJURY_LOOKBACK_DAYS = 90;

function isoDateAddDays(isoDate: string, deltaDays: number): string {
  const parts = isoDate.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function loadInjuryHistory(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  lookbackDays: number,
): Promise<InjuryEvent[]> {
  const since = isoDateAddDays(today, -lookbackDays);
  const { data, error } = await supabase
    .from('health_events')
    .select('id, event_type, title, started_at, ended_at, severity, notes, metadata')
    .eq('user_id', userId)
    .gte('started_at', `${since}T00:00:00.000Z`)
    .order('started_at', { ascending: false });

  if (error) {
    // Non-fatal — the coach can still operate without injury history. Log
    // and return empty so a transient DB error doesn't break the daily call.
    console.error('athlete-context: failed to load injury history:', error);
    return [];
  }

  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const metadata = (r.metadata as Record<string, unknown>) ?? {};
    return {
      id: String(r.id),
      eventType: String(r.event_type),
      title: String(r.title ?? ''),
      startedAt: String(r.started_at),
      endedAt: r.ended_at ? String(r.ended_at) : null,
      severity: r.severity ? String(r.severity) : null,
      notes: r.notes ? String(r.notes) : null,
      bodyPart: typeof metadata.bodyPart === 'string' ? metadata.bodyPart : undefined,
      source: typeof metadata.source === 'string' ? metadata.source : undefined,
    };
  });
}

async function loadLatestBiomarkers(
  supabase: SupabaseClient,
  userId: string,
): Promise<BiomarkerSummary | null> {
  // Get the most recent lab_panels row for this athlete.
  const { data: panels, error: panelErr } = await supabase
    .from('lab_panels')
    .select('id, panel_date, provider, panel_name')
    .eq('user_id', userId)
    .order('panel_date', { ascending: false })
    .limit(1);

  if (panelErr) {
    console.error('athlete-context: failed to load lab_panels:', panelErr);
    return null;
  }
  const panel = (panels ?? [])[0] as Record<string, unknown> | undefined;
  if (!panel) return null;

  // Fetch the results for that panel.
  const { data: rows, error: rowsErr } = await supabase
    .from('biomarker_results')
    .select(
      'biomarker_key, display_name, domain, value_numeric, value_text, unit, reference_low, reference_high, optimal_low, optimal_high, status, measured_at',
    )
    .eq('lab_panel_id', String(panel.id))
    .order('display_name', { ascending: true });

  if (rowsErr) {
    console.error('athlete-context: failed to load biomarker_results:', rowsErr);
    return {
      panelDate: panel.panel_date ? String(panel.panel_date) : null,
      provider: panel.provider ? String(panel.provider) : null,
      panelName: panel.panel_name ? String(panel.panel_name) : null,
      results: [],
    };
  }

  const results = (rows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const numeric = typeof r.value_numeric === 'number' ? r.value_numeric : null;
    const text = typeof r.value_text === 'string' ? r.value_text : null;
    return {
      biomarkerKey: String(r.biomarker_key),
      displayName: String(r.display_name),
      domain: String(r.domain ?? 'other'),
      value: (numeric ?? text) as number | string | null,
      unit: r.unit ? String(r.unit) : null,
      referenceLow: typeof r.reference_low === 'number' ? r.reference_low : null,
      referenceHigh: typeof r.reference_high === 'number' ? r.reference_high : null,
      optimalLow: typeof r.optimal_low === 'number' ? r.optimal_low : null,
      optimalHigh: typeof r.optimal_high === 'number' ? r.optimal_high : null,
      status: r.status ? String(r.status) : null,
      measuredAt: String(r.measured_at ?? panel.panel_date ?? ''),
    };
  });

  return {
    panelDate: panel.panel_date ? String(panel.panel_date) : null,
    provider: panel.provider ? String(panel.provider) : null,
    panelName: panel.panel_name ? String(panel.panel_name) : null,
    results,
  };
}

async function loadCoachConversation(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<{
  conversation: CoachConversationMessageStored[];
  followUp: CoachFollowUpStored | null;
  longevityConversation: LongevityConversationMessageStored[];
}> {
  // The coach state lives on daily_summaries.summary for the most recent
  // entry (often today's, but it can be a prior day if today's summary
  // hasn't been written yet).
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary, day')
    .eq('user_id', userId)
    .lte('day', today)
    .order('day', { ascending: false })
    .limit(1);

  if (error) {
    console.error('athlete-context: failed to load coach conversation:', error);
    return { conversation: [], followUp: null, longevityConversation: [] };
  }
  const row = (data ?? [])[0] as { summary?: Record<string, unknown> } | undefined;
  const summary = row?.summary ?? {};

  const rawConv = summary.coachConversation;
  const conversation: CoachConversationMessageStored[] = Array.isArray(rawConv)
    ? (rawConv as Array<Record<string, unknown>>)
        .map((m): CoachConversationMessageStored => ({
          role: m.role === 'coach' ? 'coach' : 'athlete',
          text: typeof m.text === 'string' ? m.text : '',
          at: typeof m.at === 'string' ? m.at : undefined,
        }))
        .filter((m) => m.text.length > 0)
    : [];

  // Same shape, different summary key: longevityConversation lives next
  // to coachConversation on the same row. Each agent reads its own list
  // when composing its prompt, and either can see the other's via the
  // AthleteContext for cross-coach awareness.
  const rawLongevityConv = summary.longevityConversation;
  const longevityConversation: LongevityConversationMessageStored[] = Array.isArray(rawLongevityConv)
    ? (rawLongevityConv as Array<Record<string, unknown>>)
        .map((m): LongevityConversationMessageStored => ({
          role: m.role === 'guru' ? 'guru' : 'athlete',
          text: typeof m.text === 'string' ? m.text : '',
          at: typeof m.at === 'string' ? m.at : undefined,
        }))
        .filter((m) => m.text.length > 0)
    : [];

  const rawFollowUp = summary.coachFollowUp as Record<string, unknown> | undefined;
  const followUp: CoachFollowUpStored | null =
    rawFollowUp && typeof rawFollowUp === 'object'
      ? {
          easyThroughDate: String(rawFollowUp.easyThroughDate ?? ''),
          checkInDate: String(rawFollowUp.checkInDate ?? ''),
          status: rawFollowUp.status === 'closed' ? 'closed' : 'active',
          bodyPart: typeof rawFollowUp.bodyPart === 'string' ? rawFollowUp.bodyPart : undefined,
        }
      : null;

  return { conversation, followUp, longevityConversation };
}

export type LoadAthleteContextOptions = {
  today?: string;
  workoutLookbackDays?: number;
  injuryLookbackDays?: number;
};

/**
 * Assemble the full athlete context for the Training Coach agent.
 *
 * Critical contract: this function does NOT throw when the athlete has no
 * plan. `currentPlan` returns null in that case and the agent flow handles
 * the no-plan branch (offer to build one conversationally).
 */
export async function loadAthleteContext(
  supabase: SupabaseClient,
  userId: string,
  options: LoadAthleteContextOptions = {},
): Promise<AthleteContext> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const workoutLookback = options.workoutLookbackDays ?? DEFAULT_WORKOUT_LOOKBACK_DAYS;
  const injuryLookback = options.injuryLookbackDays ?? DEFAULT_INJURY_LOOKBACK_DAYS;

  // Soul loads can fail when migration 010 (athlete_souls) hasn't been
  // applied to an environment — relation-does-not-exist throws from
  // loadSoul. Wrap them so the missing table degrades to empty souls
  // and the coach still works. Everything else throws normally.
  async function safeLoadSoul(kind: 'training' | 'longevity'): Promise<AthleteSoul> {
    try {
      return await loadSoul(supabase, userId, kind);
    } catch (err) {
      console.error(`[athlete-context] ${kind} soul load failed:`, err);
      return {
        userId,
        kind,
        content: '',
        updatedBy: 'athlete',
        updatedAt: null,
      };
    }
  }

  // Run the independent loads in parallel.
  const [
    profile,
    currentPlan,
    recentWorkouts,
    recoveryHistory,
    injuryHistory,
    biomarkers,
    longevityRaw,
    conversationState,
    trainingSoul,
    longevitySoul,
  ] = await Promise.all([
    loadAthleteProfile(supabase, userId),
    loadActiveTrainingPlan(supabase, userId),
    loadCompletedWorkouts(supabase, userId, { today, lookbackDays: workoutLookback }),
    loadRecoveryHistory(supabase, userId, { today, lookbackDays: workoutLookback }),
    loadInjuryHistory(supabase, userId, today, injuryLookback),
    loadLatestBiomarkers(supabase, userId),
    loadLongevityContextForAthlete(supabase, userId, today),
    loadCoachConversation(supabase, userId, today),
    safeLoadSoul('training'),
    safeLoadSoul('longevity'),
  ]);

  const longevityContext: LongevityContextSummary | null = longevityRaw
    ? {
        recoveryPriority: longevityRaw.recoveryPriority,
        notes: longevityRaw.notes,
        evaluatedAt: longevityRaw.evaluatedAt,
      }
    : null;

  return {
    userId,
    today,
    profile,
    currentPlan,
    recentWorkouts,
    recoveryHistory,
    injuryHistory,
    biomarkers,
    longevityContext,
    conversation: conversationState.conversation,
    followUp: conversationState.followUp,
    longevityConversation: conversationState.longevityConversation,
    trainingSoul,
    longevitySoul,
  };
}

/**
 * Convenience: derive an AdaptiveCoachInput from a loaded AthleteContext.
 * Used by the runAdaptiveEngine tool so the agent can invoke the
 * deterministic engine when (and only when) a plan exists.
 *
 * Returns null when there's no plan to engage the engine against.
 */
export function toAdaptiveCoachInput(ctx: AthleteContext): AdaptiveCoachInput | null {
  if (!ctx.currentPlan) return null;
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const parts = ctx.today.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const dayOfWeek = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  const currentDay = DAY_NAMES[dayOfWeek];

  // Coaching posture override: surfaced by loadActiveTrainingPlan when
  // training_plans.metadata.coachingPosture is set. Undefined → the engine
  // infers from goal + raceContext text via inferCoachingPosture.
  const explicitPosture: CoachingPosture | undefined = ctx.currentPlan.coachingPosture;

  return {
    weeklyStructure: ctx.currentPlan.weeklyStructure,
    completedWorkouts: ctx.recentWorkouts,
    currentDay,
    recoveryScore: ctx.recoveryHistory.length
      ? ctx.recoveryHistory[ctx.recoveryHistory.length - 1].score
      : undefined,
    today: ctx.today,
    raceDate: ctx.currentPlan.raceDate ?? undefined,
    planStartDate: ctx.currentPlan.planStartDate ?? undefined,
    phaseBlocks: ctx.currentPlan.phaseBlocks,
    recoveryHistory: ctx.recoveryHistory,
    goal: ctx.currentPlan.goal ?? undefined,
    raceContext: ctx.currentPlan.raceContext,
    longevityContext: ctx.longevityContext ?? undefined,
    coachingPosture: explicitPosture,
  };
}

