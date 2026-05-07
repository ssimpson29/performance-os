import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseTrainingPlanWorkbook } from '../lib/training-plan/parser';

const fixturePath = join(process.cwd(), 'tests/fixtures/Swiss Alps 100.xlsx');
const fixture = readFileSync(fixturePath);

describe('parseTrainingPlanWorkbook', () => {
  it('parses the Swiss Alps workbook into normalized structures', () => {
    const parsed = parseTrainingPlanWorkbook(fixture, 'Swiss Alps 100.xlsx');

    expect(parsed.planName).toBe('Swiss Alps 100');
    expect(parsed.sheetNames).toEqual(['Weekly Schedule', 'Daily', 'Strength Days', 'Speed Warmup']);
    expect(parsed.weeklyStructure).toHaveLength(7);
    expect(parsed.weeklyStructure.map((session) => session.day)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);

    expect(parsed.weeklyStructure[0]).toMatchObject({
      day: 'Monday',
      runSession: 'Aerobic Run',
      strengthMobility: 'Lift A (Posterior Chain)',
    });

    expect(parsed.phaseBlocks.map((block) => block.phaseName)).toEqual([
      'PHASE 1: FOUNDATION BUILD (Weeks 1–6)',
      'PHASE 2: SPECIFIC LOAD BUILD',
      'PHASE 3: PEAK SPECIFICITY (Weeks 15–19)',
      'PHASE 4: TAPER (Weeks 20–22)',
    ]);

    expect(parsed.phaseBlocks[0].weeks[0]).toMatchObject({
      weekLabel: '1',
      mileageTarget: '62–65',
      vertTarget: '4,500 ft',
      fuelTarget: '60g/hr',
      notes: 'Start gut training',
    });

    expect(parsed.supportTemplates.map((template) => template.name)).toEqual([
      'Daily Routine',
      'Evening Recovery Routine',
      'Optional Add-On',
      'Strength Day A',
      'Mobility',
      'Strength Day C',
      'Speed Warmup',
    ]);

    expect(parsed.supportTemplates.find((template) => template.name === 'Speed Warmup')?.items).toHaveLength(12);
  });
});
