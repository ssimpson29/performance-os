import { NextResponse } from 'next/server';

import { normalizeImportedWorkoutType } from '@/lib/apple-health/normalization';
import { verifyAppleHealthPushSignature } from '@/lib/apple-health/automation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { importActualWorkouts } from '@/lib/training-plan/workout-ingestion';
import type { ActualWorkoutInput } from '@/lib/training-plan/types';

type ShortcutWorkoutPayload = Partial<ActualWorkoutInput> & {
  workoutType?: string;
  startedAt?: string;
};

function toAppleHealthWorkoutPayload(workout: ShortcutWorkoutPayload): ActualWorkoutInput {
  return {
    source: 'apple_health',
    externalId: workout.externalId,
    workoutType: normalizeImportedWorkoutType(String(workout.workoutType ?? 'Workout')),
    startedAt: String(workout.startedAt),
    endedAt: workout.endedAt,
    localDate: workout.localDate,
    durationSeconds: workout.durationSeconds,
    distanceMeters: workout.distanceMeters,
    energyKcal: workout.energyKcal,
    avgHeartRate: workout.avgHeartRate,
    maxHeartRate: workout.maxHeartRate,
    avgPowerWatts: workout.avgPowerWatts,
    avgCadence: workout.avgCadence,
    perceivedExertion: workout.perceivedExertion,
    metadata: {
      ...(workout.metadata ?? {}),
      ingestMode: 'shortcut_push',
    },
    rawPayload: (workout.rawPayload as Record<string, unknown> | undefined) ?? (workout as Record<string, unknown>),
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') ?? '';
  const signature = url.searchParams.get('signature') ?? '';

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  if (!verifyAppleHealthPushSignature(userId, signature)) {
    return NextResponse.json({ error: 'Invalid Apple Health push signature' }, { status: 401 });
  }

  const body = (await request.json()) as { workouts?: ShortcutWorkoutPayload[] };

  if (!Array.isArray(body.workouts) || body.workouts.length === 0) {
    return NextResponse.json({ error: 'Missing workouts' }, { status: 400 });
  }

  const workouts = body.workouts.map(toAppleHealthWorkoutPayload);

  if (workouts.some((workout) => !workout.startedAt || !workout.workoutType)) {
    return NextResponse.json({ error: 'Each workout requires startedAt and workoutType' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const result = await importActualWorkouts(supabase, {
    userId,
    workouts,
  });

  return NextResponse.json({
    ...result,
    acceptedWorkouts: workouts.length,
    mode: 'shortcut_push',
  });
}
