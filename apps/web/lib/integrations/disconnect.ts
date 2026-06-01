import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Disconnect an integration and DELETE the data ingested from it.
 *
 * Provider API terms (esp. Strava's 2024 agreement) require that a third party
 * stop retaining provider data once the athlete disconnects. This removes:
 *   - the provider-sourced rows (recovery_daily for Oura, workouts for Strava),
 *   - the provider's sync_runs,
 *   - the user_integrations row itself (revokes our stored tokens).
 *
 * Athlete-scoped (caller passes the authenticated userId). Idempotent: a
 * disconnect when nothing exists returns zero counts, not an error.
 *
 * Known limitation: a Strava description previously forwarded onto a canonical
 * Apple-sourced workout row is NOT scrubbed (we don't track per-field
 * provenance). The Strava-sourced rows themselves are deleted. Noted for a
 * future provenance-aware cleanup.
 */

export type DisconnectableProvider = 'oura' | 'strava';

export type DisconnectResult = {
  provider: DisconnectableProvider;
  deletedRecovery: number;
  deletedWorkouts: number;
  deletedSyncRuns: number;
  integrationRemoved: boolean;
};

async function deleteWhere(
  supabase: SupabaseClient,
  table: string,
  match: Record<string, string>,
): Promise<number> {
  let query = supabase.from(table).delete({ count: 'exact' });
  for (const [col, val] of Object.entries(match)) query = query.eq(col, val);
  const { count, error } = await query;
  if (error) throw new Error(`Failed to delete from ${table}: ${error.message}`);
  return count ?? 0;
}

export async function disconnectIntegration(
  supabase: SupabaseClient,
  args: { userId: string; provider: DisconnectableProvider },
): Promise<DisconnectResult> {
  const { userId, provider } = args;

  // Delete the provider-sourced data first, then the integration row, so a
  // mid-failure leaves the (still-connected) integration able to retry.
  const deletedRecovery =
    provider === 'oura' ? await deleteWhere(supabase, 'recovery_daily', { user_id: userId, source: 'oura' }) : 0;
  const deletedWorkouts =
    provider === 'strava' ? await deleteWhere(supabase, 'workouts', { user_id: userId, source: 'strava' }) : 0;
  const deletedSyncRuns = await deleteWhere(supabase, 'sync_runs', { user_id: userId, provider });
  const integrationRemoved =
    (await deleteWhere(supabase, 'user_integrations', { user_id: userId, provider })) > 0;

  return { provider, deletedRecovery, deletedWorkouts, deletedSyncRuns, integrationRemoved };
}
