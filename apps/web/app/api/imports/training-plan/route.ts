import { NextResponse } from 'next/server';

import { loadAdaptiveCoachContext } from '@/app/plan/coach-data';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';
import { expandTrainingPlanCalendar } from '@/lib/training-plan/expansion';
import { parseTrainingPlanWorkbook } from '@/lib/training-plan/parser';
import { persistImportedTrainingPlan } from '@/lib/training-plan/persistence';
import type { RaceContext } from '@/lib/training-plan/types';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  const startDate = String(formData.get('startDate') ?? '');
  const raceContextRaw = String(formData.get('raceContext') ?? '');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing workbook file' }, { status: 400 });
  }

  const parsed = parseTrainingPlanWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
  const today = new Date().toISOString().slice(0, 10);
  const effectiveStartDate = startDate || today;

  const expanded = expandTrainingPlanCalendar(parsed, { startDate: effectiveStartDate });

  // Optional RaceContext from the form (JSON). Used for end_date/goal
  // resolution in persistence and as input to the race-aware coach.
  let raceContext: RaceContext | undefined;
  if (raceContextRaw) {
    try {
      raceContext = JSON.parse(raceContextRaw) as RaceContext;
    } catch {
      return NextResponse.json({ error: 'Invalid raceContext JSON' }, { status: 400 });
    }
  }

  const supabase = createServerSupabaseClient();

  // Build the race-aware coach input from athlete data, using the just-parsed
  // plan as the planOverride (it hasn't been persisted yet).
  const coachInput = await loadAdaptiveCoachContext(supabase, userId, {
    today,
    planOverride: {
      planId: 'pending-import',
      planStartDate: effectiveStartDate,
      raceDate: raceContext?.raceDate ?? null,
      goal: raceContext?.goal ?? null,
      weeklyStructure: parsed.weeklyStructure,
      phaseBlocks: parsed.phaseBlocks,
      raceContext,
    },
  });

  const adaptivePreview = adaptWeeklyStructure(coachInput);

  const persisted = await persistImportedTrainingPlan(supabase, parsed, {
    userId,
    startDate: startDate || undefined,
    endDate: raceContext?.raceDate,
    goal: raceContext?.goal,
    raceContext,
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
