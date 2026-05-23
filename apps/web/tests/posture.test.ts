import { describe, expect, it } from 'vitest';

import { inferCoachingPosture, resolveCoachingPosture } from '../lib/training-plan/posture';

describe('inferCoachingPosture', () => {
  it('returns "balanced" when goal text is missing', () => {
    expect(inferCoachingPosture(null)).toBe('balanced');
    expect(inferCoachingPosture(undefined)).toBe('balanced');
    expect(inferCoachingPosture('')).toBe('balanced');
    expect(inferCoachingPosture('   ')).toBe('balanced');
  });

  it.each([
    ['place top 10 in the Swiss Alps 100', 'aggressive'],
    ['Top-15 finish at Western States', 'aggressive'],
    ['podium at the regional 50k', 'aggressive'],
    ['Win the master’s division', 'aggressive'],
    ['PR my marathon', 'aggressive'],
    ['Personal best at Boston', 'aggressive'],
    ['Sub-3 marathon', 'aggressive'],
    ['Run faster than last year', 'aggressive'],
    ['Compete with the front pack', 'aggressive'],
    ['Qualifying for Boston', 'aggressive'],
  ])('classifies %j as aggressive', (goal, expected) => {
    expect(inferCoachingPosture(goal)).toBe(expected);
  });

  it.each([
    ['Finish my first 100-mile race', 'conservative'],
    ['Just want to complete the half marathon', 'conservative'],
    ['First marathon, gentle build', 'conservative'],
    ['Experience the trail, not race it', 'conservative'],
    ['Fun run with friends', 'conservative'],
    ['Survive the climb', 'conservative'],
  ])('classifies %j as conservative', (goal, expected) => {
    expect(inferCoachingPosture(goal)).toBe(expected);
  });

  it('classifies plain goals with no posture markers as balanced', () => {
    expect(inferCoachingPosture('Run the Swiss Alps 100 in August')).toBe('balanced');
    expect(inferCoachingPosture('Stay healthy through the season')).toBe('balanced');
  });

  it('aggressive signals dominate over conservative ones when both match', () => {
    // "first marathon" is conservative, "PR" is aggressive — aggressive wins
    // because a PR-seeking first-timer wants competitive coaching.
    expect(inferCoachingPosture('PR my first marathon')).toBe('aggressive');
  });

  it('reads goal hints out of raceContext when top-level goal is empty', () => {
    expect(
      inferCoachingPosture(null, {
        raceName: 'Swiss Alps 100',
        raceDate: '2026-08-07',
        goal: 'place top 10',
      }),
    ).toBe('aggressive');
  });

  it('reads goal hints out of raceContext.notes too', () => {
    expect(
      inferCoachingPosture(null, {
        raceName: 'Local Half',
        raceDate: '2026-09-01',
        notes: 'just want to finish strong with my friend',
      }),
    ).toBe('conservative');
  });
});

describe('resolveCoachingPosture', () => {
  it('honors an explicit posture override', () => {
    expect(resolveCoachingPosture({ explicit: 'aggressive', goal: 'just finish' })).toBe('aggressive');
    expect(resolveCoachingPosture({ explicit: 'conservative', goal: 'win it' })).toBe('conservative');
    expect(resolveCoachingPosture({ explicit: 'balanced', goal: 'place top 10' })).toBe('balanced');
  });

  it('falls back to inference when explicit is null / undefined / invalid', () => {
    expect(resolveCoachingPosture({ explicit: null, goal: 'place top 10' })).toBe('aggressive');
    expect(resolveCoachingPosture({ explicit: undefined, goal: 'just finish' })).toBe('conservative');
    // @ts-expect-error — intentionally pass an invalid value to test the guard.
    expect(resolveCoachingPosture({ explicit: 'middling', goal: 'win' })).toBe('aggressive');
  });
});
