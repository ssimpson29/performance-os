/**
 * Model routing + tool-loop bounds.
 *
 * Cost lever: most volume (chat, Today's Call) should run on the cheap default
 * model; only quality-critical surfaces (vision lab extraction) should use a
 * higher-tier model when one is configured. Centralizing the choice here keeps
 * a future "upgrade to gpt-4o" from silently 16x-ing the whole bill.
 *
 * Env (read at call time, never at import — see CLAUDE.md pitfall #3):
 * - AI_COACH_MODEL: default/cheap model (e.g. gpt-4o-mini). Required for any
 *   LLM path; when unset, callers keep their deterministic fallback.
 * - AI_COACH_MODEL_HEAVY: optional higher-tier model used only for HEAVY_SURFACES.
 * - AI_COACH_MAX_TOOL_ITERATIONS: optional override for the loop cap (default 5).
 */

export type LlmSurface =
  | 'coach-chat'
  | 'todays-call'
  | 'longevity-chat'
  | 'longevity-eval'
  | 'image-extraction';

// Surfaces that should prefer the higher-quality model when configured. Vision
// extraction needs a capable model; the rest stay on the cheap default.
const HEAVY_SURFACES: ReadonlySet<LlmSurface> = new Set<LlmSurface>(['image-extraction']);

/**
 * Resolve the model for a surface. Returns undefined when AI_COACH_MODEL is
 * unset so callers fall through to their env-missing deterministic path.
 */
export function resolveModel(surface: LlmSurface): string | undefined {
  const base = process.env.AI_COACH_MODEL;
  if (!base) return undefined;
  if (HEAVY_SURFACES.has(surface)) {
    return process.env.AI_COACH_MODEL_HEAVY || base;
  }
  return base;
}

/**
 * Hard cap on tool-calling round-trips per user message. Bounds worst-case
 * token spend if the model loops. 2-4 rounds is normal; 5 is a safe ceiling.
 */
export function maxToolIterations(): number {
  const raw = Number(process.env.AI_COACH_MAX_TOOL_ITERATIONS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 5;
}
