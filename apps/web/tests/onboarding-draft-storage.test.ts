import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STATE_STORAGE_KEY,
  STEP_STORAGE_KEY,
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from '../lib/onboarding/draft-storage';

/**
 * The storage helpers read `window.sessionStorage`. The vitest default
 * environment is `node`, which has neither `window` nor any browser
 * Storage implementation. Rather than pulling in jsdom (~20 MB devDep)
 * just for this one test file, we stub both globals with a Map-backed
 * mock that matches the Storage interface closely enough for these
 * helpers. The mock is reset between tests.
 *
 * Tests that need to simulate "storage disabled" / "quota exceeded" /
 * "private browsing" replace the relevant method on the mock per-test
 * and restore in their own teardown.
 */

class MapStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

let mockStorage: MapStorage;

beforeAll(() => {
  mockStorage = new MapStorage();
  // The helper does `typeof window === 'undefined'` and `window.sessionStorage`.
  // Stub both — Node has neither by default.
  vi.stubGlobal('window', { sessionStorage: mockStorage });
  vi.stubGlobal('sessionStorage', mockStorage); // for the test bodies themselves
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockStorage.clear();
});

const STEP_COUNT = 5;

describe('loadOnboardingDraft', () => {
  it('returns null when storage is empty', () => {
    expect(loadOnboardingDraft(STEP_COUNT)).toBeNull();
  });

  it('returns persisted state + stepIndex when both are valid', () => {
    sessionStorage.setItem(
      STATE_STORAGE_KEY,
      JSON.stringify({ displayName: 'Scott', heightCm: '180' }),
    );
    sessionStorage.setItem(STEP_STORAGE_KEY, '3');

    const draft = loadOnboardingDraft(STEP_COUNT);
    expect(draft).toEqual({
      state: { displayName: 'Scott', heightCm: '180' },
      stepIndex: 3,
    });
  });

  it('returns empty-state default when only stepIndex is persisted', () => {
    sessionStorage.setItem(STEP_STORAGE_KEY, '2');
    const draft = loadOnboardingDraft(STEP_COUNT);
    expect(draft).toEqual({ state: {}, stepIndex: 2 });
  });

  it('falls back to step 0 when only state is persisted', () => {
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({ displayName: 'Scott' }));
    const draft = loadOnboardingDraft(STEP_COUNT);
    expect(draft).toEqual({ state: { displayName: 'Scott' }, stepIndex: 0 });
  });

  it('treats malformed JSON in state as missing state (does not throw)', () => {
    sessionStorage.setItem(STATE_STORAGE_KEY, '{not-json');
    sessionStorage.setItem(STEP_STORAGE_KEY, '1');
    const draft = loadOnboardingDraft(STEP_COUNT);
    expect(draft).toEqual({ state: {}, stepIndex: 1 });
  });

  it('rejects a persisted stepIndex outside [0, stepCount) and falls back to step 0', () => {
    // State key present so the loader doesn't short-circuit to null when
    // stepIndex alone is rejected. Reflects the realistic edge case:
    // valid form draft, stepIndex somehow corrupted / from a different
    // version. We want to recover the state and reset to step 0 rather
    // than discard everything.
    const validState = JSON.stringify({ displayName: 'Scott' });

    sessionStorage.setItem(STATE_STORAGE_KEY, validState);
    sessionStorage.setItem(STEP_STORAGE_KEY, '99');
    expect(loadOnboardingDraft(STEP_COUNT)).toEqual({
      state: { displayName: 'Scott' },
      stepIndex: 0,
    });

    sessionStorage.setItem(STATE_STORAGE_KEY, validState);
    sessionStorage.setItem(STEP_STORAGE_KEY, '-1');
    expect(loadOnboardingDraft(STEP_COUNT)?.stepIndex).toBe(0);

    sessionStorage.setItem(STATE_STORAGE_KEY, validState);
    sessionStorage.setItem(STEP_STORAGE_KEY, 'abc');
    expect(loadOnboardingDraft(STEP_COUNT)?.stepIndex).toBe(0);
  });

  it('returns null when ONLY an invalid stepIndex is persisted (nothing worth restoring)', () => {
    // No state key at all + invalid stepIndex → both signals are useless,
    // helper returns null so the form mounts with fresh defaults.
    sessionStorage.setItem(STEP_STORAGE_KEY, '99');
    expect(loadOnboardingDraft(STEP_COUNT)).toBeNull();
  });

  it('rejects an array (not an object) as persisted state', () => {
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(['a', 'b']));
    sessionStorage.setItem(STEP_STORAGE_KEY, '1');
    const draft = loadOnboardingDraft(STEP_COUNT);
    expect(draft).toEqual({ state: {}, stepIndex: 1 });
  });

  it("returns null when window.sessionStorage access throws (private browsing simulation)", () => {
    const original = mockStorage.getItem.bind(mockStorage);
    mockStorage.getItem = () => {
      throw new Error('SecurityError: storage disabled');
    };
    expect(loadOnboardingDraft(STEP_COUNT)).toBeNull();
    mockStorage.getItem = original;
  });
});

describe('saveOnboardingDraft', () => {
  it('writes both keys', () => {
    saveOnboardingDraft({ displayName: 'Scott', heightCm: '180' }, 2);
    expect(JSON.parse(sessionStorage.getItem(STATE_STORAGE_KEY)!)).toEqual({
      displayName: 'Scott',
      heightCm: '180',
    });
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBe('2');
  });

  it('swallows quota-exceeded errors without throwing', () => {
    const original = mockStorage.setItem.bind(mockStorage);
    mockStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveOnboardingDraft({ displayName: 'Scott' }, 0)).not.toThrow();
    mockStorage.setItem = original;
  });
});

describe('clearOnboardingDraft', () => {
  it('removes both keys', () => {
    sessionStorage.setItem(STATE_STORAGE_KEY, '{}');
    sessionStorage.setItem(STEP_STORAGE_KEY, '4');
    clearOnboardingDraft();
    expect(sessionStorage.getItem(STATE_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(STEP_STORAGE_KEY)).toBeNull();
  });

  it('does not throw when keys are already absent', () => {
    expect(() => clearOnboardingDraft()).not.toThrow();
  });

  it('does not throw when sessionStorage removeItem throws', () => {
    const original = mockStorage.removeItem.bind(mockStorage);
    mockStorage.removeItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => clearOnboardingDraft()).not.toThrow();
    mockStorage.removeItem = original;
  });
});

describe('versioning', () => {
  afterEach(() => {
    mockStorage.clear();
  });

  it('uses v1 keys so a future schema change can bump the version cleanly', () => {
    expect(STATE_STORAGE_KEY).toBe('onboarding.formState.v1');
    expect(STEP_STORAGE_KEY).toBe('onboarding.stepIndex.v1');
  });

  it('ignores keys from a different version (forward compat shim)', () => {
    sessionStorage.setItem('onboarding.formState.v2', JSON.stringify({ displayName: 'Future' }));
    sessionStorage.setItem('onboarding.stepIndex.v2', '4');
    expect(loadOnboardingDraft(STEP_COUNT)).toBeNull();
  });
});
