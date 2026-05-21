import { describe, expect, it } from 'vitest';

import { prioritizeLongevityActions, type MarkerInput } from '../lib/longevity/prioritization';

function marker(overrides: Partial<MarkerInput> = {}): MarkerInput {
  return {
    markerKey: 'apob',
    displayName: 'Apolipoprotein B',
    domain: 'cardiometabolic',
    flag: 'in_range',
    optimalDelta: 0,
    trend: null,
    ...overrides,
  };
}

describe('prioritizeLongevityActions', () => {
  it('returns no priorities when every marker is at optimal with no trend', () => {
    const result = prioritizeLongevityActions({
      markers: [marker(), marker({ markerKey: 'hdl_c', domain: 'cardiometabolic' })],
    });
    expect(result.priorities).toHaveLength(0);
    expect(result.watching).toHaveLength(0);
  });

  it('surfaces a single high-severity lever as the only priority', () => {
    const result = prioritizeLongevityActions({
      markers: [
        marker({ flag: 'high', optimalDelta: 1.5 }),
        marker({ markerKey: 'hdl_c' }),
      ],
    });
    expect(result.priorities).toHaveLength(1);
    expect(result.priorities[0].leverKey).toBe('cardiometabolic');
    expect(result.priorities[0].contributingMarkers).toContain('Apolipoprotein B');
  });

  it('aggregates multiple markers within the same domain into one lever', () => {
    const result = prioritizeLongevityActions({
      markers: [
        marker({ flag: 'high', optimalDelta: 1.0 }),
        marker({ markerKey: 'ldl_c', displayName: 'LDL Cholesterol', flag: 'high', optimalDelta: 1.0 }),
        marker({ markerKey: 'hba1c', displayName: 'HbA1c', flag: 'in_range', optimalDelta: 0.5 }),
      ],
    });
    expect(result.priorities[0].leverKey).toBe('cardiometabolic');
    expect(result.priorities[0].contributingMarkers).toHaveLength(3);
  });

  it('improving trend de-prioritizes a lever even when the value is outside optimal', () => {
    const noTrend = prioritizeLongevityActions({
      markers: [marker({ flag: 'in_range', optimalDelta: 1.0 })],
    });
    const improving = prioritizeLongevityActions({
      markers: [
        marker({
          flag: 'in_range',
          optimalDelta: 1.0,
          trend: { direction: 'improving', magnitude: 'moderate' },
        }),
      ],
    });

    // Improving should reduce severity.
    if (improving.priorities.length === 0) {
      // de-prioritized entirely
      expect(improving.priorities).toHaveLength(0);
    } else {
      expect(improving.priorities[0].severity).toBeLessThan(noTrend.priorities[0].severity);
    }
  });

  it('degrading trend increases severity', () => {
    const stable = prioritizeLongevityActions({
      markers: [marker({ flag: 'in_range', optimalDelta: 0.5 })],
    });
    const degrading = prioritizeLongevityActions({
      markers: [
        marker({
          flag: 'in_range',
          optimalDelta: 0.5,
          trend: { direction: 'degrading', magnitude: 'major' },
        }),
      ],
    });
    expect(degrading.priorities[0].severity).toBeGreaterThan(stable.priorities[0].severity);
  });

  it('caps surfaced priorities at 3 with the rest in watching', () => {
    const result = prioritizeLongevityActions({
      markers: [
        marker({ markerKey: 'apob', domain: 'cardiometabolic', flag: 'high', optimalDelta: 1.5 }),
        marker({ markerKey: 'hs_crp', displayName: 'hs-CRP', domain: 'inflammation', flag: 'high', optimalDelta: 1.5 }),
        marker({ markerKey: 'total_testosterone', displayName: 'Testosterone', domain: 'hormonal', flag: 'low', optimalDelta: 1.5 }),
        marker({ markerKey: 'vitamin_d', displayName: 'Vitamin D', domain: 'nutrients', flag: 'low', optimalDelta: 1.5 }),
        marker({ markerKey: 'alt', displayName: 'ALT', domain: 'liver_kidney', flag: 'high', optimalDelta: 1.5 }),
      ],
    });
    expect(result.priorities).toHaveLength(3);
    expect(result.watching).toHaveLength(2);
  });

  it('domain priority weight breaks ties: cardiometabolic > hormonal at equal severity', () => {
    const result = prioritizeLongevityActions({
      markers: [
        marker({ flag: 'high', optimalDelta: 0.5, domain: 'hormonal', markerKey: 't', displayName: 'T' }),
        marker({ flag: 'high', optimalDelta: 0.5, domain: 'cardiometabolic' }),
      ],
    });
    expect(result.priorities[0].leverKey).toBe('cardiometabolic');
  });

  it('adds sustained training-load overreach as a performance_recovery lever even with no markers', () => {
    const result = prioritizeLongevityActions({
      markers: [],
      trainingLoadOverreach: {
        sustainedOverreach: true,
        description: '4+ weeks of HRV trending down with prescribed-vs-actual delta positive — chronic overreach.',
      },
    });
    expect(result.priorities[0].leverKey).toBe('performance_recovery');
    expect(result.priorities[0].rationale).toMatch(/HRV|overreach/);
  });

  it('boosts performance_recovery above purely-metabolic when overreach is sustained AND equal markers exist', () => {
    const result = prioritizeLongevityActions({
      markers: [marker({ flag: 'in_range', optimalDelta: 0.5 })], // mild cardiometabolic
      trainingLoadOverreach: { sustainedOverreach: true },
    });
    expect(result.priorities[0].leverKey).toBe('performance_recovery');
  });
});
