import { NextResponse } from 'next/server';

import {
  extractPanelFromImage,
  matchRawNameToCatalogKey,
  type ExtractedBiomarker,
} from '@/lib/longevity/image-extraction';
import { getMarkerSpec } from '@/lib/longevity/reference-ranges';
import { getAuthenticatedUserId } from '@/lib/server-auth';

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

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

  const arrayBuf = await file.arrayBuffer();
  const imageBase64 = Buffer.from(arrayBuf).toString('base64');

  let extracted;
  try {
    extracted = await extractPanelFromImage({ imageBase64, mimeType: file.type });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vision extraction failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!extracted) {
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
    const unitMatchesCanonical = spec ? m.unit === spec.canonicalUnit : false;
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
