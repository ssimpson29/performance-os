import type { ExpandedTrainingPlanCalendar, ExpandedTrainingSession, ParsedTrainingPlan, PhaseWeekTarget, WeeklyStructureSession } from './types';

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function getWeekStart(startDate: string): Date {
  const base = new Date(`${startDate}T00:00:00Z`);
  const weekday = base.getUTCDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function sessionDateFor(weekStart: Date, weekIndex: number, day: string): string {
  const offset = Math.max(0, DAY_ORDER.indexOf(day as (typeof DAY_ORDER)[number]));
  const date = new Date(weekStart);
  date.setUTCDate(weekStart.getUTCDate() + weekIndex * 7 + offset);
  return date.toISOString().slice(0, 10);
}

function getWeeklyFocus(day: string, week: PhaseWeekTarget): string {
  if (day === 'Saturday') return week.saturdayTarget ?? '';
  if (day === 'Sunday') return week.sundayTarget ?? '';
  if (day === 'Thursday') return week.thursdayTarget ?? '';
  return '';
}

function buildSession(
  weeklySession: WeeklyStructureSession,
  phaseName: string,
  week: PhaseWeekTarget,
  weekIndex: number,
  weekStart: Date,
): ExpandedTrainingSession {
  return {
    sessionDate: sessionDateFor(weekStart, weekIndex, weeklySession.day),
    phaseName,
    weekLabel: week.weekLabel,
    weekIndex: weekIndex + 1,
    day: weeklySession.day,
    title: weeklySession.runSession,
    details: weeklySession.details,
    strengthMobility: weeklySession.strengthMobility,
    exactWork: weeklySession.exactWork,
    weeklyFocus: getWeeklyFocus(weeklySession.day, week),
    fuelTarget: week.fuelTarget,
    weekNotes: week.notes,
    isDeload: week.isDeload,
    metadata: {
      mileageTarget: week.mileageTarget,
      vertTarget: week.vertTarget,
      saturdayTarget: week.saturdayTarget ?? '',
      sundayTarget: week.sundayTarget ?? '',
      thursdayTarget: week.thursdayTarget ?? '',
      keyFocus: week.keyFocus ?? '',
      strengthMobility: weeklySession.strengthMobility,
      exactWork: weeklySession.exactWork,
    },
  };
}

export function expandTrainingPlanCalendar(
  parsed: ParsedTrainingPlan,
  options: { startDate: string },
): ExpandedTrainingPlanCalendar {
  const weekStart = getWeekStart(options.startDate);
  const allWeeks = parsed.phaseBlocks.flatMap((phaseBlock) =>
    phaseBlock.weeks.map((week) => ({ phaseName: phaseBlock.phaseName, week })),
  );

  const sessions = allWeeks.flatMap(({ phaseName, week }, weekIndex) =>
    parsed.weeklyStructure.map((weeklySession) => buildSession(weeklySession, phaseName, week, weekIndex, weekStart)),
  );

  return {
    planStartDate: weekStart.toISOString().slice(0, 10),
    totalWeeks: allWeeks.length,
    sessions,
  };
}
