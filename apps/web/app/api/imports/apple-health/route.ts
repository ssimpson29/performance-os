import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { normalizeImportedWorkoutType } from '@/lib/apple-health/normalization';
import { parseAppleHealthWorkoutExport } from '@/lib/apple-health/workout-parser';
import { importActualWorkouts } from '@/lib/training-plan/workout-ingestion';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file');
  const userId = String(formData.get('userId') ?? '');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  const xml = await file.text();
  const parsedWorkouts = parseAppleHealthWorkoutExport(xml).map((workout) => ({
    ...workout,
    workoutType: normalizeImportedWorkoutType(workout.workoutType),
  }));

  const supabase = createServerSupabaseClient();
  const result = await importActualWorkouts(supabase, {
    userId,
    workouts: parsedWorkouts,
  });

  return NextResponse.json({
    ...result,
    parsedWorkouts: parsedWorkouts.length,
  });
}
