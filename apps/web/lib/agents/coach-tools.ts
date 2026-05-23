import type { SupabaseClient } from '@supabase/supabase-js';

import {
  upsertAthleteProfile,
  type AthleteProfilePatch,
} from '@/lib/profile/profile-writer';
import { updateSoul } from '@/lib/profile/soul-writer';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';

import { toAdaptiveCoachInput, type AthleteContext } from './athlete-context';
import {
  commitProposedPlan,
  proposeRacePlan,
  type ProposeRacePlanInput,
  type ProposeRacePlanResult,
} from './plan-generator';

/**
 * Tool registry for the Training Coach LLM agent.
 *
 * Each tool has:
 *   - an OpenAI-compatible JSON schema for declaration to the LLM
 *   - a server-side handler that executes against the loaded AthleteContext
 *
 * The agent loop in `training-coach.ts` declares the tools, receives
 * tool_calls from the LLM, dispatches to the handler, and feeds results
 * back. All tool I/O is JSON-stringified so it matches what the OpenAI
 * tools API expects.
 *
 * Tool taxonomy:
 *   - READ tools — pull slices of the athlete context (workouts, injury
 *     history, biomarkers, current plan, race context) and run the
 *     deterministic adaptive engine on demand.
 *   - WRITE tools — `proposeRacePlanTool` drafts a plan structure (returns
 *     to the LLM for athlete review). `commitTrainingPlanTool` persists a
 *     draft after the athlete approves. Both require the LLM to gather
 *     enough info before invoking — the system prompt sets the bar.
 */

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolHandlerContext = {
  ctx: AthleteContext;
  supabase: SupabaseClient;
  /**
   * In-memory store for proposed plans across tool invocations. The agent
   * calls proposeRacePlan, the result is stashed here, then a later
   * commitTrainingPlan call can persist it by id. Avoids round-tripping a
   * large JSON blob through the LLM.
   */
  proposalStore: Map<string, ProposeRacePlanResult>;
};

export type ToolHandler = (args: unknown, ctx: ToolHandlerContext) => Promise<string>;

// ---------------------------------------------------------------------------
// Tool: getRecentWorkouts
// ---------------------------------------------------------------------------

const getRecentWorkoutsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getRecentWorkouts',
    description:
      "Get the athlete's recent completed workouts with full Strava + Apple fidelity. Each entry includes ISO date, day-of-week, sport type, Strava activity name, athlete-authored description, duration, distance, elevation (gain / high / low), pace (m/s and derived min/km), cadence, heart rate (avg/max), power (avg/max/normalized + whether it came from a real meter), athlete-logged RPE, Strava suffer score (Relative Effort), calories, gear id, device name, location, treadmill flag, kudos / PR / photo counts, and source. USE THE DATE FIELDS — when the athlete says 'yesterday' or 'Thursday', match against `localDate`. When a field is null it really wasn't recorded by the source; when it's a number, quote it directly. Don't claim a workout doesn't exist or a field is missing without checking the data here. Suffer score and RPE are the best intensity proxies; HR + pace + elevation give the full physiological picture. Returns the last 14 days by default.",
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days back from today to include. Default 14.',
        },
      },
    },
  },
};

function paceMinPerKmFromMps(speedMps: number | null | undefined): number | null {
  if (typeof speedMps !== 'number' || speedMps <= 0) return null;
  // (1 km / m/s) / 60s → minutes per km. Round to 2 decimals.
  return Math.round(((1000 / speedMps) / 60) * 100) / 100;
}

const handleGetRecentWorkouts: ToolHandler = async (args, { ctx }) => {
  const a = (args as { days?: number } | null) ?? {};
  const days = typeof a.days === 'number' ? a.days : 14;
  // `recentWorkouts` is already loaded for the configured lookback window
  // (default 14 days) and ordered oldest → newest. Don't slice by index — the
  // LLM asked for a date window, not a row count.
  const workouts = ctx.recentWorkouts;
  return JSON.stringify({
    today: ctx.today,
    lookbackDays: days,
    count: workouts.length,
    workouts: workouts.map((w) => ({
      localDate: w.localDate,
      day: w.day,
      sessionType: w.sessionType,
      source: w.source,
      activityName: w.activityName,
      description: w.description,
      durationMinutes: w.durationMinutes,
      distanceMeters: w.distanceMeters,
      // Pace: provide the raw m/s value Strava sends AND the derived min/km
      // so the LLM doesn't have to do unit math. Both null when not recorded.
      avgSpeedMps: w.avgSpeedMps,
      maxSpeedMps: w.maxSpeedMps,
      avgPaceMinPerKm: paceMinPerKmFromMps(w.avgSpeedMps),
      maxPaceMinPerKm: paceMinPerKmFromMps(w.maxSpeedMps),
      elevationGainM: w.elevationGainM,
      elevHigh: w.elevHigh,
      elevLow: w.elevLow,
      avgHeartRate: w.avgHeartRate,
      maxHeartRate: w.maxHeartRate,
      avgCadence: w.avgCadence,
      avgPowerWatts: w.avgPowerWatts,
      maxPowerWatts: w.maxPowerWatts,
      weightedAvgPowerWatts: w.weightedAvgPowerWatts,
      devicePowerMeter: w.devicePowerMeter,
      perceivedExertion: w.perceivedExertion,
      sufferScore: w.sufferScore,
      energyKcal: w.energyKcal,
      avgTempC: w.avgTempC,
      gearId: w.gearId,
      deviceName: w.deviceName,
      trainer: w.trainer,
      stravaWorkoutType: w.stravaWorkoutType,
      // Derived: simple intensity proxy = perceived_exertion ?? 5; loadScore = duration + intensity * 20.
      intensityScore: w.intensityScore,
      loadScore: w.loadScore,
    })),
  });
};

// ---------------------------------------------------------------------------
// Tool: getInjuryHistory
// ---------------------------------------------------------------------------

const getInjuryHistoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getInjuryHistory',
    description:
      'Get the athlete recorded injury or strain events (body part, severity, when it started/ended, notes). Use this when the athlete reports a new physical issue, when assessing risk before raising volume, or when deciding whether to recommend rest. Default lookback 90 days.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

const handleGetInjuryHistory: ToolHandler = async (_args, { ctx }) => {
  return JSON.stringify({
    today: ctx.today,
    count: ctx.injuryHistory.length,
    events: ctx.injuryHistory.map((e) => ({
      eventType: e.eventType,
      title: e.title,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      severity: e.severity,
      bodyPart: e.bodyPart,
      notes: e.notes,
      source: e.source,
    })),
  });
};

// ---------------------------------------------------------------------------
// Tool: getRecentBiomarkers
// ---------------------------------------------------------------------------

const getRecentBiomarkersDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getRecentBiomarkers',
    description:
      "Get the athlete's most recent biomarker panel (e.g. blood work). Includes panel date, individual markers with value/unit/reference range/status. Use when the athlete asks about their bloodwork, when recommending nutrition or training based on physiology, or when interpreting fatigue against iron/cortisol/etc. Returns null when no panel is on record.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetRecentBiomarkers: ToolHandler = async (_args, { ctx }) => {
  if (!ctx.biomarkers) {
    return JSON.stringify({ panel: null, note: 'No biomarker panel on record.' });
  }
  return JSON.stringify({
    panelDate: ctx.biomarkers.panelDate,
    provider: ctx.biomarkers.provider,
    panelName: ctx.biomarkers.panelName,
    resultCount: ctx.biomarkers.results.length,
    results: ctx.biomarkers.results.map((r) => ({
      displayName: r.displayName,
      value: r.value,
      unit: r.unit,
      referenceLow: r.referenceLow,
      referenceHigh: r.referenceHigh,
      optimalLow: r.optimalLow,
      optimalHigh: r.optimalHigh,
      status: r.status,
      domain: r.domain,
    })),
  });
};

// ---------------------------------------------------------------------------
// Tool: getCurrentPlan
// ---------------------------------------------------------------------------

const getCurrentPlanDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getCurrentPlan',
    description:
      "Get the athlete's active training plan summary (race context, phase blocks, weekly structure). Returns { plan: null } when no plan is on record — that's the signal the athlete needs you to help them build one. Do NOT call proposeRacePlan until you've confirmed via this tool that no plan exists OR the athlete explicitly asked to replace their plan.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetCurrentPlan: ToolHandler = async (_args, { ctx }) => {
  if (!ctx.currentPlan) {
    return JSON.stringify({
      plan: null,
      note: 'No active training plan on record. Offer to build one if the athlete mentions a race.',
    });
  }
  const p = ctx.currentPlan;
  return JSON.stringify({
    planId: p.planId,
    planStartDate: p.planStartDate,
    raceDate: p.raceDate,
    goal: p.goal,
    raceContext: p.raceContext ?? null,
    weeklyStructureCount: p.weeklyStructure.length,
    phaseBlockCount: p.phaseBlocks.length,
    phaseSummary: p.phaseBlocks.map((b) => ({
      phaseName: b.phaseName,
      weekCount: b.weeks.length,
    })),
  });
};

// ---------------------------------------------------------------------------
// Tool: getAthleteProfile
// ---------------------------------------------------------------------------

const getAthleteProfileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getAthleteProfile',
    description:
      "Get the athlete's structured profile: heightCm, weightKg, dateOfBirth, sex, primaryGoal (free text — what they're training for and why), experienceLevel ('beginner' | 'building' | 'experienced'), weeklyTrainingHoursBaseline (typical hours/week before this plan), healthNotes (chronic conditions / meds / allergies / surgeries), and onboardingCompletedAt. **Always call this BEFORE asking the athlete for any profile field** — half the time the answer is already on file. Fields are null when the athlete hasn't filled them yet; treat null as 'gap to fill via recordAthleteProfile when relevant', not as 'has been told this is unknown'.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetAthleteProfile: ToolHandler = async (_args, { ctx }) => {
  return JSON.stringify({ profile: ctx.profile });
};

// ---------------------------------------------------------------------------
// Tool: recordAthleteProfile
// ---------------------------------------------------------------------------

const recordAthleteProfileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'recordAthleteProfile',
    description:
      "Patch one or more athlete profile fields when the athlete tells you something new ('I'm 5'10\"', 'goal is to PR my marathon', 'I'm building back from 3 years off'). All fields optional — only include what the athlete actually told you. Don't fill in values you're guessing at. Do NOT call this to set onboardingCompletedAt — that's lifecycle-managed by the onboarding form. Returns the updated profile.",
    parameters: {
      type: 'object',
      properties: {
        displayName: { type: 'string' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. America/Denver.' },
        dateOfBirth: { type: 'string', description: 'YYYY-MM-DD.' },
        sex: { type: 'string', enum: ['male', 'female'] },
        heightCm: { type: 'number' },
        weightKg: { type: 'number' },
        primaryGoal: {
          type: 'string',
          description: 'Free text. The exact goal the athlete states, in their words.',
        },
        experienceLevel: { type: 'string', enum: ['beginner', 'building', 'experienced'] },
        weeklyTrainingHoursBaseline: {
          type: 'number',
          description: 'Typical training hours per week over the recent baseline (4-8 weeks).',
        },
        healthNotes: {
          type: 'string',
          description: 'Chronic conditions / meds / allergies / surgeries the coach should remember.',
        },
      },
    },
  },
};

const handleRecordAthleteProfile: ToolHandler = async (args, { ctx, supabase }) => {
  const patch = (args ?? {}) as AthleteProfilePatch;
  // Drop unknown keys defensively — the LLM occasionally sends extras.
  const allowed: AthleteProfilePatch = {
    displayName: patch.displayName,
    timezone: patch.timezone,
    dateOfBirth: patch.dateOfBirth,
    sex: patch.sex,
    heightCm: patch.heightCm,
    weightKg: patch.weightKg,
    primaryGoal: patch.primaryGoal,
    experienceLevel: patch.experienceLevel,
    weeklyTrainingHoursBaseline: patch.weeklyTrainingHoursBaseline,
    healthNotes: patch.healthNotes,
  };
  // Empty patches are no-ops in the writer; return current shape.
  try {
    const updated = await upsertAthleteProfile(supabase, ctx.userId, allowed);
    return JSON.stringify({ ok: true, profile: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ ok: false, error: message });
  }
};

// ---------------------------------------------------------------------------
// Tool: getTrainingSoul
// ---------------------------------------------------------------------------

const getTrainingSoulDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'getTrainingSoul',
    description:
      "Get the current training-soul content for this athlete — a long-form markdown document of durable facts you've recorded over time: preferences (e.g. 'morning runs over evening', 'hates treadmill'), values (e.g. 'wants to be present for kids first, fast second'), recurring patterns (e.g. 'always sandbags Tuesday quality, gets hurt on weeks > 70mi'), hard constraints (e.g. 'never travel-train, max 6 days/week'). **Read this every turn before responding** so your reply reframes through what you already know. The longevity-soul is also already in your system prompt — no separate tool needed to read that.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetTrainingSoul: ToolHandler = async (_args, { ctx }) => {
  return JSON.stringify({ soul: ctx.trainingSoul });
};

// ---------------------------------------------------------------------------
// Tool: updateTrainingSoul
// ---------------------------------------------------------------------------

const updateTrainingSoulDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'updateTrainingSoul',
    description:
      "Overwrite the training-soul markdown body. ⚠️ **PRESERVE EXISTING FACTS.** Always call getTrainingSoul first, then write back the full prior content PLUS your new additions. Do NOT delete a fact unless the athlete explicitly contradicts or retracts it. When facts evolve (e.g. athlete used to prefer mornings, now prefers evenings), append the new state and mark the prior as historical rather than deleting — the audit table keeps prior versions either way, but the live soul is what frames every reply, so a deletion is immediately costly. Use this when the athlete reveals a new durable preference, value, recurring pattern, doctor / influencer trust, hard constraint, or framing they want you to remember next time.",
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The FULL new markdown body. Prior content + your additions.',
        },
      },
      required: ['content'],
    },
  },
};

const handleUpdateTrainingSoul: ToolHandler = async (args, { ctx, supabase }) => {
  const a = (args ?? {}) as { content?: string };
  if (typeof a.content !== 'string') {
    return JSON.stringify({ ok: false, error: 'updateTrainingSoul requires content (string).' });
  }
  try {
    const updated = await updateSoul(supabase, {
      userId: ctx.userId,
      kind: 'training',
      content: a.content,
      updatedBy: 'training_coach',
    });
    return JSON.stringify({ ok: true, soul: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ ok: false, error: message });
  }
};

// ---------------------------------------------------------------------------
// Tool: runAdaptiveEngine
// ---------------------------------------------------------------------------

const runAdaptiveEngineDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'runAdaptiveEngine',
    description:
      "Run the deterministic race-aware engine for the athlete. Returns the resolved coachingPosture (aggressive | balanced | conservative — derived from the athlete's stated goal), the athlete's goal text and raceContext, today's per-day recommendations, fatigue state, recovery trend, performance delta vs. plan, and the plan-level adapt-up/-down suggestion with magnitude. **When planAdaptation.suggestion === 'raise', advocate for that raise concretely** — cite the volumeDelta and the posture, and recommend specifically what to lift next block. When it's 'lower', explain which signal triggered it. When 'hold', validate the plan. Returns { available: false } when no plan exists — don't rely on this for plan-creation conversations.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleRunAdaptiveEngine: ToolHandler = async (_args, { ctx }) => {
  const adaptiveInput = toAdaptiveCoachInput(ctx);
  if (!adaptiveInput) {
    return JSON.stringify({
      available: false,
      reason: 'No active training plan — engine requires plan + weekly structure to run.',
    });
  }
  const result = adaptWeeklyStructure(adaptiveInput);
  return JSON.stringify({
    available: true,
    // Posture + goal + raceContext: surfaced so the LLM advocates at the
    // matching aggressiveness rather than defaulting to caution.
    coachingPosture: result.coachingPosture,
    goal: ctx.currentPlan?.goal ?? null,
    raceContext: ctx.currentPlan?.raceContext ?? null,
    fatigueState: result.fatigueState,
    overloadScore: result.overloadScore,
    phasePosition: result.phasePosition,
    recoveryTrend: result.recoveryTrend,
    performanceDelta: result.performanceDelta,
    planAdaptation: result.planAdaptation,
    recommendations: result.recommendations,
  });
};

// ---------------------------------------------------------------------------
// Tool: proposeRacePlan
// ---------------------------------------------------------------------------

const proposeRacePlanDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'proposeRacePlan',
    description:
      "Draft a training plan for a race. Only call this AFTER you've (1) checked getCurrentPlan and confirmed no plan exists (or the athlete asked to replace one), (2) gathered the athlete's recent fitness via getRecentWorkouts, and (3) confirmed the race details (name, date, distance, elevation). The tool returns a proposalId — present the summary to the athlete and ask for approval before calling commitTrainingPlan. Do NOT commit without the athlete's go-ahead.",
    parameters: {
      type: 'object',
      properties: {
        raceName: { type: 'string', description: 'Race name as the athlete refers to it.' },
        raceDate: { type: 'string', description: 'Race date in YYYY-MM-DD format.' },
        distanceKm: { type: 'number', description: 'Race distance in km.' },
        elevationGainM: { type: 'number', description: 'Total elevation gain in meters.' },
        goal: { type: 'string', description: "Athlete's stated goal (e.g. 'finish', 'top 15')." },
        notes: { type: 'string', description: 'Free-text race context (terrain, aid stations, etc.).' },
        planStartDate: {
          type: 'string',
          description: 'When the plan begins (YYYY-MM-DD). Defaults to today.',
        },
        currentFitness: {
          type: 'object',
          properties: {
            weeklyMileageKm: { type: 'number' },
            longestRecentRunKm: { type: 'number' },
            experienceLevel: { type: 'string', enum: ['beginner', 'building', 'experienced'] },
          },
        },
        constraints: {
          type: 'object',
          properties: {
            trainingDaysPerWeek: { type: 'number' },
            longRunDay: { type: 'string', enum: ['Saturday', 'Sunday'] },
          },
        },
      },
      required: ['raceName', 'raceDate'],
    },
  },
};

const handleProposeRacePlan: ToolHandler = async (args, { proposalStore }) => {
  const input = args as ProposeRacePlanInput;
  if (!input || !input.raceName || !input.raceDate) {
    return JSON.stringify({ error: 'proposeRacePlan requires raceName and raceDate.' });
  }
  const proposal = proposeRacePlan(input);
  const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  proposalStore.set(proposalId, proposal);
  return JSON.stringify({
    proposalId,
    summary: proposal.summary,
    raceContext: proposal.raceContext,
    weeklyStructure: proposal.plan.weeklyStructure,
    note:
      'Present the summary to the athlete. Ask them to confirm before calling commitTrainingPlan with this proposalId. Do not invent details not present in the summary.',
  });
};

// ---------------------------------------------------------------------------
// Tool: commitTrainingPlan
// ---------------------------------------------------------------------------

const commitTrainingPlanDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'commitTrainingPlan',
    description:
      "Persist a previously-proposed plan to the athlete's account. ONLY call this after the athlete has explicitly approved the proposal (e.g. they said 'yes', 'commit it', 'go ahead'). Use the proposalId returned by proposeRacePlan. Once committed, the plan becomes the athlete's active plan and feeds the daily adaptive engine.",
    parameters: {
      type: 'object',
      properties: {
        proposalId: { type: 'string', description: 'proposalId returned by proposeRacePlan.' },
        planStartDate: {
          type: 'string',
          description: 'YYYY-MM-DD. Optional — defaults to today.',
        },
      },
      required: ['proposalId'],
    },
  },
};

const handleCommitTrainingPlan: ToolHandler = async (args, { ctx, supabase, proposalStore }) => {
  const a = args as { proposalId?: string; planStartDate?: string };
  if (!a?.proposalId) {
    return JSON.stringify({ error: 'commitTrainingPlan requires a proposalId.' });
  }
  const proposal = proposalStore.get(a.proposalId);
  if (!proposal) {
    return JSON.stringify({
      error: `No proposal found with id ${a.proposalId}. Call proposeRacePlan again to regenerate.`,
    });
  }
  try {
    const persisted = await commitProposedPlan(supabase, {
      userId: ctx.userId,
      proposal,
      planStartDate: a.planStartDate ?? ctx.today,
    });
    return JSON.stringify({
      ok: true,
      planId: persisted.planId,
      importedSessions: persisted.importedSessions,
      totalWeeks: persisted.totalWeeks,
      note: 'Plan committed. The adaptive engine will use it from the next coach turn onward.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ ok: false, error: `Failed to persist plan: ${message}` });
  }
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const COACH_TOOL_DEFINITIONS: ToolDefinition[] = [
  getRecentWorkoutsDefinition,
  getInjuryHistoryDefinition,
  getRecentBiomarkersDefinition,
  getCurrentPlanDefinition,
  getAthleteProfileDefinition,
  recordAthleteProfileDefinition,
  getTrainingSoulDefinition,
  updateTrainingSoulDefinition,
  runAdaptiveEngineDefinition,
  proposeRacePlanDefinition,
  commitTrainingPlanDefinition,
];

const HANDLERS: Record<string, ToolHandler> = {
  getRecentWorkouts: handleGetRecentWorkouts,
  getInjuryHistory: handleGetInjuryHistory,
  getRecentBiomarkers: handleGetRecentBiomarkers,
  getCurrentPlan: handleGetCurrentPlan,
  getAthleteProfile: handleGetAthleteProfile,
  recordAthleteProfile: handleRecordAthleteProfile,
  getTrainingSoul: handleGetTrainingSoul,
  updateTrainingSoul: handleUpdateTrainingSoul,
  runAdaptiveEngine: handleRunAdaptiveEngine,
  proposeRacePlan: handleProposeRacePlan,
  commitTrainingPlan: handleCommitTrainingPlan,
};

export async function executeCoachTool(
  name: string,
  rawArgs: string,
  ctx: ToolHandlerContext,
): Promise<string> {
  const handler = HANDLERS[name];
  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
  let parsed: unknown = null;
  try {
    parsed = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: `Tool ${name} received non-JSON arguments.` });
  }
  return handler(parsed, ctx);
}

export function createProposalStore(): Map<string, ProposeRacePlanResult> {
  return new Map();
}
