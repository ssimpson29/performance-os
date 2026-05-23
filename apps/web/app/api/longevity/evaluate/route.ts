import { NextResponse } from 'next/server';

import { runLongevityGuru, type LongevityMarkerInput } from '@/lib/agents/longevity-guru';
import { checkRateLimit } from '@/lib/rate-limit';
import { persistLongevityRun } from '@/lib/longevity/persistence';
import { loadSoul } from '@/lib/profile/soul-loader';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

type BiomarkerResultRow = {
  biomarker_key: string;
  value_numeric: number | null;
  unit: string | null;
  measured_at: string;
};

type UserRow = {
  date_of_birth: string | null;
  sex: string | null;
};

function ageFromDob(dob: string | null, today: string): number | undefined {
  if (!dob) return undefined;
  const dobDate = new Date(`${dob.slice(0, 10)}T00:00:00.000Z`);
  const todayDate = new Date(`${today.slice(0, 10)}T00:00:00.000Z`);
  const ms = todayDate.getTime() - dobDate.getTime();
  if (ms <= 0) return undefined;
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

function normalizeSex(value: string | null): 'male' | 'female' | undefined {
  if (value === 'male' || value === 'female') return value;
  return undefined;
}

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rate = checkRateLimit({ key: `longevity-evaluate:${userId}`, limit: 5, windowMs: 60_000 });
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Re-evaluating too frequently. Try again shortly.', retryAfterMs: rate.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    athleteQuestion?: string;
    healthHistory?: string[];
  } | null;

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  // Load the athlete's biomarker history — every result keyed by biomarker_key.
  const { data: resultsData, error: resultsError } = await supabase
    .from('biomarker_results')
    .select('biomarker_key, value_numeric, unit, measured_at')
    .eq('user_id', userId)
    .order('measured_at', { ascending: true });
  if (resultsError) {
    return NextResponse.json({ error: `Failed to load biomarker_results: ${resultsError.message}` }, { status: 500 });
  }

  const rows = (resultsData as BiomarkerResultRow[] | null) ?? [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No biomarker results found for athlete. Import a panel first.' },
      { status: 400 },
    );
  }

  // Bucket rows by biomarker_key. Most recent row is the "current value";
  // earlier rows feed the trend detector.
  const byKey = new Map<string, BiomarkerResultRow[]>();
  for (const row of rows) {
    if (row.value_numeric == null || !row.unit) continue;
    const list = byKey.get(row.biomarker_key) ?? [];
    list.push(row);
    byKey.set(row.biomarker_key, list);
  }

  const markers: LongevityMarkerInput[] = [];
  for (const [key, list] of byKey) {
    const latest = list[list.length - 1];
    if (latest.value_numeric == null || !latest.unit) continue;
    markers.push({
      markerKey: key,
      value: latest.value_numeric,
      unit: latest.unit,
      history: list.map((r) => ({ date: r.measured_at, value: r.value_numeric as number })),
    });
  }

  // Optional age/sex from the users row (best-effort; columns may not exist on all schemas).
  let age: number | undefined;
  let sex: 'male' | 'female' | undefined;
  const { data: userRow } = await supabase
    .from('users')
    .select('date_of_birth, sex')
    .eq('id', userId)
    .limit(1);
  const u = (userRow as UserRow[] | null)?.[0];
  if (u) {
    age = ageFromDob(u.date_of_birth, today);
    sex = normalizeSex(u.sex);
  }

  // Load the longevity soul so the guru can frame recommendations through
  // the athlete's stated doctor / influencer preferences. Best-effort —
  // missing soul is fine, the guru just runs without that framing.
  let longevitySoul: string | undefined;
  try {
    const soul = await loadSoul(supabase, userId, 'longevity');
    longevitySoul = soul.content.trim() || undefined;
  } catch (err) {
    console.warn('[longevity/evaluate] failed to load longevity soul:', err);
  }

  const output = await runLongevityGuru({
    today,
    age,
    sex,
    markers,
    athleteQuestion: body?.athleteQuestion,
    healthHistory: body?.healthHistory,
    longevitySoul,
  });

  const persisted = await persistLongevityRun(supabase, { userId, today, output });

  return NextResponse.json({
    priorities: output.priorities,
    watching: output.watching,
    markerEvaluations: output.markerEvaluations,
    narrative: output.narrative,
    cautions: output.cautions,
    longevityContext: output.longevityContext,
    conflictsWithTraining: output.conflictsWithTraining,
    llmInvoked: output.llmInvoked,
    persisted,
  });
}
