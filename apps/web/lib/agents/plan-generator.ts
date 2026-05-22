import type { SupabaseClient } from '@supabase/supabase-js';

import { persistImportedTrainingPlan } from '@/lib/training-plan/persistence';
import type {
  ParsedTrainingPlan,
  PhaseBlock,
  PhaseWeekTarget,
  RaceContext,
  SupportTemplate,
  WeeklyStructureSession,
} from '@/lib/training-plan/types';

/**
 * Conversational plan generator for the Training Coach agent.
 *
 * `proposeRacePlan` is a pure function — it takes a race + the athlete's
 * current fitness + (optional) constraints, and returns a draft
 * ParsedTrainingPlan shaped exactly like a workbook import. The agent calls
 * this when the athlete says "I just signed up for a race, build me a
 * plan" and surfaces a summary to the user for review before committing.
 *
 * `commitProposedPlan` is the persistence step — the agent calls it after
 * the athlete approves the draft. It delegates to
 * `persistImportedTrainingPlan` so the new plan lands in the same tables
 * (training_plans + planned_sessions) as workbook-imported plans, with the
 * same race-context metadata.
 *
 * The structure is deterministic: four phases (Foundation / Build / Peak /
 * Taper) distributed proportionally over the weeks until race day, with
 * mileage and vert ramping by phase. This is a v1 template — the agent can
 * later iterate on it conversationally (e.g. "shift the build phase by a
 * week") in future revisions.
 */

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

const ULTRA_WEEKLY_TEMPLATE: WeeklyStructureSession[] = [
  { day: 'Monday', runSession: 'Aerobic Run', details: 'Easy aerobic miles, conversational pace', strengthMobility: 'Strength A', exactWork: 'Z2 effort' },
  { day: 'Tuesday', runSession: 'Quality', details: 'Intervals or tempo — varies by phase', strengthMobility: 'Daily Routine', exactWork: 'Per phase prescription' },
  { day: 'Wednesday', runSession: 'Aerobic Run', details: 'Easy aerobic miles', strengthMobility: 'Mobility', exactWork: 'Z2 effort, optional double' },
  { day: 'Thursday', runSession: 'Vert Run', details: 'Hills or climbing-focused', strengthMobility: 'Daily Routine', exactWork: 'Per phase vert target' },
  { day: 'Friday', runSession: 'Recovery or Rest', details: 'Easy 30–45 min OR full rest day', strengthMobility: 'Strength B', exactWork: 'Posterior chain + core' },
  { day: 'Saturday', runSession: 'Long Run', details: 'Weekly long run, race-specific terrain', strengthMobility: 'Mobility', exactWork: 'Per phase long-run target' },
  { day: 'Sunday', runSession: 'Easy Run', details: 'Easy aerobic recovery from Saturday', strengthMobility: 'Mobility', exactWork: 'Z1–Z2 effort' },
];

const DEFAULT_SUPPORT_TEMPLATES: SupportTemplate[] = [
  {
    name: 'Strength A',
    sourceSheet: 'AI Generated',
    items: [
      { label: 'Back Squat', prescription: '3x6–8', focus: 'Posterior chain', notes: '', metadata: {} },
      { label: 'Romanian Deadlift', prescription: '3x8', focus: 'Hamstrings + glutes', notes: '', metadata: {} },
      { label: 'Single-Leg Calf Raise', prescription: '3x12 ea', focus: 'Calves + ankle stability', notes: '', metadata: {} },
      { label: 'Side Plank', prescription: '3x30s ea', focus: 'Core', notes: '', metadata: {} },
    ],
  },
  {
    name: 'Strength B',
    sourceSheet: 'AI Generated',
    items: [
      { label: 'Step-Up', prescription: '3x10 ea', focus: 'Single-leg power', notes: '', metadata: {} },
      { label: 'Front Squat or Goblet Squat', prescription: '3x8', focus: 'Quads + core', notes: '', metadata: {} },
      { label: 'Single-Leg RDL', prescription: '3x8 ea', focus: 'Balance + posterior chain', notes: '', metadata: {} },
      { label: 'Dead Bug', prescription: '3x10 ea', focus: 'Anti-extension core', notes: '', metadata: {} },
    ],
  },
  {
    name: 'Daily Routine',
    sourceSheet: 'AI Generated',
    items: [
      { label: 'Foot doming', prescription: '2x20', focus: 'Foot intrinsics', notes: '', metadata: {} },
      { label: 'Glute bridge', prescription: '2x15', focus: 'Glute activation', notes: '', metadata: {} },
      { label: 'Hip airplane', prescription: '2x8 ea', focus: 'Hip stability', notes: '', metadata: {} },
    ],
  },
  {
    name: 'Mobility',
    sourceSheet: 'AI Generated',
    items: [
      { label: '90/90 hip switch', prescription: '2x10 ea', focus: 'Hip mobility', notes: '', metadata: {} },
      { label: 'World’s greatest stretch', prescription: '2x5 ea', focus: 'Full-body mobility', notes: '', metadata: {} },
      { label: 'Couch stretch', prescription: '2x30s ea', focus: 'Hip flexors', notes: '', metadata: {} },
    ],
  },
];

export type ProposeRacePlanInput = {
  raceName: string;
  /** ISO YYYY-MM-DD */
  raceDate: string;
  distanceKm?: number;
  elevationGainM?: number;
  goal?: string;
  /** Athlete-facing notes (terrain, aid stations, etc.) */
  notes?: string;
  /** ISO YYYY-MM-DD; defaults to today. The plan's week 1 starts here. */
  planStartDate?: string;
  currentFitness?: {
    /** Athlete's recent average weekly volume in km. */
    weeklyMileageKm?: number;
    /** Longest recent run in km. */
    longestRecentRunKm?: number;
    /** Subjective: 'beginner' | 'building' | 'experienced'. */
    experienceLevel?: 'beginner' | 'building' | 'experienced';
  };
  constraints?: {
    /** Number of training days per week the athlete can commit to. Default 6. */
    trainingDaysPerWeek?: number;
    /** Day of week for the long run. Default 'Saturday'. */
    longRunDay?: 'Saturday' | 'Sunday';
  };
};

export type ProposedRacePlanSummary = {
  totalWeeks: number;
  phases: Array<{
    name: string;
    weekCount: number;
    weekStart: string; // ISO
    weekEnd: string; // ISO
    peakMileageKm: number;
    peakVertM: number;
  }>;
  estimatedPeakMileageKm: number;
  estimatedPeakVertM: number;
  longRunProgression: Array<{ weekIndex: number; longRunKm: number }>;
};

export type ProposeRacePlanResult = {
  /** The full ParsedTrainingPlan-shaped draft. Pass to commitProposedPlan to persist. */
  plan: ParsedTrainingPlan;
  /** A human-readable summary suitable for the agent to present to the athlete. */
  summary: ProposedRacePlanSummary;
  /** The RaceContext that will be stored on the plan when committed. */
  raceContext: RaceContext;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, deltaDays: number): string {
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(fromIso: string, toIso: string): number {
  const fromMs = new Date(`${fromIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${toIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const diff = toMs - fromMs;
  return Math.max(1, Math.floor(diff / (MS_PER_DAY * DAYS_PER_WEEK)));
}

/**
 * Decide a sensible peak-week mileage given race distance + current fitness.
 * Conservative estimates — biased toward "athlete who can sustain training"
 * rather than "athlete who breaks down before the race."
 */
function estimatePeakMileageKm(input: ProposeRacePlanInput): number {
  const distance = input.distanceKm ?? 50;
  // Default starting points by race distance (km/week at peak).
  let base: number;
  if (distance >= 160) base = 110;       // 100mi+
  else if (distance >= 100) base = 90;   // 100k
  else if (distance >= 50) base = 70;    // 50k
  else if (distance >= 42) base = 60;    // marathon
  else base = 50;                         // shorter

  const fitness = input.currentFitness?.weeklyMileageKm;
  const experience = input.currentFitness?.experienceLevel;

  // Cap the peak relative to current fitness to avoid blowing the athlete up.
  // Rule of thumb: peak can be ~1.7× current weekly volume for experienced,
  // ~1.4× for building, ~1.2× for beginner.
  if (typeof fitness === 'number' && fitness > 0) {
    const multiplier = experience === 'experienced' ? 1.7 : experience === 'beginner' ? 1.2 : 1.4;
    const fitnessCap = Math.round(fitness * multiplier);
    base = Math.min(base, Math.max(fitnessCap, fitness + 15));
  }
  return base;
}

function estimatePeakVertM(input: ProposeRacePlanInput, peakMileageKm: number): number {
  const elevationGain = input.elevationGainM ?? 0;
  if (elevationGain === 0) {
    return Math.round(peakMileageKm * 15); // baseline rolling vert
  }
  // Vert per week scales with race vert / race-distance ratio.
  const distance = input.distanceKm ?? 50;
  const verticalRatio = elevationGain / Math.max(distance, 1);
  return Math.round(peakMileageKm * verticalRatio * 0.6);
}

function clampMileage(mileage: number, minKm: number = 25): number {
  return Math.max(minKm, Math.round(mileage));
}

/**
 * Divide totalWeeks into Foundation / Build / Peak / Taper. Allocates by
 * floor of standard proportions and pushes the remainder to Build (the
 * longest phase). Always reserves at least one week per phase when total
 * weeks >= 4; otherwise collapses.
 */
function distributePhases(totalWeeks: number): { foundation: number; build: number; peak: number; taper: number } {
  if (totalWeeks <= 1) return { foundation: 0, build: 0, peak: 0, taper: totalWeeks };
  if (totalWeeks === 2) return { foundation: 0, build: 1, peak: 0, taper: 1 };
  if (totalWeeks === 3) return { foundation: 0, build: 1, peak: 1, taper: 1 };
  if (totalWeeks === 4) return { foundation: 1, build: 1, peak: 1, taper: 1 };
  const taper = Math.max(2, Math.floor(totalWeeks * 0.1));
  const peak = Math.max(2, Math.floor(totalWeeks * 0.2));
  const foundation = Math.max(2, Math.floor(totalWeeks * 0.3));
  const build = totalWeeks - taper - peak - foundation;
  return { foundation, build, peak, taper };
}

function buildPhaseWeeks(args: {
  phaseName: string;
  startWeekIndex: number;
  weekCount: number;
  startMileageKm: number;
  endMileageKm: number;
  vertScale: number;
  isTaper?: boolean;
  longRunProgression?: number[];
}): { weeks: PhaseWeekTarget[]; longRunByWeek: Map<number, number> } {
  const { phaseName, startWeekIndex, weekCount, startMileageKm, endMileageKm, vertScale, isTaper, longRunProgression } = args;
  const weeks: PhaseWeekTarget[] = [];
  const longRunByWeek = new Map<number, number>();
  for (let i = 0; i < weekCount; i += 1) {
    const t = weekCount === 1 ? 1 : i / (weekCount - 1);
    const rawMileage = startMileageKm + (endMileageKm - startMileageKm) * t;
    const isDeload = !isTaper && weekCount > 3 && i > 0 && (i + 1) % 4 === 0; // every 4th week, except in 3-week phases or taper
    const mileage = isDeload ? Math.round(rawMileage * 0.75) : Math.round(rawMileage);
    const vert = Math.round(mileage * vertScale);
    const longRunKm = longRunProgression
      ? longRunProgression[i] ?? Math.round(mileage * 0.35)
      : Math.round(mileage * 0.35);
    longRunByWeek.set(startWeekIndex + i, longRunKm);

    const keyFocus = isDeload
      ? 'Deload — recovery + maintenance'
      : phaseName === 'Foundation'
        ? 'Aerobic base + strength foundation'
        : phaseName === 'Build'
          ? 'Volume + vert + quality progression'
          : phaseName === 'Peak'
            ? 'Race-specific intensity at peak volume'
            : 'Taper — reduce volume, preserve sharpness';
    weeks.push({
      weekLabel: `Week ${startWeekIndex + i + 1}`,
      mileageTarget: `${clampMileage(mileage)} km`,
      vertTarget: `${vert} m`,
      saturdayTarget: `${longRunKm} km long run`,
      sundayTarget: `${Math.max(8, Math.round(mileage * 0.15))} km easy`,
      thursdayTarget: `${Math.max(8, Math.round(mileage * 0.18))} km with vert`,
      fuelTarget: isTaper ? 'Maintain race-day fueling protocol' : '60–80 g/hr carb on long runs',
      notes: isDeload ? 'Deload week — every 4th week through the build.' : undefined,
      keyFocus,
      isDeload,
      metadata: {
        phase: phaseName,
        weekInPhase: String(i + 1),
        weekTotalIndex: String(startWeekIndex + i + 1),
      },
    });
  }
  return { weeks, longRunByWeek };
}

/**
 * Generate a draft training plan for a race. Pure / deterministic — the
 * agent calls this and presents the summary to the user before committing.
 */
export function proposeRacePlan(input: ProposeRacePlanInput): ProposeRacePlanResult {
  const planStartDate = input.planStartDate ?? isoToday();
  const totalWeeks = weeksBetween(planStartDate, input.raceDate);
  const phaseSplit = distributePhases(totalWeeks);
  const peakMileage = estimatePeakMileageKm(input);
  const peakVert = estimatePeakVertM(input, peakMileage);
  const vertScale = peakVert / Math.max(peakMileage, 1);

  // Mileage anchors:
  //   - Foundation starts at ~55% of peak, ends at ~75%.
  //   - Build starts at ~75%, ends at ~100% (peak).
  //   - Peak holds at ~95–100%.
  //   - Taper drops from 80% to ~50% on race week.
  const startMileage = Math.round(peakMileage * 0.55);
  const foundationEndMileage = Math.round(peakMileage * 0.75);
  const buildEndMileage = peakMileage;
  const peakHoldMileage = Math.round(peakMileage * 0.97);
  const taperStartMileage = Math.round(peakMileage * 0.8);
  const raceWeekMileage = Math.round(peakMileage * 0.5);

  const allWeeks: PhaseWeekTarget[] = [];
  const phaseSummaries: ProposedRacePlanSummary['phases'] = [];
  let cursor = 0;
  let allLongRuns = new Map<number, number>();

  const addPhase = (
    name: string,
    weekCount: number,
    startMile: number,
    endMile: number,
    isTaper = false,
  ) => {
    if (weekCount === 0) return;
    const { weeks: w, longRunByWeek } = buildPhaseWeeks({
      phaseName: name,
      startWeekIndex: cursor,
      weekCount,
      startMileageKm: startMile,
      endMileageKm: endMile,
      vertScale,
      isTaper,
    });
    allWeeks.push(...w);
    for (const [k, v] of longRunByWeek) allLongRuns.set(k, v);
    const phaseStartIso = addDaysIso(planStartDate, cursor * DAYS_PER_WEEK);
    const phaseEndIso = addDaysIso(planStartDate, (cursor + weekCount) * DAYS_PER_WEEK - 1);
    phaseSummaries.push({
      name,
      weekCount,
      weekStart: phaseStartIso,
      weekEnd: phaseEndIso,
      peakMileageKm: Math.max(startMile, endMile),
      peakVertM: Math.round(Math.max(startMile, endMile) * vertScale),
    });
    cursor += weekCount;
  };

  addPhase('Foundation', phaseSplit.foundation, startMileage, foundationEndMileage);
  addPhase('Build', phaseSplit.build, foundationEndMileage, buildEndMileage);
  addPhase('Peak', phaseSplit.peak, buildEndMileage, peakHoldMileage);
  addPhase('Taper', phaseSplit.taper, taperStartMileage, raceWeekMileage, true);

  // Group weeks into PhaseBlocks by phase metadata.
  const phaseBlocks: PhaseBlock[] = [];
  for (const summary of phaseSummaries) {
    const weeksInPhase = allWeeks.filter((w) => w.metadata.phase === summary.name);
    phaseBlocks.push({
      phaseName: `PHASE ${phaseBlocks.length + 1}: ${summary.name.toUpperCase()}`,
      headers: ['Week', 'Mileage Target', 'Vert Target', 'Saturday Long Run', 'Sunday Run', 'Thursday Vert', 'Fuel Target', 'Notes', 'Key Focus'],
      weeks: weeksInPhase,
    });
  }

  const raceContext: RaceContext = {
    raceName: input.raceName,
    raceDate: input.raceDate,
    distanceKm: input.distanceKm,
    elevationGainM: input.elevationGainM,
    goal: input.goal,
    notes: input.notes,
  };

  const longRunProgression = Array.from(allLongRuns.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekIndex, longRunKm]) => ({ weekIndex: weekIndex + 1, longRunKm }));

  const plan: ParsedTrainingPlan = {
    planName: `${input.raceName} Build`,
    sourceFileName: 'ai-generated.json',
    sheetNames: ['AI Generated'],
    weeklyStructure: ULTRA_WEEKLY_TEMPLATE,
    phaseBlocks,
    supportTemplates: DEFAULT_SUPPORT_TEMPLATES,
  };

  return {
    plan,
    summary: {
      totalWeeks,
      phases: phaseSummaries,
      estimatedPeakMileageKm: peakMileage,
      estimatedPeakVertM: peakVert,
      longRunProgression,
    },
    raceContext,
  };
}

/**
 * Persist a proposed plan to Supabase. Delegates to the existing
 * `persistImportedTrainingPlan` helper so AI-generated plans land in the
 * same shape as workbook-imported ones (training_plans + planned_sessions
 * with race-context metadata).
 */
export async function commitProposedPlan(
  supabase: SupabaseClient,
  args: {
    userId: string;
    proposal: ProposeRacePlanResult;
    /** Defaults to today. Plan's week 1 starts on this date. */
    planStartDate?: string;
  },
): Promise<{ planId: string; importedSessions: number; totalWeeks: number }> {
  const startDate = args.planStartDate ?? isoToday();
  return persistImportedTrainingPlan(supabase, args.proposal.plan, {
    userId: args.userId,
    startDate,
    endDate: args.proposal.raceContext.raceDate,
    goal: args.proposal.raceContext.goal,
    raceContext: args.proposal.raceContext,
  });
}
