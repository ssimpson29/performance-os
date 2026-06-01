import { NextResponse } from 'next/server';

import { disconnectIntegration, type DisconnectableProvider } from '@/lib/integrations/disconnect';
import { getAuthenticatedUserId } from '@/lib/server-auth';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const PROVIDERS: ReadonlySet<DisconnectableProvider> = new Set(['oura', 'strava']);

/**
 * POST /api/integrations/disconnect  { provider: 'oura' | 'strava' }
 *
 * Auth-scoped. Disconnects the integration for the SIGNED-IN athlete and
 * deletes the data ingested from that provider (terms-compliance: stop
 * retaining provider data on disconnect). Never trusts a caller-supplied
 * userId — always the session athlete.
 */
export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { provider?: string } | null;
  const provider = body?.provider;
  if (!provider || !PROVIDERS.has(provider as DisconnectableProvider)) {
    return NextResponse.json(
      { error: `Unknown provider. Expected one of: ${[...PROVIDERS].join(', ')}.` },
      { status: 400 },
    );
  }

  try {
    const supabase = createServerSupabaseClient();
    const result = await disconnectIntegration(supabase, {
      userId,
      provider: provider as DisconnectableProvider,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed.';
    console.error('[integrations/disconnect] failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
