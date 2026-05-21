import { NextResponse } from 'next/server';

import { normalizeImportedWorkoutType } from '@/lib/apple-health/normalization';
import { parseAppleHealthWorkoutExport } from '@/lib/apple-health/workout-parser';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { importActualWorkouts } from '@/lib/training-plan/workout-ingestion';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get('file');

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
