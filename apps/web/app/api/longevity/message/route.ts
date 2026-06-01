import { NextResponse } from 'next/server';

import { loadAthleteContext } from '@/lib/agents/athlete-context';
import {
  persistLongevityChatRun,
  runLongevityChat,
} from '@/lib/agents/longevity-chat';
import { checkSpendCeiling } from '@/lib/agents/llm-usage';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/longevity/message
 *
 * Conversational Longevity Guru endpoint. Auth-scoped, rate-limited.
 * Body: { message: string }.
 *
 * Mirrors /api/coach/message — loads the full athlete context, runs
 * the multi-turn agent loop, persists the conversation to
 * daily_summaries.summary.longevityConversation.
 *
 * The single-shot /api/longevity/evaluate endpoint stays unchanged.
 * Use this one for "ask the guru a question," that one for
 * "re-evaluate my labs."
 */
export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rate = checkRateLimit({
    key: `longevity-message:${userId}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many guru messages. Try again shortly.', retryAfterMs: rate.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { message?: string } | null;
  const athleteMessage = (body?.message ?? '').trim();

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  // Daily spend ceiling (no-op unless AI_COACH_DAILY_USD_CEILING is set).
  const ceiling = await checkSpendCeiling(supabase, userId);
  if (!ceiling.allowed) {
    return NextResponse.json(
      {
        error: `Daily AI limit reached ($${ceiling.ceilingUsd?.toFixed(2)}). Resets at UTC midnight.`,
        spentUsd: Number(ceiling.spentUsd.toFixed(4)),
      },
      { status: 429 },
    );
  }

  let athleteContext;
  try {
    athleteContext = await loadAthleteContext(supabase, userId, { today });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load athlete context';
    console.error('[longevity/message] loadAthleteContext threw:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const output = await runLongevityChat({
    today,
    athleteMessage,
    athleteContext,
    supabase,
  });

  try {
    await persistLongevityChatRun(supabase, { userId, today, output });
  } catch (err) {
    // Persistence failure shouldn't drop the reply — the athlete still
    // sees the message in the response. Log and surface as a warning.
    console.error('[longevity/message] persistLongevityChatRun failed:', err);
  }

  return NextResponse.json({
    message: output.message,
    conversation: output.conversation,
    soulUpdated: output.soulUpdated,
    llmInvoked: output.llmInvoked,
    toolTrace: output.toolTrace,
  });
}
