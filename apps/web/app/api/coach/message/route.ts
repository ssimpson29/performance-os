import { NextResponse } from 'next/server';

import { loadAdaptiveCoachContext } from '@/app/plan/coach-data';
import { checkRateLimit } from '@/lib/rate-limit';
import { runTrainingCoach } from '@/lib/agents/training-coach';
import { loadTrainingCoachState, persistTrainingCoachRun } from '@/lib/agents/training-coach-persistence';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { adaptWeeklyStructure } from '@/lib/training-plan/adaptive-coach';

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rate = checkRateLimit({ key: `coach-message:${userId}`, limit: 10, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many coach messages. Try again shortly.', retryAfterMs: rate.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const athleteMessage = (body?.message ?? '').trim();

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  let coachInput;
  try {
    coachInput = await loadAdaptiveCoachContext(supabase, userId, { today });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load coach context';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const adaptive = adaptWeeklyStructure(coachInput);
  const state = await loadTrainingCoachState(supabase, { userId, today });

  const output = await runTrainingCoach({
    today,
    athleteMessage,
    adaptive,
    conversation: state.conversation,
    followUp: state.followUp,
  });

  const persisted = await persistTrainingCoachRun(supabase, { userId, today, output });

  return NextResponse.json({
    message: output.message,
    recommendations: output.recommendations,
    cautions: output.cautions,
    rationale: output.rationale,
    followUp: output.followUp,
    injurySignal: output.injurySignal,
    recoverySignal: output.recoverySignal,
    llmInvoked: output.llmInvoked,
    persisted,
  });
}
