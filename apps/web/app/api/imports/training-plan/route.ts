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
  try {
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

    // Parse the workbook. The parser is strict about sheet names, so surface
    // the specific failure rather than letting it bubble up as a 500 with an
    // empty body (which becomes 'Unexpected end of JSON input' on the client).
    let parsed;
    try {
      parsed = parseTrainingPlanWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse workbook';
      return NextResponse.json(
        {
          error:
            `Workbook parse failed: ${message}. The parser expects sheets named ` +
            `'Weekly Schedule', 'Daily', 'Strength Days', 'Speed Warmup' — verify your file matches.`,
        },
        { status: 400 },
      );
    }

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
        supportTemplates: parsed.supportTemplates,
        raceContext,
      },
    });

    const adaptivePreview = adaptWeeklyStructure(coachInput);

    // Always persist a non-null start_date so the race-aware adaptive engine
    // can compute phase position. The expansion above already fell back to
    // `today` when the form didn't carry one — use the same value here so
    // the persisted plan row and the expanded sessions agree on week 1.
    const persisted = await persistImportedTrainingPlan(supabase, parsed, {
      userId,
      startDate: effectiveStartDate,
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
  } catch (err) {
    // Final safety net: any unhandled exception (DB error, env issue, anything)
    // surfaces a clear server-error JSON instead of an empty 500 body. The
    // client sees a real error message rather than 'Unexpected end of JSON input'.
    console.error('POST /api/imports/training-plan failed:', err);
    const message = err instanceof Error ? err.message : 'Import failed';
    return NextResponse.json({ error: `Server error: ${message}` }, { status: 500 });
  }
}
