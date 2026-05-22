import type { SupabaseClient } from '@supabase/supabase-js';

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
      "Get the athlete's recent completed workouts. Each entry includes ISO date (e.g. '2026-05-21'), day-of-week, session type, duration, distance, average heart rate, elevation gain in meters, source (apple_watch / strava / manual), and any athlete-authored description from Strava (e.g. '+8kg vest'). USE THE DATE FIELDS — when the athlete says 'yesterday' or 'Thursday', match against `localDate`. Use `elevationGainM` for vert questions — it's populated for every Strava activity. When a field is null it really wasn't recorded; when it's a number, quote it. Don't claim a workout doesn't exist or a field is missing without checking the data here. Returns up to the last 14 days by default.",
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
      durationMinutes: w.durationMinutes,
      distanceMeters: w.distanceMeters,
      avgHeartRate: w.avgHeartRate,
      elevationGainM: w.elevationGainM,
      intensityScore: w.intensityScore,
      loadScore: w.loadScore,
      description: w.description,
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
// Tool: runAdaptiveEngine
// ---------------------------------------------------------------------------

const runAdaptiveEngineDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'runAdaptiveEngine',
    description:
      "Run the deterministic race-aware engine for the athlete. Returns today's per-day recommendations, fatigue state, recovery trend, plan-level adapt-up/-down suggestion, and rationale. Use this when the athlete has an active plan and you want to incorporate the engine's signal into your reply. Returns { available: false } when no plan exists — don't rely on this for plan-creation conversations.",
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
  runAdaptiveEngineDefinition,
  proposeRacePlanDefinition,
  commitTrainingPlanDefinition,
];

const HANDLERS: Record<string, ToolHandler> = {
  getRecentWorkouts: handleGetRecentWorkouts,
  getInjuryHistory: handleGetInjuryHistory,
  getRecentBiomarkers: handleGetRecentBiomarkers,
  getCurrentPlan: handleGetCurrentPlan,
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
