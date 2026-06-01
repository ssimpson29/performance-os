import { describe, expect, it } from 'vitest';

import { disconnectIntegration } from '../lib/integrations/disconnect';

// supabase stub: from(table).delete({count}).eq().eq() -> { count, error }.
function makeSupabase(counts: Record<string, number>, opts: { errorTable?: string } = {}) {
  const calls: Array<{ table: string; filters: Record<string, string> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder: Record<string, unknown> = {};
      builder.delete = () => builder;
      builder.eq = (col: string, val: string) => {
        filters[col] = val;
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) => {
        calls.push({ table, filters: { ...filters } });
        if (opts.errorTable === table) return resolve({ count: null, error: { message: 'boom' } });
        return resolve({ count: counts[table] ?? 0, error: null });
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe('disconnectIntegration', () => {
  it('oura: deletes recovery_daily(source=oura) + sync_runs + integration, not workouts', async () => {
    const { client, calls } = makeSupabase({ recovery_daily: 26, sync_runs: 3, user_integrations: 1 });
    const res = await disconnectIntegration(client, { userId: 'u1', provider: 'oura' });

    expect(res).toEqual({
      provider: 'oura',
      deletedRecovery: 26,
      deletedWorkouts: 0,
      deletedSyncRuns: 3,
      integrationRemoved: true,
    });
    const tables = calls.map((c) => c.table);
    expect(tables).toContain('recovery_daily');
    expect(tables).toContain('sync_runs');
    expect(tables).toContain('user_integrations');
    expect(tables).not.toContain('workouts');
    // scoped to the athlete + provider
    expect(calls.find((c) => c.table === 'recovery_daily')?.filters).toEqual({ user_id: 'u1', source: 'oura' });
    expect(calls.find((c) => c.table === 'sync_runs')?.filters).toEqual({ user_id: 'u1', provider: 'oura' });
  });

  it('strava: deletes workouts(source=strava) + sync_runs + integration, not recovery', async () => {
    const { client, calls } = makeSupabase({ workouts: 12, sync_runs: 5, user_integrations: 1 });
    const res = await disconnectIntegration(client, { userId: 'u1', provider: 'strava' });

    expect(res).toMatchObject({ provider: 'strava', deletedWorkouts: 12, deletedRecovery: 0, integrationRemoved: true });
    const tables = calls.map((c) => c.table);
    expect(tables).toContain('workouts');
    expect(tables).not.toContain('recovery_daily');
    expect(calls.find((c) => c.table === 'workouts')?.filters).toEqual({ user_id: 'u1', source: 'strava' });
  });

  it('is idempotent: zero counts + integrationRemoved=false when nothing exists', async () => {
    const { client } = makeSupabase({});
    const res = await disconnectIntegration(client, { userId: 'u1', provider: 'oura' });
    expect(res).toMatchObject({ deletedRecovery: 0, deletedSyncRuns: 0, integrationRemoved: false });
  });

  it('throws with a clear message on a delete error', async () => {
    const { client } = makeSupabase({}, { errorTable: 'recovery_daily' });
    await expect(disconnectIntegration(client, { userId: 'u1', provider: 'oura' })).rejects.toThrow(/recovery_daily/);
  });
});
