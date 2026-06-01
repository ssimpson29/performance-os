import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveCoachingPosture, type CoachingPosture } from '@/lib/training-plan/posture';
import {
  adaptWeeklyStructure,
  computePhasePosition,
} from '@/lib/training-plan/adaptive-coach';
import type { PhasePosition, WeeklyStructureSession } from '@/lib/training-plan/types';

import { toAdaptiveCoachInput, type AthleteContext } from './athlete-context';
import {
  COACH_TOOL_DEFINITIONS,
  createProposalStore,
  executeCoachTool,
  type ToolHandlerContext,
} from './coach-tools';
import { resolveModel } from './llm-model';
import { createUsageTracker, recordLlmUsage, type RawUsage } from './llm-usage';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured workout call composed by the LLM for "today." Distinct from
 * the chat coach's free-form reply because this surface is PROACTIVE —
 * it's what the athlete sees when /coach loads, before any chat happens.
 *
 * Fields are deliberately separated so the UI can lay them out
 * consistently rather than having to parse free-form prose. The LLM
 * returns JSON matching this shape via response_format: { type:
 * 'json_object' }.
 */
export type TodaysCall = {
  /** One-line workout title — "Long Run · 32mi with LT inserts" */
  headline: string;
  /** Session type — "Long Run" / "Quality" / "Recovery" / "Rest" */
  runSession: string;
  /** Free-text details of duration + structure. */
  details: string;
  /** Exact prescription — pace targets, intervals, RPE. */
  exactWork: string;
  /** Strength + mobility instructions, or "Skip lifting today." */
  strengthMobility: string;
  /** Fuel + hydration guidance. */
  fuel: string;
  /** 1-2 sentence rationale referencing recent data + phase. */
  rationale: string;
  /**
   * "Phase 2: Specific Load Build · week 5 of 10 · 11 weeks to race"
   * — surfaces the engine's view of where the athlete is. Diagnostic
   * if it looks wrong vs. the athlete's expectation.
   */
  phaseContext: string;
  /** ISO date when this call was composed. */
  composedAt: string;
  /** Whether the LLM was invoked (false → deterministic fallback). */
  llmInvoked: boolean;
};

export type ComposeTodaysCallInput = {
  ctx: AthleteContext;
  supabase: SupabaseClient;
};

// ---------------------------------------------------------------------------
// Env + LLM call infrastructure (mirrors training-coach.ts)
// ---------------------------------------------------------------------------

type LlmEnv = { apiKey: string; model: string; baseUrl: string };

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = resolveModel('todays-call');
  const baseUrl = process.env.AI_COACH_BASE_URL;
  if (!apiKey || !model || !baseUrl) return null;
  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, '') };
}

type OpenAIChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAICompletion = {
  choices?: Array<{
    message?: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: RawUsage;
};

const MAX_ITERATIONS = 6;
const LLM_TIMEOUT_MS = 45_000;

async function callLlmChatCompletion(
  env: LlmEnv,
  messages: OpenAIChatMessage[],
): Promise<OpenAICompletion | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const endpoint = `${env.baseUrl}/v1/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        model: env.model,
        messages,
        tools: COACH_TOOL_DEFINITIONS,
        // gpt-5 / o1 / o3 only accept temperature=1.
        temperature: 1,
        // Reasoning-class models reject `max_tokens` — use the newer
        // parameter for compatibility with gpt-4o through gpt-5.
        max_completion_tokens: 1500,
        // CRITICAL: force JSON output so we can parse the TodaysCall struct.
        // The prompt also tells the LLM to emit JSON only.
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(
        `[todays-call] LLM call returned ${response.status} from ${endpoint} (model=${env.model}). Body: ${text.slice(0, 500)}`,
      );
      return null;
    }
    return (await response.json()) as OpenAICompletion;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[todays-call] LLM fetch threw ${name}: ${message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayFromIsoDate(iso: string): string {
  const parts = iso.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return DAY_NAMES[d.getUTCDay()];
}

function buildPhaseContextString(position: PhasePosition | null): string {
  if (!position || position.phaseIndex < 0) {
    return 'Phase position unknown (plan dates may be missing).';
  }
  const phaseName = position.phaseName ?? 'Unknown phase';
  const weekInPhase = position.weekIndexInPhase + 1; // 1-indexed for humans
  const raceFlag = position.isRaceWeek
    ? ' · RACE WEEK'
    : position.isTaper
    ? ' · taper'
    : '';
  return `${phaseName} · week ${weekInPhase}${raceFlag} · ${position.weeksToRace} weeks to race`;
}

function buildSystemPrompt(): string {
  return `You are composing TODAY'S EXACT WORKOUT for an endurance athlete. Not advice. Not a conversation. The specific workout they should do today, derived from their plan + their recent data.

OUTPUT FORMAT — STRICT JSON ONLY. No commentary, no markdown, no code fences. The JSON must have these exact keys:

{
  "headline": "<one-line workout title — e.g. 'Long Run · 32mi with 4×8min LT inserts'>",
  "runSession": "<session type — Long Run | Quality | Aerobic Run | Vert Run | Recovery | Rest>",
  "details": "<duration + structure in plain prose>",
  "exactWork": "<specific prescription — pace targets, intervals, RPE — be CONCRETE>",
  "strengthMobility": "<strength/mobility for today, or 'Skip lifting today.' with a reason>",
  "fuel": "<fueling / hydration guidance — grams of carbs/hr, sodium, water>",
  "rationale": "<1-2 sentences citing recent data + phase. Why THIS workout TODAY?>"
}

Rules:
- Be SPECIFIC. "Easy 60 min" is bad. "60 min Z2, target 145-155 HR avg, fueling 30g carbs and 16oz water" is good.
- Reference REAL numbers from the athlete's recent data. Look at HR drift, suffer score, RPE from the workouts tool. If recovery scores are degrading, say so in the rationale and back off.
- HONOR the phase. Build phase = build volume; Peak = quality; Taper = strip volume; Race week = lock the plan.
- HONOR the posture. Aggressive posture + good recovery → push. Conservative + recent over-performance → consolidate.
- HONOR the soul. If the athlete's training soul says "hates the treadmill" don't prescribe a treadmill session. If it says "prefers morning runs" frame accordingly.
- If there's an active injury/follow-up window, KEEP IT EASY for 3 days. Strength can stay if it doesn't aggravate.
- Use tools — getRecentWorkouts is essential, runAdaptiveEngine for the engine's read, getInjuryHistory if anything physical came up recently.
- The output IS the workout. The athlete will execute exactly what you write. Treat it that way.`;
}

function buildUserPrompt(args: {
  ctx: AthleteContext;
  todayDay: string;
  phaseContext: string;
  baseSession: WeeklyStructureSession | null;
  prescribedWeekText: string | null;
  posture: CoachingPosture;
}): string {
  const { ctx, todayDay, phaseContext, baseSession, prescribedWeekText, posture } = args;

  const lines: string[] = [];
  lines.push(`Today: ${ctx.today} (${todayDay})`);
  lines.push(`Athlete goal: ${ctx.currentPlan?.goal ?? ctx.profile?.primaryGoal ?? '(none stated)'}`);
  lines.push(`Coaching posture: ${posture}`);
  lines.push(`Phase context: ${phaseContext}`);
  if (prescribedWeekText) {
    lines.push(`Current week prescription: ${prescribedWeekText}`);
  }
  if (baseSession) {
    lines.push(
      `Today's base template (from weeklyStructure): runSession="${baseSession.runSession}" · details="${baseSession.details}" · strengthMobility="${baseSession.strengthMobility}" · exactWork="${baseSession.exactWork}"`,
    );
  } else {
    lines.push('Today has no entry in the plan template (rest day, or template gap).');
  }

  if (ctx.followUp?.status === 'active') {
    lines.push(
      `ACTIVE FOLLOW-UP WINDOW: keep easy through ${ctx.followUp.easyThroughDate}; check-in on ${ctx.followUp.checkInDate}${ctx.followUp.bodyPart ? ` (${ctx.followUp.bodyPart})` : ''}.`,
    );
  }
  if (ctx.longevityContext?.recoveryPriority === 'elevated') {
    lines.push(
      `LONGEVITY GURU FLAGGED RECOVERY PRIORITY = ELEVATED. Bias toward recovery; do not push.`,
    );
  }

  // Athlete soul context inline so the LLM doesn't have to call a tool
  // for the highest-frequency reference data.
  if (ctx.trainingSoul.content.trim()) {
    lines.push('');
    lines.push(`=== ATHLETE SOUL (training) ===`);
    lines.push(ctx.trainingSoul.content);
    lines.push(`=== END ATHLETE SOUL ===`);
  }

  // Profile basics so the LLM can scale pace targets to the athlete.
  const p = ctx.profile;
  if (p) {
    const profileBits = [
      p.dateOfBirth ? `DOB ${p.dateOfBirth}` : null,
      p.sex ?? null,
      p.heightCm != null ? `${p.heightCm}cm` : null,
      p.weightKg != null ? `${p.weightKg}kg` : null,
      p.experienceLevel ?? null,
      p.weeklyTrainingHoursBaseline != null ? `baseline ${p.weeklyTrainingHoursBaseline}h/wk` : null,
    ].filter(Boolean);
    if (profileBits.length) {
      lines.push(`Profile: ${profileBits.join(', ')}`);
    }
    if (p.healthNotes) lines.push(`Health notes: ${p.healthNotes}`);
  }

  lines.push('');
  lines.push(
    `Compose today's workout. Call getRecentWorkouts FIRST to see what the athlete actually completed in the last 7 days, then runAdaptiveEngine for the engine's read on phase/fatigue/recovery, then output JSON.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function runComposerLoop(
  env: LlmEnv,
  ctx: AthleteContext,
  toolHandlerContext: ToolHandlerContext,
): Promise<string | null> {
  // Build phase context up front so we can include it in the prompt
  // even if the LLM doesn't bother calling runAdaptiveEngine.
  const phasePosition =
    ctx.currentPlan?.raceDate && ctx.currentPlan?.planStartDate && ctx.currentPlan?.phaseBlocks
      ? computePhasePosition({
          today: ctx.today,
          planStartDate: ctx.currentPlan.planStartDate,
          raceDate: ctx.currentPlan.raceDate,
          phaseBlocks: ctx.currentPlan.phaseBlocks,
        })
      : null;
  const phaseContext = buildPhaseContextString(phasePosition);

  // Current week from phaseBlocks for prescribed volume / vert / focus.
  let prescribedWeekText: string | null = null;
  if (phasePosition && ctx.currentPlan?.phaseBlocks?.[phasePosition.phaseIndex]) {
    const wk =
      ctx.currentPlan.phaseBlocks[phasePosition.phaseIndex]?.weeks[
        phasePosition.weekIndexInPhase
      ];
    if (wk) {
      const bits = [
        wk.mileageTarget ? `mileage ${wk.mileageTarget}` : null,
        wk.vertTarget ? `vert ${wk.vertTarget}` : null,
        wk.keyFocus ? `focus: ${wk.keyFocus}` : null,
        wk.fuelTarget ? `fuel ${wk.fuelTarget}` : null,
        wk.isDeload ? 'DELOAD' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      prescribedWeekText = bits || null;
    }
  }

  const todayDay = dayFromIsoDate(ctx.today);
  const baseSession =
    ctx.currentPlan?.weeklyStructure.find((s) => s.day === todayDay) ?? null;

  const posture: CoachingPosture = ctx.currentPlan
    ? resolveCoachingPosture({
        explicit: ctx.currentPlan.coachingPosture ?? null,
        goal: ctx.currentPlan.goal ?? null,
        raceContext: ctx.currentPlan.raceContext ?? null,
      })
    : resolveCoachingPosture({
        explicit: null,
        goal: ctx.profile?.primaryGoal ?? null,
        raceContext: null,
      });

  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    {
      role: 'user',
      content: buildUserPrompt({
        ctx,
        todayDay,
        phaseContext,
        baseSession,
        prescribedWeekText,
        posture,
      }),
    },
  ];

  // Agent loop — same shape as training-coach.ts. The LLM is allowed
  // to call any tool in the coach registry to dig deeper before
  // emitting the final JSON. Single-exit so usage is recorded on every path.
  const tracker = createUsageTracker();
  let composed: string | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    tracker.addIteration();
    const completion = await callLlmChatCompletion(env, messages);
    if (!completion) break;
    tracker.add(completion.usage);
    const choice = completion.choices?.[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) {
      console.error('[todays-call] LLM returned no message.choices[0].message');
      break;
    }
    const toolCalls = assistantMessage.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantMessage.content ?? null,
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const name = call.function?.name ?? '';
        const args = call.function?.arguments ?? '{}';
        const result = await executeCoachTool(name, args, toolHandlerContext);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      continue;
    }
    const text = assistantMessage.content?.trim() ?? '';
    if (!text) {
      console.error('[todays-call] LLM returned empty content with no tool_calls');
      break;
    }
    composed = text;
    break;
  }

  if (composed === null && tracker.iterations >= MAX_ITERATIONS) {
    console.error(`[todays-call] composer loop hit the ${MAX_ITERATIONS}-iteration cap`);
  }
  await recordLlmUsage(toolHandlerContext.supabase, {
    userId: ctx.userId,
    surface: 'todays-call',
    model: env.model,
    tracker,
  });
  return composed;
}

// ---------------------------------------------------------------------------
// Deterministic fallback — used when LLM env is missing or call fails
// ---------------------------------------------------------------------------

function deterministicFallback(ctx: AthleteContext): TodaysCall {
  const phasePosition =
    ctx.currentPlan?.raceDate && ctx.currentPlan?.planStartDate && ctx.currentPlan?.phaseBlocks
      ? computePhasePosition({
          today: ctx.today,
          planStartDate: ctx.currentPlan.planStartDate,
          raceDate: ctx.currentPlan.raceDate,
          phaseBlocks: ctx.currentPlan.phaseBlocks,
        })
      : null;
  const todayDay = dayFromIsoDate(ctx.today);
  const baseSession =
    ctx.currentPlan?.weeklyStructure.find((s) => s.day === todayDay) ?? null;

  // Run the deterministic engine for whatever adapted recommendation it has.
  let engineHint = '';
  if (ctx.currentPlan) {
    const adaptiveInput = toAdaptiveCoachInput(ctx);
    if (adaptiveInput) {
      const adapted = adaptWeeklyStructure(adaptiveInput);
      const todayRec = adapted.recommendations.find((r) => r.day === todayDay);
      if (todayRec) {
        engineHint = ` Engine note: ${todayRec.reason}`;
      }
    }
  }

  return {
    headline: baseSession
      ? `${baseSession.runSession}${baseSession.details ? ` — ${baseSession.details}` : ''}`
      : 'Rest day',
    runSession: baseSession?.runSession ?? 'Rest',
    details: baseSession?.details ?? 'No template entry for today; treat as rest unless your plan says otherwise.',
    exactWork: baseSession?.exactWork || 'See your plan for exact work targets.',
    strengthMobility: baseSession?.strengthMobility || 'None.',
    fuel: 'Per plan defaults — review with your coach.',
    rationale: `LLM composition unavailable right now; showing plan template.${engineHint}`,
    phaseContext: buildPhaseContextString(phasePosition),
    composedAt: new Date().toISOString(),
    llmInvoked: false,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compose today's workout call for the athlete. Returns null only when
 * the athlete has no plan (composer has nothing to anchor on). Otherwise
 * always returns a TodaysCall — either LLM-composed (preferred) or the
 * deterministic fallback (when env missing / LLM fails).
 */
export async function composeTodaysCall(
  input: ComposeTodaysCallInput,
): Promise<TodaysCall | null> {
  const { ctx, supabase } = input;

  // No plan → composer has nothing to compose against. Caller should
  // render the "upload a plan" CTA instead.
  if (!ctx.currentPlan) {
    return null;
  }

  const env = readLlmEnv();
  if (!env) {
    return deterministicFallback(ctx);
  }

  const proposalStore = createProposalStore();
  const toolHandlerContext: ToolHandlerContext = { ctx, supabase, proposalStore };

  let rawJson: string | null;
  try {
    rawJson = await runComposerLoop(env, ctx, toolHandlerContext);
  } catch (err) {
    console.error('[todays-call] composer loop threw:', err);
    return deterministicFallback(ctx);
  }
  if (!rawJson) return deterministicFallback(ctx);

  // Parse + validate the LLM's JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    console.error('[todays-call] LLM returned non-JSON content:', rawJson.slice(0, 300));
    return deterministicFallback(ctx);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.error('[todays-call] LLM returned non-object payload');
    return deterministicFallback(ctx);
  }
  const obj = parsed as Record<string, unknown>;

  // Phase context computed server-side so the LLM can't get it wrong.
  const phasePosition = ctx.currentPlan.raceDate && ctx.currentPlan.planStartDate
    ? computePhasePosition({
        today: ctx.today,
        planStartDate: ctx.currentPlan.planStartDate,
        raceDate: ctx.currentPlan.raceDate,
        phaseBlocks: ctx.currentPlan.phaseBlocks,
      })
    : null;

  const str = (key: string, fallback = ''): string => {
    const v = obj[key];
    return typeof v === 'string' ? v : fallback;
  };

  return {
    headline: str('headline', 'Today'),
    runSession: str('runSession', 'Run'),
    details: str('details', ''),
    exactWork: str('exactWork', ''),
    strengthMobility: str('strengthMobility', ''),
    fuel: str('fuel', ''),
    rationale: str('rationale', ''),
    phaseContext: buildPhaseContextString(phasePosition),
    composedAt: new Date().toISOString(),
    llmInvoked: true,
  };
}
