import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runLongevityGuru, type RunLongevityGuruInput } from '../lib/agents/longevity-guru';

function baseInput(overrides: Partial<RunLongevityGuruInput> = {}): RunLongevityGuruInput {
  return {
    today: '2026-05-21',
    age: 38,
    sex: 'male',
    markers: [
      { markerKey: 'apob', value: 70, unit: 'mg/dL' },
      { markerKey: 'hs_crp', value: 0.5, unit: 'mg/L' },
    ],
    ...overrides,
  };
}

describe('runLongevityGuru — deterministic fallback', () => {
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

  it("returns 'low' recovery priority + empty priorities when all markers are at optimal", async () => {
    const result = await runLongevityGuru(baseInput());
    expect(result.llmInvoked).toBe(false);
    expect(result.priorities).toHaveLength(0);
    expect(result.longevityContext.recoveryPriority).toBe('low');
    expect(result.narrative).toMatch(/nothing material/i);
  });

  it("returns 'elevated' recovery priority when trainingLoadOverreach is sustained", async () => {
    const result = await runLongevityGuru(
      baseInput({
        trainingLoadOverreach: {
          sustainedOverreach: true,
          description: 'HRV trending down for 4+ weeks while completed > prescribed.',
        },
      }),
    );
    expect(result.longevityContext.recoveryPriority).toBe('elevated');
    expect(result.priorities[0]?.leverKey).toBe('performance_recovery');
    expect(result.conflictsWithTraining).toHaveLength(1);
    expect(result.conflictsWithTraining[0].description).toMatch(/sustained-signal-wins-for-longevity/);
  });

  it("returns 'elevated' when a cardiometabolic marker is high-severity (out of range AND outside optimal)", async () => {
    const result = await runLongevityGuru(
      baseInput({
        markers: [
          { markerKey: 'apob', value: 160, unit: 'mg/dL' }, // way above reference 130 + optimal 80
          { markerKey: 'hs_crp', value: 0.5, unit: 'mg/L' },
        ],
      }),
    );
    expect(result.priorities[0]?.leverKey).toBe('cardiometabolic');
    expect(result.longevityContext.recoveryPriority).toBe('elevated');
    expect(result.cautions[0]).toMatch(/outside clinical reference/);
  });

  it("returns 'normal' when there's a mild lever but nothing high-severity", async () => {
    const result = await runLongevityGuru(
      baseInput({
        markers: [
          { markerKey: 'apob', value: 100, unit: 'mg/dL' }, // in clinical range, outside optimal
        ],
      }),
    );
    expect(result.priorities.length).toBeGreaterThanOrEqual(1);
    expect(result.longevityContext.recoveryPriority).toBe('normal');
  });

  it('runs trend detection when history is supplied (≥2 samples)', async () => {
    const result = await runLongevityGuru(
      baseInput({
        markers: [
          {
            markerKey: 'apob',
            value: 100,
            unit: 'mg/dL',
            history: [
              { date: '2025-08-01', value: 140 },
              { date: '2025-11-01', value: 120 },
              { date: '2026-02-01', value: 110 },
              { date: '2026-05-01', value: 100 },
            ],
          },
        ],
      }),
    );
    const apob = result.markerEvaluations.find((m) => m.markerKey === 'apob');
    expect(apob?.trend?.direction).toBe('improving');
  });

  it('records a rationale for markers with unit mismatch and skips them from prioritization', async () => {
    const result = await runLongevityGuru(
      baseInput({
        markers: [
          { markerKey: 'apob', value: 1.0, unit: 'mmol/L' }, // wrong unit
        ],
      }),
    );
    const apob = result.markerEvaluations.find((m) => m.markerKey === 'apob');
    expect(apob?.rationale).toMatch(/Unit mismatch/);
    expect(result.priorities).toHaveLength(0);
  });
});

describe('runLongevityGuru — LLM path', () => {
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

  it('uses the LLM-rendered narrative when the API returns a normal response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Your cardiometabolic picture is solid; keep the routines that got you here.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    const result = await runLongevityGuru(baseInput());
    expect(result.llmInvoked).toBe(true);
    expect(result.narrative).toBe('Your cardiometabolic picture is solid; keep the routines that got you here.');
  });

  it('falls back to deterministic narrative when LLM errors out', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const result = await runLongevityGuru(baseInput());
    expect(result.llmInvoked).toBe(true);
    expect(result.narrative).toBeTruthy();
  });
});
