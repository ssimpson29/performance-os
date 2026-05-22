import { describe, expect, it } from 'vitest';

import {
  findExistingMatch,
  isSameSession,
  workoutFamily,
  type WorkoutLike,
} from '../lib/workouts/duplicate-matching';

describe('workoutFamily', () => {
  it("maps Apple and Strava run variants to 'run'", () => {
    expect(workoutFamily('Running')).toBe('run');
    expect(workoutFamily('Outdoor Run')).toBe('run');
    expect(workoutFamily('Trail Run')).toBe('run');
    expect(workoutFamily('VirtualRun')).toBe('run');
    expect(workoutFamily('Jog')).toBe('run');
  });

  it("maps cycling variants to 'bike'", () => {
    expect(workoutFamily('Cycling')).toBe('bike');
    expect(workoutFamily('Ride')).toBe('bike');
    expect(workoutFamily('MountainBikeRide')).toBe('bike');
    expect(workoutFamily('Outdoor Bike')).toBe('bike');
  });

  it("maps walks and hikes to their own families", () => {
    expect(workoutFamily('Walking')).toBe('walk');
    expect(workoutFamily('Walk')).toBe('walk');
    expect(workoutFamily('Hike')).toBe('hike');
    expect(workoutFamily('Hiking')).toBe('hike');
  });

  it("maps strength variants to 'strength'", () => {
    expect(workoutFamily('Strength Training')).toBe('strength');
    expect(workoutFamily('WeightTraining')).toBe('strength');
    expect(workoutFamily('Workout')).toBe('strength');
  });

  it("returns 'other' for unknown or empty types", () => {
    expect(workoutFamily('Yoga')).toBe('other');
    expect(workoutFamily('')).toBe('other');
    expect(workoutFamily(undefined)).toBe('other');
    expect(workoutFamily(null)).toBe('other');
  });
});

describe('isSameSession', () => {
  const baseA: WorkoutLike = {
    startedAt: '2026-05-17T13:00:00.000Z',
    durationSeconds: 3600,
    workoutType: 'Outdoor Run',
  };

  it('matches Apple "Outdoor Run" with Strava "Run" at identical start and duration', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b)).toBe(true);
  });

  it('matches when Strava start lags Apple by 90 seconds (within default ±2 min)', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:01:30.000Z',
      durationSeconds: 3600,
      workoutType: 'Trail Run',
    };
    expect(isSameSession(baseA, b)).toBe(true);
  });

  it('does NOT match when start times are >2 minutes apart', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:03:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b)).toBe(false);
  });

  it('matches when durations are within 10% (3600s vs 3850s = 6.5%)', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3850,
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b)).toBe(true);
  });

  it('does NOT match when durations differ by more than 10% (3600s vs 4100s = 12.2%)', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 4100,
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b)).toBe(false);
  });

  it('matches when one side has no duration (time + family is enough)', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:30.000Z',
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b)).toBe(true);
  });

  it('does NOT match across families (run vs ride at the same time)', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Cycling',
    };
    expect(isSameSession(baseA, b)).toBe(false);
  });

  it("refuses to match two 'other' workouts even if time + duration align (avoid folding unknowns)", () => {
    const a: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Yoga',
    };
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Pilates',
    };
    expect(isSameSession(a, b)).toBe(false);
  });

  it('accepts custom tolerances', () => {
    const b: WorkoutLike = {
      startedAt: '2026-05-17T13:03:30.000Z',
      durationSeconds: 3600,
      workoutType: 'Run',
    };
    expect(isSameSession(baseA, b, { toleranceSeconds: 300 })).toBe(true);
  });
});

describe('findExistingMatch', () => {
  const existing: (WorkoutLike & { id: string; source: string })[] = [
    {
      id: 'apple-1',
      source: 'apple_watch',
      startedAt: '2026-05-17T13:00:00.000Z',
      durationSeconds: 3600,
      workoutType: 'Outdoor Run',
    },
    {
      id: 'apple-2',
      source: 'apple_watch',
      startedAt: '2026-05-18T13:00:00.000Z',
      durationSeconds: 5400,
      workoutType: 'Cycling',
    },
    {
      id: 'manual-3',
      source: 'manual',
      startedAt: '2026-05-19T13:00:00.000Z',
      durationSeconds: 1800,
      workoutType: 'Strength Training',
    },
  ];

  it('returns the Apple run row when given a Strava run at the same time', () => {
    const match = findExistingMatch(
      {
        startedAt: '2026-05-17T13:00:45.000Z',
        durationSeconds: 3590,
        workoutType: 'Run',
      },
      existing,
    );
    expect(match?.id).toBe('apple-1');
  });

  it("returns null when the candidate doesn't match any existing row", () => {
    const match = findExistingMatch(
      {
        startedAt: '2026-05-20T13:00:00.000Z',
        durationSeconds: 3600,
        workoutType: 'Run',
      },
      existing,
    );
    expect(match).toBeNull();
  });

  it('matches the bike row, not the run row', () => {
    const match = findExistingMatch(
      {
        startedAt: '2026-05-18T13:00:30.000Z',
        durationSeconds: 5400,
        workoutType: 'Ride',
      },
      existing,
    );
    expect(match?.id).toBe('apple-2');
  });
});
