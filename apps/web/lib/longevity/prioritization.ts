import type { BiomarkerDomain, MarkerFlag } from './reference-ranges';
import type { TrendDirection, TrendMagnitude } from './trend-detection';

/**
 * Deterministic Longevity Guru prioritization. Produces an ordered list
 * of "levers" — high-level domains the athlete should act on — with the
 * top 3 surfaced as priorities and the rest listed as "watching".
 *
 * Signal blending:
 *   - flag === 'high' or 'low' adds substantial severity (clinical out-of-range).
 *   - optimalDelta (fraction of optimal-range width) adds proportional severity.
 *   - trend direction modifies severity: 'degrading' adds, 'improving' subtracts,
 *     'stable' is neutral. Magnitude scales the contribution.
 *   - Recent training-load overreach (caller-provided) adds severity to the
 *     `performance_recovery` lever.
 *
 * Domain priority weighting (general-adult default) is used as a tie-breaker
 * only — higher weights surface first when severities are equal. The
 * weighting reflects evidence-base for longevity impact at population scale;
 * it's not a personalization layer (that comes later).
 */

export type MarkerInput = {
  markerKey: string;
  displayName: string;
  domain: BiomarkerDomain;
  flag: MarkerFlag;
  optimalDelta: number;
  trend: {
    direction: TrendDirection;
    magnitude: TrendMagnitude;
  } | null;
};

export type TrainingLoadOverreachInput = {
  /** True when sustained overreach is observed (e.g., HRV down 4+ weeks). */
  sustainedOverreach: boolean;
  description?: string;
};

export type PrioritizeLongevityActionsInput = {
  markers: MarkerInput[];
  trainingLoadOverreach?: TrainingLoadOverreachInput;
};

export type LongevityLever = {
  leverKey: BiomarkerDomain;
  severity: number;
  contributingMarkers: string[];
  recommendation: string;
  rationale: string;
};

export type PrioritizeLongevityActionsResult = {
  /** Top 1-3 levers ordered by severity desc. */
  priorities: LongevityLever[];
  /** Lower-severity levers surfaced as 'watching'. */
  watching: LongevityLever[];
};

const DOMAIN_PRIORITY_WEIGHT: Record<BiomarkerDomain, number> = {
  cardiometabolic: 1.2,
  inflammation: 1.1,
  performance_recovery: 1.05,
  hormonal: 1.0,
  nutrients: 0.95,
  liver_kidney: 0.9,
  other: 0.5,
};

const LEVER_RECOMMENDATION: Record<BiomarkerDomain, string> = {
  cardiometabolic: 'Tighten metabolic + cardiovascular levers (ApoB / glycemic control).',
  inflammation: 'Reduce inflammatory load (sleep, alcohol, sub-clinical infection sources, dietary inflammation).',
  hormonal: 'Investigate hormonal axis (sleep, training stress, body composition, periodic labs).',
  nutrients: 'Address nutrient gap (food-first; targeted supplementation only as needed).',
  liver_kidney: 'Check liver/kidney function inputs (alcohol load, hydration, recent NSAID use).',
  performance_recovery: 'Defend recovery capacity (sustained training load may be eroding adaptation).',
  other: 'Investigate further.',
};

function severityForMarker(m: MarkerInput): number {
  let s = 0;
  if (m.flag === 'high' || m.flag === 'low') s += 1.0;
  // Optimal delta — cap at 2.0 so a single far-off marker can't dominate.
  s += Math.min(2.0, m.optimalDelta);

  if (m.trend) {
    const magBoost = m.trend.magnitude === 'major' ? 0.6 : m.trend.magnitude === 'moderate' ? 0.3 : 0.1;
    if (m.trend.direction === 'degrading') s += magBoost;
    if (m.trend.direction === 'improving') s -= magBoost;
  }

  return Math.max(0, s);
}

export function prioritizeLongevityActions(
  input: PrioritizeLongevityActionsInput,
): PrioritizeLongevityActionsResult {
  const byDomain = new Map<BiomarkerDomain, LongevityLever>();

  for (const m of input.markers) {
    const sev = severityForMarker(m);
    if (sev <= 0) continue;
    const existing = byDomain.get(m.domain);
    if (existing) {
      existing.severity += sev;
      existing.contributingMarkers.push(m.displayName);
    } else {
      byDomain.set(m.domain, {
        leverKey: m.domain,
        severity: sev,
        contributingMarkers: [m.displayName],
        recommendation: LEVER_RECOMMENDATION[m.domain],
        rationale: `Marker(s) outside or trending against optimal in ${m.domain}.`,
      });
    }
  }

  // Training-load overreach lever — only when caller flagged it.
  if (input.trainingLoadOverreach?.sustainedOverreach) {
    const existing = byDomain.get('performance_recovery');
    const overreachBoost = 1.5; // ranks above purely-metabolic signals when equal severity from markers
    if (existing) {
      existing.severity += overreachBoost;
      existing.rationale = `${existing.rationale} Sustained training-load overreach signal added.`;
    } else {
      byDomain.set('performance_recovery', {
        leverKey: 'performance_recovery',
        severity: overreachBoost,
        contributingMarkers: ['Training load overreach'],
        recommendation: LEVER_RECOMMENDATION.performance_recovery,
        rationale:
          input.trainingLoadOverreach.description ??
          'Sustained training-load overreach over the recent window — recovery markers degrading.',
      });
    }
  }

  // Apply domain weighting to break ties; sort severity desc, then weight desc.
  const ranked = [...byDomain.values()].sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return DOMAIN_PRIORITY_WEIGHT[b.leverKey] - DOMAIN_PRIORITY_WEIGHT[a.leverKey];
  });

  return {
    priorities: ranked.slice(0, 3),
    watching: ranked.slice(3),
  };
}
