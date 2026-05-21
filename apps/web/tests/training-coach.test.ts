import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectInjurySignal,
  detectRecoverySignal,
  runTrainingCoach,
} from '../lib/agents/training-coach';
import type { AdaptiveCoachResult } from '../lib/training-plan/types';

const baseAdaptive: AdaptiveCoachResult = {
  fatigueState: 'manageable',
  overloadScore: 200,
  recommendations: [
    {
      day: 'Monday',
      baseSessionType: 'Aerobic Run',
      recommendedSessionType: 'Aerobic Run',
      action: 'keep',
      reason: 'Base weekly structure remains appropriate.',
    },
    {
      day: 'Tuesday',
      baseSessionType: 'Quality',
      recommendedSessionType: 'Quality',
      action: 'keep',
      reason: 'Base weekly structure remains appropriate.',
    },
  ],
};

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

  it('produces a coach output without invoking the LLM when env is missing', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: '',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.llmInvoked).toBe(false);
    expect(result.message).toMatch(/Aerobic Run|Base weekly structure/);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.rationale).toMatch(/Fatigue: manageable/);
    expect(result.followUp).toBeNull();
    expect(result.conversation).toHaveLength(1); // coach reply only (no athlete message)
    expect(result.conversation[0].role).toBe('coach');
  });

  it('opens a follow-up window when athlete reports injury, inserts a coach reply asking for details', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: 'my left foot is hurting after the long run',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.injurySignal.detected).toBe(true);
    expect(result.injurySignal.bodyPart).toBe('foot');
    expect(result.followUp).not.toBeNull();
    expect(result.followUp?.easyThroughDate).toBe('2026-05-24');
    expect(result.followUp?.checkInDate).toBe('2026-05-25');
    expect(result.followUp?.status).toBe('active');
    expect(result.followUp?.bodyPart).toBe('foot');
    expect(result.message).toMatch(/foot|easy|tell me/i);
    // Conversation: athlete message + coach reply.
    expect(result.conversation).toHaveLength(2);
    expect(result.conversation[0]).toMatchObject({ role: 'athlete' });
    expect(result.conversation[1]).toMatchObject({ role: 'coach' });
  });

  it('closes an existing follow-up window on positive-recovery phrase', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-25',
      athleteMessage: 'foot is pain free today, feels back to normal',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: {
        easyThroughDate: '2026-05-24',
        checkInDate: '2026-05-25',
        status: 'active',
        bodyPart: 'foot',
      },
    });

    expect(result.injurySignal.detected).toBe(false);
    expect(result.recoverySignal.detected).toBe(true);
    expect(result.followUp?.status).toBe('closed');
    expect(result.followUp?.bodyPart).toBe('foot'); // preserved
  });

  it('does NOT open a follow-up window when no injury is reported', async () => {
    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: 'feeling solid, ready for tomorrow',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.injurySignal.detected).toBe(false);
    expect(result.followUp).toBeNull();
  });

  it('trims conversation to the last 20 messages', async () => {
    const longHistory = Array.from({ length: 25 }, (_, i) => ({
      role: 'athlete' as const,
      text: `old message ${i}`,
    }));

    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: 'how should I run today?',
      adaptive: baseAdaptive,
      conversation: longHistory,
      followUp: null,
    });

    expect(result.conversation.length).toBeLessThanOrEqual(20);
    expect(result.conversation[result.conversation.length - 1].role).toBe('coach');
  });
});

// ---------------------------------------------------------------------------
// runTrainingCoach — LLM happy path (mocked fetch)
// ---------------------------------------------------------------------------

describe('runTrainingCoach — LLM path', () => {
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

  it('uses the LLM-rendered message when the API returns a normal response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Easy run for 45 minutes today. Mind the foot.' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: 'how should I run today?',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.llmInvoked).toBe(true);
    expect(result.message).toBe('Easy run for 45 minutes today. Mind the foot.');
  });

  it('falls back to deterministic message when the LLM call errors out', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: '',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.llmInvoked).toBe(true);
    expect(result.message).toMatch(/Aerobic Run|Base weekly structure/);
  });

  it('still detects injury deterministically even when LLM provides the message text', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Tell me more about the foot — sharp or dull?' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await runTrainingCoach({
      today: '2026-05-21',
      athleteMessage: 'left foot hurts after the long run',
      adaptive: baseAdaptive,
      conversation: [],
      followUp: null,
    });

    expect(result.injurySignal.detected).toBe(true);
    expect(result.followUp?.status).toBe('active');
    expect(result.followUp?.bodyPart).toBe('foot');
    expect(result.message).toContain('foot');
  });
});
