import { NextResponse } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { importActualWorkouts } from '@/lib/training-plan/workout-ingestion';
import type { ActualWorkoutInput } from '@/lib/training-plan/types';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    workouts?: ActualWorkoutInput[];
  };

  if (!Array.isArray(body.workouts) || body.workouts.length === 0) {
    return NextResponse.json({ error: 'Missing workouts payload' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const result = await importActualWorkouts(supabase, {
    userId,
    workouts: body.workouts,
  });

  return NextResponse.json(result);
}
