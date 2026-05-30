import { describe, expect, it } from 'vitest';

import {
  createSoulUpdatedRef,
  executeLongevityTool,
  LONGEVITY_TOOL_DEFINITIONS,
} from '../lib/agents/longevity-tools';
import type { AthleteContext } from '../lib/agents/athlete-context';
import type { CompletedWorkout } from '../lib/training-plan/types';

function workout(partial: Partial<CompletedWorkout>): CompletedWorkout {
  return {
    day: 'Mon',
    durationMinutes: 60,
    intensityScore: 5,
    loadScore: 80,
    sessionType: 'Aerobic Run',
    ...partial,
  };
}

function makeCtx(workouts: CompletedWorkout[]): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-29',
    profile: null,
    currentPlan: null,
    recentWorkouts: workouts,
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    longevityConversation: [],
    trainingSoul: null,
    longevitySoul: null,
  } as unknown as AthleteContext;
}

const ctxArgs = (ctx: AthleteContext) => ({ ctx, supabase: {} as never, soulUpdatedRef: createSoulUpdatedRef() });

describe('longevity getRecentWorkouts tool', () => {
  it('is registered in the longevity tool definitions', () => {
    const names = LONGEVITY_TOOL_DEFINITIONS.map((d) => d.function.name);
    expect(names).toContain('getRecentWorkouts');
  });

  it('returns each session plus an aggregate training-load summary', async () => {
    const ctx = makeCtx([
      workout({ localDate: '2026-05-24', sessionType: 'Long Run', durationMinutes: 180, distanceMeters: 32000, elevationGainM: 1400, energyKcal: 2600, perceivedExertion: 6, loadScore: 240 }),
      workout({ localDate: '2026-05-25', sessionType: 'Recovery', durationMinutes: 40, distanceMeters: 6000, elevationGainM: 60, energyKcal: 400, perceivedExertion: 2, loadScore: 50 }),
      workout({ localDate: '2026-05-27', sessionType: 'Quality', durationMinutes: 70, distanceMeters: 14000, elevationGainM: 200, energyKcal: 1000, perceivedExertion: 8, intensityScore: 8, loadScore: 160 }),
    ]);

    const raw = await executeLongevityTool('getRecentWorkouts', '{}', ctxArgs(ctx));
    const parsed = JSON.parse(raw);

    expect(parsed.count).toBe(3);
    expect(parsed.workouts).toHaveLength(3);
    expect(parsed.summary).toMatchObject({
      totalSessions: 3,
      totalDurationMinutes: 290,
      totalDistanceMeters: 52000,
      totalElevationGainM: 1660,
      totalEnergyKcal: 4000,
      hardSessions: 1, // only the PE-8 / intensity-8 quality session
      longestSessionMinutes: 180,
      daysTrained: 3,
    });
    // Per-session fields useful for fueling/recovery are surfaced.
    const long = parsed.workouts.find((w: { sessionType: string }) => w.sessionType === 'Long Run');
    expect(long.energyKcal).toBe(2600);
    expect(long.elevationGainM).toBe(1400);
  });

  it('handles no workouts with a zeroed summary (null kcal)', async () => {
    const raw = await executeLongevityTool('getRecentWorkouts', '{}', ctxArgs(makeCtx([])));
    const parsed = JSON.parse(raw);
    expect(parsed.count).toBe(0);
    expect(parsed.summary.totalSessions).toBe(0);
    expect(parsed.summary.totalEnergyKcal).toBeNull();
    expect(parsed.summary.daysTrained).toBe(0);
  });
});
