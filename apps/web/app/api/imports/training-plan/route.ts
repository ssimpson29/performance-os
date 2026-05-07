import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import { expandTrainingPlanCalendar } from '@/lib/training-plan/expansion';
import { parseTrainingPlanWorkbook } from '@/lib/training-plan/parser';
import { persistImportedTrainingPlan } from '@/lib/training-plan/persistence';
import type { CompletedWorkout } from '@/lib/training-plan/types';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const userId = String(formData.get('userId') ?? '');
  const startDate = String(formData.get('startDate') ?? '');
  const completedWorkoutsJson = String(formData.get('completedWorkouts') ?? '[]');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing workbook file' }, { status: 400 });
  }

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const completedWorkouts = JSON.parse(completedWorkoutsJson) as CompletedWorkout[];
  const parsed = parseTrainingPlanWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
  const expanded = expandTrainingPlanCalendar(parsed, {
    startDate: startDate || new Date().toISOString().slice(0, 10),
  });
  const adaptivePreview = adaptWeeklyStructure({
    weeklyStructure: parsed.weeklyStructure,
    completedWorkouts,
    currentDay: 'Monday',
  });

  const supabase = createServerSupabaseClient();
  const persisted = await persistImportedTrainingPlan(supabase, parsed, {
    userId,
    startDate: startDate || undefined,
  });

  return NextResponse.json({
    parsedSummary: {
      planName: parsed.planName,
      weeklyStructureCount: parsed.weeklyStructure.length,
      phaseBlockCount: parsed.phaseBlocks.length,
      supportTemplateCount: parsed.supportTemplates.length,
      expandedWeekCount: expanded.totalWeeks,
      expandedSessionCount: expanded.sessions.length,
    },
    adaptivePreview,
    persisted,
  });
}
