import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSystemPrompt as buildBaseLongevityPrompt } from './longevity-guru';
import { maxToolIterations, resolveModel } from './llm-model';
import { createUsageTracker, recordLlmUsage, type RawUsage } from './llm-usage';
import {
  createSoulUpdatedRef,
  executeLongevityTool,
  LONGEVITY_TOOL_DEFINITIONS,
  type LongevityToolHandlerContext,
} from './longevity-tools';
import type {
  AthleteContext,
  LongevityConversationMessageStored,
} from './athlete-context';

/**
 * Multi-turn Longevity Guru chat agent. Distinct from
 * `runLongevityGuru` in `longevity-guru.ts` — that's the single-shot
 * panel evaluation path used by /api/longevity/evaluate. This module
 * is the conversational path used by /api/longevity/message: athlete
 * asks a question, the guru optionally calls tools, the guru replies
 * in plain prose.
 *
 * Shape parallels `runTrainingCoach` in `training-coach.ts` — same
 * tool-calling loop pattern, same trim-to-N-messages persistence
 * model, same env-missing deterministic fallback.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LongevityConversationRole = 'athlete' | 'guru';

export type LongevityConversationMessage = {
  role: LongevityConversationRole;
  text: string;
  at?: string;
};

export type LongevityChatToolTraceEntry = {
  iteration: number;
  toolName: string;
  argsPreview: string;
  resultPreview: string;
};

export type LongevityChatInput = {
  /** Today's ISO date — used in the prompt header. */
  today: string;
  /** Athlete's latest message. Empty string for a "give me a read" prompt. */
  athleteMessage: string;
  athleteContext: AthleteContext;
  supabase: SupabaseClient;
};

export type LongevityChatOutput = {
  /** Final assistant message — natural prose, the guru's reply. */
  message: string;
  /** Updated conversation including this turn (most recent last, trimmed). */
  conversation: LongevityConversationMessage[];
  /** True when the agent persisted a soul change via updateLongevitySoul. */
  soulUpdated: boolean;
  /** False when env is missing or the LLM call failed and we fell back. */
  llmInvoked: boolean;
  /** Tool-call trace for debugging / persistence. */
  toolTrace: LongevityChatToolTraceEntry[];
};

// ---------------------------------------------------------------------------
// Env + HTTP plumbing
// ---------------------------------------------------------------------------

type LlmEnv = { apiKey: string; model: string; baseUrl: string };

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = resolveModel('longevity-chat');
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
        tools: LONGEVITY_TOOL_DEFINITIONS,
        temperature: 1,
        max_completion_tokens: 2000,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(
        `[longevity-chat] LLM call returned ${response.status} from ${endpoint} (model=${env.model}). Body: ${text.slice(0, 500)}`,
      );
      return null;
    }
    return (await response.json()) as OpenAICompletion;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[longevity-chat] LLM fetch threw ${name}: ${message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function clipPreview(text: string, max = 400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Prompt — extends the existing single-shot system prompt with chat
// behavior so the same persona shows up on both surfaces.
// ---------------------------------------------------------------------------

function buildChatSystemPrompt(ctx: AthleteContext): string {
  const base = buildBaseLongevityPrompt(ctx.longevitySoul?.content || undefined);
  const profile = ctx.profile;
  const profileLine = profile
    ? `Athlete profile: DOB ${profile.dateOfBirth ?? '?'}, ${profile.sex ?? '?'}, ${profile.heightCm != null ? `${profile.heightCm}cm` : '?'}, ${profile.weightKg != null ? `${profile.weightKg}kg` : '?'}. Health notes: ${profile.healthNotes ?? '(none)'}.`
    : 'Athlete profile not yet on file.';

  const chatExtras = `

You are now in CONVERSATIONAL mode. The athlete will ask follow-up questions and you respond in natural prose, multi-turn. Use the tools to look up real data — getRecentBiomarkers for the current panel, getMarkerHistory for how a single marker has moved, getRecentWorkouts for recent training volume / load / energy expenditure, runDeterministicPrioritization for the engine's structured read, getInjuryHistory when relevant, getLongevitySoul / updateLongevitySoul to read or extend the soul.

${profileLine}

Conversation behavior:
- Ground every claim about lab values in tool results. Never guess numbers.
- For nutrition, fueling, hydration, or recovery questions, call getRecentWorkouts first and tie advice to the athlete's actual recent load (long-run carb needs, post-session protein, fueling across back-to-back days, electrolytes for high-vert / high-sweat efforts) rather than giving generic guidance.
- When the athlete shares a NEW durable health framing (a doctor they trust, a dietary philosophy, a chronic condition), call updateLongevitySoul to record it — PRESERVING existing facts. Don't use it for transient observations.
- If the athlete asks something the Training Coach should own (today's workout, taper structure, race-week tapering), say so — refer them back to the coach but answer the longevity component yourself.
- Stay under 180 words per reply. Plain language. No emojis. No exclamation points unless the athlete uses them first.`;

  return `${base}${chatExtras}`;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

async function runAgentLoop(
  env: LlmEnv,
  ctx: AthleteContext,
  athleteMessage: string,
  handlerContext: LongevityToolHandlerContext,
): Promise<{ message: string | null; trace: LongevityChatToolTraceEntry[] }> {
  const trace: LongevityChatToolTraceEntry[] = [];

  // Convert prior conversation to OpenAI messages. Last 12 turns is enough
  // context without blowing token budget on multi-month back-references.
  const historyMessages: OpenAIChatMessage[] = ctx.longevityConversation
    .slice(-12)
    .map((m) => ({
      role: m.role === 'guru' ? 'assistant' : 'user',
      content: m.text,
    }));

  const messages: OpenAIChatMessage[] = [
    { role: 'system', content: buildChatSystemPrompt(ctx) },
    ...historyMessages,
  ];
  if (athleteMessage) {
    messages.push({ role: 'user', content: athleteMessage });
  } else {
    messages.push({
      role: 'user',
      content: 'Give me your current read — what should I be paying attention to today?',
    });
  }

  // Single exit so usage logs on every path. maxToolIterations() caps spend.
  const tracker = createUsageTracker();
  const maxIterations = maxToolIterations();
  let result: { message: string | null; trace: LongevityChatToolTraceEntry[] } = { message: null, trace };

  for (let iter = 0; iter < maxIterations; iter += 1) {
    tracker.addIteration();
    const completion = await callLlmChatCompletion(env, messages);
    if (!completion) break;
    tracker.add(completion.usage);
    const choice = completion.choices?.[0];
    const assistantMessage = choice?.message;
    if (!assistantMessage) {
      console.error('[longevity-chat] LLM returned no message.choices[0].message');
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
        const toolResult = await executeLongevityTool(name, args, handlerContext);
        trace.push({
          iteration: iter,
          toolName: name,
          argsPreview: clipPreview(args, 240),
          resultPreview: clipPreview(toolResult, 400),
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult });
      }
      continue;
    }
    const text = assistantMessage.content?.trim() ?? '';
    if (!text) {
      console.error('[longevity-chat] LLM returned empty content with no tool_calls');
      break;
    }
    result = { message: text, trace };
    break;
  }

  if (result.message === null && tracker.iterations >= maxIterations) {
    console.error(`[longevity-chat] agent loop hit the ${maxIterations}-iteration cap`);
  }
  await recordLlmUsage(handlerContext.supabase, {
    userId: ctx.userId,
    surface: 'longevity-chat',
    model: env.model,
    tracker,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Deterministic fallback when LLM is unavailable
// ---------------------------------------------------------------------------

function deterministicFallback(ctx: AthleteContext, athleteMessage: string): string {
  if (!athleteMessage) {
    return "I'm having trouble reaching my reasoning right now. Try again in a moment — or check the priorities + narrative shown above for the engine's current read on your panel.";
  }
  return `Got your question: "${athleteMessage}". I can't reach my full reasoning right now, but the priorities + narrative above reflect the most recent deterministic evaluation of your labs. Try again shortly for a personalized response.`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const MAX_CONVERSATION_LENGTH = 20;

export async function runLongevityChat(
  input: LongevityChatInput,
): Promise<LongevityChatOutput> {
  const { today, athleteMessage, athleteContext, supabase } = input;

  const env = readLlmEnv();
  let message: string | null = null;
  let llmInvoked = false;
  let trace: LongevityChatToolTraceEntry[] = [];
  const soulUpdatedRef = createSoulUpdatedRef();

  if (env) {
    llmInvoked = true;
    const handlerContext: LongevityToolHandlerContext = {
      ctx: athleteContext,
      supabase,
      soulUpdatedRef,
    };
    const result = await runAgentLoop(env, athleteContext, athleteMessage, handlerContext);
    message = result.message;
    trace = result.trace;
  } else {
    console.warn(
      '[longevity-chat] AI_COACH_API_KEY / AI_COACH_MODEL / AI_COACH_BASE_URL not all set; using deterministic fallback.',
    );
  }

  if (!message) {
    message = deterministicFallback(athleteContext, athleteMessage);
  }

  // Append this turn to the conversation history. The persister later
  // writes the trimmed list back to daily_summaries.summary.longevityConversation.
  const now = new Date().toISOString();
  const updatedConversation: LongevityConversationMessage[] = [
    ...athleteContext.longevityConversation,
  ];
  if (athleteMessage) {
    updatedConversation.push({ role: 'athlete', text: athleteMessage, at: now });
  }
  updatedConversation.push({ role: 'guru', text: message, at: now });
  const trimmedConversation = updatedConversation.slice(-MAX_CONVERSATION_LENGTH);

  return {
    message,
    conversation: trimmedConversation,
    soulUpdated: soulUpdatedRef.value,
    llmInvoked,
    toolTrace: trace,
  };
}

/**
 * Persist a longevity chat turn into `daily_summaries.summary`,
 * preserving every other key (coachConversation, todaysCall,
 * longevityContext, etc.).
 */
export async function persistLongevityChatRun(
  supabase: SupabaseClient,
  args: {
    userId: string;
    today: string;
    output: LongevityChatOutput;
  },
): Promise<{ summaryId: string }> {
  const { userId, today, output } = args;

  type DailySummaryRow = {
    id: string;
    summary: Record<string, unknown> | null;
  };

  const { data: existingRows, error: loadError } = await supabase
    .from('daily_summaries')
    .select('id, summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);

  if (loadError) {
    throw new Error(`Failed to load daily_summaries for longevity chat: ${loadError.message}`);
  }

  const existing: DailySummaryRow | undefined = (existingRows as DailySummaryRow[] | null)?.[0];
  const existingSummary = (existing?.summary ?? {}) as Record<string, unknown>;

  const mergedSummary: Record<string, unknown> = {
    ...existingSummary,
    longevityConversation: output.conversation,
  };

  let summaryId: string;
  if (existing) {
    const { error } = await supabase
      .from('daily_summaries')
      .update({ summary: mergedSummary })
      .eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update daily_summaries: ${error.message}`);
    }
    summaryId = existing.id;
  } else {
    const { data, error } = await supabase
      .from('daily_summaries')
      .insert({ user_id: userId, day: today, summary: mergedSummary })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`Failed to insert daily_summaries: ${error?.message ?? 'no row returned'}`);
    }
    summaryId = (data as { id: string }).id;
  }

  return { summaryId };
}
