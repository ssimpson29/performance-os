import type { SupabaseClient } from '@supabase/supabase-js';

import type { AdaptiveCoachResult, AdaptedRecommendation } from '@/lib/training-plan/types';

import type { AthleteContext } from './athlete-context';
import {
  COACH_TOOL_DEFINITIONS,
  createProposalStore,
  executeCoachTool,
  type ToolHandlerContext,
} from './coach-tools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachConversationRole = 'athlete' | 'coach';

export type CoachConversationMessage = {
  role: CoachConversationRole;
  text: string;
  /** ISO 8601 timestamp. Optional on input; server-set on persisted history. */
  at?: string;
};

export type CoachFollowUp = {
  easyThroughDate: string;
  checkInDate: string;
  status: 'active' | 'closed';
  bodyPart?: string;
};

export type InjurySignal = {
  detected: boolean;
  bodyPart?: string;
  rationale: string;
};

export type RecoverySignal = {
  detected: boolean;
  rationale: string;
};

export type TrainingCoachInput = {
  /** Today's ISO date — drives the follow-up window math. */
  today: string;
  /** The athlete's latest message. Empty string for "no new message". */
  athleteMessage: string;
  /** Rich athlete context for the agent loop. */
  athleteContext: AthleteContext;
  /** Supabase client (passed to tool handlers for write-tool persistence). */
  supabase: SupabaseClient;
};

export type CoachToolTraceEntry = {
  iteration: number;
  toolName: string;
  argsPreview: string;
  resultPreview: string;
};

export type TrainingCoachOutput = {
  /** Top-line response from the coach. */
  message: string;
  /** Optional structured recommendations the UI can surface separately. */
  recommendations: string[];
  /** Cautions to surface. */
  cautions: string[];
  /** Plain-language rationale stitched from any deterministic signals consulted. */
  rationale: string;
  /** Updated conversation including this turn (most recent last). */
  conversation: CoachConversationMessage[];
  /** Updated follow-up window. */
  followUp: CoachFollowUp | null;
  /** Injury detection for this turn (used by persistence layer to insert health_events). */
  injurySignal: InjurySignal;
  /** Recovery detection for this turn. */
  recoverySignal: RecoverySignal;
  /** Whether the LLM was invoked. False when env is missing or the call errored. */
  llmInvoked: boolean;
  /** Tool-call trace for debugging / persistence. */
  toolTrace: CoachToolTraceEntry[];
  /** True when the agent persisted a new plan via commitTrainingPlan during this turn. */
  planCommitted: boolean;
};

// ---------------------------------------------------------------------------
// Detection — order matters: positive-recovery checks BEFORE injury checks
// (CLAUDE.md pitfall #1: "pain free" contains "pain").
// ---------------------------------------------------------------------------

const POSITIVE_RECOVERY_PATTERNS: RegExp[] = [
  /\bpain[\s-]?free\b/i,
  /\bno\s+pain\b/i,
  /\bnot\s+(hurting|sore|in\s+pain)\b/i,
  /\bfeels?\s+(better|fine|good|normal)\b/i,
  /\bback\s+to\s+normal\b/i,
  /\b(all\s+)?recovered\b/i,
  /\b(it'?s|i'?m)\s+(better|fine|good)\b/i,
];

const INJURY_PATTERNS: RegExp[] = [
  /\bhurt(s|ing)?\b/i,
  /\bpain(ful|s)?\b/i,
  /\b(strain|sprain|tweak)(ed|ing|s)?\b/i,
  /\binjur(y|ed|ies)\b/i,
  /\bsharp\b.*\b(ache|pain)\b/i,
  /\bach(e|es|ing|y)\b/i,
  /\bswollen\b/i,
  /\binflam(ed|mation)\b/i,
];

const BODY_PART_PATTERNS: { part: string; rx: RegExp }[] = [
  { part: 'foot', rx: /\b(left|right)?\s*foot\b/i },
  { part: 'ankle', rx: /\b(left|right)?\s*ankle\b/i },
  { part: 'knee', rx: /\b(left|right)?\s*knee\b/i },
  { part: 'hip', rx: /\b(left|right)?\s*hip\b/i },
  { part: 'calf', rx: /\b(left|right)?\s*calf\b/i },
  { part: 'shin', rx: /\b(left|right)?\s*shin\b/i },
  { part: 'hamstring', rx: /\bhamstring\b/i },
  { part: 'quad', rx: /\b(quad|quadricep)s?\b/i },
  { part: 'back', rx: /\b(lower|upper)?\s*back\b/i },
  { part: 'achilles', rx: /\bachilles\b/i },
  { part: 'IT band', rx: /\b(it[\s-]?band|iliotibial)\b/i },
];

export function detectRecoverySignal(message: string): RecoverySignal {
  if (!message) return { detected: false, rationale: 'no message' };
  for (const rx of POSITIVE_RECOVERY_PATTERNS) {
    if (rx.test(message)) {
      return { detected: true, rationale: `matched positive-recovery pattern ${rx}` };
    }
  }
  return { detected: false, rationale: 'no positive-recovery phrase detected' };
}

export function detectInjurySignal(message: string): InjurySignal {
  if (!message) return { detected: false, rationale: 'no message' };

  // Positive-recovery check FIRST (CLAUDE.md pitfall #1: "pain free" contains "pain").
  if (detectRecoverySignal(message).detected) {
    return { detected: false, rationale: 'message matched positive-recovery first' };
  }

  for (const rx of INJURY_PATTERNS) {
    if (rx.test(message)) {
      let bodyPart: string | undefined;
      for (const bp of BODY_PART_PATTERNS) {
        if (bp.rx.test(message)) {
          bodyPart = bp.part;
          break;
        }
      }
      return {
        detected: true,
        bodyPart,
        rationale: `matched injury pattern ${rx}${bodyPart ? ` (body part: ${bodyPart})` : ''}`,
      };
    }
  }
  return { detected: false, rationale: 'no injury pattern matched' };
}

// ---------------------------------------------------------------------------
// Follow-up window math
// ---------------------------------------------------------------------------

function addDaysIso(isoDate: string, days: number): string {
  const parts = isoDate.slice(0, 10).split('-').map((p) => Number.parseInt(p, 10));
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function openFollowUpWindow(today: string, bodyPart?: string): CoachFollowUp {
  return {
    easyThroughDate: addDaysIso(today, 3),
    checkInDate: addDaysIso(today, 4),
    status: 'active',
    bodyPart,
  };
}

// ---------------------------------------------------------------------------
// System prompt — gives the coach genuine agency.
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: AthleteContext): string {
  const planSummary = ctx.currentPlan
    ? `Active plan: ${ctx.currentPlan.raceContext?.raceName ?? 'untitled'} on ${ctx.currentPlan.raceDate ?? 'no race date'}, ${ctx.currentPlan.phaseBlocks.length} phase blocks.`
    : 'No active training plan on record.';
  const followUpSummary = ctx.followUp?.status === 'active'
    ? `Open follow-up window: easy through ${ctx.followUp.easyThroughDate}, check-in ${ctx.followUp.checkInDate}${ctx.followUp.bodyPart ? ` (${ctx.followUp.bodyPart})` : ''}.`
    : 'No open follow-up window.';

  return `You are the athlete's Training Coach. You give intelligent, contextual advice grounded in their actual training data — not generic templates.

Today: ${ctx.today}
${planSummary}
${followUpSummary}

You have tools to inspect the athlete's recent workouts, injury history, biomarker panel, current plan, and to run the deterministic adaptive engine. Use them when the question warrants it. Don't call every tool every turn — only what's relevant.

**Anchor on dates, not feelings.** When the athlete refers to "yesterday", "Thursday", "this week's long run", or any specific workout, ALWAYS call getRecentWorkouts FIRST and match against the \`localDate\` field — never claim a workout doesn't exist without checking the data. Every workout in the tool output has its actual ISO date AND a \`description\` field (Strava annotations like "+8kg vest" go here — read them and use them in your reasoning). If the athlete mentions a specific date that doesn't appear in the data, say so — but only after you've looked.

Key behaviors:

- **Injury / pain reports.** When the athlete reports something physical (pain, strain, ache, swelling), call getInjuryHistory to see prior episodes, then ask ONE or TWO targeted clarifying questions (location, sharp vs dull, weight-bearing, when it started, recent shoe / surface change). Do not diagnose. Bias toward easy work for 3 days while it resolves; the system opens a follow-up window automatically.

- **Recovery report.** When the athlete says "pain free", "better", "fine", "normal", "recovered" — acknowledge it and return to the normal plan (run runAdaptiveEngine if there's a plan).

- **Daily question with active plan.** Call runAdaptiveEngine for today's per-day signal, optionally getRecentWorkouts for context. Give a clear recommendation. You may disagree with the engine when the broader context warrants it — explain why.

- **No active plan + athlete mentions a race.** Confirm race details (name, date, distance, elevation), call getRecentWorkouts to anchor on current fitness, then call proposeRacePlan. Present the summary plainly (total weeks, phase split, peak mileage / vert, long-run progression). Ask the athlete to confirm before calling commitTrainingPlan. NEVER commit without explicit approval.

- **Plan modifications.** Out of scope for now — if the athlete asks to modify their existing plan, acknowledge and say you'll add this in a future revision.

Style:
- Natural, conversational prose. One or two paragraphs.
- No markdown headers, no bullet lists unless the athlete explicitly asks for a structured list.
- No emojis. No exclamation points unless the athlete uses them first.
- Be specific — reference actual numbers from tool results (mileage, dates, RPE) rather than vague language.`;
}

// ---------------------------------------------------------------------------
// Deterministic fallback (used when LLM fails)
// ---------------------------------------------------------------------------

function summarizeRecommendations(recs: AdaptedRecommendation[]): string[] {
  return recs.map((r) => `${r.day}: ${r.recommendedSessionType} — ${r.reason}`);
}

function buildDeterministicCautions(adaptive: AdaptiveCoachResult): string[] {
  const cautions: string[] = [];
  if (adaptive.fatigueState === 'high') {
    cautions.push('Weekend overload is high; treat early-week sessions as recovery.');
  } else if (adaptive.fatigueState === 'elevated') {
    cautions.push('Weekend load is elevated; downgrade quality on Tuesday.');
  }
  if (adaptive.recoveryTrend?.direction === 'degrading' && (adaptive.recoveryTrend.confidence ?? 0) >= 0.4) {
    cautions.push('Recovery trend is degrading — back off intensity until it stabilizes.');
  }
  if (adaptive.phasePosition?.isRaceWeek) {
    cautions.push('Race week — plan is both floor and ceiling.');
  }
  if (adaptive.phasePosition?.isTaper) {
    cautions.push('Taper phase — do not exceed prescribed work, even on good days.');
  }
  return cautions;
}

function buildDeterministicRationale(adaptive: AdaptiveCoachResult | null): string {
  if (!adaptive) return 'No active training plan; coach in plan-building mode.';
  const parts: string[] = [];
  if (adaptive.phasePosition) {
    parts.push(`Phase: ${adaptive.phasePosition.phaseName ?? 'unknown'} (${adaptive.phasePosition.weeksToRace} weeks to race)`);
  }
  parts.push(`Fatigue: ${adaptive.fatigueState} (overload ${adaptive.overloadScore.toFixed(0)})`);
  if (adaptive.recoveryTrend) {
    parts.push(`Recovery trend: ${adaptive.recoveryTrend.direction} (confidence ${adaptive.recoveryTrend.confidence})`);
  }
  if (adaptive.performanceDelta) parts.push(`Performance vs. plan: ${adaptive.performanceDelta.signal}`);
  if (adaptive.planAdaptation) parts.push(`Plan adaptation: ${adaptive.planAdaptation.suggestion} (${adaptive.planAdaptation.magnitudePct}%)`);
  return parts.join('. ');
}

function deterministicFallbackMessage(ctx: AthleteContext, injury: InjurySignal): string {
  if (injury.detected) {
    const where = injury.bodyPart ? ` Tell me more about the ${injury.bodyPart}` : ' Tell me more';
    return `Sounds like something's flaring up.${where} — when did it start, sharp or dull, weight-bearing or not? I'll keep work easy through the next 3 days while we sort it out.`;
  }
  if (!ctx.currentPlan) {
    return "I'm not sure I can reach my full reasoning right now, but I can see you don't have an active plan yet. If you tell me your target race (name, date, distance, elevation) and a rough sense of your current weekly volume, I can draft something next time we talk.";
  }
  return "I'm having trouble reaching my reasoning right now. Stick with today's planned session if it's an easy or aerobic day; defer hard quality work and we'll re-engage tomorrow.";
}

// ---------------------------------------------------------------------------
// LLM environment + agent loop
// ---------------------------------------------------------------------------

type LlmEnv = { apiKey: string; model: string; baseUrl: string };

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = process.env.AI_COACH_MODEL;
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
};

const MAX_ITERATIONS = 8;
const LLM_TIMEOUT_MS = 30_000;

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
        temperature: 1,
        max_completion_tokens: 2000,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(
        `[training-coach] LLM call returned ${response.status} from ${endpoint} (model=${env.model}). Body: ${text.slice(0, 500)}`,
      );
      return null;
    }
    return (await response.json()) as OpenAICompletion;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[training-coach] LLM fetch threw ${name} against ${endpoint} (model=${env.model}): ${message}`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function clipPreview(text: string, max = 400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Run the LLM agent loop. Returns either the final assistant text or null
 * if the LLM failed (deterministic fallback fires in the caller).
 */
async function runAgentLoop(
  env: LlmEnv,
  ctx: AthleteContext,
  athleteMessage: string,
  toolHandlerContext: ToolHandlerContext,
): Promise<{ message: string | null; trace: CoachToolTraceEntry[]; planCommitted: boolean }> {
  const trace: CoachToolTraceEntry[] = [];
  let planCommitted = false;

  // Conversation history -> OpenAI messages. We include the last 12 turns
  // (truncated) plus this turn's athlete message at the end.
  const historyMessages: OpenAIChatMessage[] = ctx.conversation.slice(-12).map((m) => ({
    role: m.role === 'coach' ? 'assistant' : 'user',
    content: m.text,
  }));
  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(ctx) },
    ...historyMessages,
  ];
  if (athleteMessage) {
    messages.push({ role: 'user', content: athleteMessage });
  } else {
    // No-message case (daily prompt). Synthesize a user turn so the LLM
    // knows what we want.
    messages.push({
      role: 'user',
      content: 'Daily check-in — give me your read on today, including anything I should pay attention to.',
    });
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const completion = await callLlmChatCompletion(env, messages);
    if (!completion) {
      return { message: null, trace, planCommitted };
    }
    const choice = completion.choices?.[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) {
      console.error('[training-coach] LLM returned no message.choices[0].message');
      return { message: null, trace, planCommitted };
    }

    // Did the model ask to call tools? If so, execute and feed back.
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
        trace.push({
          iteration: iter,
          toolName: name,
          argsPreview: clipPreview(args, 240),
          resultPreview: clipPreview(result, 400),
        });
        if (name === 'commitTrainingPlan') {
          try {
            const parsed = JSON.parse(result) as { ok?: boolean };
            if (parsed.ok) planCommitted = true;
          } catch {
            // ignore parse error — the LLM will see the raw result anyway
          }
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        });
      }
      continue; // Loop back so the LLM can respond to the tool results.
    }

    // No tool calls → this is the final assistant message.
    const text = assistantMessage.content?.trim() ?? '';
    if (!text) {
      console.error('[training-coach] LLM returned empty assistant content with no tool_calls.');
      return { message: null, trace, planCommitted };
    }
    return { message: text, trace, planCommitted };
  }

  console.error(`[training-coach] Agent loop exceeded ${MAX_ITERATIONS} iterations without producing a final reply.`);
  return { message: null, trace, planCommitted };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runTrainingCoach(input: TrainingCoachInput): Promise<TrainingCoachOutput> {
  const { today, athleteMessage, athleteContext, supabase } = input;
  const injurySignal = detectInjurySignal(athleteMessage);
  const recoverySignal = detectRecoverySignal(athleteMessage);

  // Update follow-up window deterministically (independent of the LLM).
  let followUp: CoachFollowUp | null = athleteContext.followUp;
  if (injurySignal.detected) {
    followUp = openFollowUpWindow(today, injurySignal.bodyPart);
  } else if (recoverySignal.detected && athleteContext.followUp?.status === 'active') {
    followUp = { ...athleteContext.followUp, status: 'closed' };
  }

  // Run the LLM agent loop. Fall back to deterministic message on any failure.
  const env = readLlmEnv();
  let message: string | null = null;
  let llmInvoked = false;
  let trace: CoachToolTraceEntry[] = [];
  let planCommitted = false;

  if (env) {
    llmInvoked = true;
    const proposalStore = createProposalStore();
    const toolHandlerContext: ToolHandlerContext = {
      ctx: athleteContext,
      supabase,
      proposalStore,
    };
    const result = await runAgentLoop(env, athleteContext, athleteMessage, toolHandlerContext);
    message = result.message;
    trace = result.trace;
    planCommitted = result.planCommitted;
  } else {
    console.warn(
      '[training-coach] AI_COACH_API_KEY / AI_COACH_MODEL / AI_COACH_BASE_URL not all set; using deterministic fallback.',
    );
  }

  if (!message) {
    message = deterministicFallbackMessage(athleteContext, injurySignal);
  }

  // Recommendations + cautions: derived from the adaptive engine if available
  // — purely informational for the UI now that the LLM is the primary author.
  const recommendations: string[] = [];
  const cautions: string[] = [];
  let rationale = '';
  if (athleteContext.currentPlan) {
    // We don't re-run the engine here; the agent does it via tool call. But
    // we surface the most recent tool-trace summary if helpful.
    rationale = buildDeterministicRationale(null);
  } else {
    rationale = 'Coach is in plan-building mode (no active plan on record).';
  }

  // Append this turn to the conversation history.
  const now = new Date().toISOString();
  const updatedConversation: CoachConversationMessage[] = [...athleteContext.conversation];
  if (athleteMessage) {
    updatedConversation.push({ role: 'athlete', text: athleteMessage, at: now });
  }
  updatedConversation.push({ role: 'coach', text: message, at: now });
  const trimmedConversation = updatedConversation.slice(-20);

  return {
    message,
    recommendations,
    cautions,
    rationale,
    conversation: trimmedConversation,
    followUp,
    injurySignal,
    recoverySignal,
    llmInvoked,
    toolTrace: trace,
    planCommitted,
  };
}

// Re-export the deterministic helpers used by deterministic-only tests.
export {
  buildDeterministicCautions,
  buildDeterministicRationale,
  summarizeRecommendations,
};
