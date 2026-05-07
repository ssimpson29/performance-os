import { describe, expect, it } from 'vitest';

import { adaptWeeklyStructure } from '../lib/training-plan/adaptive-coach';
import type { CompletedWorkout, WeeklyStructureSession } from '../lib/training-plan/types';

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

describe('adaptWeeklyStructure', () => {
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
      completedWorkouts: [
        { day: 'Saturday', durationMinutes: 150, intensityScore: 6, loadScore: 120, sessionType: 'Long Run' },
      ],
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
