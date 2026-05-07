import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { importActualWorkouts } from '@/lib/training-plan/workout-ingestion';
import type { ActualWorkoutInput } from '@/lib/training-plan/types';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    userId?: string;
    workouts?: ActualWorkoutInput[];
  };

  if (!body.userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  if (!Array.isArray(body.workouts) || body.workouts.length === 0) {
    return NextResponse.json({ error: 'Missing workouts payload' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const result = await importActualWorkouts(supabase, {
    userId: body.userId,
    workouts: body.workouts,
  });

  return NextResponse.json(result);
}
