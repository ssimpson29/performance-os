import {
  evaluateMarker,
  getMarkerSpec,
  type BiomarkerDomain,
  type EvaluateMarkerResult,
  type MarkerFlag,
} from '@/lib/longevity/reference-ranges';
import {
  prioritizeLongevityActions,
  type LongevityLever,
  type MarkerInput,
  type TrainingLoadOverreachInput,
} from '@/lib/longevity/prioritization';
import {
  detectMarkerTrend,
  type MarkerSample,
  type DetectMarkerTrendResult,
} from '@/lib/longevity/trend-detection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LongevityRecoveryPriority = 'low' | 'normal' | 'elevated';

export type LongevityContext = {
  /** Cross-write signal the Training Coach reads as a downgrade input. */
  recoveryPriority: LongevityRecoveryPriority;
  notes: string;
  /** ISO timestamp the context was last computed. */
  evaluatedAt: string;
};

export type LongevityMarkerInput = {
  markerKey: string;
  value: number;
  unit: string;
  /** Optional history for trend detection (most recent last). */
  history?: MarkerSample[];
};

export type RunLongevityGuruInput = {
  today: string;
  age?: number;
  sex?: 'male' | 'female';
  markers: LongevityMarkerInput[];
  trainingLoadOverreach?: TrainingLoadOverreachInput;
  /** Optional free-text question from the athlete. */
  athleteQuestion?: string;
  /** Optional health/family history one-liners surfaced to the LLM. */
  healthHistory?: string[];
};

export type LongevityMarkerEvaluation = {
  markerKey: string;
  displayName: string;
  domain: BiomarkerDomain;
  flag: MarkerFlag;
  optimalDelta: number;
  trend: DetectMarkerTrendResult | null;
  rationale: string;
};

export type LongevityGuruOutput = {
  priorities: LongevityLever[];
  watching: LongevityLever[];
  /** Per-marker evaluation results — used by the UI to show what's moving. */
  markerEvaluations: LongevityMarkerEvaluation[];
  narrative: string;
  cautions: string[];
  /** Cross-write target for daily_summaries.summary.longevityContext. */
  longevityContext: LongevityContext;
  /** Conflicts the Training Coach should see (e.g., recovery wins over intensity). */
  conflictsWithTraining: Array<{ leverKey: BiomarkerDomain; description: string }>;
  llmInvoked: boolean;
};

// ---------------------------------------------------------------------------
// Marker evaluation pipeline
// ---------------------------------------------------------------------------

function evaluateMarkers(
  markers: LongevityMarkerInput[],
  age?: number,
  sex?: 'male' | 'female',
): { evaluations: LongevityMarkerEvaluation[]; markerInputs: MarkerInput[] } {
  const evaluations: LongevityMarkerEvaluation[] = [];
  const markerInputs: MarkerInput[] = [];

  for (const m of markers) {
    const spec = getMarkerSpec(m.markerKey);
    let evaluation: EvaluateMarkerResult;
    try {
      evaluation = evaluateMarker({ markerKey: m.markerKey, value: m.value, unit: m.unit, age, sex });
    } catch (err) {
      // Unit mismatch — skip the marker but record a rationale.
      const message = err instanceof Error ? err.message : 'unknown error';
      evaluations.push({
        markerKey: m.markerKey,
        displayName: spec?.displayName ?? m.markerKey,
        domain: spec?.domain ?? 'other',
        flag: 'unknown_marker',
        optimalDelta: 0,
        trend: null,
        rationale: `Skipped: ${message}`,
      });
      continue;
    }

    let trend: DetectMarkerTrendResult | null = null;
    if (m.history && m.history.length >= 2 && spec) {
      trend = detectMarkerTrend(m.history, spec.desiredDirection);
    }

    const evalRecord: LongevityMarkerEvaluation = {
      markerKey: m.markerKey,
      displayName: spec?.displayName ?? m.markerKey,
      domain: spec?.domain ?? 'other',
      flag: evaluation.flag,
      optimalDelta: evaluation.optimalDelta,
      trend,
      rationale: evaluation.rationale,
    };
    evaluations.push(evalRecord);

    if (evaluation.flag !== 'unknown_marker') {
      markerInputs.push({
        markerKey: m.markerKey,
        displayName: evalRecord.displayName,
        domain: evalRecord.domain,
        flag: evaluation.flag,
        optimalDelta: evaluation.optimalDelta,
        trend: trend
          ? { direction: trend.direction, magnitude: trend.magnitude }
          : null,
      });
    }
  }

  return { evaluations, markerInputs };
}

// ---------------------------------------------------------------------------
// LongevityContext derivation
// ---------------------------------------------------------------------------

function deriveLongevityContext(
  priorities: LongevityLever[],
  overreach?: TrainingLoadOverreachInput,
  today?: string,
): LongevityContext {
  const evaluatedAt = today
    ? new Date(`${today}T00:00:00.000Z`).toISOString()
    : new Date().toISOString();

  // Performance-recovery lever (or sustained overreach) → elevated.
  const hasRecoveryLever = priorities.some((p) => p.leverKey === 'performance_recovery');
  const sustainedOverreach = overreach?.sustainedOverreach ?? false;

  if (hasRecoveryLever || sustainedOverreach) {
    const topNote = priorities[0]?.rationale ?? overreach?.description ?? 'Sustained training-load overreach.';
    return {
      recoveryPriority: 'elevated',
      notes: `Longevity Guru: prioritize recovery. ${topNote}`,
      evaluatedAt,
    };
  }

  // High-severity inflammation/cardiometabolic with degrading trend → elevated.
  const inflammationOrCardio = priorities.filter(
    (p) => p.leverKey === 'inflammation' || p.leverKey === 'cardiometabolic',
  );
  const highSeverityDegrading = inflammationOrCardio.find((p) => p.severity >= 2.0);
  if (highSeverityDegrading) {
    return {
      recoveryPriority: 'elevated',
      notes: `Longevity Guru: ${highSeverityDegrading.leverKey} signal is strong — back off intensity until it stabilizes.`,
      evaluatedAt,
    };
  }

  if (priorities.length === 0) {
    return {
      recoveryPriority: 'low',
      notes: 'Longevity Guru: nothing flagged this evaluation; carry on.',
      evaluatedAt,
    };
  }

  return {
    recoveryPriority: 'normal',
    notes: `Longevity Guru top lever: ${priorities[0].leverKey} (severity ${priorities[0].severity.toFixed(1)}).`,
    evaluatedAt,
  };
}

// ---------------------------------------------------------------------------
// Training-conflict surfacing
// ---------------------------------------------------------------------------

function deriveConflictsWithTraining(
  context: LongevityContext,
  priorities: LongevityLever[],
): Array<{ leverKey: BiomarkerDomain; description: string }> {
  if (context.recoveryPriority !== 'elevated') return [];
  const top = priorities[0];
  if (!top) return [];
  return [
    {
      leverKey: top.leverKey,
      description: `Longevity Guru recommends backing off intensity (${top.leverKey} signal); Training Coach may want to push. Conflict resolution rule: sustained-signal-wins-for-longevity. See docs/two-coach-architecture.md.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// LLM prompt + fetch (shared shape with training-coach.ts)
// ---------------------------------------------------------------------------

type LlmEnv = { apiKey: string; model: string; baseUrl: string };

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = process.env.AI_COACH_MODEL;
  const baseUrl = process.env.AI_COACH_BASE_URL;
  if (!apiKey || !model || !baseUrl) return null;
  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, '') };
}

function buildSystemPrompt(): string {
  return `You are the athlete's Longevity Guru. Your job is healthspan, not race day. Time horizon: months to decades.

You receive the deterministic prioritization engine's output as ground truth. Do NOT re-prioritize against it — explain it, frame it for behavior change, and reference the athlete's specific markers. The Training Coach handles daily training; you focus on biomarker trends, lifestyle levers, and long-term trajectory.

Be evidence-informed but humble: you are not a clinician. Recommend lab interpretation with a physician for clinically out-of-range values. Surface "in range but not optimal" as a real lever — that's where most of the longevity work lives.

When the Longevity signal conflicts with the Training Coach (you want recovery; training wants intensity), surface the conflict honestly. The conflict resolution rule is sustained-signal-wins-for-longevity, acute-need-wins-for-training; never silently override.

Keep responses under 180 words. Plain language. No emojis. No exclamation points unless the athlete uses them first.`;
}

function buildUserPrompt(input: RunLongevityGuruInput, output: Omit<LongevityGuruOutput, 'narrative' | 'llmInvoked'>): string {
  const lines: string[] = [];
  lines.push(`Today: ${input.today}`);
  if (input.age != null) lines.push(`Age: ${input.age}`);
  if (input.sex) lines.push(`Sex: ${input.sex}`);
  if (input.healthHistory && input.healthHistory.length) {
    lines.push(`Health history: ${input.healthHistory.join('; ')}`);
  }
  lines.push('');

  lines.push('=== Deterministic prioritization (ground truth — do not override) ===');
  if (output.priorities.length === 0) {
    lines.push('No priorities flagged.');
  } else {
    for (const p of output.priorities) {
      lines.push(`- ${p.leverKey} (severity ${p.severity.toFixed(1)}): ${p.recommendation}`);
      lines.push(`    Contributing: ${p.contributingMarkers.join(', ')}`);
    }
  }
  if (output.watching.length) {
    lines.push(`Watching: ${output.watching.map((w) => w.leverKey).join(', ')}`);
  }

  lines.push('');
  lines.push('=== Marker evaluations ===');
  for (const m of output.markerEvaluations) {
    const trend = m.trend ? `${m.trend.direction}/${m.trend.magnitude}` : 'no-trend';
    lines.push(`- ${m.displayName} (${m.domain}): flag=${m.flag} optimalDelta=${m.optimalDelta.toFixed(2)} trend=${trend}`);
  }

  lines.push('');
  lines.push(`Longevity context for Training Coach: ${output.longevityContext.recoveryPriority} — ${output.longevityContext.notes}`);
  if (output.conflictsWithTraining.length) {
    lines.push('Training conflicts:');
    for (const c of output.conflictsWithTraining) lines.push(`- ${c.leverKey}: ${c.description}`);
  }

  if (input.athleteQuestion) {
    lines.push('');
    lines.push(`Athlete question: ${input.athleteQuestion}`);
  }

  lines.push('');
  lines.push('Reply as the Longevity Guru. One or two paragraphs. No markdown headings, no lists, no bullets.');
  return lines.join('\n');
}

async function callLlm(env: LlmEnv, systemPrompt: string, userPrompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${env.baseUrl}/v1/chat/completions`, {
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
        temperature: 0.3,
        // Use OpenAI's newer parameter so reasoning-class models (o1/o3/gpt-5)
        // don't reject the request with `unsupported_parameter: max_tokens`.
        max_completion_tokens: 500,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function deterministicNarrative(priorities: LongevityLever[], context: LongevityContext): string {
  if (priorities.length === 0) {
    return 'Nothing material is flagging right now. Markers and recovery signals look stable. Keep the routines that got you here.';
  }
  const top = priorities[0];
  const followOns = priorities
    .slice(1)
    .map((p) => `${p.leverKey} (severity ${p.severity.toFixed(1)})`)
    .join(', ');
  const closer =
    context.recoveryPriority === 'elevated'
      ? ' Coordination with the Training Coach: back off intensity while this signal sustains.'
      : '';
  return `Top lever right now: ${top.leverKey}. ${top.recommendation} Contributing markers: ${top.contributingMarkers.join(', ')}.${followOns ? ` Also worth watching: ${followOns}.` : ''}${closer}`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runLongevityGuru(input: RunLongevityGuruInput): Promise<LongevityGuruOutput> {
  const { evaluations, markerInputs } = evaluateMarkers(input.markers, input.age, input.sex);
  const { priorities, watching } = prioritizeLongevityActions({
    markers: markerInputs,
    trainingLoadOverreach: input.trainingLoadOverreach,
  });
  const longevityContext = deriveLongevityContext(priorities, input.trainingLoadOverreach, input.today);
  const conflictsWithTraining = deriveConflictsWithTraining(longevityContext, priorities);

  const cautions: string[] = [];
  const hasOutOfRange = evaluations.some((e) => e.flag === 'high' || e.flag === 'low');
  if (hasOutOfRange) {
    cautions.push('At least one marker is outside clinical reference; review with a physician.');
  }

  const partialOutput = {
    priorities,
    watching,
    markerEvaluations: evaluations,
    cautions,
    longevityContext,
    conflictsWithTraining,
  };

  // LLM wrap with deterministic fallback.
  const env = readLlmEnv();
  let narrative: string | null = null;
  let llmInvoked = false;
  if (env) {
    llmInvoked = true;
    narrative = await callLlm(env, buildSystemPrompt(), buildUserPrompt(input, partialOutput));
  }
  if (!narrative) {
    narrative = deterministicNarrative(priorities, longevityContext);
  }

  return {
    ...partialOutput,
    narrative,
    llmInvoked,
  };
}
