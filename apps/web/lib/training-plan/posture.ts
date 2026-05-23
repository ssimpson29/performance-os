import type { RaceContext } from './types';

/**
 * Coaching posture controls how aggressively the engine and the LLM
 * advocate for plan changes. Derived from the athlete's stated goal so
 * the same engine serves a top-10 ultra ambition AND a casual-finisher
 * half-marathon goal without either getting the wrong end of the stick.
 *
 * - **conservative** — finisher / first-time / fun-run goals. Engine raises
 *   the over-threshold (volume has to be meaningfully over plan before
 *   adapt-up fires), caps raise magnitude lower, and prefers 'hold' even
 *   when conditions clear. LLM should default to patience-first language.
 *
 * - **balanced** — default. Current behavior, no posture tuning.
 *
 * - **aggressive** — podium / placement / PR / competitive goals. Engine
 *   lowers the over-threshold, allows adapt-up under a wider band of
 *   weekend fatigue (specifically: 'elevated' weekend load no longer
 *   blocks a raise — only 'high' does, as a safety floor), and raises
 *   the magnitude cap. LLM should advocate concretely when the engine
 *   signals a raise and when the athlete reports handling extra load.
 */
export type CoachingPosture = 'conservative' | 'balanced' | 'aggressive';

/**
 * Posture-tuned engine constants. The deterministic core reads these
 * instead of hard-coded thresholds so changing posture changes the
 * adapt-up / adapt-down arithmetic in one place.
 */
export type PostureTuning = {
  /** Completed/prescribed delta required to register as 'over' (or, negated, 'under'). */
  overThreshold: number;
  /** Hard cap on planAdaptation.magnitudePct when raising. */
  raiseMagnitudeCap: number;
  /**
   * When true, weekend fatigueState === 'elevated' is treated as a NEUTRAL
   * input to adapt-up rather than a blocker. The intent: an athlete
   * deliberately stacking big weekends to build for an ultra is exhibiting
   * the exact behavior we want to recognize, not punish.
   */
  allowRaiseOnElevatedFatigue: boolean;
  /**
   * When true, the engine prefers 'hold' over 'raise' even when the four
   * adapt-up conditions clear. Useful for conservative goals where the
   * athlete should be defending the plan rather than stretching it.
   */
  preferHoldOverRaise: boolean;
};

export const POSTURE_TUNINGS: Record<CoachingPosture, PostureTuning> = {
  conservative: {
    overThreshold: 0.12,
    raiseMagnitudeCap: 8,
    allowRaiseOnElevatedFatigue: false,
    preferHoldOverRaise: true,
  },
  balanced: {
    overThreshold: 0.08,
    raiseMagnitudeCap: 12,
    allowRaiseOnElevatedFatigue: false,
    preferHoldOverRaise: false,
  },
  aggressive: {
    overThreshold: 0.05,
    raiseMagnitudeCap: 15,
    allowRaiseOnElevatedFatigue: true,
    preferHoldOverRaise: false,
  },
};

// Keyword sets used by the heuristic classifier. Order matters within
// each tier (longer phrases first) so "top 10" matches before "top".
const AGGRESSIVE_PATTERNS: RegExp[] = [
  /\btop[\s-]?\d+\b/i,
  /\bpodium\b/i,
  /\bplace\b/i,
  /\bplacement\b/i,
  /\bwin(ning)?\b/i,
  /\bcompet(e|ing|itive)\b/i,
  // Intentionally NO generic /\brace\b/ pattern — it fires on negated
  // constructions ("not race it") and the regex can't see negation.
  /\b(PR|personal\s+record|personal\s+best)\b/i,
  /\bfast(er|est)?\b/i,
  /\bsub[\s-]?\d/i,
  /\bquali(fy|fying)\b/i,
  /\bbreak\b.*\b(\d|record|time)\b/i,
];

const CONSERVATIVE_PATTERNS: RegExp[] = [
  /\bfinish(er|ing)?\b/i,
  /\bcomplete\b/i,
  /\bjust\s+(want\s+to\s+)?(finish|run|complete)\b/i,
  /\bfirst\s+(half|full|marathon|ultra|race|time)\b/i,
  /\bexperience\b/i,
  /\bfun\b/i,
  /\bsurvive\b/i,
  /\bgentle\b/i,
];

/**
 * Heuristically classify the athlete's coaching posture from goal text +
 * race context. Aggressive patterns dominate over conservative ones when
 * both match — a "PR my first marathon" goal is aggressive (PR signal
 * is the operative one). Returns 'balanced' when neither tier matches or
 * when goal text is missing.
 */
export function inferCoachingPosture(
  goal: string | null | undefined,
  raceContext?: RaceContext | null,
): CoachingPosture {
  const fragments = [goal ?? '', raceContext?.goal ?? '', raceContext?.notes ?? '']
    .filter((s) => typeof s === 'string' && s.trim().length > 0)
    .join(' ');

  if (!fragments) return 'balanced';

  const hasAggressiveSignal = AGGRESSIVE_PATTERNS.some((rx) => rx.test(fragments));
  if (hasAggressiveSignal) return 'aggressive';

  const hasConservativeSignal = CONSERVATIVE_PATTERNS.some((rx) => rx.test(fragments));
  if (hasConservativeSignal) return 'conservative';

  return 'balanced';
}

/**
 * Resolve the posture for a plan: explicit override on
 * `training_plans.metadata.coachingPosture` wins, otherwise we infer
 * from goal/raceContext. Centralized here so any caller (engine, prompt,
 * UI) reads posture the same way.
 */
export function resolveCoachingPosture(args: {
  explicit?: CoachingPosture | null;
  goal?: string | null;
  raceContext?: RaceContext | null;
}): CoachingPosture {
  if (
    args.explicit === 'conservative' ||
    args.explicit === 'balanced' ||
    args.explicit === 'aggressive'
  ) {
    return args.explicit;
  }
  return inferCoachingPosture(args.goal ?? null, args.raceContext ?? null);
}
