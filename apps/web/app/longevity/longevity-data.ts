import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  LongevityContext,
  LongevityGuruOutput,
  LongevityMarkerEvaluation,
} from '@/lib/agents/longevity-guru';
import type { LongevityLever } from '@/lib/longevity/prioritization';
import { getAuthenticatedUser } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export type LongevityPageState =
  | { kind: 'unauthenticated' }
  | { kind: 'no-data'; userId: string; email?: string | null }
  | {
      kind: 'ready';
      userId: string;
      email?: string | null;
      latestPanel: { panelDate: string; provider: string | null; panelName: string | null } | null;
      priorities: LongevityLever[];
      watching: LongevityLever[];
      narrative: string | null;
      cautions: string[];
      markerEvaluations: LongevityMarkerEvaluation[];
      longevityContext: LongevityContext | null;
      conflictsWithTraining: Array<{ leverKey: string; description: string }>;
    };

type DailySummaryRow = {
  summary: Record<string, unknown> | null;
};

type LabPanelRow = {
  panel_date: string;
  provider: string | null;
  panel_name: string | null;
};

async function loadLatestPanel(
  supabase: SupabaseClient,
  userId: string,
): Promise<LabPanelRow | null> {
  const { data, error } = await supabase
    .from('lab_panels')
    .select('panel_date, provider, panel_name')
    .eq('user_id', userId)
    .order('panel_date', { ascending: false })
    .limit(1);
  if (error) return null;
  return ((data as LabPanelRow[] | null) ?? [])[0] ?? null;
}

async function loadDailyLongevityState(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('daily_summaries')
    .select('summary')
    .eq('user_id', userId)
    .eq('day', today)
    .limit(1);
  if (error) return null;
  const row = ((data as DailySummaryRow[] | null) ?? [])[0];
  return (row?.summary ?? null) as Record<string, unknown> | null;
}

export async function loadLongevityPageState(args?: { today?: string }): Promise<LongevityPageState> {
  try {
    return await loadLongevityPageStateUnsafe(args);
  } catch (err) {
    console.error('loadLongevityPageState failed:', err instanceof Error ? err.message : err);
    return { kind: 'unauthenticated' };
  }
}

async function loadLongevityPageStateUnsafe(args?: { today?: string }): Promise<LongevityPageState> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { kind: 'unauthenticated' };
  }

  const supabase = createServerSupabaseClient();
  const today = args?.today ?? new Date().toISOString().slice(0, 10);
  const [latestPanel, summary] = await Promise.all([
    loadLatestPanel(supabase, user.id),
    loadDailyLongevityState(supabase, user.id, today),
  ]);

  if (!latestPanel) {
    return { kind: 'no-data', userId: user.id, email: user.email };
  }

  const blob = summary ?? {};
  return {
    kind: 'ready',
    userId: user.id,
    email: user.email,
    latestPanel: {
      panelDate: latestPanel.panel_date,
      provider: latestPanel.provider,
      panelName: latestPanel.panel_name,
    },
    priorities: (blob.longevityPriorities as LongevityGuruOutput['priorities'] | undefined) ?? [],
    watching: (blob.longevityWatching as LongevityGuruOutput['watching'] | undefined) ?? [],
    narrative: (blob.longevityNarrative as string | undefined) ?? null,
    cautions: (blob.longevityCautions as string[] | undefined) ?? [],
    markerEvaluations: [],
    longevityContext: (blob.longevityContext as LongevityContext | undefined) ?? null,
    conflictsWithTraining: [],
  };
}
