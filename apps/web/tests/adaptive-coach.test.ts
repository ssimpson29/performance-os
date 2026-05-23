import { describe, expect, it } from 'vitest';

import {
  adaptWeeklyStructure,
  computePerformanceDelta,
  computePhasePosition,
  computeRecoveryTrend,
} from '../lib/training-plan/adaptive-coach';
import type {
  CompletedWorkout,
  PhaseBlock,
  RecoverySample,
  WeeklyStructureSession,
} from '../lib/training-plan/types';

const weeklyStructure: WeeklyStructureSession[] = [
  {
    day: 'Monday',
    runSession: 'Aerobic Run',
    details: '8–10 miles Zone 2',
    strengthMobility: 'Lift A (Posterior Chain)',
    exactWork: 'See Strength Sheet',
  },
  {
    day: 'Tuesday',
    runSession: 'Quality',
    details: 'Track intervals or tempo',
    strengthMobility: 'None',
    exactWork: 'No lifting',
  },
  {
    day: 'Wednesday',
    runSession: 'Aerobic Volume',
    details: '10–12 miles easy Zone 2',
    strengthMobility: 'Lift B (Mobility Only)',
    exactWork: 'See Mobility Sheet',
  },
];

const overloadedWeekend: CompletedWorkout[] = [
  { day: 'Saturday', durationMinutes: 330, intensityScore: 9, loadScore: 320, sessionType: 'Long Run' },
  { day: 'Sunday', durationMinutes: 240, intensityScore: 8, loadScore: 240, sessionType: 'Mountain Long Run' },
];

const manageableWeekend: CompletedWorkout[] = [
  { day: 'Saturday', durationMinutes: 150, intensityScore: 6, loadScore: 120, sessionType: 'Long Run' },
];

// Phase plan aligned to plan start 2026-02-02 and race 2026-08-07.
// Total 27 weeks (race week is week 26): 8 + 10 + 5 + 3 + 1.
function buildPhaseBlocks(): PhaseBlock[] {
  const phase = (name: string, count: number): PhaseBlock => ({
    phaseName: name,
    headers: ['Week'],
    weeks: Array.from({ length: count }, (_, i) => ({
      weekLabel: `${i + 1}`,
      mileageTarget: '60',
      vertTarget: '5,000 ft',
      isDeload: false,
      metadata: {},
    })),
  });
  return [
    phase('PHASE 1: FOUNDATION BUILD', 8),       // weeks 0-7
    phase('PHASE 2: SPECIFIC LOAD BUILD', 10),   // weeks 8-17
    phase('PHASE 3: PEAK SPECIFICITY', 5),       // weeks 18-22
    phase('PHASE 4: TAPER', 3),                  // weeks 23-25
    phase('Race Week', 1),                       // week 26
  ];
}

// Sample recovery histories.
function steadyHealthyRecovery(): RecoverySample[] {
  return Array.from({ length: 10 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    score: 78 + (i % 3),
  }));
}
function improvingRecovery(): RecoverySample[] {
  return Array.from({ length: 10 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    score: 60 + i * 2,
  }));
}
function degradingRecovery(): RecoverySample[] {
  return Array.from({ length: 10 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    score: 85 - i * 2,
  }));
}

// ---------------------------------------------------------------------------
// Existing behavior — must remain green.
// ---------------------------------------------------------------------------

describe('adaptWeeklyStructure — existing weekend-overload behavior (preserved)', () => {
  it('downgrades monday and tuesday after a stacked overload weekend', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: overloadedWeekend,
      currentDay: 'Monday',
      recoveryScore: 46,
    });

    expect(adapted.fatigueState).toBe('high');
    expect(adapted.recommendations[0]).toMatchObject({
      day: 'Monday',
      action: 'downgrade',
      recommendedSessionType: 'Recovery Run or Rest',
    });
    expect(adapted.recommendations[1]).toMatchObject({
      day: 'Tuesday',
      action: 'defer-intensity',
      recommendedSessionType: 'Aerobic Run',
    });
  });

  it('keeps the base structure when weekend load is normal', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 79,
    });

    expect(adapted.fatigueState).toBe('manageable');
    expect(adapted.recommendations[0]).toMatchObject({
      day: 'Monday',
      action: 'keep',
      recommendedSessionType: 'Aerobic Run',
    });
    expect(adapted.recommendations[1]).toMatchObject({
      day: 'Tuesday',
      action: 'keep',
      recommendedSessionType: 'Quality',
    });
  });
});

// ---------------------------------------------------------------------------
// Phase-of-plan calc
// ---------------------------------------------------------------------------

describe('computePhasePosition', () => {
  const phaseBlocks = buildPhaseBlocks();
  const planStart = '2026-02-02';
  const race = '2026-08-07'; // ~27 weeks out, race week starts ~2026-08-03

  it('places the athlete in foundation build at week 0', () => {
    const pos = computePhasePosition({
      today: '2026-02-02',
      planStartDate: planStart,
      raceDate: race,
      phaseBlocks,
    });
    expect(pos?.phaseName).toMatch(/FOUNDATION BUILD/i);
    expect(pos?.totalWeekIndex).toBe(0);
    expect(pos?.isRaceWeek).toBe(false);
    expect(pos?.isTaper).toBe(false);
    expect(pos?.raiseAllowed).toBe(true);
  });

  it('detects taper phase and forbids raises', () => {
    const pos = computePhasePosition({
      today: '2026-07-20',
      planStartDate: planStart,
      raceDate: race,
      phaseBlocks,
    });
    expect(pos?.phaseName).toMatch(/TAPER/i);
    expect(pos?.isTaper).toBe(true);
    expect(pos?.raiseAllowed).toBe(false);
    expect(pos?.isRaceWeek).toBe(false);
  });

  it('detects race week', () => {
    const pos = computePhasePosition({
      today: '2026-08-05',
      planStartDate: planStart,
      raceDate: race,
      phaseBlocks,
    });
    expect(pos?.isRaceWeek).toBe(true);
    expect(pos?.raiseAllowed).toBe(false);
    expect(pos?.weeksToRace).toBe(0);
  });

  it('returns null when inputs are malformed', () => {
    const pos = computePhasePosition({
      today: 'not-a-date',
      planStartDate: planStart,
      raceDate: race,
      phaseBlocks,
    });
    expect(pos).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recovery trend detection
// ---------------------------------------------------------------------------

describe('computeRecoveryTrend', () => {
  it('returns stable + zero confidence on empty history', () => {
    const t = computeRecoveryTrend([]);
    expect(t.direction).toBe('stable');
    expect(t.confidence).toBe(0);
    expect(t.sampleCount).toBe(0);
  });

  it('classifies a consistently improving series', () => {
    const t = computeRecoveryTrend(improvingRecovery());
    expect(t.direction).toBe('improving');
    expect(t.confidence).toBeGreaterThan(0.3);
  });

  it('classifies a consistently degrading series', () => {
    const t = computeRecoveryTrend(degradingRecovery());
    expect(t.direction).toBe('degrading');
    expect(t.confidence).toBeGreaterThan(0.3);
  });

  it('classifies a steady healthy series as stable', () => {
    const t = computeRecoveryTrend(steadyHealthyRecovery());
    expect(t.direction).toBe('stable');
  });

  it('resists a single outlier', () => {
    const history: RecoverySample[] = [
      { date: '2026-04-01', score: 80 },
      { date: '2026-04-02', score: 81 },
      { date: '2026-04-03', score: 79 },
      { date: '2026-04-04', score: 45 }, // outlier
      { date: '2026-04-05', score: 80 },
      { date: '2026-04-06', score: 82 },
      { date: '2026-04-07', score: 80 },
    ];
    const t = computeRecoveryTrend(history);
    expect(t.direction).toBe('stable');
  });
});

// ---------------------------------------------------------------------------
// Performance delta
// ---------------------------------------------------------------------------

describe('computePerformanceDelta', () => {
  const baseWorkouts: CompletedWorkout[] = [
    { day: 'Saturday', durationMinutes: 180, intensityScore: 6, loadScore: 150, sessionType: 'Long Run' },
    { day: 'Sunday', durationMinutes: 120, intensityScore: 5, loadScore: 100, sessionType: 'Long Run' },
  ];

  it("returns 'on' signal with null deltas when no prescription is supplied", () => {
    const d = computePerformanceDelta({ completed: baseWorkouts });
    expect(d.volumeDelta).toBeNull();
    expect(d.intensityDelta).toBeNull();
    expect(d.signal).toBe('on');
  });

  it("returns 'over' when completed volume exceeds prescribed by > 8%", () => {
    const d = computePerformanceDelta({
      prescribed: { volumeTarget: 250 }, // completed = 300 → +20%
      completed: baseWorkouts,
    });
    expect(d.volumeDelta).toBeGreaterThan(0.08);
    expect(d.signal).toBe('over');
  });

  it("returns 'under' when completed volume falls short by > 8%", () => {
    const d = computePerformanceDelta({
      prescribed: { volumeTarget: 360 }, // completed = 300 → -17%
      completed: baseWorkouts,
    });
    expect(d.volumeDelta).toBeLessThan(-0.08);
    expect(d.signal).toBe('under');
  });

  it("returns 'on' when completed is within +/- 8% of prescribed", () => {
    const d = computePerformanceDelta({
      prescribed: { volumeTarget: 305 }, // completed = 300 → -1.6%
      completed: baseWorkouts,
    });
    expect(d.signal).toBe('on');
  });
});

// ---------------------------------------------------------------------------
// Worked example 1 — adapt up on healthy over-performance
// ---------------------------------------------------------------------------

describe('adaptWeeklyStructure — race-aware adapt-up (worked example 1)', () => {
  it('suggests raising next block when athlete over-performs with healthy recovery in base phase', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-02-09', // week 2 of foundation build
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 120, intensityTarget: 5 },
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.phasePosition?.raiseAllowed).toBe(true);
    expect(adapted.performanceDelta?.signal).toBe('over');
    expect(adapted.planAdaptation?.suggestion).toBe('raise');
    expect(adapted.planAdaptation?.magnitudePct ?? 0).toBeGreaterThan(0);
    expect(adapted.planAdaptation?.reason).toMatch(/raise|performance|consistently/i);
  });

  it('does NOT raise in taper even when over-performing with healthy recovery', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-07-20', // taper phase
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 120 },
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.phasePosition?.isTaper).toBe(true);
    expect(adapted.planAdaptation?.suggestion).toBe('hold');
    expect(adapted.planAdaptation?.reason).toMatch(/taper/i);
  });

  it('race week is locked — daily recommendations are forced to keep', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: overloadedWeekend, // would normally trigger downgrade
      currentDay: 'Monday',
      recoveryScore: 46,
      today: '2026-08-05',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
    });

    expect(adapted.phasePosition?.isRaceWeek).toBe(true);
    expect(adapted.recommendations[0]).toMatchObject({ day: 'Monday', action: 'keep' });
    expect(adapted.recommendations[1]).toMatchObject({ day: 'Tuesday', action: 'keep' });
    expect(adapted.planAdaptation?.suggestion).toBe('hold');
    expect(adapted.planAdaptation?.reason).toMatch(/race week/i);
  });
});

// ---------------------------------------------------------------------------
// Worked example 2 — adapt down on lagging adherence / degraded recovery
// ---------------------------------------------------------------------------

describe('adaptWeeklyStructure — race-aware adapt-down (worked example 2)', () => {
  it("suggests lowering next block when completed volume is meaningfully under prescribed", () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend, // 150 min total
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-23',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 300 }, // completed << prescribed
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.performanceDelta?.signal).toBe('under');
    expect(adapted.planAdaptation?.suggestion).toBe('lower');
    expect(adapted.planAdaptation?.reason).toMatch(/below the prescribed|recovery|overload/i);
  });

  it('defers Tuesday quality when recovery trend is degrading (no weekend overload)', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 70,
      today: '2026-03-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      recoveryHistory: degradingRecovery(),
    });

    expect(adapted.recoveryTrend?.direction).toBe('degrading');
    expect(adapted.recommendations.find((r) => r.day === 'Tuesday')).toMatchObject({
      action: 'defer-intensity',
    });
    expect(adapted.planAdaptation?.suggestion).toBe('lower');
  });

  it('keeps base + holds next block when everything is on plan and recovery is stable', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-03-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 155 }, // completed = 150 → ~-3% (on)
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.performanceDelta?.signal).toBe('on');
    expect(adapted.recommendations[0]).toMatchObject({ day: 'Monday', action: 'keep' });
    expect(adapted.recommendations[1]).toMatchObject({ day: 'Tuesday', action: 'keep' });
    expect(adapted.planAdaptation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-influence loop — Training Coach reads longevityContext
// ---------------------------------------------------------------------------

describe('adaptWeeklyStructure — longevityContext cross-influence', () => {
  const baseRaceAwareInput = () => ({
    weeklyStructure,
    completedWorkouts: manageableWeekend,
    currentDay: 'Monday' as const,
    recoveryScore: 80,
    today: '2026-03-09',
    planStartDate: '2026-02-02',
    raceDate: '2026-08-07',
    phaseBlocks: buildPhaseBlocks(),
    prescribedWeek: { volumeTarget: 120, intensityTarget: 5 },
    recoveryHistory: steadyHealthyRecovery(),
  });

  it("suppresses adapt-up when longevity recoveryPriority is 'elevated' even on healthy over-performance", () => {
    const adapted = adaptWeeklyStructure({
      ...baseRaceAwareInput(),
      longevityContext: {
        recoveryPriority: 'elevated',
        notes: 'cardiometabolic signal sustained',
      },
    });

    expect(adapted.performanceDelta?.signal).toBe('over');
    expect(adapted.phasePosition?.raiseAllowed).toBe(true);
    // Without longevityContext this would adapt up; with elevated it goes 'lower'.
    expect(adapted.planAdaptation?.suggestion).toBe('lower');
    expect(adapted.planAdaptation?.reason).toMatch(/Longevity Guru flagged recovery priority/);
  });

  it("defers Tuesday quality when longevity recoveryPriority is 'elevated' (no weekend overload, no degrading trend)", () => {
    const adapted = adaptWeeklyStructure({
      ...baseRaceAwareInput(),
      longevityContext: { recoveryPriority: 'elevated', notes: 'inflammation flag' },
    });

    const tuesday = adapted.recommendations.find((r) => r.day === 'Tuesday');
    expect(tuesday?.action).toBe('defer-intensity');
    expect(tuesday?.reason).toMatch(/Longevity Guru flagged recovery priority/);
  });

  it("does NOT change behavior when longevity recoveryPriority is 'normal'", () => {
    const adapted = adaptWeeklyStructure({
      ...baseRaceAwareInput(),
      longevityContext: { recoveryPriority: 'normal', notes: '' },
    });

    // Over-performing + healthy + manageable + non-taper → adapt up should still fire.
    expect(adapted.planAdaptation?.suggestion).toBe('raise');
    const tuesday = adapted.recommendations.find((r) => r.day === 'Tuesday');
    expect(tuesday?.action).toBe('keep');
  });

  it("does NOT change behavior when longevity recoveryPriority is 'low'", () => {
    const adapted = adaptWeeklyStructure({
      ...baseRaceAwareInput(),
      longevityContext: { recoveryPriority: 'low', notes: '' },
    });
    expect(adapted.planAdaptation?.suggestion).toBe('raise');
  });

  it('preserves existing behavior when longevityContext is absent (backward compat)', () => {
    const adapted = adaptWeeklyStructure(baseRaceAwareInput());
    expect(adapted.planAdaptation?.suggestion).toBe('raise');
  });
});


// ---------------------------------------------------------------------------
// parseMileageMidpoint helper + auto-populated prescribedWeek
// ---------------------------------------------------------------------------

import { parseMileageMidpoint } from '../lib/training-plan/adaptive-coach';

describe('parseMileageMidpoint', () => {
  it('parses a single integer', () => {
    expect(parseMileageMidpoint('65')).toBe(65);
  });
  it('parses an ASCII range as midpoint', () => {
    expect(parseMileageMidpoint('62-65')).toBe(63.5);
  });
  it('parses an en-dash range as midpoint', () => {
    expect(parseMileageMidpoint('70–72')).toBe(71);
  });
  it('strips parenthetical context like (75%)', () => {
    expect(parseMileageMidpoint('60 (75%)')).toBe(60);
  });
  it('returns null for non-numeric content', () => {
    expect(parseMileageMidpoint('Simulated vert (treadmill focus)')).toBeNull();
  });
  it('returns null for empty / undefined', () => {
    expect(parseMileageMidpoint('')).toBeNull();
    expect(parseMileageMidpoint(undefined)).toBeNull();
  });
});

describe('adaptWeeklyStructure — auto-populates prescribedWeek from phaseBlocks', () => {
  it('derives performance delta from the current weeks mileageTarget when prescribedWeek is absent', () => {
    const phaseBlocks = buildPhaseBlocks();
    // Today is 2026-02-09 (week 1 of the plan). Set every foundation week so
    // the engine reads '65' regardless of which week today lands on.
    for (const week of phaseBlocks[0].weeks) {
      week.mileageTarget = '65';
    }

    // Athlete completed roughly half the weekly minutes (65 mi * 9 min/mi = 585 min;
    // completed 280 min ≈ -52%): expect 'under' signal.
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: [
        { day: 'Saturday', durationMinutes: 180, intensityScore: 6, loadScore: 180, sessionType: 'Long' },
        { day: 'Sunday', durationMinutes: 100, intensityScore: 4, loadScore: 100, sessionType: 'Easy' },
      ],
      currentDay: 'Monday',
      recoveryScore: 78,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks,
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.performanceDelta).toBeDefined();
    expect(adapted.performanceDelta?.signal).toBe('under');
    expect(adapted.planAdaptation?.suggestion).toBe('lower');
  });

  it('caller-supplied prescribedWeek wins over auto-derivation', () => {
    const phaseBlocks = buildPhaseBlocks();
    for (const week of phaseBlocks[0].weeks) {
      week.mileageTarget = '65'; // would imply ~585 min auto-derived
    }

    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: [
        { day: 'Saturday', durationMinutes: 300, intensityScore: 6, loadScore: 300, sessionType: 'Long' },
      ],
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks,
      prescribedWeek: { volumeTarget: 120 }, // far below auto-derived; completed 300 → over
      recoveryHistory: steadyHealthyRecovery(),
    });

    expect(adapted.performanceDelta?.signal).toBe('over');
  });

  it('leaves performanceDelta undefined when mileageTarget is non-numeric', () => {
    const phaseBlocks = buildPhaseBlocks();
    // Today is 2026-02-09 (week 1 of the plan). Wipe every foundation-phase
    // week to a non-numeric value so the engine can't parse any mileageTarget.
    for (const week of phaseBlocks[0].weeks) {
      week.mileageTarget = 'Simulated vert (treadmill focus)';
    }

    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks,
    });

    expect(adapted.performanceDelta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Goal-aware coaching posture
// ---------------------------------------------------------------------------

describe('adaptWeeklyStructure — coaching posture surface', () => {
  it('defaults to balanced when no posture and no goal text is provided', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
    });
    expect(adapted.coachingPosture).toBe('balanced');
  });

  it('infers aggressive from a top-10 race goal', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      goal: 'place top 10 at the Swiss Alps 100',
    });
    expect(adapted.coachingPosture).toBe('aggressive');
  });

  it('infers conservative from a "just finish" goal', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      goal: 'just want to finish my first half marathon',
    });
    expect(adapted.coachingPosture).toBe('conservative');
  });

  it('honors an explicit coachingPosture over goal-text inference', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      goal: 'just finish',
      coachingPosture: 'aggressive',
    });
    expect(adapted.coachingPosture).toBe('aggressive');
  });
});

describe('adaptWeeklyStructure — aggressive posture relaxes adapt-up gate', () => {
  // Aggressive scenario: athlete is over-performing with healthy recovery,
  // but weekend fatigue is 'elevated' (the very behavior they're trying to
  // build). Under balanced posture this blocks adapt-up — under aggressive,
  // it should not.
  //
  // Score math (see scoreWorkout + getFatigueState in adaptive-coach.ts):
  //   Sat: 120 (load) + 180 * 0.35 (63) + 5 * 12 (60) = 243
  //   Sun: 100 (load) + 120 * 0.35 (42) + 5 * 12 (60) = 202
  //   Sum 445 + stacked bonus 90 = 535 → 'elevated' (≥ 320, < 560).
  // Bump either workout much further and we'd cross 560 into 'high', which
  // is a hard safety floor that NO posture relaxes — different test below.
  const aggressiveOverWeekend: CompletedWorkout[] = [
    { day: 'Saturday', durationMinutes: 180, intensityScore: 5, loadScore: 120, sessionType: 'Long Run' },
    { day: 'Sunday', durationMinutes: 120, intensityScore: 5, loadScore: 100, sessionType: 'Mountain Long Run' },
  ];

  it('balanced posture: elevated weekend fatigue blocks adapt-up even when over-performing', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: aggressiveOverWeekend,
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 250 }, // 300 completed vs 250 → +20% over
      recoveryHistory: steadyHealthyRecovery(),
      coachingPosture: 'balanced',
    });
    expect(adapted.coachingPosture).toBe('balanced');
    expect(adapted.fatigueState).toBe('elevated');
    expect(adapted.performanceDelta?.signal).toBe('over');
    // Balanced gate requires fatigueState === 'manageable' — so no raise.
    expect(adapted.planAdaptation).toBeUndefined();
  });

  it('aggressive posture: elevated weekend fatigue does NOT block adapt-up when over-performing', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: aggressiveOverWeekend,
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 250 },
      recoveryHistory: steadyHealthyRecovery(),
      coachingPosture: 'aggressive',
    });
    expect(adapted.coachingPosture).toBe('aggressive');
    expect(adapted.fatigueState).toBe('elevated');
    expect(adapted.planAdaptation?.suggestion).toBe('raise');
    expect(adapted.planAdaptation?.reason).toMatch(/aggressive/);
    expect(adapted.planAdaptation?.reason).toMatch(/intentional overload/);
  });

  it("aggressive posture: 'high' fatigue is STILL a hard safety floor (no raise)", () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: overloadedWeekend, // pushes fatigueState to 'high'
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 250 },
      recoveryHistory: steadyHealthyRecovery(),
      coachingPosture: 'aggressive',
    });
    expect(adapted.fatigueState).toBe('high');
    // 'high' triggers adapt-down regardless of posture.
    expect(adapted.planAdaptation?.suggestion).toBe('lower');
  });

  it('aggressive posture: lower over-threshold (5%) trips raise earlier than balanced (8%)', () => {
    // Construct a workload that's +6% over prescribed — between 5% and 8%.
    // Aggressive: over → raise. Balanced: on → no adaptation.
    const lightWeekend: CompletedWorkout[] = [
      { day: 'Saturday', durationMinutes: 159, intensityScore: 5, loadScore: 120, sessionType: 'Long Run' },
    ];
    const base = {
      weeklyStructure,
      completedWorkouts: lightWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 150 }, // 159 vs 150 → +6%
      recoveryHistory: steadyHealthyRecovery(),
    } as const;

    const balancedRun = adaptWeeklyStructure({ ...base, coachingPosture: 'balanced' });
    expect(balancedRun.performanceDelta?.signal).toBe('on'); // +6% < 8%

    const aggressiveRun = adaptWeeklyStructure({ ...base, coachingPosture: 'aggressive' });
    expect(aggressiveRun.performanceDelta?.signal).toBe('over'); // +6% > 5%
    expect(aggressiveRun.planAdaptation?.suggestion).toBe('raise');
  });

  it('aggressive posture: raise magnitude cap is higher (up to 15%) than balanced (12%)', () => {
    // Make completed volume hugely over prescribed so the overshoot * 60% formula
    // would exceed the cap, forcing the cap to bind.
    const bigOverWeekend: CompletedWorkout[] = [
      { day: 'Saturday', durationMinutes: 240, intensityScore: 5, loadScore: 120, sessionType: 'Long Run' },
    ];
    const base = {
      weeklyStructure,
      completedWorkouts: bigOverWeekend,
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 100 }, // 240 vs 100 → +140%
      recoveryHistory: steadyHealthyRecovery(),
    } as const;

    const balanced = adaptWeeklyStructure({ ...base, coachingPosture: 'balanced' });
    expect(balanced.planAdaptation?.magnitudePct).toBe(12);

    const aggressive = adaptWeeklyStructure({ ...base, coachingPosture: 'aggressive' });
    expect(aggressive.planAdaptation?.magnitudePct).toBe(15);
  });
});

describe('adaptWeeklyStructure — conservative posture prefers hold over raise', () => {
  it("conservative + over-performing + healthy recovery → 'hold' (not 'raise')", () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend,
      currentDay: 'Monday',
      recoveryScore: 82,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 120 }, // 150 vs 120 → +25%
      recoveryHistory: steadyHealthyRecovery(),
      coachingPosture: 'conservative',
    });
    expect(adapted.coachingPosture).toBe('conservative');
    expect(adapted.performanceDelta?.signal).toBe('over');
    expect(adapted.planAdaptation?.suggestion).toBe('hold');
    expect(adapted.planAdaptation?.reason).toMatch(/conservative|patience/i);
  });

  it('conservative + slight over-performance (+10%) does not trip the 12% over-threshold', () => {
    const adapted = adaptWeeklyStructure({
      weeklyStructure,
      completedWorkouts: manageableWeekend, // 150 min
      currentDay: 'Monday',
      recoveryScore: 80,
      today: '2026-02-09',
      planStartDate: '2026-02-02',
      raceDate: '2026-08-07',
      phaseBlocks: buildPhaseBlocks(),
      prescribedWeek: { volumeTarget: 136 }, // 150 vs 136 → +10% — < 12% threshold
      recoveryHistory: steadyHealthyRecovery(),
      coachingPosture: 'conservative',
    });
    expect(adapted.performanceDelta?.signal).toBe('on');
    expect(adapted.planAdaptation).toBeUndefined();
  });
});
