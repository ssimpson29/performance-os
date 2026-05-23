/**
 * Reference-range catalog for the Longevity Guru's deterministic layer.
 *
 * Each entry encodes both the clinical reference range (bounded by disease,
 * pulled from common lab cutoffs) and a tighter "optimal" range
 * (longevity-leaning, evidence-informed). The prioritization engine uses
 * the optimal range to flag "in range but not optimal" as a real lever.
 *
 * `desiredDirection` tells the trend detector which way is "improving":
 *   - 'low'    — lower is better (e.g. ApoB, LDL-C, hs-CRP)
 *   - 'high'   — higher is better (e.g. HDL-C, vitamin D)
 *   - 'middle' — in-range is better; both extremes are flagged
 *
 * Source notes in `evidenceNotes` are for traceability only — not validated
 * citations. Users of this module should treat ranges as advisory, not
 * clinical decision support.
 */

import { unitsEquivalent } from './units';

export type BiomarkerDomain =
  | 'cardiometabolic'
  | 'inflammation'
  | 'hormonal'
  | 'nutrients'
  | 'liver_kidney'
  | 'performance_recovery'
  | 'other';

export type DesiredDirection = 'low' | 'high' | 'middle';

export type ReferenceBand = { low: number; high: number };

export type AgeBandOverride = {
  /** Lower-bound age (inclusive). */
  ageMin: number;
  /** Upper-bound age (exclusive). Use Infinity for "and up". */
  ageMax: number;
  /** Optional sex filter — when set, this override only applies to the given sex. */
  sex?: 'male' | 'female';
  reference?: ReferenceBand;
  optimal?: ReferenceBand;
};

export type MarkerSpec = {
  key: string;
  displayName: string;
  domain: BiomarkerDomain;
  canonicalUnit: string;
  desiredDirection: DesiredDirection;
  /** Default reference range for adults when no override applies. */
  reference: ReferenceBand;
  /** Optional optimal range; tighter than reference, longevity-leaning. */
  optimal?: ReferenceBand;
  /** Age/sex overrides, checked in order; first match wins. */
  overrides?: AgeBandOverride[];
  evidenceNotes?: string;
};

// ---------------------------------------------------------------------------
// Catalog — initial set, ~14 markers covering the 80/20 of longevity panels.
// ---------------------------------------------------------------------------

export const REFERENCE_CATALOG: Record<string, MarkerSpec> = {
  apob: {
    key: 'apob',
    displayName: 'Apolipoprotein B',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'low',
    reference: { low: 0, high: 130 },
    optimal: { low: 0, high: 80 },
    evidenceNotes: 'ApoB <80 mg/dL is the longevity-leaning target; clinical reference cutoff ~130.',
  },
  ldl_c: {
    key: 'ldl_c',
    displayName: 'LDL Cholesterol',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'low',
    reference: { low: 0, high: 130 },
    optimal: { low: 0, high: 100 },
  },
  hdl_c: {
    key: 'hdl_c',
    displayName: 'HDL Cholesterol',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'high',
    reference: { low: 40, high: 200 },
    optimal: { low: 50, high: 200 },
  },
  triglycerides: {
    key: 'triglycerides',
    displayName: 'Triglycerides',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'low',
    reference: { low: 0, high: 150 },
    optimal: { low: 0, high: 100 },
  },
  lp_a: {
    key: 'lp_a',
    displayName: 'Lipoprotein(a)',
    domain: 'cardiometabolic',
    canonicalUnit: 'nmol/L',
    desiredDirection: 'low',
    reference: { low: 0, high: 75 },
    optimal: { low: 0, high: 50 },
    evidenceNotes: 'Largely genetically determined; values >75 nmol/L (~30 mg/dL) elevate ASCVD risk.',
  },
  fasting_glucose: {
    key: 'fasting_glucose',
    displayName: 'Fasting Glucose',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'low',
    reference: { low: 70, high: 99 },
    optimal: { low: 70, high: 90 },
  },
  hba1c: {
    key: 'hba1c',
    displayName: 'HbA1c',
    domain: 'cardiometabolic',
    canonicalUnit: '%',
    desiredDirection: 'low',
    reference: { low: 4.0, high: 5.6 },
    optimal: { low: 4.5, high: 5.2 },
  },
  fasting_insulin: {
    key: 'fasting_insulin',
    displayName: 'Fasting Insulin',
    domain: 'cardiometabolic',
    canonicalUnit: 'uIU/mL',
    desiredDirection: 'low',
    reference: { low: 2, high: 25 },
    optimal: { low: 2, high: 8 },
  },
  hs_crp: {
    key: 'hs_crp',
    displayName: 'High-sensitivity CRP',
    domain: 'inflammation',
    canonicalUnit: 'mg/L',
    desiredDirection: 'low',
    reference: { low: 0, high: 3 },
    optimal: { low: 0, high: 1 },
  },
  total_testosterone: {
    key: 'total_testosterone',
    displayName: 'Total Testosterone',
    domain: 'hormonal',
    canonicalUnit: 'ng/dL',
    desiredDirection: 'high',
    // Default reference is adult male; female default lives in overrides.
    reference: { low: 300, high: 1000 },
    optimal: { low: 600, high: 1000 },
    overrides: [
      { ageMin: 0, ageMax: Infinity, sex: 'female', reference: { low: 15, high: 70 }, optimal: { low: 30, high: 70 } },
      // Age-band override for men 40+: same reference but lower optimal floor.
      { ageMin: 40, ageMax: Infinity, sex: 'male', optimal: { low: 500, high: 1000 } },
    ],
  },
  vitamin_d: {
    key: 'vitamin_d',
    displayName: '25-Hydroxy Vitamin D',
    domain: 'nutrients',
    canonicalUnit: 'ng/mL',
    desiredDirection: 'high',
    reference: { low: 30, high: 100 },
    optimal: { low: 40, high: 80 },
  },
  ferritin: {
    key: 'ferritin',
    displayName: 'Ferritin',
    domain: 'nutrients',
    canonicalUnit: 'ng/mL',
    desiredDirection: 'middle',
    reference: { low: 30, high: 300 },
    optimal: { low: 50, high: 150 },
    overrides: [
      { ageMin: 0, ageMax: Infinity, sex: 'female', reference: { low: 15, high: 150 }, optimal: { low: 30, high: 100 } },
    ],
    evidenceNotes: 'Low ferritin suggests iron deficiency; high ferritin can suggest inflammation or iron overload.',
  },
  omega_3_index: {
    key: 'omega_3_index',
    displayName: 'Omega-3 Index',
    domain: 'nutrients',
    canonicalUnit: '%',
    desiredDirection: 'high',
    reference: { low: 4, high: 12 },
    optimal: { low: 8, high: 12 },
  },
  alt: {
    key: 'alt',
    displayName: 'ALT (Alanine Aminotransferase)',
    domain: 'liver_kidney',
    canonicalUnit: 'U/L',
    desiredDirection: 'low',
    reference: { low: 0, high: 40 },
    optimal: { low: 0, high: 25 },
  },
  egfr: {
    key: 'egfr',
    displayName: 'Estimated GFR',
    domain: 'liver_kidney',
    canonicalUnit: 'mL/min/1.73m2',
    desiredDirection: 'high',
    reference: { low: 60, high: 120 },
    optimal: { low: 90, high: 120 },
  },

  // ---------------------------------------------------------------------
  // Standard CMP + lipid panel markers — added 2026-05-23 after the
  // Longevity Guru's first real panel ingest showed ~20 standard lab
  // markers all flagging "No match." The longevity-leaning set above
  // (apob / lp(a) / ApoE etc.) doesn't include the basics that every
  // CMP / BMP / lipid panel produces. Adding them here so the Guru
  // can actually reason about the athlete's full bloodwork.
  //
  // Ranges below are adult clinical references; optimal ranges are
  // only set where there's an evidence-informed longevity target
  // (e.g. total cholesterol low side, BUN mid-range for protein status).
  // ---------------------------------------------------------------------

  total_cholesterol: {
    key: 'total_cholesterol',
    displayName: 'Total Cholesterol',
    domain: 'cardiometabolic',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'low',
    reference: { low: 0, high: 200 },
    optimal: { low: 0, high: 180 },
  },
  ast: {
    key: 'ast',
    displayName: 'AST (Aspartate Aminotransferase)',
    domain: 'liver_kidney',
    canonicalUnit: 'U/L',
    desiredDirection: 'low',
    reference: { low: 0, high: 40 },
    optimal: { low: 0, high: 25 },
  },
  alkaline_phosphatase: {
    key: 'alkaline_phosphatase',
    displayName: 'Alkaline Phosphatase',
    domain: 'liver_kidney',
    canonicalUnit: 'U/L',
    desiredDirection: 'middle',
    reference: { low: 40, high: 150 },
  },
  total_bilirubin: {
    key: 'total_bilirubin',
    displayName: 'Total Bilirubin',
    domain: 'liver_kidney',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'middle',
    reference: { low: 0.1, high: 1.2 },
  },
  bun: {
    key: 'bun',
    displayName: 'Blood Urea Nitrogen (BUN)',
    domain: 'liver_kidney',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'middle',
    reference: { low: 7, high: 20 },
    optimal: { low: 10, high: 18 },
    evidenceNotes: 'Mid-range BUN suggests adequate protein intake without overt kidney stress.',
  },
  creatinine: {
    key: 'creatinine',
    displayName: 'Creatinine',
    domain: 'liver_kidney',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'middle',
    // General adult reference. Sex-specific overrides: males trend higher
    // because of muscle mass.
    reference: { low: 0.6, high: 1.3 },
    overrides: [
      { ageMin: 0, ageMax: Infinity, sex: 'female', reference: { low: 0.5, high: 1.1 } },
      { ageMin: 0, ageMax: Infinity, sex: 'male', reference: { low: 0.7, high: 1.3 } },
    ],
  },
  creatinine_clearance: {
    key: 'creatinine_clearance',
    displayName: 'Estimated Creatinine Clearance',
    domain: 'liver_kidney',
    canonicalUnit: 'mL/min',
    desiredDirection: 'high',
    reference: { low: 90, high: 140 },
  },
  albumin: {
    key: 'albumin',
    displayName: 'Albumin',
    domain: 'liver_kidney',
    canonicalUnit: 'g/dL',
    desiredDirection: 'middle',
    reference: { low: 3.5, high: 5.0 },
    optimal: { low: 4.0, high: 5.0 },
    evidenceNotes: 'Higher-end albumin (within range) tracks longevity in observational data — proxy for healthy protein status and low inflammation.',
  },
  total_protein: {
    key: 'total_protein',
    displayName: 'Total Protein',
    domain: 'liver_kidney',
    canonicalUnit: 'g/dL',
    desiredDirection: 'middle',
    reference: { low: 6.0, high: 8.3 },
  },
  sodium: {
    key: 'sodium',
    displayName: 'Sodium',
    domain: 'other',
    canonicalUnit: 'mmol/L',
    desiredDirection: 'middle',
    reference: { low: 135, high: 145 },
  },
  potassium: {
    key: 'potassium',
    displayName: 'Potassium',
    domain: 'other',
    canonicalUnit: 'mmol/L',
    desiredDirection: 'middle',
    reference: { low: 3.5, high: 5.0 },
  },
  chloride: {
    key: 'chloride',
    displayName: 'Chloride',
    domain: 'other',
    canonicalUnit: 'mmol/L',
    desiredDirection: 'middle',
    reference: { low: 96, high: 106 },
  },
  co2: {
    key: 'co2',
    displayName: 'CO2 (Bicarbonate)',
    domain: 'other',
    canonicalUnit: 'mmol/L',
    desiredDirection: 'middle',
    reference: { low: 22, high: 28 },
  },
  calcium: {
    key: 'calcium',
    displayName: 'Calcium',
    domain: 'nutrients',
    canonicalUnit: 'mg/dL',
    desiredDirection: 'middle',
    reference: { low: 8.5, high: 10.5 },
  },
  anion_gap: {
    key: 'anion_gap',
    displayName: 'Anion Gap',
    domain: 'other',
    canonicalUnit: 'mmol/L',
    desiredDirection: 'middle',
    reference: { low: 8, high: 16 },
  },
  osmolality: {
    key: 'osmolality',
    displayName: 'Osmolality (Calculated)',
    domain: 'other',
    canonicalUnit: 'mOsm/kg',
    desiredDirection: 'middle',
    reference: { low: 275, high: 295 },
  },
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type MarkerFlag = 'low' | 'in_range' | 'high' | 'unknown_marker';

export type EvaluateMarkerInput = {
  markerKey: string;
  value: number;
  unit: string;
  age?: number;
  sex?: 'male' | 'female';
};

export type EvaluateMarkerResult = {
  flag: MarkerFlag;
  reference: ReferenceBand | null;
  optimal: ReferenceBand | null;
  /** Distance from optimal as a fraction of the optimal-range width. 0 when inside optimal. */
  optimalDelta: number;
  rationale: string;
};

function pickRanges(
  spec: MarkerSpec,
  age?: number,
  sex?: 'male' | 'female',
): { reference: ReferenceBand; optimal: ReferenceBand | null } {
  let reference = spec.reference;
  let optimal = spec.optimal ?? null;

  if (spec.overrides) {
    for (const ov of spec.overrides) {
      const ageOk = age == null ? false : age >= ov.ageMin && age < ov.ageMax;
      const sexOk = ov.sex == null || ov.sex === sex;
      if (ageOk && sexOk) {
        if (ov.reference) reference = ov.reference;
        if (ov.optimal) optimal = ov.optimal;
      }
    }
  }
  return { reference, optimal };
}

function computeOptimalDelta(value: number, optimal: ReferenceBand | null): number {
  if (!optimal) return 0;
  if (value >= optimal.low && value <= optimal.high) return 0;
  const width = Math.max(1, optimal.high - optimal.low);
  if (value < optimal.low) return (optimal.low - value) / width;
  return (value - optimal.high) / width;
}

export function evaluateMarker(input: EvaluateMarkerInput): EvaluateMarkerResult {
  const spec = REFERENCE_CATALOG[input.markerKey];
  if (!spec) {
    return {
      flag: 'unknown_marker',
      reference: null,
      optimal: null,
      optimalDelta: 0,
      rationale: `Marker '${input.markerKey}' not in reference catalog.`,
    };
  }
  // Use unitsEquivalent so "mL/min/1.73 m2" vs "mL/min/1.73m2",
  // "unit/L" vs "U/L", "IU/L" vs "U/L", and "mg/dl" vs "mg/dL" all
  // compare as equal. The save route hits this path; strict string
  // equality was rejecting trivially-equivalent labels with "Caller
  // must normalize first" and blocking otherwise-valid panels.
  if (!unitsEquivalent(input.unit, spec.canonicalUnit)) {
    throw new Error(
      `Unit mismatch for ${input.markerKey}: expected ${spec.canonicalUnit}, got ${input.unit}. Caller must normalize first.`,
    );
  }

  const { reference, optimal } = pickRanges(spec, input.age, input.sex);
  const optimalDelta = computeOptimalDelta(input.value, optimal);

  let flag: MarkerFlag;
  if (input.value < reference.low) flag = 'low';
  else if (input.value > reference.high) flag = 'high';
  else flag = 'in_range';

  let rationale: string;
  if (flag === 'low') {
    rationale = `${spec.displayName} is below clinical reference (${reference.low}–${reference.high} ${spec.canonicalUnit}).`;
  } else if (flag === 'high') {
    rationale = `${spec.displayName} is above clinical reference (${reference.low}–${reference.high} ${spec.canonicalUnit}).`;
  } else if (optimal && optimalDelta > 0) {
    rationale = `${spec.displayName} is in clinical reference but outside the longevity-optimal range (${optimal.low}–${optimal.high} ${spec.canonicalUnit}).`;
  } else {
    rationale = `${spec.displayName} is in range.`;
  }

  return { flag, reference, optimal, optimalDelta, rationale };
}

export function getMarkerSpec(markerKey: string): MarkerSpec | null {
  return REFERENCE_CATALOG[markerKey] ?? null;
}
