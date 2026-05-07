import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { expandTrainingPlanCalendar } from '../lib/training-plan/expansion';
import { parseTrainingPlanWorkbook } from '../lib/training-plan/parser';

const fixturePath = join(process.cwd(), 'tests/fixtures/Swiss Alps 100.xlsx');
const fixture = readFileSync(fixturePath);

describe('expandTrainingPlanCalendar', () => {
  it('expands the imported workbook into dated sessions across all phase weeks', () => {
    const parsed = parseTrainingPlanWorkbook(fixture, 'Swiss Alps 100.xlsx');
    const expanded = expandTrainingPlanCalendar(parsed, { startDate: '2026-02-02' });

    expect(expanded.planStartDate).toBe('2026-02-02');
    expect(expanded.totalWeeks).toBe(24);
    expect(expanded.sessions).toHaveLength(168);

    expect(expanded.sessions[0]).toMatchObject({
      sessionDate: '2026-02-02',
      day: 'Monday',
      title: 'Aerobic Run',
      phaseName: 'PHASE 1: FOUNDATION BUILD (Weeks 1–6)',
      weekLabel: '1',
      isDeload: false,
    });

    expect(expanded.sessions[5]).toMatchObject({
      sessionDate: '2026-02-07',
      day: 'Saturday',
      title: 'Long Run',
      weeklyFocus: '3h / 2k ft',
      fuelTarget: '60g/hr',
    });

    const deloadMonday = expanded.sessions.find(
      (session) => session.sessionDate === '2026-02-23' && session.day === 'Monday',
    );
    expect(deloadMonday).toMatchObject({
      weekLabel: '4 (Deload)',
      isDeload: true,
      phaseName: 'PHASE 1: FOUNDATION BUILD (Weeks 1–6)',
    });

    const finalWeekFriday = expanded.sessions.find(
      (session) => session.sessionDate === '2026-07-17' && session.day === 'Friday',
    );
    expect(finalWeekFriday).toMatchObject({
      weekLabel: '24 (Race Week)',
      phaseName: 'PHASE 4: TAPER (Weeks 20–22)',
    });
  });
});
