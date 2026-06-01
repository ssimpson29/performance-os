import { NextResponse } from 'next/server';

import { loadAthleteContext } from '@/lib/agents/athlete-context';
import { checkSpendCeiling } from '@/lib/agents/llm-usage';
import { checkPaywallGate } from '@/lib/billing/entitlement';
import { AI_DATA_CONSENT_VERSION, checkAiConsentGate } from '@/lib/consent/ai-consent';
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

  // Paywall: the LLM coach is a premium surface (no-op unless
  // BILLING_PAYWALL_ENABLED is on).
  const paywall = await checkPaywallGate(supabase, userId);
  if (!paywall.allowed) {
    return NextResponse.json(
      { error: 'A subscription is required to use the AI coach.', upgradeRequired: true },
      { status: 402 },
    );
  }

  // Third-party-LLM data consent (no-op unless AI_REQUIRE_DATA_CONSENT is on).
  const consentGate = await checkAiConsentGate(supabase, userId);
  if (!consentGate.allowed) {
    return NextResponse.json(
      { error: 'AI data-processing consent required.', consentRequired: true, consentVersion: AI_DATA_CONSENT_VERSION },
      { status: 403 },
    );
  }

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
