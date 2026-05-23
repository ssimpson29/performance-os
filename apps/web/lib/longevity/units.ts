/**
 * Unit normalization for biomarker units. Lab reports use slightly
 * different forms of the same physical unit ("unit/L" vs "U/L",
 * "mL/min/1.73 m2" vs "mL/min/1.73m2", "mg/dl" vs "mg/dL") which
 * strict string comparison flags as mismatches. This module gives
 * both the review path (image-extraction) and the save path
 * (reference-ranges.evaluateMarker) one canonical comparison so
 * equivalent units count as equal.
 *
 * Lives in its own module to avoid a circular import between
 * image-extraction.ts and reference-ranges.ts (the latter imports
 * from the former for catalog matching helpers).
 */

export function normalizeUnit(unit: string): string {
  return unit
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')            // strip internal whitespace
    .replace(/²/g, '2')              // m² → m2
    .replace(/\^2/g, '2')            // m^2 → m2
    .replace(/^units?\//, 'u/')      // unit/L | units/L → u/l
    .replace(/^iu\//, 'u/');         // IU/L → u/l
}

export function unitsEquivalent(raw: string, canonical: string): boolean {
  return normalizeUnit(raw) === normalizeUnit(canonical);
}
