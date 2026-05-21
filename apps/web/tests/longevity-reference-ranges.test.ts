import { describe, expect, it } from 'vitest';

import { evaluateMarker, getMarkerSpec, REFERENCE_CATALOG } from '../lib/longevity/reference-ranges';

describe('REFERENCE_CATALOG shape', () => {
  it('covers the initial set of ~14 markers', () => {
    const keys = Object.keys(REFERENCE_CATALOG);
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const k of ['apob', 'ldl_c', 'hdl_c', 'triglycerides', 'lp_a', 'hba1c', 'hs_crp', 'total_testosterone']) {
      expect(keys).toContain(k);
    }
  });

  it('every entry has reference, canonicalUnit, domain, desiredDirection', () => {
    for (const [k, spec] of Object.entries(REFERENCE_CATALOG)) {
      expect(spec.reference.low, `${k} reference.low`).toBeTypeOf('number');
      expect(spec.reference.high, `${k} reference.high`).toBeTypeOf('number');
      expect(spec.canonicalUnit, `${k} canonicalUnit`).toBeTruthy();
      expect(['cardiometabolic', 'inflammation', 'hormonal', 'nutrients', 'liver_kidney', 'performance_recovery', 'other']).toContain(spec.domain);
      expect(['low', 'high', 'middle']).toContain(spec.desiredDirection);
    }
  });
});

describe('evaluateMarker', () => {
  it("returns 'unknown_marker' for markers not in the catalog", () => {
    const r = evaluateMarker({ markerKey: 'made_up_marker', value: 42, unit: 'mg/dL' });
    expect(r.flag).toBe('unknown_marker');
    expect(r.reference).toBeNull();
    expect(r.optimal).toBeNull();
    expect(r.rationale).toMatch(/not in reference catalog/);
  });

  it('throws on unit mismatch (caller must normalize first)', () => {
    expect(() => evaluateMarker({ markerKey: 'apob', value: 80, unit: 'mmol/L' })).toThrow(/Unit mismatch/);
  });

  it('flags "in_range" for an ApoB of 100 (within reference 0-130) but flags optimal delta', () => {
    const r = evaluateMarker({ markerKey: 'apob', value: 100, unit: 'mg/dL' });
    expect(r.flag).toBe('in_range');
    expect(r.optimal).toEqual({ low: 0, high: 80 });
    expect(r.optimalDelta).toBeGreaterThan(0);
    expect(r.rationale).toMatch(/longevity-optimal/);
  });

  it('flags "in_range" with zero optimal delta when value is inside optimal', () => {
    const r = evaluateMarker({ markerKey: 'apob', value: 60, unit: 'mg/dL' });
    expect(r.flag).toBe('in_range');
    expect(r.optimalDelta).toBe(0);
    expect(r.rationale).toMatch(/in range/);
    expect(r.rationale).not.toMatch(/longevity-optimal/);
  });

  it('flags "high" for an ApoB of 140 (above reference 130)', () => {
    const r = evaluateMarker({ markerKey: 'apob', value: 140, unit: 'mg/dL' });
    expect(r.flag).toBe('high');
    expect(r.rationale).toMatch(/above clinical reference/);
  });

  it('flags "low" for an HDL of 35 (below reference 40)', () => {
    const r = evaluateMarker({ markerKey: 'hdl_c', value: 35, unit: 'mg/dL' });
    expect(r.flag).toBe('low');
    expect(r.rationale).toMatch(/below clinical reference/);
  });

  it('applies female override for total testosterone', () => {
    const r = evaluateMarker({ markerKey: 'total_testosterone', value: 50, unit: 'ng/dL', age: 35, sex: 'female' });
    expect(r.flag).toBe('in_range'); // female reference 15-70
    expect(r.reference).toEqual({ low: 15, high: 70 });
  });

  it('applies age 40+ male optimal override on testosterone', () => {
    const r40plus = evaluateMarker({ markerKey: 'total_testosterone', value: 520, unit: 'ng/dL', age: 45, sex: 'male' });
    // Male age 40+ override sets optimal to {500, 1000}; 520 is inside optimal -> delta 0
    expect(r40plus.optimal).toEqual({ low: 500, high: 1000 });
    expect(r40plus.optimalDelta).toBe(0);

    const rUnder40 = evaluateMarker({ markerKey: 'total_testosterone', value: 520, unit: 'ng/dL', age: 30, sex: 'male' });
    // Under-40 male uses default optimal {600, 1000}; 520 is outside optimal -> delta > 0
    expect(rUnder40.optimal).toEqual({ low: 600, high: 1000 });
    expect(rUnder40.optimalDelta).toBeGreaterThan(0);
  });

  it('scales optimalDelta as a fraction of the optimal-range width', () => {
    // hs_crp optimal {0,1}; reference {0,3}. Value=2 -> delta = (2 - 1) / max(1, 1-0) = 1.
    const r = evaluateMarker({ markerKey: 'hs_crp', value: 2, unit: 'mg/L' });
    expect(r.flag).toBe('in_range');
    expect(r.optimalDelta).toBe(1);
  });
});

describe('getMarkerSpec', () => {
  it('returns the spec for a known marker', () => {
    const spec = getMarkerSpec('apob');
    expect(spec?.canonicalUnit).toBe('mg/dL');
    expect(spec?.domain).toBe('cardiometabolic');
  });

  it('returns null for an unknown marker', () => {
    expect(getMarkerSpec('made_up_marker')).toBeNull();
  });
});
