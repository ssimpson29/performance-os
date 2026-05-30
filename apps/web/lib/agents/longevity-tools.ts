import type { SupabaseClient } from '@supabase/supabase-js';

import { updateSoul } from '@/lib/profile/soul-writer';
import {
  prioritizeLongevityActions,
  type MarkerInput,
  type TrainingLoadOverreachInput,
} from '@/lib/longevity/prioritization';
import {
  evaluateMarker,
  getMarkerSpec,
} from '@/lib/longevity/reference-ranges';

import type { AthleteContext } from './athlete-context';

/**
 * Tool registry for the Longevity Guru conversational agent.
 *
 * Distinct from `coach-tools.ts` so each agent's tool descriptions are
 * tuned to its audience (the training coach cares about workouts +
 * recent load; the guru cares about marker trends + lifestyle levers).
 * Some handler implementations overlap with the coach (getInjuryHistory
 * is the same data either way) — that overlap is intentional and not
 * coupled.
 */

export type LongevityToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LongevityToolHandlerContext = {
  ctx: AthleteContext;
  supabase: SupabaseClient;
  /**
   * Set to true by updateLongevitySoul when it persists a change.
   * The agent loop reads this back so the API route can surface
   * `soulUpdated: true` to the UI for a small "saved" affordance.
   */
  soulUpdatedRef: { value: boolean };
};

export type LongevityToolHandler = (
  args: unknown,
  ctx: LongevityToolHandlerContext,
) => Promise<string>;

// ---------------------------------------------------------------------------
// Tool: getRecentBiomarkers
// ---------------------------------------------------------------------------

const getRecentBiomarkersDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'getRecentBiomarkers',
    description:
      "Get the athlete's most recent biomarker panel. Returns panel date + provider + every marker with displayName, raw value, unit, the catalog's reference range, the catalog's longevity-optimal range, current flag (low | in_range | high | unknown_marker), and domain (cardiometabolic / inflammation / hormonal / nutrients / liver_kidney / other). Use this when answering any question that touches lab values; do NOT make up numbers.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetRecentBiomarkers: LongevityToolHandler = async (_args, { ctx }) => {
  if (!ctx.biomarkers) {
    return JSON.stringify({ panel: null, note: 'No biomarker panel on record yet.' });
  }
  return JSON.stringify({
    panelDate: ctx.biomarkers.panelDate,
    provider: ctx.biomarkers.provider,
    panelName: ctx.biomarkers.panelName,
    resultCount: ctx.biomarkers.results.length,
    results: ctx.biomarkers.results.map((r) => ({
      biomarkerKey: r.biomarkerKey,
      displayName: r.displayName,
      domain: r.domain,
      value: r.value,
      unit: r.unit,
      referenceLow: r.referenceLow,
      referenceHigh: r.referenceHigh,
      optimalLow: r.optimalLow,
      optimalHigh: r.optimalHigh,
      status: r.status,
    })),
  });
};

// ---------------------------------------------------------------------------
// Tool: getMarkerHistory
// ---------------------------------------------------------------------------

const getMarkerHistoryDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'getMarkerHistory',
    description:
      "Get the athlete's full history of a single biomarker across all panels — date + value for every measurement on record, oldest first. Use this when answering 'how has my apoB moved?' or computing trend rationale. Returns { markerKey, displayName, history: [{ measuredAt, value, unit }] } or { history: [] } when no rows exist.",
    parameters: {
      type: 'object',
      properties: {
        markerKey: {
          type: 'string',
          description:
            "Catalog key — e.g. 'apob', 'ldl_c', 'hba1c'. Use getRecentBiomarkers first to discover the key if uncertain.",
        },
      },
      required: ['markerKey'],
    },
  },
};

const handleGetMarkerHistory: LongevityToolHandler = async (args, { ctx, supabase }) => {
  const a = (args ?? {}) as { markerKey?: string };
  if (!a.markerKey || typeof a.markerKey !== 'string') {
    return JSON.stringify({ error: 'getMarkerHistory requires markerKey (string).' });
  }
  const spec = getMarkerSpec(a.markerKey);

  const { data, error } = await supabase
    .from('biomarker_results')
    .select('value_numeric, unit, measured_at')
    .eq('user_id', ctx.userId)
    .eq('biomarker_key', a.markerKey)
    .order('measured_at', { ascending: true });

  if (error) {
    return JSON.stringify({ error: `Failed to load marker history: ${error.message}` });
  }

  const history = (data ?? [])
    .map((row) => row as { value_numeric: number | null; unit: string | null; measured_at: string })
    .filter((row) => row.value_numeric != null)
    .map((row) => ({
      measuredAt: row.measured_at,
      value: row.value_numeric as number,
      unit: row.unit ?? '',
    }));

  return JSON.stringify({
    markerKey: a.markerKey,
    displayName: spec?.displayName ?? a.markerKey,
    canonicalUnit: spec?.canonicalUnit ?? null,
    historyCount: history.length,
    history,
  });
};

// ---------------------------------------------------------------------------
// Tool: getLongevitySoul
// ---------------------------------------------------------------------------

const getLongevitySoulDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'getLongevitySoul',
    description:
      "Get the athlete's longevity soul — a long-form markdown document of durable facts about how they want longevity recommendations framed: doctor / influencer preferences (e.g. 'filter through Attia / Saladino'), dietary philosophy, chronic conditions context, hard constraints. Read this every turn so your reply reframes through what's already recorded.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetLongevitySoul: LongevityToolHandler = async (_args, { ctx }) => {
  return JSON.stringify({ soul: ctx.longevitySoul });
};

// ---------------------------------------------------------------------------
// Tool: updateLongevitySoul
// ---------------------------------------------------------------------------

const updateLongevitySoulDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'updateLongevitySoul',
    description:
      "Overwrite the longevity-soul markdown body. ⚠️ PRESERVE EXISTING FACTS. Always call getLongevitySoul first, then write back the full prior content PLUS your additions. Use this when the athlete shares a new durable health framing — a doctor they trust, a dietary philosophy, a chronic condition, a longevity goal they want every recommendation routed through. Don't use it for transient questions or one-off observations.",
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'FULL new markdown body — prior content + your additions.',
        },
      },
      required: ['content'],
    },
  },
};

const handleUpdateLongevitySoul: LongevityToolHandler = async (
  args,
  { ctx, supabase, soulUpdatedRef },
) => {
  const a = (args ?? {}) as { content?: string };
  if (typeof a.content !== 'string') {
    return JSON.stringify({ ok: false, error: 'updateLongevitySoul requires content (string).' });
  }
  try {
    const updated = await updateSoul(supabase, {
      userId: ctx.userId,
      kind: 'longevity',
      content: a.content,
      updatedBy: 'longevity_guru',
    });
    soulUpdatedRef.value = true;
    return JSON.stringify({ ok: true, soul: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return JSON.stringify({ ok: false, error: message });
  }
};

// ---------------------------------------------------------------------------
// Tool: getInjuryHistory
// ---------------------------------------------------------------------------

const getInjuryHistoryDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'getInjuryHistory',
    description:
      "Get the athlete's recorded injury / strain events with bodyPart, severity, when it started / ended, and notes. Useful when a longevity question intersects with musculoskeletal load — chronic recurring injuries are a healthspan signal too.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleGetInjuryHistory: LongevityToolHandler = async (_args, { ctx }) => {
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
// Tool: runDeterministicPrioritization
// ---------------------------------------------------------------------------

const runDeterministicPrioritizationDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'runDeterministicPrioritization',
    description:
      "Run the deterministic longevity prioritization engine over the athlete's current biomarker panel + any recent training-load overreach signal. Returns the top 1-3 priorities (lever + severity + recommendation + contributing markers) plus a 'watching' list and any conflicts with the Training Coach. Use this to ground your reply in the engine's structured output rather than re-deriving priorities from scratch.",
    parameters: { type: 'object', properties: {} },
  },
};

const handleRunDeterministicPrioritization: LongevityToolHandler = async (_args, { ctx }) => {
  if (!ctx.biomarkers || ctx.biomarkers.results.length === 0) {
    return JSON.stringify({
      available: false,
      reason: 'No biomarker panel on record — engine requires markers to prioritize.',
    });
  }

  // Build MarkerInput[] from the athlete's most recent panel results.
  // Skip rows that can't evaluate (unit mismatch, unknown key, non-numeric).
  // Trend is left null — computing real trends would require per-marker
  // history queries which add latency to every chat turn. If the athlete
  // wants to know how a specific marker is moving, getMarkerHistory is
  // the right tool to call.
  const markerInputs: MarkerInput[] = [];
  const evaluations: Array<{
    markerKey: string;
    displayName: string;
    flag: string;
    optimalDelta: number;
  }> = [];

  for (const r of ctx.biomarkers.results) {
    const value = typeof r.value === 'number' ? r.value : Number(r.value);
    if (!Number.isFinite(value) || !r.unit) continue;
    const spec = getMarkerSpec(r.biomarkerKey);
    if (!spec) continue;
    let evaluation;
    try {
      evaluation = evaluateMarker({
        markerKey: r.biomarkerKey,
        value,
        unit: r.unit,
      });
    } catch {
      // unit mismatch / catalog miss — skip this marker.
      continue;
    }
    markerInputs.push({
      markerKey: r.biomarkerKey,
      displayName: spec.displayName,
      domain: spec.domain,
      flag: evaluation.flag,
      optimalDelta: evaluation.optimalDelta,
      trend: null,
    });
    evaluations.push({
      markerKey: r.biomarkerKey,
      displayName: spec.displayName,
      flag: evaluation.flag,
      optimalDelta: evaluation.optimalDelta,
    });
  }

  // No training-load overreach signal here — chat path doesn't compute it.
  // The athlete can describe one in conversation if relevant.
  const overreach: TrainingLoadOverreachInput | undefined = undefined;
  const { priorities, watching } = prioritizeLongevityActions({
    markers: markerInputs,
    trainingLoadOverreach: overreach,
  });

  return JSON.stringify({
    available: true,
    priorities: priorities.map((p) => ({
      leverKey: p.leverKey,
      severity: p.severity,
      recommendation: p.recommendation,
      contributingMarkers: p.contributingMarkers,
    })),
    watching: watching.map((w) => ({
      leverKey: w.leverKey,
      severity: w.severity,
      recommendation: w.recommendation,
    })),
    evaluations,
  });
};

// ---------------------------------------------------------------------------
// Tool: getRecentWorkouts
//
// The longevity guru shares the training coach's loaded AthleteContext, so
// recent training is already in hand — it just needs a tool to read it. Tuned
// for the guru's job: ground nutrition / fueling / hydration / recovery advice
// in real energy expenditure and load, not generic guidance.
// ---------------------------------------------------------------------------

const getRecentWorkoutsDefinition: LongevityToolDefinition = {
  type: 'function',
  function: {
    name: 'getRecentWorkouts',
    description:
      "Get the athlete's recent training (last 14 days by default) plus an aggregate training-load summary. USE THIS to ground nutrition, fueling, hydration, and recovery advice in actual energy expenditure and load — e.g. carbohydrate needs around long/hard sessions, protein for recovery, fueling across back-to-back days, electrolytes for high-sweat or high-vert efforts. Each session carries date, type, duration, distance, elevation gain, avg/max HR, perceived exertion, Strava suffer score, energy (kcal), and derived intensity/load scores. The `summary` aggregates totals (sessions, duration, distance, vert, kcal, load), hard-session count, longest session, and days trained — the fastest read on weekly load. Null fields mean the source didn't record that metric; don't infer a value.",
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days back from today to include. Default 14.' },
      },
    },
  },
};

const handleGetRecentWorkouts: LongevityToolHandler = async (args, { ctx }) => {
  const a = (args as { days?: number } | null) ?? {};
  const days = typeof a.days === 'number' ? a.days : 14;
  const workouts = ctx.recentWorkouts;

  const sum = (fn: (w: (typeof workouts)[number]) => number | null | undefined) =>
    workouts.reduce((acc, w) => acc + (fn(w) ?? 0), 0);
  const totalEnergyKcal = Math.round(sum((w) => w.energyKcal));

  return JSON.stringify({
    today: ctx.today,
    lookbackDays: days,
    count: workouts.length,
    summary: {
      totalSessions: workouts.length,
      totalDurationMinutes: Math.round(sum((w) => w.durationMinutes)),
      totalDistanceMeters: Math.round(sum((w) => w.distanceMeters)),
      totalElevationGainM: Math.round(sum((w) => w.elevationGainM)),
      totalEnergyKcal: totalEnergyKcal || null,
      totalLoadScore: Math.round(sum((w) => w.loadScore)),
      hardSessions: workouts.filter((w) => (w.intensityScore ?? 0) >= 7 || (w.perceivedExertion ?? 0) >= 7).length,
      longestSessionMinutes: workouts.reduce((m, w) => Math.max(m, w.durationMinutes ?? 0), 0),
      daysTrained: new Set(workouts.map((w) => w.localDate ?? w.day)).size,
    },
    workouts: workouts.map((w) => ({
      localDate: w.localDate,
      day: w.day,
      sessionType: w.sessionType,
      source: w.source,
      durationMinutes: w.durationMinutes,
      distanceMeters: w.distanceMeters ?? null,
      elevationGainM: w.elevationGainM ?? null,
      avgHeartRate: w.avgHeartRate ?? null,
      maxHeartRate: w.maxHeartRate ?? null,
      perceivedExertion: w.perceivedExertion ?? null,
      sufferScore: w.sufferScore ?? null,
      energyKcal: w.energyKcal ?? null,
      intensityScore: w.intensityScore,
      loadScore: w.loadScore,
    })),
  });
};

// ---------------------------------------------------------------------------
// Registry + dispatcher
// ---------------------------------------------------------------------------

export const LONGEVITY_TOOL_DEFINITIONS: LongevityToolDefinition[] = [
  getRecentBiomarkersDefinition,
  getMarkerHistoryDefinition,
  getRecentWorkoutsDefinition,
  getLongevitySoulDefinition,
  updateLongevitySoulDefinition,
  getInjuryHistoryDefinition,
  runDeterministicPrioritizationDefinition,
];

const HANDLERS: Record<string, LongevityToolHandler> = {
  getRecentBiomarkers: handleGetRecentBiomarkers,
  getMarkerHistory: handleGetMarkerHistory,
  getRecentWorkouts: handleGetRecentWorkouts,
  getLongevitySoul: handleGetLongevitySoul,
  updateLongevitySoul: handleUpdateLongevitySoul,
  getInjuryHistory: handleGetInjuryHistory,
  runDeterministicPrioritization: handleRunDeterministicPrioritization,
};

export async function executeLongevityTool(
  name: string,
  rawArgs: string,
  ctx: LongevityToolHandlerContext,
): Promise<string> {
  const handler = HANDLERS[name];
  if (!handler) {
    return JSON.stringify({ error: `Unknown longevity tool: ${name}` });
  }
  let parsed: unknown = null;
  try {
    parsed = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: `Tool ${name} received non-JSON arguments.` });
  }
  return handler(parsed, ctx);
}

export function createSoulUpdatedRef(): { value: boolean } {
  return { value: false };
}
