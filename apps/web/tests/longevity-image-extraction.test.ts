import { describe, expect, it } from 'vitest';

import { matchRawNameToCatalogKey } from '../lib/longevity/image-extraction';

describe('matchRawNameToCatalogKey', () => {
  it('matches an exact catalog key', () => {
    expect(matchRawNameToCatalogKey('apob')).toBe('apob');
  });

  it('matches an exact catalog displayName case-insensitively', () => {
    expect(matchRawNameToCatalogKey('Apolipoprotein B')).toBe('apob');
    expect(matchRawNameToCatalogKey('apolipoprotein b')).toBe('apob');
  });

  it('matches via alias hint (LDL Cholesterol → ldl_c)', () => {
    expect(matchRawNameToCatalogKey('LDL Cholesterol')).toBe('ldl_c');
    expect(matchRawNameToCatalogKey('LDL-C')).toBe('ldl_c');
  });

  it('matches via alias hint (hsCRP variants)', () => {
    expect(matchRawNameToCatalogKey('hs-CRP')).toBe('hs_crp');
    expect(matchRawNameToCatalogKey('High Sensitivity CRP')).toBe('hs_crp');
    expect(matchRawNameToCatalogKey('hsCRP')).toBe('hs_crp');
  });

  it('matches via alias hint substring within longer printed name', () => {
    expect(matchRawNameToCatalogKey('LDL Cholesterol Calculation')).toBe('ldl_c');
    expect(matchRawNameToCatalogKey('Vitamin D, 25-Hydroxy')).toBe('vitamin_d');
  });

  it('matches Lipoprotein(a) variants', () => {
    expect(matchRawNameToCatalogKey('Lipoprotein(a)')).toBe('lp_a');
    expect(matchRawNameToCatalogKey('Lp(a)')).toBe('lp_a');
  });

  it('returns null for unrelated names', () => {
    // Sodium used to be unmatched; it's now in the catalog after the CMP
    // expansion. Use markers that are genuinely outside the catalog —
    // exotic / niche / made-up names that no lab would print.
    expect(matchRawNameToCatalogKey('Coenzyme Q10')).toBeNull();
    expect(matchRawNameToCatalogKey('Random unknown marker')).toBeNull();
  });

  it('strips punctuation when matching', () => {
    expect(matchRawNameToCatalogKey('Vitamin D.')).toBe('vitamin_d');
  });

  it('matches eGFR variants', () => {
    expect(matchRawNameToCatalogKey('eGFR')).toBe('egfr');
    expect(matchRawNameToCatalogKey('Estimated GFR')).toBe('egfr');
  });
});
