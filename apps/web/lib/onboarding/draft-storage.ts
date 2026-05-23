/**
 * Onboarding draft persistence (sessionStorage).
 *
 * The five-step onboarding form is in-memory React state by default —
 * which means a click on a Step-5 "Connect" link (full-page nav to
 * /settings/integrations) used to wipe the entire draft. Persisting
 * the draft to sessionStorage keeps the athlete's progress through
 * accidental navigations, browser reloads, and short tab closures.
 *
 * Why sessionStorage (not localStorage):
 *   - Scoped to the current browser tab + session. An athlete who
 *     finishes onboarding then comes back fresh doesn't see ghost
 *     state. A shared computer doesn't leak data across browser
 *     sessions.
 *   - Persists across full-page navigation within the tab — which is
 *     exactly the problem we're solving.
 *
 * The keys are versioned so a future FormState shape change can bump
 * the version and start clean rather than try to migrate.
 *
 * Pure helpers — typed loosely as Record<string, unknown> for the
 * state shape so the onboarding form's FormState (which is a private
 * type in onboarding-flow.tsx) doesn't have to move into this lib.
 * The form does a `setState(prev => ({ ...prev, ...loaded }))` merge
 * on hydration, so extra keys from older drafts are harmless and
 * missing keys keep their defaults.
 */

const STORAGE_VERSION = 1;
export const STATE_STORAGE_KEY = `onboarding.formState.v${STORAGE_VERSION}`;
export const STEP_STORAGE_KEY = `onboarding.stepIndex.v${STORAGE_VERSION}`;

export type OnboardingDraft = {
  state: Record<string, unknown>;
  stepIndex: number;
};

/**
 * Load a persisted onboarding draft. Returns null when:
 *   - no draft exists,
 *   - sessionStorage is unavailable (SSR, disabled, private browsing),
 *   - the persisted JSON is malformed,
 *   - the persisted stepIndex isn't a finite non-negative integer.
 *
 * Either field can come back missing — when only one of the two keys
 * is present, we still return the available piece with sane fallbacks
 * for the other. (In practice the form writes both atomically per
 * setState, so split states are rare, but we shouldn't crash on them.)
 */
export function loadOnboardingDraft(stepCount: number): OnboardingDraft | null {
  if (typeof window === 'undefined') return null;
  let storage: Storage;
  try {
    storage = window.sessionStorage;
  } catch {
    return null;
  }

  let state: Record<string, unknown> | null = null;
  try {
    const rawState = storage.getItem(STATE_STORAGE_KEY);
    if (rawState) {
      const parsed = JSON.parse(rawState) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Malformed JSON or storage threw — fall through with null state.
  }

  let stepIndex: number | null = null;
  try {
    const rawStep = storage.getItem(STEP_STORAGE_KEY);
    if (rawStep != null) {
      const idx = Number.parseInt(rawStep, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < stepCount) {
        stepIndex = idx;
      }
    }
  } catch {
    /* fall through */
  }

  if (state === null && stepIndex === null) return null;
  return {
    state: state ?? {},
    stepIndex: stepIndex ?? 0,
  };
}

/**
 * Persist the current draft. Swallows quota / unavailable storage
 * errors — the form should keep working even if persistence is off.
 */
export function saveOnboardingDraft(state: unknown, stepIndex: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    window.sessionStorage.setItem(STEP_STORAGE_KEY, String(stepIndex));
  } catch {
    /* sessionStorage unavailable or quota exceeded — no-op */
  }
}

/**
 * Wipe the persisted draft. Called after a successful submit so the
 * next visit (possibly by a different athlete on the same browser)
 * starts clean.
 */
export function clearOnboardingDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(STEP_STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
