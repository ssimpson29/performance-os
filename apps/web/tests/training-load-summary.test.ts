import { describe, expect, it } from 'vitest';

import {
  formatTrainingLoadSummary,
  summarizeTrainingLoad,
} from '../lib/training-plan/training-load-summary';
import type { CompletedWorkout } from '../lib/training-plan/types';

function workout(partial: Partial<CompletedWorkout>): CompletedWorkout {
  return { day: 'Mon', durationMinutes: 60, intensityScore: 5, loadScore: 80, sessionType: 'Aerobic Run', ...partial };
}

describe('summarizeTrainingLoad', () => {
  it('aggregates totals, hard sessions, longest, and distinct days', () => {
    const s = summarizeTrainingLoad([
      workout({ localDate: '2026-05-24', durationMinutes: 180, distanceMeters: 32000, elevationGainM: 1400, energyKcal: 2600, perceivedExertion: 6, loadScore: 240 }),
      workout({ localDate: '2026-05-25', durationMinutes: 40, distanceMeters: 6000, elevationGainM: 60, energyKcal: 400, perceivedExertion: 2, loadScore: 50 }),
      workout({ localDate: '2026-05-27', durationMinutes: 70, distanceMeters: 14000, elevationGainM: 200, energyKcal: 1000, intensityScore: 8, loadScore: 160 }),
    ]);
    expect(s).toEqual({
      totalSessions: 3,
      totalDurationMinutes: 290,
      totalDistanceMeters: 52000,
      totalElevationGainM: 1660,
      totalEnergyKcal: 4000,
      totalLoadScore: 450,
      hardSessions: 1,
      longestSessionMinutes: 180,
      daysTrained: 3,
    });
  });

  it('counts two sessions on the same day as one trained day', () => {
    const s = summarizeTrainingLoad([
      workout({ localDate: '2026-05-24', durationMinutes: 60 }),
      workout({ localDate: '2026-05-24', durationMinutes: 30 }),
    ]);
    expect(s.totalSessions).toBe(2);
    expect(s.daysTrained).toBe(1);
  });

  it('reports null kcal when no session recorded energy', () => {
    const s = summarizeTrainingLoad([workout({ localDate: '2026-05-24' })]);
    expect(s.totalEnergyKcal).toBeNull();
  });

  it('zeroes everything for no workouts', () => {
    const s = summarizeTrainingLoad([]);
    expect(s).toMatchObject({ totalSessions: 0, totalDurationMinutes: 0, daysTrained: 0, totalEnergyKcal: null });
  });
});

describe('formatTrainingLoadSummary', () => {
  it('renders a compact one-liner with the lookback window', () => {
    const s = summarizeTrainingLoad([
      workout({ localDate: '2026-05-24', durationMinutes: 180, distanceMeters: 32000, elevationGainM: 1400, energyKcal: 2600, intensityScore: 8 }),
    ]);
    const line = formatTrainingLoadSummary(s, 14);
    expect(line).toContain('last 14 days');
    expect(line).toContain('1 sessions across 1 days');
    expect(line).toContain('32.0 km');
    expect(line).toContain('1400 m vert');
    expect(line).toContain('~2600 kcal');
    expect(line).toContain('1 hard session');
  });

  it('says none logged when empty', () => {
    expect(formatTrainingLoadSummary(summarizeTrainingLoad([]), 14)).toBe('Recent training (last 14 days): none logged.');
  });
});
