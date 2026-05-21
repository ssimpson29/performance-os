import type { SupabaseClient } from '@supabase/supabase-js';

import { expandTrainingPlanCalendar } from './expansion';
import type { ParsedTrainingPlan, RaceContext } from './types';

export type PersistImportedTrainingPlanOptions = {
  userId?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  raceContext?: RaceContext;
};

export async function persistImportedTrainingPlan(
  supabase: SupabaseClient,
  parsed: ParsedTrainingPlan,
  options?: PersistImportedTrainingPlanOptions,
) {
  if (!options?.userId) {
    throw new Error('userId is required to persist a training plan import.');
  }

  // Race context can be supplied directly via options.raceContext, with
  // top-level endDate/goal options taking precedence when provided. Keep
  // metadata.raceContext absent when no race context is supplied so the
  // persisted blob stays minimal for non-race imports.
  const resolvedEndDate = options.endDate ?? options.raceContext?.raceDate ?? null;
  const resolvedGoal = options.goal ?? options.raceContext?.goal ?? null;

  const metadata: Record<string, unknown> = {
    sourceFileName: parsed.sourceFileName,
    sheetNames: parsed.sheetNames,
    weeklyStructure: parsed.weeklyStructure,
    phaseBlocks: parsed.phaseBlocks,
    supportTemplates: parsed.supportTemplates,
  };

  if (options.raceContext) {
    metadata.raceContext = options.raceContext;
  }

  const { data: plan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      user_id: options.userId,
      name: parsed.planName,
      source: 'xlsx-import',
      description: `Imported from ${parsed.sourceFileName}`,
      start_date: options.startDate ?? null,
      end_date: resolvedEndDate,
      goal: resolvedGoal,
      metadata,
    })
    .select('id')
    .single();

  if (planError || !plan) {
    throw new Error(planError?.message ?? 'Failed to create training plan');
  }

  const expanded = expandTrainingPlanCalendar(parsed, {
    startDate: options.startDate ?? new Date().toISOString().slice(0, 10),
  });

  const sessionRows = expanded.sessions.map((session) => ({
    training_plan_id: plan.id,
    user_id: options.userId,
    session_date: session.sessionDate,
    title: session.title,
    discipline: session.title,
    objective: session.details,
    notes: session.weekNotes || session.exactWork,
    recurrence_key: `${session.weekIndex}:${session.day}`,
    metadata: {
      phaseName: session.phaseName,
      weekLabel: session.weekLabel,
      weekIndex: String(session.weekIndex),
      isDeload: String(session.isDeload),
      weeklyFocus: session.weeklyFocus ?? '',
      fuelTarget: session.fuelTarget ?? '',
      strengthMobility: session.strengthMobility,
      exactWork: session.exactWork,
      ...session.metadata,
    },
  }));

  const { error: sessionsError } = await supabase.from('planned_sessions').insert(sessionRows);
  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  return {
    planId: plan.id,
    importedSessions: sessionRows.length,
    totalWeeks: expanded.totalWeeks,
  };
}
