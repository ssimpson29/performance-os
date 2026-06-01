import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { maxToolIterations, resolveModel } from '../lib/agents/llm-model';

const ENV_KEYS = ['AI_COACH_MODEL', 'AI_COACH_MODEL_HEAVY', 'AI_COACH_MAX_TOOL_ITERATIONS'] as const;

describe('resolveModel', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns undefined when AI_COACH_MODEL is unset (callers fall back)', () => {
    expect(resolveModel('coach-chat')).toBeUndefined();
    expect(resolveModel('image-extraction')).toBeUndefined();
  });

  it('uses the default model for cheap surfaces', () => {
    process.env.AI_COACH_MODEL = 'gpt-4o-mini';
    expect(resolveModel('coach-chat')).toBe('gpt-4o-mini');
    expect(resolveModel('todays-call')).toBe('gpt-4o-mini');
    expect(resolveModel('longevity-eval')).toBe('gpt-4o-mini');
  });

  it('routes heavy surfaces to AI_COACH_MODEL_HEAVY when set', () => {
    process.env.AI_COACH_MODEL = 'gpt-4o-mini';
    process.env.AI_COACH_MODEL_HEAVY = 'gpt-4o';
    expect(resolveModel('image-extraction')).toBe('gpt-4o'); // heavy
    expect(resolveModel('coach-chat')).toBe('gpt-4o-mini'); // unaffected
  });

  it('heavy surfaces fall back to the default when no heavy model is configured', () => {
    process.env.AI_COACH_MODEL = 'gpt-4o-mini';
    expect(resolveModel('image-extraction')).toBe('gpt-4o-mini');
  });
});

describe('maxToolIterations', () => {
  const saved = process.env.AI_COACH_MAX_TOOL_ITERATIONS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_COACH_MAX_TOOL_ITERATIONS;
    else process.env.AI_COACH_MAX_TOOL_ITERATIONS = saved;
  });

  it('defaults to 5', () => {
    delete process.env.AI_COACH_MAX_TOOL_ITERATIONS;
    expect(maxToolIterations()).toBe(5);
  });

  it('honors a valid override and ignores garbage', () => {
    process.env.AI_COACH_MAX_TOOL_ITERATIONS = '3';
    expect(maxToolIterations()).toBe(3);
    process.env.AI_COACH_MAX_TOOL_ITERATIONS = 'notanumber';
    expect(maxToolIterations()).toBe(5);
    process.env.AI_COACH_MAX_TOOL_ITERATIONS = '0';
    expect(maxToolIterations()).toBe(5);
  });
});
