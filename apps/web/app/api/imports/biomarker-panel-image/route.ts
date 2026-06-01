import { NextResponse } from 'next/server';

import {
  extractPanelFromImage,
  matchRawNameToCatalogKey,
  unitsEquivalent,
  type ExtractedBiomarker,
} from '@/lib/longevity/image-extraction';
import { getMarkerSpec } from '@/lib/longevity/reference-ranges';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Vision-capable chat completions APIs accept image MIME types via the
// `image_url` content type, and PDFs via the `file` content type
// (OpenAI native support, added late 2024). The extractor dispatches on
// mimeType. Older models that don't accept the `file` content type
// return a 400 that bubbles up with a clear message — no silent fallback.
const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

type ReviewMarker = {
  rawName: string;
  value: number;
  unit: string;
  referenceRange?: string;
  /** Matched catalog markerKey, or null when no catalog entry matched. */
  markerKey: string | null;
  /** Display name from the catalog when matched. */
  displayName: string | null;
  /** Canonical unit from the catalog when matched. */
  canonicalUnit: string | null;
  /** True when raw unit equals the catalog canonical unit. */
  unitMatchesCanonical: boolean;
  inCatalog: boolean;
};

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rate = checkRateLimit({ key: `biomarker-image:${userId}`, limit: 3, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Image extraction is rate-limited. Try again shortly.', retryAfterMs: rate.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400 });
  }
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'image' file field" }, { status: 400 });
  }
  if (!SUPPORTED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported MIME type '${file.type}'. Supported: ${[...SUPPORTED_MIME].join(', ')}.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: `Image exceeds the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB upload limit. Compress or reshoot the lab report and try again.`,
        actualBytes: file.size,
        maxBytes: MAX_IMAGE_BYTES,
      },
      { status: 413 },
    );
  }

  const arrayBuf = await file.arrayBuffer();
  const imageBase64 = Buffer.from(arrayBuf).toString('base64');

  // Best-effort supabase for usage telemetry only — never let it block
  // extraction (e.g. missing service env in a non-prod context).
  let usageSupabase;
  try {
    usageSupabase = createServerSupabaseClient();
  } catch {
    usageSupabase = undefined;
  }

  let extracted;
  try {
    extracted = await extractPanelFromImage({
      imageBase64,
      mimeType: file.type,
      // OpenAI requires `filename` on the `file` content type for PDFs.
      // Pass the original upload name; fall back to a generic when the
      // browser somehow sent an empty name.
      filename: file.name || 'lab-report',
      userId,
      supabase: usageSupabase,
    });
  } catch (err) {
    // Vision LLM threw — propagate the real error (API rejection, timeout,
    // malformed JSON, missing markers array). This is NOT the "env missing"
    // path; env-missing is the only case where extractPanelFromImage now
    // returns null without throwing.
    const message = err instanceof Error ? err.message : 'Vision extraction failed';
    console.error('[biomarker-panel-image] extraction threw:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!extracted) {
    // Only path to `null` is `readLlmEnv()` returning null — i.e. one of
    // AI_COACH_API_KEY / AI_COACH_MODEL / AI_COACH_BASE_URL is unset.
    return NextResponse.json(
      {
        error:
          'Vision LLM is not configured. Set AI_COACH_API_KEY, AI_COACH_MODEL (vision-capable, e.g. gpt-4o), and AI_COACH_BASE_URL.',
      },
      { status: 503 },
    );
  }

  const warnings: string[] = [];
  if (!extracted.panelDate) warnings.push('Could not extract panel date — set it before saving.');

  const review: ReviewMarker[] = extracted.markers.map((m: ExtractedBiomarker) => {
    const markerKey = matchRawNameToCatalogKey(m.rawName);
    const spec = markerKey ? getMarkerSpec(markerKey) : null;
    // Use unitsEquivalent so "mL/min/1.73 m2" vs catalog "mL/min/1.73m2"
    // and "unit/L" vs "U/L" both compare as equal — strict string match
    // was producing bogus mismatch warnings for trivially-equivalent units.
    const unitMatchesCanonical = spec ? unitsEquivalent(m.unit, spec.canonicalUnit) : false;
    if (markerKey && spec && !unitMatchesCanonical) {
      warnings.push(
        `"${m.rawName}" matched ${spec.displayName} but the extracted unit '${m.unit}' doesn't equal the catalog unit '${spec.canonicalUnit}'. Convert before saving.`,
      );
    }
    return {
      rawName: m.rawName,
      value: m.value,
      unit: m.unit,
      referenceRange: m.referenceRange,
      markerKey,
      displayName: spec?.displayName ?? null,
      canonicalUnit: spec?.canonicalUnit ?? null,
      unitMatchesCanonical,
      inCatalog: Boolean(markerKey),
    };
  });

  const unmatched = review.filter((r) => !r.inCatalog);
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length} marker(s) didn't match the catalog and will be skipped on Save: ${unmatched.map((u) => u.rawName).join(', ')}.`,
    );
  }

  return NextResponse.json({
    panelDate: extracted.panelDate,
    provider: extracted.provider,
    panelName: extracted.panelName,
    markers: review,
    warnings,
    llmInvoked: true,
  });
}
