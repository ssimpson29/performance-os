import { describe, expect, it } from 'vitest';

import { proposeRacePlan } from '../lib/agents/plan-generator';

describe('proposeRacePlan', () => {
  it('generates a plan with foundation/build/peak/taper phases for a ~24-week build', () => {
    const result = proposeRacePlan({
      raceName: 'Swiss Alps 100',
      raceDate: '2026-08-07',
      distanceKm: 160,
      elevationGainM: 9000,
      goal: 'finish',
      planStartDate: '2026-02-22',
      currentFitness: {
        weeklyMileageKm: 60,
        longestRecentRunKm: 30,
        experienceLevel: 'experienced',
      },
    });

    expect(result.summary.totalWeeks).toBeGreaterThanOrEqual(23);
    expect(result.summary.totalWeeks).toBeLessThanOrEqual(25);

    // Standard ultra phase split: 4 phases in this order.
    const phaseNames = result.summary.phases.map((p) => p.name);
    expect(phaseNames).toEqual(['Foundation', 'Build', 'Peak', 'Taper']);

    // Build is the longest phase.
    const build = result.summary.phases.find((p) => p.name === 'Build')!;
    const foundation = result.summary.phases.find((p) => p.name === 'Foundation')!;
    expect(build.weekCount).toBeGreaterThanOrEqual(foundation.weekCount);
  });

  it('produces a ParsedTrainingPlan-shaped object that the persistence helper can consume', () => {
    const result = proposeRacePlan({
      raceName: 'Test Ultra',
      raceDate: '2026-12-01',
      distanceKm: 100,
      elevationGainM: 3000,
      planStartDate: '2026-06-01',
    });

    expect(result.plan.planName).toContain('Test Ultra');
    expect(result.plan.weeklyStructure.length).toBe(7);
    expect(result.plan.phaseBlocks.length).toBe(4);
    expect(result.plan.supportTemplates.length).toBeGreaterThan(0);
    // Each phase block has at least one week with mileage + vert targets.
    for (const block of result.plan.phaseBlocks) {
      expect(block.weeks.length).toBeGreaterThan(0);
      for (const week of block.weeks) {
        expect(week.mileageTarget).toMatch(/\d+ km/);
        expect(week.vertTarget).toMatch(/\d+ m/);
      }
    }
  });

  it('caps peak mileage against current fitness for a building athlete', () => {
    const result = proposeRacePlan({
      raceName: 'Newbie 50k',
      raceDate: '2026-12-01',
      distanceKm: 50,
      planStartDate: '2026-06-01',
      currentFitness: {
        weeklyMileageKm: 20,
        experienceLevel: 'building',
      },
    });

    // Athlete at 20km/wk shouldn't be pushed to 70km/wk peak — cap at ~1.4x.
    expect(result.summary.estimatedPeakMileageKm).toBeLessThan(50);
    expect(result.summary.estimatedPeakMileageKm).toBeGreaterThan(20);
  });

  it('inserts deload weeks (every 4th week) inside the Build phase', () => {
    const result = proposeRacePlan({
      raceName: 'Long Build Race',
      raceDate: '2027-01-01',
      distanceKm: 100,
      planStartDate: '2026-06-01',
    });
    const build = result.plan.phaseBlocks.find((b) => b.phaseName.includes('BUILD'));
    expect(build).toBeDefined();
    const deloads = build!.weeks.filter((w) => w.isDeload);
    expect(deloads.length).toBeGreaterThan(0);
    for (const dl of deloads) {
      expect(dl.keyFocus).toMatch(/Deload/i);
    }
  });

  it('embeds the race context exactly as supplied so it persists on training_plans.metadata.raceContext', () => {
    const raceArgs = {
      raceName: 'Goat Trail 100',
      raceDate: '2027-07-04',
      distanceKm: 100,
      elevationGainM: 7000,
      goal: 'sub-24',
      notes: 'point-to-point, self-supported',
    };
    const result = proposeRacePlan({ ...raceArgs, planStartDate: '2026-09-01' });
    expect(result.raceContext).toEqual(raceArgs);
  });

  it('handles short build (taper-only) without crashing', () => {
    // Race in 2 weeks → Build + Taper only. distributePhases drops zero-week
    // phases, so phaseBlocks may be < 4 for very short builds — that's fine.
    const result = proposeRacePlan({
      raceName: 'Last-Minute 10k',
      raceDate: '2026-06-15',
      distanceKm: 10,
      planStartDate: '2026-06-01',
    });
    expect(result.summary.totalWeeks).toBeLessThanOrEqual(3);
    expect(result.plan.phaseBlocks.length).toBeGreaterThan(0);
    expect(result.plan.phaseBlocks.length).toBeLessThanOrEqual(4);
    // The Taper phase is always represented for an upcoming race.
    expect(result.plan.phaseBlocks.some((b) => b.phaseName.includes('TAPER'))).toBe(true);
  });
});
