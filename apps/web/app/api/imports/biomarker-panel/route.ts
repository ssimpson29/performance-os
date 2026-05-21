import { NextResponse } from 'next/server';

import { evaluateMarker, getMarkerSpec, type BiomarkerDomain } from '@/lib/longevity/reference-ranges';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

type IncomingMarker = {
  markerKey: string;
  value: number;
  unit: string;
};

type IncomingPanel = {
  panelDate: string;
  provider?: string;
  panelName?: string;
  notes?: string;
  markers: IncomingMarker[];
};

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as IncomingPanel | null;
  if (!body) {
    return NextResponse.json({ error: 'Missing or invalid JSON body' }, { status: 400 });
  }
  if (!body.panelDate || !isValidIsoDate(body.panelDate)) {
    return NextResponse.json({ error: 'panelDate must be an ISO date (YYYY-MM-DD)' }, { status: 400 });
  }
  if (!Array.isArray(body.markers) || body.markers.length === 0) {
    return NextResponse.json({ error: 'markers array is required and must be non-empty' }, { status: 400 });
  }

  // Validate every marker before any DB writes — fail-fast preserves
  // the all-or-nothing semantics callers expect from an import.
  const validated: Array<{
    incoming: IncomingMarker;
    displayName: string;
    domain: BiomarkerDomain;
    evaluation: ReturnType<typeof evaluateMarker>;
  }> = [];
  for (const m of body.markers) {
    if (!m.markerKey || typeof m.value !== 'number' || !m.unit) {
      return NextResponse.json(
        { error: `Each marker must include markerKey, numeric value, and unit (offender: ${JSON.stringify(m)})` },
        { status: 400 },
      );
    }
    const spec = getMarkerSpec(m.markerKey);
    if (!spec) {
      return NextResponse.json(
        { error: `Unknown marker key '${m.markerKey}'. See lib/longevity/reference-ranges.ts for the supported catalog.` },
        { status: 400 },
      );
    }
    let evaluation: ReturnType<typeof evaluateMarker>;
    try {
      evaluation = evaluateMarker({ markerKey: m.markerKey, value: m.value, unit: m.unit });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'evaluation failed';
      return NextResponse.json({ error: `Marker '${m.markerKey}': ${message}` }, { status: 400 });
    }
    validated.push({
      incoming: m,
      displayName: spec.displayName,
      domain: spec.domain,
      evaluation,
    });
  }

  const supabase = createServerSupabaseClient();

  // Insert the panel.
  const { data: panel, error: panelError } = await supabase
    .from('lab_panels')
    .insert({
      user_id: userId,
      panel_date: body.panelDate,
      provider: body.provider ?? null,
      panel_name: body.panelName ?? null,
      notes: body.notes ?? null,
    })
    .select('id')
    .single();
  if (panelError || !panel) {
    return NextResponse.json(
      { error: `Failed to create lab_panel: ${panelError?.message ?? 'no row returned'}` },
      { status: 500 },
    );
  }

  const panelId = (panel as { id: string }).id;

  // Insert the marker rows in one shot.
  const resultRows = validated.map((v) => ({
    user_id: userId,
    lab_panel_id: panelId,
    domain: v.domain,
    biomarker_key: v.incoming.markerKey,
    display_name: v.displayName,
    value_numeric: v.incoming.value,
    unit: v.incoming.unit,
    reference_low: v.evaluation.reference?.low ?? null,
    reference_high: v.evaluation.reference?.high ?? null,
    optimal_low: v.evaluation.optimal?.low ?? null,
    optimal_high: v.evaluation.optimal?.high ?? null,
    status: v.evaluation.flag,
    measured_at: body.panelDate,
    metadata: { evaluatedAt: new Date().toISOString(), rationale: v.evaluation.rationale },
  }));

  const { error: resultsError } = await supabase.from('biomarker_results').insert(resultRows);
  if (resultsError) {
    return NextResponse.json(
      { error: `Failed to insert biomarker_results: ${resultsError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    panelId,
    importedMarkerCount: resultRows.length,
    summary: validated.map((v) => ({
      markerKey: v.incoming.markerKey,
      displayName: v.displayName,
      flag: v.evaluation.flag,
      optimalDelta: v.evaluation.optimalDelta,
    })),
  });
}
