/**
 * Vision-LLM helper for extracting biomarker panels from lab report images.
 * Uses the existing AI_COACH_* env. The configured AI_COACH_MODEL must be
 * a vision-capable model (e.g. gpt-4o, claude-3.5-sonnet via OpenAI-compatible
 * proxies). When env is missing or the call fails, the extractor returns null
 * and the route surfaces a clear error to the caller.
 *
 * The extractor returns the raw LLM JSON. Marker-key normalization + catalog
 * validation happen in the route so the LLM doesn't have to know our schema
 * verbatim — it just returns lab-report names + values + units, and the route
 * maps to our canonical keys.
 */

import { REFERENCE_CATALOG } from './reference-ranges';

export type ExtractedBiomarker = {
  /** Raw name as it appeared on the report. */
  rawName: string;
  value: number;
  unit: string;
  /** Optional reference range from the lab report, captured for traceability. */
  referenceRange?: string;
};

export type RawExtractedPanel = {
  panelDate: string | null;
  provider: string | null;
  panelName: string | null;
  markers: ExtractedBiomarker[];
  rawText?: string;
};

type LlmEnv = { apiKey: string; model: string; baseUrl: string };

function readLlmEnv(): LlmEnv | null {
  const apiKey = process.env.AI_COACH_API_KEY;
  const model = process.env.AI_COACH_MODEL;
  const baseUrl = process.env.AI_COACH_BASE_URL;
  if (!apiKey || !model || !baseUrl) return null;
  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, '') };
}

function buildSystemPrompt(): string {
  // Surface the supported catalog keys so the LLM can match where possible.
  const knownMarkers = Object.values(REFERENCE_CATALOG)
    .map((spec) => `  - ${spec.key} (${spec.displayName}, canonical unit ${spec.canonicalUnit})`)
    .join('\n');

  return `You extract structured biomarker panel data from images of lab reports.

Return a single JSON object with this shape — no commentary, no markdown, no code fences:

{
  "panelDate": "YYYY-MM-DD" | null,
  "provider": "Quest" | "LabCorp" | "..." | null,
  "panelName": "Annual longevity panel" | null,
  "markers": [
    {
      "rawName": "exact text as printed on the report",
      "value": <number>,
      "unit": "mg/dL" | "mmol/L" | "%" | ...,
      "referenceRange": "the reference range printed on the report" | null
    }
  ]
}

Rules:
- Extract every numeric biomarker line item you can see.
- For markers known to this system, prefer the original printed unit — do
  NOT convert. The downstream normalizer handles unit conversion.
- If panel date is illegible, set it to null.
- Use null for any field you cannot extract with high confidence.
- Numeric values must be parsed as JSON numbers (e.g. 80, not "80").
- Do not invent values. If unsure, omit the marker.

Known markers in our catalog (you may extract others — the system will
flag any not in this list as "unknown"):
${knownMarkers}`;
}

/**
 * Extract biomarker data from an image using a vision-capable LLM.
 * Returns null when env is missing or the LLM call fails entirely.
 * Throws when the response is non-JSON or fundamentally malformed.
 */
export async function extractPanelFromImage(args: {
  imageBase64: string;
  mimeType: string;
}): Promise<RawExtractedPanel | null> {
  const env = readLlmEnv();
  if (!env) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let raw: string | null = null;
  try {
    const response = await fetch(`${env.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        model: env.model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the biomarker panel from this image. Respond with JSON only.' },
              {
                type: 'image_url',
                image_url: { url: `data:${args.mimeType};base64,${args.imageBase64}` },
              },
            ],
          },
        ],
        // gpt-5.5 / o1 / o3 only accept temperature=1; temp 0 used to be
        // ideal for deterministic OCR but the reasoning models reject it.
        // Determinism for the extraction is now carried by response_format
        // (forces strict JSON) instead of temperature.
        temperature: 1,
        // Use OpenAI's newer parameter so reasoning-class models (o1/o3/gpt-5)
        // don't reject the request with `unsupported_parameter: max_tokens`.
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    raw = data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!raw) return null;

  // Parse + validate the LLM's JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Vision LLM returned non-JSON output');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Vision LLM returned a non-object payload');
  }
  const obj = parsed as Record<string, unknown>;
  const markersRaw = obj.markers;
  if (!Array.isArray(markersRaw)) {
    throw new Error("Vision LLM did not return a 'markers' array");
  }

  const markers: ExtractedBiomarker[] = [];
  for (const m of markersRaw) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (typeof r.rawName !== 'string' || typeof r.value !== 'number' || typeof r.unit !== 'string') {
      continue;
    }
    markers.push({
      rawName: r.rawName,
      value: r.value,
      unit: r.unit,
      referenceRange: typeof r.referenceRange === 'string' ? r.referenceRange : undefined,
    });
  }

  const panelDate = typeof obj.panelDate === 'string' ? obj.panelDate : null;
  const provider = typeof obj.provider === 'string' ? obj.provider : null;
  const panelName = typeof obj.panelName === 'string' ? obj.panelName : null;

  return { panelDate, provider, panelName, markers };
}

// ---------------------------------------------------------------------------
// Catalog matching
// ---------------------------------------------------------------------------

/**
 * Map a free-form raw lab-report name to a catalog markerKey using a
 * loose fuzzy match. Returns null when nothing in the catalog matches.
 *
 * Matching rules (in priority order):
 *  1. Exact key match (e.g. "apob" → apob).
 *  2. Exact displayName match (case-insensitive).
 *  3. displayName substring match.
 *  4. Alias hint dictionary (e.g. "ldl cholesterol calculation" → ldl_c).
 */
const ALIAS_HINTS: Record<string, string> = {
  'apolipoprotein b': 'apob',
  apob: 'apob',
  'ldl cholesterol': 'ldl_c',
  'ldl-c': 'ldl_c',
  'ldl calc': 'ldl_c',
  'hdl cholesterol': 'hdl_c',
  'hdl-c': 'hdl_c',
  triglyceride: 'triglycerides',
  triglycerides: 'triglycerides',
  'lipoprotein(a)': 'lp_a',
  'lp(a)': 'lp_a',
  'lp a': 'lp_a',
  'fasting glucose': 'fasting_glucose',
  glucose: 'fasting_glucose',
  hba1c: 'hba1c',
  'hemoglobin a1c': 'hba1c',
  'fasting insulin': 'fasting_insulin',
  insulin: 'fasting_insulin',
  'high-sensitivity c-reactive protein': 'hs_crp',
  'high sensitivity crp': 'hs_crp',
  'hs-crp': 'hs_crp',
  hscrp: 'hs_crp',
  'total testosterone': 'total_testosterone',
  testosterone: 'total_testosterone',
  '25-hydroxy vitamin d': 'vitamin_d',
  'vitamin d': 'vitamin_d',
  'vitamin d, 25-hydroxy': 'vitamin_d',
  ferritin: 'ferritin',
  'omega-3 index': 'omega_3_index',
  'omega 3 index': 'omega_3_index',
  alt: 'alt',
  'alanine aminotransferase': 'alt',
  egfr: 'egfr',
  'estimated gfr': 'egfr',
};

export function matchRawNameToCatalogKey(rawName: string): string | null {
  const normalized = rawName.toLowerCase().trim().replace(/[,.]/g, '');

  if (REFERENCE_CATALOG[normalized]) return normalized;

  for (const [k, spec] of Object.entries(REFERENCE_CATALOG)) {
    if (spec.displayName.toLowerCase() === normalized) return k;
  }

  if (ALIAS_HINTS[normalized]) return ALIAS_HINTS[normalized];

  for (const [alias, key] of Object.entries(ALIAS_HINTS)) {
    if (normalized.includes(alias)) return key;
  }

  for (const [k, spec] of Object.entries(REFERENCE_CATALOG)) {
    if (normalized.includes(spec.displayName.toLowerCase())) return k;
  }

  return null;
}
