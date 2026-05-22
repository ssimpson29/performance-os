import { NextResponse } from 'next/server';

import { loadAthleteContext } from '@/lib/agents/athlete-context';
import { runTrainingCoach } from '@/lib/agents/training-coach';
import { persistTrainingCoachRun } from '@/lib/agents/training-coach-persistence';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/coach/message
 *
 * Auth-scoped LLM-agent coach endpoint. The agent loads the athlete's full
 * context (workouts, plan-or-null, injury history, biomarkers, recovery,
 * follow-up state, recent conversation), then runs a tool-calling agent
 * loop that can:
 *   - inspect any slice of the context,
 *   - run the deterministic adaptive engine when a plan exists,
 *   - propose and commit a new training plan when the athlete doesn't have
 *     one and mentions a race.
 *
 * Unlike the previous route, this does NOT throw when the athlete has no
 * plan — the no-plan branch is part of normal agent behavior.
 */
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

  let athleteContext;
  try {
    athleteContext = await loadAthleteContext(supabase, userId, { today });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load athlete context';
    console.error('[coach/message] loadAthleteContext threw:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const output = await runTrainingCoach({
    today,
    athleteMessage,
    athleteContext,
    supabase,
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
    /** Tool-call trace (debugging aid). UI can ignore. */
    toolTrace: output.toolTrace,
    /** True when the agent committed a new plan during this turn. */
    planCommitted: output.planCommitted,
    persisted,
  });
}
