import type { DesiredDirection } from './reference-ranges';

/**
 * Trend detection for biomarker history. Longer time horizon than the
 * Training Coach's recovery-trend detector — works over months/quarters
 * and respects each marker's desiredDirection so "improving" means
 * "value moved the direction we want" rather than "value went up".
 *
 * Magnitude rules:
 *   - 'major'    requires ≥3 samples spanning ≥90 days AND the change
 *                exceeds 25% of the overall mean (large absolute swing).
 *   - 'moderate' requires the change exceeds 10% of the overall mean.
 *   - 'minor'    is everything else above the noise floor.
 *   - Below the noise floor → direction is 'stable'.
 *
 * Confidence scales with sample count, time span, and inverse coefficient
 * of variation. Outlier-resistant via earlier-half vs later-half means.
 */

export type TrendDirection = 'improving' | 'stable' | 'degrading';
export type TrendMagnitude = 'minor' | 'moderate' | 'major';

export type MarkerSample = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  value: number;
};

export type DetectMarkerTrendResult = {
  direction: TrendDirection;
  magnitude: TrendMagnitude;
  /** 0..1 confidence based on sample count, time span, and signal-to-noise. */
  confidence: number;
  sampleCount: number;
  /** Span in whole days from the earliest to the latest sample. */
  spanDays: number;
  rationale: string;
};

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(`${aIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const b = new Date(`${bIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.round(Math.abs(a - b) / (24 * 60 * 60 * 1000));
}

export function detectMarkerTrend(
  history: MarkerSample[],
  desiredDirection: DesiredDirection,
): DetectMarkerTrendResult {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;

  if (n === 0) {
    return {
      direction: 'stable',
      magnitude: 'minor',
      confidence: 0,
      sampleCount: 0,
      spanDays: 0,
      rationale: 'no samples',
    };
  }

  const spanDays = n >= 2 ? daysBetween(sorted[0].date, sorted[n - 1].date) : 0;

  if (n < 2) {
    return {
      direction: 'stable',
      magnitude: 'minor',
      confidence: 0.1,
      sampleCount: n,
      spanDays,
      rationale: 'single sample — cannot infer direction',
    };
  }

  const values = sorted.map((s) => s.value);
  const half = Math.floor(n / 2);
  const earlier = values.slice(0, half);
  const later = values.slice(n - half);
  const rawDelta = mean(later) - mean(earlier); // positive => values rising

  const overallMean = mean(values);
  const overallStd = stddev(values);
  // Noise floor: at least 5% of the mean OR half a stddev (whichever is larger).
  const noiseFloor = Math.max(Math.abs(overallMean) * 0.05, overallStd * 0.5);

  // Decide direction relative to desiredDirection.
  let direction: TrendDirection;
  if (Math.abs(rawDelta) <= noiseFloor) {
    direction = 'stable';
  } else if (desiredDirection === 'middle') {
    // For middle-desired markers, any move is "watch" — call it stable
    // unless the value moves toward an extreme of the range. The
    // prioritization engine handles this case via the optimal-delta on
    // the current value, so trend stays 'stable' here.
    direction = 'stable';
  } else {
    const wantUp = desiredDirection === 'high';
    if (rawDelta > 0) direction = wantUp ? 'improving' : 'degrading';
    else direction = wantUp ? 'degrading' : 'improving';
  }

  // Magnitude — gated by sample count + time span.
  const relativeChange = overallMean === 0 ? 0 : Math.abs(rawDelta) / Math.abs(overallMean);
  let magnitude: TrendMagnitude = 'minor';
  if (direction !== 'stable') {
    if (relativeChange >= 0.25 && n >= 3 && spanDays >= 90) {
      magnitude = 'major';
    } else if (relativeChange >= 0.10) {
      magnitude = 'moderate';
    }
  }

  // Confidence — composite.
  const sampleBoost = Math.min(1, n / 5);
  const spanBoost = Math.min(1, spanDays / 180); // ~6 months → full credit
  const cv = overallMean > 0 ? overallStd / overallMean : 0;
  const noiseDiscount = Math.max(0, 1 - cv * 2);
  const confidence = Math.round(sampleBoost * spanBoost * noiseDiscount * 100) / 100;

  const rationale =
    direction === 'stable'
      ? `Movement (${rawDelta.toFixed(2)}) within noise floor (${noiseFloor.toFixed(2)}).`
      : `Earlier mean ${mean(earlier).toFixed(2)} → later mean ${mean(later).toFixed(2)} (rel change ${(relativeChange * 100).toFixed(1)}%, ${desiredDirection}-is-better → ${direction}).`;

  return {
    direction,
    magnitude,
    confidence,
    sampleCount: n,
    spanDays,
    rationale,
  };
}
