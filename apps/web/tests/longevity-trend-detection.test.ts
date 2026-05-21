import { describe, expect, it } from 'vitest';

import { detectMarkerTrend, type MarkerSample } from '../lib/longevity/trend-detection';

// Helper: build an evenly-spaced quarterly series ending today.
function buildSeries(values: number[], dailyStep = 30): MarkerSample[] {
  return values.map((value, i) => ({
    date: new Date(Date.UTC(2025, 0, 1 + i * dailyStep)).toISOString().slice(0, 10),
    value,
  }));
}

describe('detectMarkerTrend', () => {
  it('returns stable + 0 confidence on empty history', () => {
    const t = detectMarkerTrend([], 'low');
    expect(t.direction).toBe('stable');
    expect(t.confidence).toBe(0);
    expect(t.sampleCount).toBe(0);
  });

  it('returns stable + low confidence on a single sample', () => {
    const t = detectMarkerTrend(buildSeries([100]), 'low');
    expect(t.direction).toBe('stable');
    expect(t.confidence).toBeLessThan(0.2);
  });

  it("classifies a falling ApoB series as 'improving' when desiredDirection is 'low'", () => {
    const t = detectMarkerTrend(buildSeries([130, 120, 110, 100, 90, 80]), 'low');
    expect(t.direction).toBe('improving');
    expect(t.confidence).toBeGreaterThan(0.3);
  });

  it("classifies a falling HDL series as 'degrading' when desiredDirection is 'high'", () => {
    const t = detectMarkerTrend(buildSeries([70, 65, 60, 55, 50, 45]), 'high');
    expect(t.direction).toBe('degrading');
  });

  it("classifies a rising HDL series as 'improving' when desiredDirection is 'high'", () => {
    const t = detectMarkerTrend(buildSeries([45, 50, 55, 60, 65, 70]), 'high');
    expect(t.direction).toBe('improving');
  });

  it('flags major magnitude on 25%+ swing across 90+ days', () => {
    // 6 samples * 30 days = 150 days span. Mean ~55. Earlier mean ~75, later mean ~35. Change ~73%.
    const t = detectMarkerTrend(buildSeries([90, 80, 70, 50, 30, 10]), 'low');
    expect(t.magnitude).toBe('major');
    expect(t.spanDays).toBeGreaterThanOrEqual(90);
  });

  it("doesn't escalate to major when sample count is too low even if % change is high", () => {
    // Two samples — n < 3 → magnitude can't be 'major' under the rule.
    const t = detectMarkerTrend(
      [
        { date: '2025-01-01', value: 100 },
        { date: '2025-09-01', value: 50 },
      ],
      'low',
    );
    expect(t.direction).toBe('improving');
    expect(t.magnitude).not.toBe('major');
  });

  it("doesn't escalate to major when span is too short even if change is dramatic", () => {
    // 5 samples but only 28 days apart.
    const t = detectMarkerTrend(buildSeries([130, 110, 90, 70, 50], 7), 'low');
    expect(t.direction).toBe('improving');
    expect(t.magnitude).not.toBe('major');
  });

  it('classifies steady jitter within noise floor as stable', () => {
    const t = detectMarkerTrend(buildSeries([100, 101, 99, 100, 102, 98, 101]), 'low');
    expect(t.direction).toBe('stable');
  });

  it('treats a single outlier as noise rather than direction flip', () => {
    const t = detectMarkerTrend(buildSeries([100, 100, 100, 60, 100, 100, 100]), 'low');
    expect(t.direction).toBe('stable');
  });

  it("treats 'middle'-desired markers as stable regardless of direction (prioritization handles them)", () => {
    const t = detectMarkerTrend(buildSeries([60, 80, 100, 120, 140, 160]), 'middle');
    expect(t.direction).toBe('stable');
  });

  it('reports spanDays correctly', () => {
    const t = detectMarkerTrend(buildSeries([100, 90, 80, 70], 30), 'low');
    expect(t.spanDays).toBe(90);
  });
});
