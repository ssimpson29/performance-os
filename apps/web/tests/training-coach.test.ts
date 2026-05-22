import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AthleteContext } from '../lib/agents/athlete-context';
import {
  detectInjurySignal,
  detectRecoverySignal,
  runTrainingCoach,
} from '../lib/agents/training-coach';

/**
 * Tests for the LLM-agent Training Coach. The detection helpers stay as
 * regex-only unit tests. The runTrainingCoach tests cover:
 *   - deterministic fallback when env vars are missing,
 *   - deterministic fallback when the LLM returns 500,
 *   - injury / recovery window state transitions,
 *   - LLM happy path (mocked fetch returning a final assistant message),
 *   - LLM tool-call path (mocked fetch returning tool_calls, then final message).
 */

function makeContext(overrides: Partial<AthleteContext> = {}): AthleteContext {
  return {
    userId: 'user-1',
    today: '2026-05-22',
    currentPlan: null,
    recentWorkouts: [],
    recoveryHistory: [],
    injuryHistory: [],
    biomarkers: null,
    longevityContext: null,
    conversation: [],
    followUp: null,
    ...overrides,
  };
}

function makeSupabase() {
  // The agent path never calls supabase directly in these tests (tool
  // handlers do). We pass a stub that throws if invoked unexpectedly.
  return {
    from: () => {
      throw new Error('Unexpected supabase access in test');
    },
  } as never;
}

// ---------------------------------------------------------------------------
// Detection — order matters: positive-recovery checks BEFORE injury checks
// ---------------------------------------------------------------------------

describe('detectRecoverySignal — positive-phrase before negative match', () => {
  it('matches "pain free" without firing on the substring "pain"', () => {
    expect(detectRecoverySignal('my foot is pain free now').detected).toBe(true);
  });
  it('matches "feels better"', () => {
    expect(detectRecoverySignal("foot feels better today").detected).toBe(true);
  });
  it('matches "back to normal"', () => {
    expect(detectRecoverySignal('back to normal').detected).toBe(true);
  });
  it("doesn't match injury-only language", () => {
    expect(detectRecoverySignal('my foot hurts').detected).toBe(false);
  });
});

describe('detectInjurySignal — CLAUDE.md pitfall #1 ordering', () => {
  it('does NOT flag injury on "pain free" (positive check runs first)', () => {
    const signal = detectInjurySignal('foot pain free now');
    expect(signal.detected).toBe(false);
    expect(signal.rationale).toMatch(/positive-recovery/);
  });

  it('flags injury on "my foot is hurting"', () => {
    const signal = detectInjurySignal('my foot is hurting after the long run');
    expect(signal.detected).toBe(true);
    expect(signal.bodyPart).toBe('foot');
  });

  it('flags injury on "sharp pain in my knee"', () => {
    const signal = detectInjurySignal('sharp pain in my left knee');
    expect(signal.detected).toBe(true);
    expect(signal.bodyPart).toBe('knee');
  });

  it('flags strain language', () => {
    const signal = detectInjurySignal('think I strained my calf');
    expect(signal.detected).toBe(true);
    expect(signal.bodyPart).toBe('calf');
  });

  it('returns no detection on empty message', () => {
    expect(detectInjurySignal('').detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runTrainingCoach — deterministic fallback (no AI env)
// ---------------------------------------------------------------------------

describe('runTrainingCoach — deterministic fallback', () => {
  const originalEnv = {
    apiKey: process.env.AI_COACH_API_KEY,
    model: process.env.AI_COACH_MODEL,
    baseUrl: process.env.AI_COACH_BASE_URL,
  };

  beforeEach(() => {
    delete process.env.AI_COACH_API_KEY;
    delete process.env.AI_COACH_MODEL;
    delete process.env.AI_COACH_BASE_URL;
  });

  afterEach(() => {
    if (originalEnv.apiKey === undefined) delete process.env.AI_COACH_API_KEY;
    else process.env.AI_COACH_API_KEY = originalEnv.apiKey;
    if (originalEnv.model === undefined) delete process.env.AI_COACH_MODEL;
    else process.env.AI_COACH_MODEL = originalEnv.model;
    if (originalEnv.baseUrl === undefined) delete process.env.AI_COACH_BASE_URL;
    else process.env.AI_COACH_BASE_URL = originalEnv.baseUrl;
  });

  it('falls back to a no-plan deterministic message when env is missing AND no plan exists', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: '',
      athleteContext: makeContext({ currentPlan: null }),
      supabase: makeSupabase(),
    });

    expect(result.llmInvoked).toBe(false);
    // No-plan branch mentions plan-building
    expect(result.message).toMatch(/plan|race|build/i);
    expect(result.conversation).toHaveLength(1); // coach reply (no athlete message)
    expect(result.conversation[0].role).toBe('coach');
  });

  it('opens a follow-up window when athlete reports injury, even without LLM', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: 'my left foot is hurting after the long run',
      athleteContext: makeContext(),
      supabase: makeSupabase(),
    });

    expect(result.injurySignal.detected).toBe(true);
    expect(result.injurySignal.bodyPart).toBe('foot');
    expect(result.followUp).not.toBeNull();
    expect(result.followUp?.easyThroughDate).toBe('2026-05-25');
    expect(result.followUp?.checkInDate).toBe('2026-05-26');
    expect(result.followUp?.status).toBe('active');
    expect(result.followUp?.bodyPart).toBe('foot');
    expect(result.message).toMatch(/foot|easy|tell me/i);
    expect(result.conversation).toHaveLength(2); // athlete + coach
  });

  it('closes an existing follow-up window on positive-recovery phrase', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-26',
      athleteMessage: 'foot is pain free today, feels back to normal',
      athleteContext: makeContext({
        followUp: {
          easyThroughDate: '2026-05-25',
          checkInDate: '2026-05-26',
          status: 'active',
          bodyPart: 'foot',
        },
      }),
      supabase: makeSupabase(),
    });

    expect(result.injurySignal.detected).toBe(false);
    expect(result.recoverySignal.detected).toBe(true);
    expect(result.followUp?.status).toBe('closed');
    expect(result.followUp?.bodyPart).toBe('foot');
  });

  it('trims conversation to the last 20 messages', async () => {
    const longHistory = Array.from({ length: 25 }, (_, i) => ({
      role: 'athlete' as const,
      text: `old message ${i}`,
    }));

    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: 'how should I run today?',
      athleteContext: makeContext({ conversation: longHistory }),
      supabase: makeSupabase(),
    });

    expect(result.conversation.length).toBeLessThanOrEqual(20);
    expect(result.conversation[result.conversation.length - 1].role).toBe('coach');
  });
});

// ---------------------------------------------------------------------------
// runTrainingCoach — LLM agent loop (mocked fetch)
// ---------------------------------------------------------------------------

describe('runTrainingCoach — LLM agent loop', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    apiKey: process.env.AI_COACH_API_KEY,
    model: process.env.AI_COACH_MODEL,
    baseUrl: process.env.AI_COACH_BASE_URL,
  };

  beforeEach(() => {
    process.env.AI_COACH_API_KEY = 'test-key';
    process.env.AI_COACH_MODEL = 'test-model';
    process.env.AI_COACH_BASE_URL = 'https://example.test';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv.apiKey === undefined) delete process.env.AI_COACH_API_KEY;
    else process.env.AI_COACH_API_KEY = originalEnv.apiKey;
    if (originalEnv.model === undefined) delete process.env.AI_COACH_MODEL;
    else process.env.AI_COACH_MODEL = originalEnv.model;
    if (originalEnv.baseUrl === undefined) delete process.env.AI_COACH_BASE_URL;
    else process.env.AI_COACH_BASE_URL = originalEnv.baseUrl;
  });

  it('returns the final LLM message when no tools are called', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovery day. Take it easy and check back tomorrow.',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: 'how should I run today?',
      athleteContext: makeContext(),
      supabase: makeSupabase(),
    });

    expect(result.llmInvoked).toBe(true);
    expect(result.message).toBe('Recovery day. Take it easy and check back tomorrow.');
    expect(result.toolTrace).toHaveLength(0);
    expect(result.planCommitted).toBe(false);
  });

  it('runs a tool call, feeds the result back, and uses the second response as the final message', async () => {
    // Two-shot mock: first call returns a tool_calls request; second returns
    // the final assistant message.
    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'getRecentWorkouts', arguments: '{"days":7}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Based on your last week of training, you should take an easy day today.',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: 'should I push today?',
      athleteContext: makeContext({
        recentWorkouts: [
          { day: 'Monday', sessionType: 'Aerobic Run', durationMinutes: 60, intensityScore: 5, loadScore: 160 },
        ],
      }),
      supabase: makeSupabase(),
    });

    expect(result.llmInvoked).toBe(true);
    expect(result.message).toMatch(/easy day|last week/i);
    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0].toolName).toBe('getRecentWorkouts');
    expect(callIndex).toBe(2); // tool call + final response
  });

  it('falls back to deterministic message when the LLM call returns 500', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('Internal error', { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: '',
      athleteContext: makeContext(),
      supabase: makeSupabase(),
    });

    expect(result.llmInvoked).toBe(true);
    expect(result.message).toMatch(/plan|reasoning|race/i);
  });

  it('still detects injury deterministically even when LLM provides the message text', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Tell me more about the foot — sharp or dull?',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-22',
      athleteMessage: 'left foot hurts after the long run',
      athleteContext: makeContext(),
      supabase: makeSupabase(),
    });

    expect(result.injurySignal.detected).toBe(true);
    expect(result.followUp?.status).toBe('active');
    expect(result.followUp?.bodyPart).toBe('foot');
    expect(result.message).toContain('foot');
  });
});
