import type { AdaptiveCoachResult, AdaptedRecommendation, CompletedWorkout, PhaseWeekTarget, SupportTemplate } from '@/lib/training-plan/types';

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
  /** ISO date the athlete should keep work easy through (inclusive). */
  easyThroughDate: string;
  /** ISO date when the coach prompts the athlete for a re-evaluation. */
  checkInDate: string;
  status: 'active' | 'closed';
  /** Body part / area extracted from the athlete report, if any. */
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
  /** The athlete's latest message. Empty string for "no new message" (e.g., daily check). */
  athleteMessage: string;
  /** Deterministic coach output from adaptWeeklyStructure — ground truth for the LLM. */
  adaptive: AdaptiveCoachResult;
  /** Existing conversation history (most recent last). */
  conversation: CoachConversationMessage[];
  /** Existing follow-up window state (null when no open window). */
  followUp: CoachFollowUp | null;
  /**
   * Support routines parsed from the training plan workbook (Strength Day A/B/C,
   * Daily Routine, Speed Warmup, Mobility, etc.). When the LLM composes a daily
   * call that references "Lift A" or "Speed Warmup", it can name specific
   * exercises rather than waving at "see your strength sheet".
   */
  supportTemplates?: SupportTemplate[];
  /** Recent completed workouts so the LLM can answer 'what have I been doing?' questions concretely. */
  recentWorkouts?: CompletedWorkout[];
  /** This week's prescribed phase-block target (mileage, vert, fuel, notes) for the LLM to reference verbatim. */
  weekTarget?: PhaseWeekTarget | null;
};

export type TrainingCoachOutput = {
  /** Top-line action for the athlete. */
  message: string;
  /** Bulleted recommendations beyond the top-line. */
  recommendations: string[];
  /** Cautions to surface (red flags / things to watch). */
  cautions: string[];
  /** Flat string rationale stitched from deterministic signals. */
  rationale: string;
  /** Updated conversation history including this turn (coach reply appended). */
  conversation: CoachConversationMessage[];
  /** Updated follow-up state (may open, close, or pass through unchanged). */
  followUp: CoachFollowUp | null;
  /** Injury detection result for this turn. Persistence layer uses this to insert health_events. */
  injurySignal: InjurySignal;
  /** Recovery detection result for this turn. */
  recoverySignal: RecoverySignal;
  /** Whether the LLM was invoked. False when env is missing or the LLM call errored. */
  llmInvoked: boolean;
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

  // Positive-recovery check FIRST so phrases like "pain free" don't trigger injury.
  // Pitfall #1 in CLAUDE.md.
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
// Deterministic rationale + recommendations builder (used by fallback path
// and as ground-truth context for the LLM prompt)
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

function buildDeterministicRationale(adaptive: AdaptiveCoachResult): string {
  const parts: string[] = [];
  if (adaptive.phasePosition) {
    parts.push(
      `Phase: ${adaptive.phasePosition.phaseName ?? 'unknown'} (${adaptive.phasePosition.weeksToRace} weeks to race)`,
    );
  }
  parts.push(`Fatigue: ${adaptive.fatigueState} (overload ${adaptive.overloadScore.toFixed(0)})`);
  if (adaptive.recoveryTrend) {
    parts.push(`Recovery trend: ${adaptive.recoveryTrend.direction} (confidence ${adaptive.recoveryTrend.confidence})`);
  }
  if (adaptive.performanceDelta) {
    parts.push(`Performance vs. plan: ${adaptive.performanceDelta.signal}`);
  }
  if (adaptive.planAdaptation) {
    parts.push(`Plan adaptation: ${adaptive.planAdaptation.suggestion} (${adaptive.planAdaptation.magnitudePct}%)`);
  }
  return parts.join('. ');
}

function deterministicMessage(adaptive: AdaptiveCoachResult, injury: InjurySignal): string {
  if (injury.detected) {
    const where = injury.bodyPart ? ` Tell me more about the ${injury.bodyPart}` : ' Tell me more';
    return `Sounds like something's flaring up.${where} — when did it start, sharp or dull, weight-bearing or not? I'll keep work easy through the next 3 days while we sort it out.`;
  }
  const today = adaptive.recommendations.find((r) => r.day === 'Monday') ?? adaptive.recommendations[0];
  if (!today) {
    return 'Stick with the base plan today.';
  }
  return `${today.recommendedSessionType}. ${today.reason}`;
}

// ---------------------------------------------------------------------------
// LLM prompt assembly + fetch
// ---------------------------------------------------------------------------

type LlmEnv = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = process.env.AI_COACH_MODEL;
  const baseUrl = process.env.AI_COACH_BASE_URL;
  if (!apiKey || !model || !baseUrl) return null;
  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, '') };
}

function buildSystemPrompt(): string {
  return `You are the athlete's Training Coach for an ultramarathon build (Swiss Alps 100, August 7 2026).

Your job is to translate the deterministic engine's output into clear, athlete-facing language. You do NOT re-prioritize against the engine; the engine's recommendations are ground truth — you explain them and ask follow-up questions when the athlete reports something physical (pain, strain, soreness, fatigue beyond normal training stress).

When the athlete reports injury or strain, ask one or two specific follow-up questions (location, sharp vs dull, weight-bearing, recent shoe change, similar history). The deterministic engine will handle the follow-up window persistence; you compose the words. Do not promise diagnosis.

When the athlete reports recovery ("pain free", "better", "normal"), acknowledge it and return to the normal plan.

Keep responses under 120 words. No emojis. No exclamation points unless the athlete uses them first.`;
}

function buildUserPrompt(input: TrainingCoachInput, injury: InjurySignal, recovery: RecoverySignal): string {
  const lines: string[] = [];
  lines.push(`Today: ${input.today}`);
  lines.push(`Athlete message: ${input.athleteMessage || '(no new message — daily check)'}`);
  lines.push('');
  lines.push('=== Deterministic engine output (ground truth — do not override) ===');
  lines.push(buildDeterministicRationale(input.adaptive));
  if (input.adaptive.recommendations.length) {
    lines.push('Recommendations:');
    for (const r of summarizeRecommendations(input.adaptive.recommendations)) lines.push(`- ${r}`);
  }
  const cautions = buildDeterministicCautions(input.adaptive);
  if (cautions.length) {
    lines.push('Cautions:');
    for (const c of cautions) lines.push(`- ${c}`);
  }
  if (input.adaptive.planAdaptation) {
    lines.push(
      `Plan-level suggestion: ${input.adaptive.planAdaptation.suggestion} (${input.adaptive.planAdaptation.magnitudePct}%) — ${input.adaptive.planAdaptation.reason}`,
    );
  }
  lines.push('');
  lines.push(`Injury signal: ${injury.detected ? `YES${injury.bodyPart ? ` (${injury.bodyPart})` : ''}` : 'no'}`);
  lines.push(`Recovery signal: ${recovery.detected ? 'YES' : 'no'}`);
  lines.push(`Open follow-up window: ${input.followUp?.status === 'active' ? `yes (easy through ${input.followUp.easyThroughDate}, check in ${input.followUp.checkInDate})` : 'no'}`);
  lines.push('');
  if (input.weekTarget) {
    lines.push('=== This weeks prescribed phase target ===');
    const t = input.weekTarget;
    const targets: string[] = [];
    if (t.weekLabel) targets.push(`week ${t.weekLabel}`);
    if (t.mileageTarget) targets.push(`mileage ${t.mileageTarget}`);
    if (t.vertTarget) targets.push(`vert ${t.vertTarget}`);
    if (t.saturdayTarget) targets.push(`Sat ${t.saturdayTarget}`);
    if (t.sundayTarget) targets.push(`Sun ${t.sundayTarget}`);
    if (t.thursdayTarget) targets.push(`Thu ${t.thursdayTarget}`);
    if (t.fuelTarget) targets.push(`fuel ${t.fuelTarget}`);
    if (targets.length) lines.push(`- ${targets.join(' · ')}`);
    if (t.keyFocus) lines.push(`- Key focus: ${t.keyFocus}`);
    if (t.notes) lines.push(`- Notes: ${t.notes}`);
    lines.push('');
  }

  if (input.recentWorkouts && input.recentWorkouts.length) {
    lines.push('=== Recent completed workouts ===');
    for (const w of input.recentWorkouts.slice(-10)) {
      const duration = w.durationMinutes ? `${w.durationMinutes}min` : '?min';
      const intensity = `RPE ${w.intensityScore ?? '?'}`;
      lines.push(`- ${w.day} · ${w.sessionType || 'workout'} · ${duration} · ${intensity}`);
    }
    lines.push('');
  }

  if (input.supportTemplates && input.supportTemplates.length) {
    lines.push('=== Support routines available (from the plan workbook) ===');
    for (const tmpl of input.supportTemplates) {
      lines.push(`* ${tmpl.name} (${tmpl.sourceSheet}):`);
      for (const item of tmpl.items.slice(0, 12)) {
        const prescription = item.prescription ? ` — ${item.prescription}` : '';
        const focus = item.focus ? ` (${item.focus})` : '';
        const notes = item.notes ? ` · ${item.notes}` : '';
        lines.push(`    - ${item.label}${prescription}${focus}${notes}`);
      }
    }
  }

  if (input.conversation.length) {
    lines.push('=== Recent conversation ===');
    for (const m of input.conversation.slice(-6)) {
      lines.push(`${m.role}: ${m.text}`);
    }
  }
  lines.push('');
  lines.push('Reply as the coach. One paragraph. No markdown. When you reference a strength routine by name (e.g. "Lift A"), use the exact exercises from the support routines section above.');
  return lines.join('\n');
}

async function callLlm(env: LlmEnv, systemPrompt: string, userPrompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 400,
      }),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(
        `[training-coach] LLM call returned ${response.status} from ${endpoint} (model=${env.model}). ` +
          `Body (first 500 chars): ${bodyText.slice(0, 500)}`,
      );
      return null;
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? null;
    if (!content) {
      console.error(
        `[training-coach] LLM returned 200 but no choices[0].message.content. ` +
          `Raw response (first 500 chars): ${JSON.stringify(data).slice(0, 500)}`,
      );
    }
    return content;
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runTrainingCoach(input: TrainingCoachInput): Promise<TrainingCoachOutput> {
  const injurySignal = detectInjurySignal(input.athleteMessage);
  const recoverySignal = detectRecoverySignal(input.athleteMessage);

  // Update follow-up window deterministically.
  let followUp: CoachFollowUp | null = input.followUp;
  if (injurySignal.detected) {
    followUp = openFollowUpWindow(input.today, injurySignal.bodyPart);
  } else if (recoverySignal.detected && input.followUp?.status === 'active') {
    followUp = { ...input.followUp, status: 'closed' };
  }

  const rationale = buildDeterministicRationale(input.adaptive);
  const recommendations = summarizeRecommendations(input.adaptive.recommendations);
  const cautions = buildDeterministicCautions(input.adaptive);

  // Try the LLM. Fall back to deterministic message on any failure.
  const env = readLlmEnv();
  let message: string | null = null;
  let llmInvoked = false;
  if (env) {
    llmInvoked = true;
    message = await callLlm(env, buildSystemPrompt(), buildUserPrompt(input, injurySignal, recoverySignal));
  } else {
    console.warn(
      '[training-coach] AI_COACH_API_KEY / AI_COACH_MODEL / AI_COACH_BASE_URL not all set; using deterministic fallback.',
    );
  }
  if (!message) {
    message = deterministicMessage(input.adaptive, injurySignal);
  }

  const now = new Date().toISOString();
  const updatedConversation: CoachConversationMessage[] = [...input.conversation];
  if (input.athleteMessage) {
    updatedConversation.push({ role: 'athlete', text: input.athleteMessage, at: now });
  }
  updatedConversation.push({ role: 'coach', text: message, at: now });
  // Keep only the most recent 20 messages in the persisted conversation.
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
  };
}
